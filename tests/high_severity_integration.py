"""High-severity regressions on disposable databases, two API processes and real Razor forms.
Requires the same isolated-cluster CARELINE_TEST_CONNECTION as tenancy_integration.py.
Optional Chromium checks require TEST_BROWSER_EXECUTABLE and Playwright in NODE_PATH.
"""
import concurrent.futures
import datetime as dt
import hashlib
import hmac
import http.cookiejar
import json
import os
from pathlib import Path
import re
import socket
import ssl
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

root = Path(__file__).resolve().parents[1]
dotnet = os.environ.get('TEST_DOTNET', 'dotnet')
parent = os.environ.get('CARELINE_TEST_CONNECTION', '')
match = re.search(r'(?:^|;)Database=([^;]+)', parent, re.I)
if not match or not any(v in match[1].lower() for v in ['test', 'integration']):
    raise SystemExit('A disposable test/integration coordinator is required.')
password, proxy_key = 'High-test-' + uuid.uuid4().hex, uuid.uuid4().hex + uuid.uuid4().hex
processes, logs = [], []
checks = 0

def assembly(project):
    key = 'TEST_API_DLL' if project.endswith('Api') else 'TEST_WEB_DLL'
    return os.environ.get(key, str(root/'src'/project/f'bin/Release/net10.0/{project}.dll'))

def content_root(project):
    key = 'TEST_API_DLL' if project.endswith('Api') else 'TEST_WEB_DLL'
    return Path(assembly(project)).parent if os.environ.get(key) else root/'src'/project

def check(value, name):
    global checks
    if not value: raise AssertionError(name)
    checks += 1
    print('PASS ' + name, flush=True)

def address():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return 'http://127.0.0.1:' + str(s.getsockname()[1])

class Client:
    def __init__(self, base, token='', clinic='main', identity=None):
        self.base, self.token, self.clinic, self.identity = base, token, clinic, identity
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(self, path, body=None, headers=None):
        h = dict(headers or {})
        h['X-Clinic'] = self.clinic
        if self.token: h['Authorization'] = 'Bearer ' + self.token
        if self.identity:
            stamp = str(int(time.time()))
            h.update({'X-Web-Client': self.identity, 'X-Web-Time': stamp,
                'X-Web-Signature': hmac.new(proxy_key.encode(), (self.identity+'\n'+stamp).encode(), hashlib.sha256).hexdigest()})
        data = None if body is None else json.dumps(body).encode()
        if data is not None: h['Content-Type'] = 'application/json'
        try: response = self.opener.open(urllib.request.Request(self.base+path, data, h), timeout=20)
        except urllib.error.HTTPError as e: response = e
        raw = response.read().decode()
        try: value = json.loads(raw)
        except ValueError: value = raw
        return response.status, value, dict(response.headers)
    def ok(self, path, body=None):
        status, value, _ = self.request(path, body)
        if status != 200: raise AssertionError(f'{path}: {status}: {value}')
        return value
    def login(self, email, platform=False):
        self.token = self.ok('/api/platform/login' if platform else '/api/auth/login', {'email':email,'password':password})['accessToken']
        return self

with tempfile.TemporaryDirectory(prefix='careline-high-') as directory:
    fixture = str(Path(directory)/'fixtures.json')
    dll = str(root/'tests/Appointments.DatabaseTests/bin/Release/net10.0/Appointments.DatabaseTests.dll')
    fixture_env = dict(os.environ, ConnectionStrings__Appointments=parent)
    def fixture_op(operation, data=None):
        result = subprocess.run([dotnet,dll,operation,fixture],env=fixture_env,input=None if data is None else json.dumps(data),capture_output=True,text=True,check=True,timeout=45)
        return result.stdout.strip()
    def sql(query, database=0):
        return json.loads(fixture_op('--tenant-query', {'database':database,'sql':query}))
    def start(project, base, env, maintenance=None):
        log = open(Path(directory)/(project+str(len(logs))+'.log'),'w+')
        logs.append(log)
        command = [dotnet,assembly(project)]
        command += maintenance if maintenance else ['--urls',base]
        process = subprocess.Popen(command,cwd=content_root(project),env=env,stdout=log,stderr=log)
        processes.append(process)
        if maintenance:
            code=process.wait(timeout=60)
            if code: log.seek(0); raise AssertionError(log.read())
            return process
        for _ in range(400):
            if process.poll() is not None: log.seek(0); raise AssertionError(log.read())
            try:
                if Client(base).request('/health/live' if project.endswith('Api') else '/Account/Login')[0] == 200: return process
            except OSError: pass
            time.sleep(.1)
        raise AssertionError('Startup timeout')
    try:
        fixture_op('--tenant-create')
        clinical, platform = json.loads(Path(fixture).read_text())
        env={k:v for k,v in os.environ.items() if not k.startswith(('Tenancy__','Bootstrap__','Platform__','Demo__','Database__','ConnectionStrings__','Hosting__','Backend__'))}
        env.update(ASPNETCORE_ENVIRONMENT='Development',Hosting__AllowHttpForTesting='true',Hosting__WebProxyKey=proxy_key,
            ConnectionStrings__Appointments=clinical,ConnectionStrings__Platform=platform,Database__ApplyMigrations='true',Demo__Enabled='false',
            Platform__Bootstrap__Email='company@high.test',Platform__Bootstrap__Password=password,Logging__LogLevel__Default='Warning')
        for i,cid in enumerate(['main','east']):
            for key,value in {'Id':cid,'Name':cid,'TimeZone':'Europe/Skopje','BootstrapEmail':cid+'@high.test','BootstrapPassword':password}.items():env[f'Tenancy__Clinics__{i}__{key}']=value
        api, api2, web = address(), address(), address()
        start('Appointments.Api',api,env)
        start('Appointments.Api',api2,env)
        admin=Client(api,identity='203.0.113.1').login('main@high.test')
        east=Client(api,clinic='east',identity='203.0.113.2').login('east@high.test')
        sql('UPDATE clinic_east."Settings" SET "Value"=\'wrong\' WHERE "Key"=\'ClinicId\'')
        check(Client(api,identity='203.0.113.3').login('main@high.test').token, 'H04 unrelated misbound clinic cannot block healthy login')
        check(east.request('/api/bootstrap')[0]==503, 'Misbound clinic itself fails closed')
        sql('UPDATE clinic_east."Settings" SET "Value"=\'east\' WHERE "Key"=\'ClinicId\'')
        # Global identity uniqueness is checked at both service and SQL boundaries.
        check(Client(api,clinic='east').request('/api/auth/register',dict(name='Duplicate',email='main@high.test',password=password,phone="070123456"))[0]==409,'Global identity uniqueness survives indexed login')
        target=admin.ok('/api/accounts',dict(name='Target Reception',email='target@high.test',password=password,role='Administrator'))
        old_target=Client(api,identity='203.0.113.4').login('target@high.test')
        if os.environ.get('TEST_BROWSER_EXECUTABLE'):
            start('Appointments.Web',web,dict(env,Backend__Mode='Api',Backend__ApiBaseUrl=api+'/',Hosting__TrustedProxies__0='127.0.0.1'))
            subprocess.run(['node','tests/frontend/high-severity.cjs'],cwd=root,env=dict(env,TEST_WEB_URL=web,TEST_PASSWORD=password),check=True,timeout=50)
            check(old_target.request('/api/auth/me')[0]==401,'H07 Web disable revokes sessions even after access is enabled again')
        # Give two administrators concurrent conflicting access requests across independent hosts.
        target_login=Client(api2,identity='203.0.113.5').login('target@high.test')
        with concurrent.futures.ThreadPoolExecutor() as pool:
            statuses=list(pool.map(lambda x:x[0].request('/api/accounts/'+x[1]+'/access',{'enabled':False})[0],[(admin,target['id']),(target_login,admin.ok('/api/auth/me')['actor']['id'])]))
        check(statuses.count(200)==1 and any(status in [401,403] for status in statuses), 'H03 concurrent administrator disable permits one change and rejects revoked actor')
        check(sql('SELECT count(*) FROM public."Accounts" WHERE "Role"=\'Administrator\' AND "Enabled"')==1,'At least one enabled administrator survives')
        # Restore with SQL only inside this disposable fixture, preserving audit session rules.
        sql('UPDATE public."Accounts" SET "Enabled"=true')
        admin=Client(api,identity='203.0.113.6').login('main@high.test')
        spec=admin.ok('/api/catalogue/specialties',{'name':'Кардиологија'})
        doctors=[]
        for i in range(4):
            d=admin.ok('/api/catalogue/doctors',dict(name='Д-р Тест '+str(i),specialtyId=spec['id'],subspecialty='',enabled=True,requiresConfirmation=True))
            admin.ok('/api/schedule/'+d['id'],dict(version=1,durationMinutes=30,periods=[dict(day=x,start='09:00',end='17:00') for x in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]))
            doctors.append(d)
        profile=Client(api,identity='203.0.113.7').ok('/api/auth/register',dict(name='Ана Петрова',email='patient@high.test',password=password,phone="070123456"))
        patient=Client(api,identity='203.0.113.8').login('patient@high.test')
        # Request-scoped language changes must not alter authorization, data or protocol values.
        status,value,_=patient.request('/api/schedule/'+doctors[0]['id'],dict(version=1,durationMinutes=30,periods=[]),headers={'Accept-Language':'en-GB'})
        check(status==403 and value['error']=='Your account does not have permission for this action.','English API permission error retains its 403 status')
        def culture_error(language):
            return admin.request('/api/schedule/'+doctors[0]['id'],dict(version=0,durationMinutes=30,periods=[]),headers={'Accept-Language':language})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            english,macedonian=list(pool.map(culture_error,['en-GB','mk-MK']))
        check(english[0]==409 and 'schedule' in english[1]['error'].lower() and macedonian[0]==409 and 'Распоредот' in macedonian[1]['error'],'Concurrent PostgreSQL API requests retain independent language and conflict semantics')
        english_bootstrap=admin.request('/api/bootstrap',headers={'Accept-Language':'en-GB'})[1]
        check(next(d for d in english_bootstrap['doctors'] if d['id']==doctors[0]['id'])['specialty']=='Кардиологија' and english_bootstrap['actor']['role']=='Administrator','English API keeps stored Cyrillic records and protocol role values unchanged')
        date=(dt.date.fromisoformat(admin.ok('/api/bootstrap')['today'])+dt.timedelta(days=10)).isoformat()
        def command(d,time_value='09:00'):
            return dict(doctorId=d['id'],patientId=profile['patientId'],date=date,time=time_value,durationMinutes=30,requestId=uuid.uuid4().hex)
        commands=[command(doctors[0],f'{9+i//2:02d}:{(i%2)*30:02d}') for i in range(16)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda body:Client(api2,patient.token,identity='203.0.113.9').request('/api/appointments',body)[0],commands))
        check(results.count(200)==1 and results.count(409)==15,'H06 concurrent pending day-fill allows one request only')
        # Other doctors share the patient's overall cap, serialized by the patient lock.
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results=list(pool.map(lambda pair:Client(api2,patient.token).request('/api/appointments',command(pair[1],f'{11+pair[0]:02d}:00'))[0],enumerate(doctors[1:])))
        check(results.count(200)==2 and results.count(409)==1,'H06 cross-doctor concurrency cannot exceed three future visits')
        check(admin.request('/api/appointments',command(doctors[0],'16:30'))[0]==200,'Staff can authorize additional visits beyond patient self-service limits')
        # Signed clients share neither anonymous login nor discovery budgets with another visitor.
        noisy=Client(api,identity='203.0.113.20')
        for _ in range(30):check(noisy.request('/api/auth/login',dict(email='missing@high.test',password=password))[0]==401,'H02 independent visitor auth attempt')
        status,body,headers=noisy.request('/api/auth/login',dict(email='main@high.test',password=password))
        check(status==429 and 'error' in body and headers.get('Retry-After')=='60','H02 exhausted visitor gets structured 429 and retry time')
        check(Client(api,identity='203.0.113.21').login('main@high.test').token,'H02 second signed visitor remains able to log in')
        spoof=Client(api)
        for _ in range(30):spoof.request('/api/auth/login',dict(email='missing@high.test',password=password))
        check(spoof.request('/api/auth/login',dict(email='main@high.test',password=password),headers={'X-Web-Client':'203.0.113.99','X-Web-Time':str(int(time.time())),'X-Web-Signature':'0'*64})[0]==403,'Invalid signed forwarding identity fails closed')
        check(spoof.request('/api/auth/login',dict(email='main@high.test',password=password),headers={'X-Forwarded-For':'203.0.113.99'})[0]==429,'Untrusted forwarded address cannot bypass direct-peer limits')
        company=Client(api,identity='203.0.113.50').login('company@high.test',platform=True)
        company.ok('/api/platform/clinics/main/adopt',{})
        # Retain explicit non-ready managed entries: do not resurrect an adopted configured clinic.
        sql('UPDATE public."PlatformClinics" SET "State"=\'Failed\' WHERE "Id"=\'main\'',1)
        deadline=time.monotonic()+8
        while admin.request('/api/bootstrap')[0]==200 and time.monotonic()<deadline:time.sleep(.2)
        check(admin.request('/api/bootstrap')[0]==404,'Non-ready adopted clinic cannot fall back to enabled configured defaults')
        sql('UPDATE public."PlatformClinics" SET "State"=\'Ready\' WHERE "Id"=\'main\'',1)
        deadline=time.monotonic()+8
        while admin.request('/api/bootstrap')[0]!=200 and time.monotonic()<deadline:time.sleep(.2)
        check(admin.request('/api/bootstrap')[0]==200,'Validated registry recovery restores the managed clinic')
        # Registry dependency: healthy cached clinical reads continue briefly, readiness degrades, lease fails closed.
        sql('ALTER TABLE public."PlatformClinics" RENAME TO "PlatformClinics_fault"',1)
        deadline=time.monotonic()+10
        while Client(api).request('/health')[0]!=503 and time.monotonic()<deadline:time.sleep(.2)
        check(Client(api).request('/health')[0]==503,'H05 registry outage makes readiness unavailable')
        check(admin.request('/api/bootstrap')[0]==200,'H05 short registry outage does not synchronously stop clinical reads')
        check(Client(api,identity='203.0.113.40').login('main@high.test').token, 'Healthy clinical login also tolerates a brief registry outage')
        deadline=time.monotonic()+35
        while admin.request('/api/bootstrap')[0]==200 and time.monotonic()<deadline:time.sleep(.3)
        check(admin.request('/api/bootstrap')[0]==503,'H05 stale routing fails closed after the bounded 30-second lease')
        check(Client(api).request('/health/live')[0]==200,'Liveness remains separate from unavailable readiness')
        sql('ALTER TABLE public."PlatformClinics_fault" RENAME TO "PlatformClinics"',1)
        deadline=time.monotonic()+10
        while Client(api).request('/health')[0]!=200 and time.monotonic()<deadline:time.sleep(.2)
        check(admin.request('/api/bootstrap')[0]==200,'Registry recovery restores clinical reads without restart')
        # Preview seed is explicit, non-destructive and idempotent within its generated date window.
        for process in processes:
            if process.poll() is None:process.terminate();process.wait(timeout=10)
        maintenance=dict(env,Database__ApplyMigrations='false',Preview__AllowSeed='true')
        before=sql('SELECT count(*) FROM public."Appointments"')
        disabled = subprocess.run([dotnet,assembly('Appointments.Api'),'--seed-preview','--clinic','main'],cwd=content_root('Appointments.Api'),
            env=dict(maintenance,Preview__AllowSeed='false'),capture_output=True,text=True,timeout=45)
        check(disabled.returncode!=0 and 'Preview seeding is disabled' in disabled.stderr,'Preview maintenance refuses to seed without an explicit opt-in')
        start('Appointments.Api','',maintenance,['--seed-preview','--clinic','main'])
        seeded=sql('SELECT count(*) FROM public."Appointments"')
        check(sql("SELECT count(*) FROM public.\"Appointments\" WHERE \"Id\" NOT LIKE 'preview-%'")==before,'Preview seeding preserves all pre-existing appointment rows')
        check(seeded>before,'Explicit preview seed adds realistic history and upcoming appointments')
        check(sql("SELECT count(*) FROM public.\"Appointments\" a WHERE a.\"CreatedBy\"='preview-seed' AND NOT EXISTS (SELECT 1 FROM public.\"AppointmentHistory\" h WHERE h.\"AppointmentId\"=a.\"Id\" AND h.\"AppointmentVersion\"=a.\"Version\" AND h.\"AfterStatus\"=a.\"Status\")")==0,'Preview history matches every generated appointment status and version')
        start('Appointments.Api','',maintenance,['--seed-preview','--clinic','main'])
        check(sql('SELECT count(*) FROM public."Appointments"')==seeded,'Preview command preserves existing bookings and does not duplicate a repeated run')
        sql("DELETE FROM careline_identity.clinics WHERE clinic_id='east'")
        incomplete = subprocess.run([dotnet,assembly('Appointments.Api'),'--urls',address()],cwd=content_root('Appointments.Api'),
            env=dict(env,ASPNETCORE_ENVIRONMENT='Production',Database__ApplyMigrations='false'),capture_output=True,text=True,timeout=45)
        check(incomplete.returncode!=0 and 'Incomplete identity directory upgrade' in incomplete.stderr,'Incomplete identity backfill cannot silently serve traffic')
        start('Appointments.Api','',maintenance,['--migrate'])
        check(sql('SELECT count(*) FROM public."Appointments"')==seeded and sql('SELECT count(*) FROM careline_identity.clinics')==2,
            'Full repeatable maintenance upgrade repairs directory coverage and preserves appointments')
        # Production HTTP listener: no TLS port, default redirect cannot discover one, credentials still blocked.
        secure=address()
        # Readiness is HTTPS-only too, so start explicitly without the HTTP readiness helper.
        log=open(Path(directory)/'https.log','w+');logs.append(log)
        p=subprocess.Popen([dotnet,assembly('Appointments.Api'),'--urls',secure],cwd=content_root('Appointments.Api'),env=dict(env,ASPNETCORE_ENVIRONMENT='Production',Hosting__AllowHttpForTesting='false',Database__ApplyMigrations='false'),stdout=log,stderr=log);processes.append(p)
        for _ in range(150):
            try:
                status,body,_=Client(secure).request('/api/auth/login',dict(email='main@high.test',password=password))
                break
            except OSError:time.sleep(.1)
        check(status==403 and 'accessToken' not in body,'H01 HTTP-only Production listener rejects credentials when HTTPS redirect port is unavailable')
        check(Client(secure).request('/api/auth/login',dict(email='main@high.test',password=password),headers={'X-Forwarded-Proto':'https'})[0]==403,'H01 untrusted forwarded HTTPS header cannot bypass transport enforcement')
        blocked_web=address()
        log=open(Path(directory)/'web-https.log','w+');logs.append(log)
        p=subprocess.Popen([dotnet,assembly('Appointments.Web'),'--urls',blocked_web],cwd=content_root('Appointments.Web'),env=dict(env,ASPNETCORE_ENVIRONMENT='Production',Hosting__AllowHttpForTesting='false',Backend__Mode='Api',Backend__ApiBaseUrl='https://localhost:5199/'),stdout=log,stderr=log);processes.append(p)
        for _ in range(150):
            try:
                web_status=Client(blocked_web).request('/Account/Login')[0]
                break
            except OSError:time.sleep(.1)
        check(web_status==403,'H01 Production Web also fails closed on an HTTP-only listener')
        if shutil.which('openssl'):
            cert, key = str(Path(directory)/'tls-cert.pem'), str(Path(directory)/'tls-key.pem')
            subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
                '-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout',key,'-out',cert],capture_output=True,check=True)
            tls=address().replace('http:','https:')
            log=open(Path(directory)/'tls.log','w+');logs.append(log)
            tls_env=dict(env,ASPNETCORE_ENVIRONMENT='Production',Hosting__AllowHttpForTesting='false',Database__ApplyMigrations='false',
                Kestrel__Certificates__Default__Path=cert,Kestrel__Certificates__Default__KeyPath=key)
            p=subprocess.Popen([dotnet,assembly('Appointments.Api'),'--urls',tls],cwd=content_root('Appointments.Api'),env=tls_env,stdout=log,stderr=log);processes.append(p)
            trusted=Client(tls,identity='203.0.113.60')
            trusted.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=cert)))
            for _ in range(150):
                try:
                    status,body,_=trusted.request('/api/auth/login',dict(email='main@high.test',password=password))
                    break
                except OSError:time.sleep(.1)
            check(status==200 and body.get('accessToken','').startswith('c1.main.'),'H01 real TLS listener accepts login with certificate validation enabled')
        else: print('SKIP positive TLS listener: OpenSSL not installed',flush=True)
        print(f'{checks}/{checks} high-severity integration checks passed.',flush=True)
    finally:
        for process in processes:
            if process.poll() is None:process.terminate();process.wait(timeout=15)
        for log in logs:log.close()
        if Path(fixture).exists():fixture_op('--tenant-drop')
