"""Real PostgreSQL discovery/identity/platform regression suite. No production connections.
Requires Release build and CARELINE_TEST_CONNECTION with CREATEDB/CREATEROLE on a
DISPOSABLE test server. Creates a shared clinic database and a separate platform database and removes only those.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

root = Path(__file__).resolve().parents[1]
dotnet = os.environ.get('TEST_DOTNET', 'dotnet')
connection = os.environ.get('CARELINE_TEST_CONNECTION', '')
match = re.search(r'(?:^|;)Database=([^;]+)', connection, re.I)
if not match or not any(x in match[1].lower() for x in ('test', 'integration')):
    raise SystemExit('CARELINE_TEST_CONNECTION must identify a disposable test/integration database.')
password = 'Platform-test-' + uuid.uuid4().hex
count = 0
processes, logs = [], []

def check(ok, name):
    global count
    if not ok: raise AssertionError(name)
    count += 1
    print('PASS', name, flush=True)

def address():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return 'http://127.0.0.1:' + str(s.getsockname()[1])

class Client:
    def __init__(self, base, token='', clinic=None):
        self.base, self.token, self.clinic = base, token, clinic
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(self, path, data=None):
        h = {}
        if self.token: h['Authorization'] = 'Bearer ' + self.token
        if self.clinic: h['X-Clinic'] = self.clinic
        if data is not None:
            h['Content-Type'] = 'application/json'
            data = json.dumps(data).encode()
        try: r = self.opener.open(urllib.request.Request(self.base + path, data, h), timeout=120)
        except urllib.error.HTTPError as e: r = e
        text = r.read().decode()
        try: body = json.loads(text)
        except ValueError: body = text
        return r.status, body
    def ok(self, path, data=None):
        status, body = self.request(path, data)
        if status != 200: raise AssertionError(f'{path} returned {status}: {body}')
        return body
    def login(self, email, platform=False, secret=password):
        s = self.ok('/api/platform/login' if platform else '/api/auth/login', {'email':email,'password':secret})
        self.token = s['accessToken']
        if not platform: self.clinic = s['clinic']['id']
        return self

def start(base, env, temporary):
    log = open(Path(temporary) / f'api-{len(logs)}.log', 'w+'); logs.append(log)
    p = subprocess.Popen([dotnet,str(root/'src/Appointments.Api/bin/Release/net10.0/Appointments.Api.dll'),'--urls',base],cwd=root/'src/Appointments.Api',env=env,stdout=log,stderr=log)
    processes.append(p)
    for _ in range(600):
        if p.poll() is not None: raise AssertionError('API exited before readiness')
        try:
            if Client(base).request('/health')[0] == 200: return p
        except (OSError, urllib.error.URLError): pass
        time.sleep(.1)
    raise AssertionError('API startup timed out')

with tempfile.TemporaryDirectory(prefix='careline-platform-') as temporary:
    fixture = str(Path(temporary)/'databases.json')
    fixture_dll = str(root/'tests/Appointments.DatabaseTests/bin/Release/net10.0/Appointments.DatabaseTests.dll')
    fixture_env = dict(os.environ, ConnectionStrings__Appointments=connection)
    def sql(operation):
        subprocess.run([dotnet,fixture_dll,operation,fixture],env=fixture_env,check=True,timeout=90)
    try:
        sql('--tenant-create')
        conns = json.loads(Path(fixture).read_text())
        env = {k:v for k,v in os.environ.items() if not k.startswith(('Tenancy__','Bootstrap__','Platform__','ConnectionStrings__'))}
        env.update(ASPNETCORE_ENVIRONMENT='Development', Database__ApplyMigrations='true', Demo__Enabled='false',
            Logging__LogLevel__Default='Warning', Logging__LogLevel__Microsoft='Warning',
            ConnectionStrings__Appointments=conns[0], ConnectionStrings__Platform=conns[1],
            Bootstrap__Email='owner@platform.test', Bootstrap__Password=password,
            Platform__Bootstrap__Email='company@platform.test', Platform__Bootstrap__Password=password,
            Tenancy__ClinicName='Existing Test Clinic')
        first, second = address(), address()
        one = start(first,env,temporary)
        two = start(second,env,temporary)
        anon = Client(first)
        owner = Client(first).login('owner@platform.test')
        company = Client(first).login('company@platform.test',True)
        company2 = Client(second,company.token)
        check(anon.request('/api/platform/clinics')[0] == 401, 'Anonymous onboarding denied')
        check(owner.request('/api/platform/clinics')[0] == 401, 'Clinic administrator cannot enter platform boundary')
        check(Client(first,company.token,'main').request('/api/bootstrap')[0] == 401, 'Platform token is not a clinical session')
        check(anon.request('/api/bootstrap')[0] == 401, 'Private bootstrap remains protected')
        for query in ['page=0','page=101','pageSize=25','search='+'x'*101]:
            check(anon.request('/api/public/doctors?'+query)[0] == 400, 'Public query limits: '+query[:25])
        doctors = anon.ok('/api/public/doctors?pageSize=2')
        check(len(doctors['items']) == 2 and doctors['total'] > 2, 'Public doctors are paginated on server')
        allowed = {'id','name','specialty','subspecialty','clinic','services','staffOnly'}
        check(all(set(d) == allowed and set(d['clinic']) == {'id','name','timeZone','allowRegistration','description','address','phone'} for d in doctors['items']), 'Public DTOs exclude clinical and account metadata')
        page2 = anon.ok('/api/public/doctors?pageSize=2&page=2')['items']
        check(not {d['id'] for d in doctors['items']} & {d['id'] for d in page2}, 'Adjacent public pages do not repeat doctors')
        check(anon.ok('/api/public/doctors?clinic=nonexistent')['total'] == 0, 'Clinic-name filter runs on server')
        check(anon.request('/api/public/clinics/missing')[0] == 404, 'Unknown public clinic is not disclosed')
        payload = dict(id='new-clinic',name='New Test Clinic',timeZone='Europe/Skopje',description='Public test description',address=None,phone=None,discoverable=True,allowRegistration=True,adminName='New Owner',adminEmail='new-owner@platform.test',adminPassword=password+'-new')
        check(anon.request('/api/platform/clinics',payload)[0] == 401 and owner.request('/api/platform/clinics',payload)[0] == 401, 'Both anonymous and clinical POST onboarding rejected')
        check(company.request('/api/platform/clinics',dict(payload,id='../bad'))[0] == 400, 'Invalid clinic identity rejected before provisioning')
        check(company.request('/api/platform/clinics',dict(payload,adminEmail='owner@platform.test'))[0] == 409, 'Existing global login email cannot become a new clinic admin')
        sql('--tenant-contaminate')
        check(company.request('/api/platform/clinics',payload)[0] == 409, 'Provisioning refuses nonempty unbound schema in shared database')
        check(any(c['id']=='new-clinic' and c['state']=='Failed' for c in company.ok('/api/platform/clinics')), 'Failure is durably recorded for retry')
        check(anon.request('/api/public/clinics/new-clinic')[0] == 404, 'Incomplete clinic is not publicly discoverable')
        sql('--tenant-clean')
        with concurrent.futures.ThreadPoolExecutor() as pool:
            results = list(pool.map(lambda c:c.request('/api/platform/clinics',payload),[company,company2]))
        check(all(s == 200 and c['state']=='Ready' for s,c in results), 'Concurrent identical retries converge on one ready clinic')
        check(sum(c['id']=='new-clinic' for c in company2.ok('/api/platform/clinics')) == 1, 'Provisioning is idempotent across API instances')
        check(company.request('/api/platform/clinics',dict(payload,name='Overwrite'))[0] == 409, 'Retry cannot overwrite clinic metadata')
        admin = Client(second).login('new-owner@platform.test',secret=password+'-new')
        check(admin.clinic == 'new-clinic', 'New administrator automatically resolves to new clinic')
        fresh = admin.ok('/api/bootstrap')
        check(fresh['actor']['role']=='Administrator' and not fresh['patients'] and not fresh['doctors'], 'Provisioned clinic starts empty with correct administrator role')
        check(Client(second,admin.token,'main').request('/api/bootstrap')[0] == 401, 'New clinic token cannot access existing clinic')
        check(Client(first,owner.token,'new-clinic').request('/api/bootstrap')[0] == 401, 'Existing clinic token cannot access new clinic')
        spec = admin.ok('/api/catalogue/specialties',{'id':None,'name':'Test Specialty'})
        doctor = admin.ok('/api/catalogue/doctors',{'id':None,'name':'Test Public Doctor','specialtyId':spec['id'],'subspecialty':'','enabled':True})
        service = admin.ok('/api/catalogue/services',{'id':None,'name':'Test Public Service','specialtyId':spec['id'],'durationMinutes':30,'enabled':True,'doctorIds':[doctor['id']]})
        public = anon.ok('/api/public/doctors?clinicId=new-clinic&specialty=Test&service=Public')
        check(public['total']==1 and public['items'][0]['services'][0]['id']==service['id'], 'New clinic doctor and active services enter public search')
        # Broad search is OR across public fields, then AND with explicit refinements.
        from urllib.parse import urlencode
        main_spec=owner.ok('/api/catalogue/specialties',{'id':None,'name':'Discovery Main Specialty'})
        main_doc=owner.ok('/api/catalogue/doctors',{'id':None,'name':'Горан Марков (тест)','specialtyId':main_spec['id'],'subspecialty':'','enabled':True})
        other_doc=admin.ok('/api/catalogue/doctors',{'id':None,'name':'Горан Петров (тест)','specialtyId':spec['id'],'subspecialty':'Посебна субспецијалност','enabled':True})
        def search(**values): return anon.ok('/api/public/doctors?'+urlencode(values))
        named=search(search='  горан  ')
        check({(d['clinic']['id'],d['id']) for d in named['items']} >= {('main',main_doc['id']),('new-clinic',other_doc['id'])}, 'Partial Cyrillic name search spans clinics and specialties, ignores case/outer spaces')
        check(search(search='ГОРАН',clinicId='new-clinic')['total']==1, 'Explicit clinic scope still narrows broad search')
        check(search(search='Горан',specialty='Discovery Main')['total']==1, 'Explicit specialty combines with broad name search')
        check(search(search='New Test Clinic')['total']==2, 'Broad clinic-name search returns its enabled doctors')
        check(search(search='Test Specialty')['total']==2, 'Broad search matches specialty')
        check(search(search='субспецијалност')['total']==1, 'Broad search matches Cyrillic subspecialty')
        check(search(search='Public Service')['total']==1, 'Broad search matches enabled assigned service')
        check(search(service='Public')['total']==1 and search(specialty='Test Specialty')['total']==2, 'Service and specialty filters work alone')
        first_match=search(search='Горан',pageSize=1,page=1)
        second_match=search(search='Горан',pageSize=1,page=2)
        check(first_match['total']==second_match['total']==named['total'] and (first_match['items'][0]['clinic']['id'],first_match['items'][0]['id'])!=(second_match['items'][0]['clinic']['id'],second_match['items'][0]['id']), 'Broad cross-clinic search retains stable server pagination')
        # Real Cyrillic regression: also run this suite against a UTF-8 C-locale cluster.
        mk_spec=owner.ok('/api/catalogue/specialties',{'id':None,'name':'Ѓинекологија Ќ Тест'})
        mk_doc=owner.ok('/api/catalogue/doctors',{'id':None,'name':'Јован Нешковски','specialtyId':mk_spec['id'],'subspecialty':'Љубљана Џ Ѕ Тест','enabled':True})
        for term in ['Јован','Нешковски','Јован Нешковски','јован','НЕШКОВСКИ','  јОвАн нЕшКоВсКи  ']:
            matches=search(search=term)
            check(any(d['id']==mk_doc['id'] and d['clinic']['id']=='main' for d in matches['items']), 'Macedonian doctor search matches: '+term)
        mk_service=owner.ok('/api/catalogue/services',{'id':None,'name':'Ќирилична Ѕ Услуга','specialtyId':mk_spec['id'],'durationMinutes':30,'enabled':True,'doctorIds':[mk_doc['id']]})
        for field,term in [('search','ѓинекологија'),('specialty','ЃИНЕКОЛОГИЈА'),('search','љубљана'),('specialty','ЉУБЉАНА'),('search','ќирилична'),('service','ЌИРИЛИЧНА')]:
            check(any(d['id']==mk_doc['id'] for d in search(**{field:term})['items']), 'Macedonian field casing: '+field+'='+term)
        admin.ok('/api/catalogue/doctors',{'id':other_doc['id'],'name':other_doc['name'],'specialtyId':spec['id'],'subspecialty':'','enabled':False,'version':other_doc['catalogVersion']})
        admin.ok('/api/catalogue/doctors',{'id':doctor['id'],'name':doctor['name'],'specialtyId':spec['id'],'subspecialty':'','enabled':False,'version':doctor['catalogVersion']})
        check(anon.ok('/api/public/doctors?clinicId=new-clinic')['total']==0, 'Disabled doctor disappears from public results')
        # Agreed time is a reception-only atomic appointment + exact one-off period.
        import datetime as dt
        agreed_spec=owner.ok('/api/catalogue/specialties',{'id':None,'name':'Agreed booking'})
        agreed_doc=owner.ok('/api/catalogue/doctors',{'id':None,'name':'Doctor without schedule','specialtyId':agreed_spec['id'],'subspecialty':'','enabled':True,'requiresConfirmation':True})
        check(agreed_doc['requiresConfirmation'], 'Confirmation flag persists for new doctor')
        agreed_patient=owner.ok('/api/patients',{'name':'Agreed Patient','email':'agreed@platform.test','phone':''})
        agreed_date=(dt.date.fromisoformat(owner.ok('/api/bootstrap')['today'])+dt.timedelta(days=3)).isoformat()
        agreed_command=dict(doctorId=agreed_doc['id'],patientId=agreed_patient['id'],date=agreed_date,time='14:00',durationMinutes=30,requestId=uuid.uuid4().hex,agreedTime=True)
        check(owner.request('/api/appointments',dict(agreed_command,agreedTime=False))[0]==409, 'No-hours doctor rejects ordinary booking')
        agreed_visit=owner.ok('/api/appointments',agreed_command)
        check(agreed_visit['status']=='Confirmed','Doctor-agreed appointment is immediately confirmed')
        other_instance=Client(second,owner.token,'main')
        check(other_instance.ok('/api/appointments',agreed_command)['id']==agreed_visit['id'], 'Agreed booking replay is idempotent across API instances')
        check(any(e['id']=='agreed-'+agreed_visit['id'] for e in other_instance.ok('/api/exceptions?doctorId='+agreed_doc['id'])), 'One-off availability is persisted with appointment')
        check(owner.request('/api/appointments',dict(agreed_command,requestId=uuid.uuid4().hex))[0]==409,'Overlapping agreed booking is rejected')
        other_instance.ok('/api/appointments/'+agreed_visit['id']+'/status',dict(status='Cancelled',version=agreed_visit['version']))
        check(not any(e['id']=='agreed-'+agreed_visit['id'] for e in owner.ok('/api/exceptions?doctorId='+agreed_doc['id'])), 'Cancellation atomically removes agreed availability')
        check(owner.request('/api/appointments',dict(agreed_command,requestId=uuid.uuid4().hex,agreedTime=False))[0]==409, 'Cancelled agreement does not leave public bookable hours')
        agreed_doc=owner.ok('/api/catalogue/doctors',dict(id=agreed_doc['id'],name=agreed_doc['name'],specialtyId=agreed_spec['id'],subspecialty='',enabled=True,version=agreed_doc['catalogVersion'],requiresConfirmation=False))
        check(not agreed_doc['requiresConfirmation'], 'Confirmation flag can be disabled on an existing doctor')
        registration={'name':'Test Patient','email':'patient@platform.test','password':password}
        ra=Client(first,clinic='main').ok('/api/auth/register',registration)
        check(Client(second,clinic='new-clinic').request('/api/auth/register',registration)[0]==409,'Registration enforces global identity uniqueness')
        check(Client(first,clinic='new-clinic').login('patient@platform.test').clinic=='main','Forged clinic hint cannot move a patient identity')
        sql('--tenant-duplicate')
        missing = anon.request('/api/auth/login',{'email':'missing@platform.test','password':password})
        for secret in [password,password+'-new']:
            check(anon.request('/api/auth/login',{'email':'owner@platform.test','password':secret})==missing,'Legacy ambiguous identity rejected with generic login error')
        sql('--tenant-restore-identity')
        check(Client(first).login('new-owner@platform.test',secret=password+'-new').clinic=='new-clinic','Explicitly resolving duplicate restores credentials-only login')
        extra=dict(payload,id='third-clinic',name='Third Test Clinic',adminEmail='third-owner@platform.test')
        check(company.ok('/api/platform/clinics',extra)['state']=='Ready', 'Another clinic provisions without a database pool or additional connection string')
        third=Client(second).login('third-owner@platform.test',secret=password+'-new')
        check(not third.ok('/api/bootstrap')['doctors'], 'Additional clinic remains empty and isolated in shared database')
        sql('--tenant-platform-check')
        company.ok('/api/platform/password',{'currentPassword':password,'newPassword':password+'-changed'})
        check(company2.request('/api/platform/clinics')[0]==401,'Platform password change revokes sessions across instances')
        changed = Client(first).login('company@platform.test',True,password+'-changed')
        changed.ok('/api/platform/logout',{})
        check(changed.request('/api/platform/clinics')[0]==401,'Platform logout revokes its opaque token')
        for _ in range(5):
            check(Client(first).request('/api/platform/login',{'email':'company@platform.test','password':'wrong-password'})[0]==401,'Company incorrect password rejected')
        check(Client(first).request('/api/platform/login',{'email':'company@platform.test','password':password+'-changed'})[0]==401,'Company lockout remains active for a correct password')
        # Hidden clinics remain accessible to their own accounts, but not public discovery.
        one.terminate(); one.wait(timeout=15)
        hidden=dict(env,Tenancy__Discoverable='false')
        start(first,hidden,temporary)
        check(Client(first).request('/api/public/clinics/main')[0]==404,'Hidden configured clinic excluded from public profile')
        check(Client(first).login('owner@platform.test').clinic=='main','Hidden clinic still supports secure login')
        check(Client(first).login('third-owner@platform.test',secret=password+'-new').clinic=='third-clinic', 'Managed clinic survives API restart in shared database')
        print(f'\n{count}/{count} PostgreSQL platform/discovery checks passed.',flush=True)
    except Exception:
        for log in logs:
            log.flush();log.seek(0)
            print('\n'.join(line for line in log.read().splitlines()[-20:] if 'Password=' not in line and 'accessToken' not in line))
        raise
    finally:
        for p in reversed(processes):
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=10)
                except subprocess.TimeoutExpired:p.kill();p.wait()
        for log in logs:log.close()
        if Path(fixture).exists():sql('--tenant-drop')
