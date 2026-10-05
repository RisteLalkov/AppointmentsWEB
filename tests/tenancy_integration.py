"""Shared Web/API, three isolated PostgreSQL databases, two API instances.
Uses disposable databases/roles created under CARELINE_TEST_CONNECTION; never a production DB.
No third-party Python dependencies. Run after Release build.
"""
import concurrent.futures
import datetime as dt
import http.cookiejar
from html import unescape
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
    raise SystemExit('A disposable test/integration database is required.')
checks = 0
processes, logs = [], []
password = 'Tenancy-test-' + uuid.uuid4().hex

def check(ok, name):
    global checks
    if not ok: raise AssertionError(name)
    checks += 1
    print('PASS ' + name, flush=True)

def url():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return 'http://127.0.0.1:' + str(s.getsockname()[1])

class Client:
    def __init__(self, base, clinic=None, token=''):
        self.base, self.clinic, self.token, self.csrf = base, clinic, token, ''
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar))
    def request(self, path, data=None, form=False, headers=None):
        h = dict(headers or {})
        if self.clinic is not None: h.setdefault('X-Clinic', self.clinic)
        if self.token: h['Authorization'] = 'Bearer ' + self.token
        if path.startswith('/data/') and self.clinic is not None: h.setdefault('X-Workspace-Clinic', self.clinic)
        if self.csrf: h.setdefault('X-CSRF-TOKEN', self.csrf)
        if data is not None:
            h['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
            data = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
        try: response = self.opener.open(urllib.request.Request(self.base + path, data, h), timeout=30)
        except urllib.error.HTTPError as e: response = e
        text = response.read().decode()
        try: body = json.loads(text)
        except ValueError: body = unescape(text)
        return response.status, body
    def ok(self, path, data=None):
        code, body = self.request(path, data)
        if code != 200: raise AssertionError(f'{path}: {code}: {body}')
        return body
    def login(self, secret=password):
        session = self.ok('/api/auth/login', {'email': 'owner@tenancy.test', 'password': secret})
        check(session['clinic']['id'] == self.clinic, 'Session identifies selected clinic ' + self.clinic)
        self.token = session['accessToken']
        return self
    def demo(self, user):
        self.token = self.ok('/api/auth/demo-login', {'userId': user})['accessToken']
        return self
    def web_login(self, clinic, secret=password):
        self.csrf = ''
        _, page = self.request('/Account/Login?clinicId=' + clinic)
        token = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', page)[1]
        code, page = self.request('/Account/Login', {'Email':'owner@tenancy.test','Password':secret,'ClinicId':clinic,'__RequestVerificationToken':token}, form=True)
        check(code == 200 and 'main-content' in page and f'content="{clinic}"' in page, 'MVC signs into ' + clinic + ' and labels workspace')
        self.clinic = clinic
        self.csrf = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', page)[1]
        return page

def start(project, address, env, directory, extra=(), expect_failure=None):
    log = open(Path(directory) / f'{project}-{len(logs)}.log', 'w+')
    logs.append(log)
    p = subprocess.Popen([dotnet, str(root/'src'/project/f'bin/Release/net10.0/{project}.dll'), '--urls', address, *extra], cwd=root/'src'/project, env=env, stdout=log, stderr=log)
    processes.append(p)
    if expect_failure:
        check(p.wait(timeout=45) != 0, 'Invalid tenant configuration fails startup')
        log.flush(); log.seek(0)
        check(expect_failure in log.read(), 'Startup rejection identifies the tenant configuration error')
        return p
    for _ in range(600):
        if p.poll() is not None: raise AssertionError(project + ' exited before readiness')
        try:
            if Client(address).request('/health' if project.endswith('Api') else '/Account/Login')[0] == 200: return p
        except (OSError, urllib.error.URLError): pass
        time.sleep(.1)
    raise AssertionError('Startup timed out')

with tempfile.TemporaryDirectory(prefix='careline-tenancy-') as temporary:
    fixture = str(Path(temporary)/'databases.json')
    fixture_dll = str(root/'tests/Appointments.DatabaseTests/bin/Release/net10.0/Appointments.DatabaseTests.dll')
    fixture_env = dict(os.environ, ConnectionStrings__Appointments=connection)
    try:
        subprocess.run([dotnet,fixture_dll,'--tenant-create',fixture],env=fixture_env,check=True)
        conns = json.loads(Path(fixture).read_text())
        env = {k:v for k,v in os.environ.items() if not k.startswith(('Tenancy__','Bootstrap__'))}
        env.update(ASPNETCORE_ENVIRONMENT='Development', Database__ApplyMigrations='true', Demo__Enabled='true',
            Logging__LogLevel__Default='Warning', Logging__LogLevel__Microsoft='Warning',
            ConnectionStrings__Appointments=conns[0],Bootstrap__Email='owner@tenancy.test',Bootstrap__Password=password)
        first, second, web_url = url(), url(), url()
        legacy = start('Appointments.Api', first, env, temporary)
        old = Client(first,'main').login()
        original = old.ok('/api/bootstrap')
        legacy.terminate(); legacy.wait(timeout=15)
        # Adopt existing database without importing/moving any existing rows.
        for i, (cid,name,zone) in enumerate([('main','Прва клиника','Europe/Skopje'),('east','Втора клиника','Europe/Skopje'),('empty','Нова клиника','UTC')]):
            prefix = f'Tenancy__Clinics__{i}__'
            env['ConnectionStrings__Clinic'+str(i)] = conns[i]
            for key,value in {'Id':cid,'Name':name,'ConnectionStringName':'Clinic'+str(i),'TimeZone':zone,
                'ImportSourceDoctors':str(i==1).lower(),'SeedDemoData':str(i<2).lower(),
                'AllowRegistration':str(i<2).lower(),'BootstrapEmail':'owner@tenancy.test',
                'BootstrapPassword':password if i!=1 else password+'-east'}.items(): env[prefix+key]=value
        migration = subprocess.run([dotnet,str(root/'src/Appointments.Api/bin/Release/net10.0/Appointments.Api.dll'),'--migrate','--clinic','empty'], cwd=root/'src/Appointments.Api',env=env,capture_output=True,text=True,timeout=60)
        check(migration.returncode==0, 'Operator can migrate and initialize one selected clinic with CLI')
        one = start('Appointments.Api', first, env, temporary)
        two = start('Appointments.Api', second, env, temporary)
        a = Client(first,'main',old.token)
        b = Client(first,'east').login(password+'-east')
        c = Client(second,'empty').login()
        anon = Client(first)
        directory = anon.ok('/api/clinics')
        check({x['id'] for x in directory} == {'main','east','empty'} and all(set(x)=={'id','name','timeZone','allowRegistration'} for x in directory), 'Public clinic directory contains only intended public metadata')
        check(a.ok('/api/bootstrap')['appointments'] == original['appointments'], 'Existing clinic appointments and session survive adoption')
        check(anon.request('/api/bootstrap')[0] == 400, 'Multi-clinic API refuses missing clinic')
        check(Client(first,'unknown').request('/api/auth/login', {'email':'owner@tenancy.test','password':password})[0] == 404, 'Unknown clinic never falls back')
        check(Client(first,'MAIN').request('/api/bootstrap')[0] == 404, 'Malformed/case-changed clinic cannot select a different database')
        check(Client(first,'main,east').request('/api/bootstrap')[0] == 404, 'Ambiguous combined clinic header rejected')
        check(Client(first,'east').request('/api/auth/login', {'email':'owner@tenancy.test','password':password})[0] == 401, 'Same email in two clinics has independent passwords')
        for cid,token in [('east',a.token),('main',b.token),('empty',a.token)]:
            check(Client(second,cid,token).request('/api/bootstrap')[0] == 401, 'Cross-clinic bearer rejected for '+cid)
        check(Client(second,'east',a.token.replace('c1.main.','c1.east.')).request('/api/auth/me')[0] == 401, 'Editing token clinic prefix cannot transfer a session')
        check(Client(second,'main',a.token).ok('/api/auth/me')['clinic']['id']=='main', 'Clinic session works on second API instance')
        fresh = c.ok('/api/bootstrap')
        check(not any(fresh[x] for x in ['doctors','patients','appointments','services','specialties']) and fresh['timeZone']=='UTC', 'New clinic starts empty with its own timezone')
        check(Client(first,'empty').request('/api/auth/register', {'name':'Patient Test','email':'new@test.test','password':password})[0]==403, 'Registration policy belongs to clinic')
        check(Client(first,'empty').request('/api/auth/demo-login',{'userId':'admin'})[0]==404,'Demo login disabled for unseeded clinic')
        registration = {'name':'Same Person','email':'same@tenancy.test','password':password}
        ra = Client(first,'main').ok('/api/auth/register',registration)
        rb = Client(first,'east').ok('/api/auth/register',registration)
        check(ra['id']!=rb['id'], 'Patient self-registration creates separate clinic identities for same email')
        a2 = Client(second,'main',a.token)
        b2 = Client(second,'east',b.token)
        day = dt.date.fromisoformat(original['today'])+dt.timedelta(days=35)
        while day.weekday()>4: day+=dt.timedelta(days=1)
        day = day.isoformat()
        slot_path = '/api/slots?' + urllib.parse.urlencode({'doctorId':'d01','date':day})
        slots = a.ok(slot_path)
        command = {'doctorId':'d01','patientId':'p01','date':day,'time':slots[0]['time'],'durationMinutes':30,'requestId':str(uuid.uuid4())}
        aa = a.ok('/api/appointments',command)
        bb = b.ok('/api/appointments',command)
        check(aa['id']!=bb['id'], 'Same slot, doctor/patient IDs and request ID book independently in two clinics')
        check(a2.ok('/api/appointments',command)['id']==aa['id'] and b2.ok('/api/appointments',command)['id']==bb['id'], 'Idempotency is clinic-local across instances')
        check(b.ok('/api/appointments?patientId=p01')['items'] and all(x['id']!=aa['id'] for x in b.ok('/api/appointments')['items']), 'Appointment lists and patient filters cannot expose other clinic')
        for actor in [b,Client(second,'east').demo('p01'),Client(second,'east').demo('user-d01')]:
            check(actor.request('/api/appointments/'+aa['id']+'/history')[0]==404,'Other clinic history is inaccessible to '+actor.token[:8])
            check(actor.request('/api/appointments/'+aa['id']+'/move',{'date':day,'time':slots[1]['time'],'version':1})[0]==404,'Other clinic rescheduling rejected')
            check(actor.request('/api/appointments/'+aa['id']+'/status',{'status':'Cancelled','version':1})[0]==404,'Other clinic cancellation rejected')
        moved = a.ok('/api/appointments/'+aa['id']+'/move',{'date':day,'time':slots[1]['time'],'version':1})
        check(len(b.ok('/api/appointments/'+bb['id']+'/history')['entries'])==1, 'Rescheduling updates only owning clinic history')
        a.ok('/api/appointments/'+aa['id']+'/status',{'status':'Cancelled','version':moved['version']})
        check(b.ok('/api/appointments/'+bb['id']+'/history')['entries'][0]['afterStatus']=='Confirmed', 'Cancellation in one clinic leaves other booking confirmed')
        check(b.request('/api/accounts/'+ra['id']+'/access',{'enabled':False})[0]==404,'Other clinic account cannot be disabled')
        check(b.request('/api/accounts/'+ra['id']+'/credentials',{'email':'x@tenancy.test','password':password})[0]==404,'Other clinic credentials cannot be changed')
        check(not any(x['id']==ra['id'] for x in b.ok('/api/accounts')), 'Account lists are isolated')
        check(not any(x['targetId']==aa['id'] for x in b.ok('/api/accounts/audit?take=500')), 'Audit events are isolated')
        web_env=dict(env,Backend__Mode='Api',Backend__ApiBaseUrl=first+'/')
        start('Appointments.Web',web_url,web_env,temporary)
        subprocess.run(['node',str(root/'tests/frontend/tenancy.mjs')], env=dict(env,TEST_WEB_BASE=web_url,TEST_TENANT_PASSWORD=password),check=True)
        # New empty clinic can be configured through its existing management workflows.
        specialty = c.ok('/api/catalogue/specialties',{'name':'Самостојна специјалност'})
        doctor = c.ok('/api/catalogue/doctors',{'name':'Нов лекар','specialtyId':specialty['id'],'subspecialty':'','enabled':True})
        check(b.request('/api/catalogue/doctors',{'name':'Forbidden','specialtyId':specialty['id'],'enabled':True})[0]==400, 'Foreign clinic specialty cannot be assigned')
        periods = [{'day':d,'start':'09:00:00','end':'12:00:00'} for d in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]
        c.ok('/api/schedule/'+doctor['id'],{'version':1,'durationMinutes':30,'periods':periods})
        service = c.ok('/api/catalogue/services',{'name':'Нов преглед','specialtyId':specialty['id'],'durationMinutes':30,'enabled':True,'doctorIds':[doctor['id']]})
        patient = c.ok('/api/patients',{'name':'Измислен пациент','email':'fixture@tenancy.test','phone':''})
        visit = c.ok('/api/appointments',{'doctorId':doctor['id'],'patientId':patient['id'],'serviceId':service['id'],'date':day,'time':'09:00:00','durationMinutes':30,'requestId':str(uuid.uuid4())})
        check(visit['start'].endswith('+00:00') or visit['start'].endswith('Z'),'New clinic booking uses configured UTC timezone')
        check(not any(d['id']==doctor['id'] for d in a.ok('/api/bootstrap')['doctors']), 'Catalogues and newly created patients stay in owning clinic')
        check(b.request('/api/schedule/'+doctor['id'],{'version':1,'durationMinutes':30,'periods':periods})[0]==404,'Foreign clinic schedule cannot be changed')
        check(b.request('/api/appointments',{'doctorId':doctor['id'],'patientId':'p01','date':day,'time':'09:00:00','durationMinutes':30,'requestId':str(uuid.uuid4())})[0]==404,'Foreign doctor cannot be booked')
        exception = c.ok('/api/exceptions/'+doctor['id'],{'date':day,'start':'10:00:00','end':'11:00:00','isAvailable':False,'reason':'Пауза'})
        check(b.request('/api/exceptions/'+exception['id']+'/remove',{})[0]==404,'Foreign clinic exception cannot be deleted')
        check(not any(x['time']=='10:00:00' for x in c.ok('/api/slots?'+urllib.parse.urlencode({'doctorId':doctor['id'],'date':day,'serviceId':service['id']}))), 'Availability exceptions apply in owning clinic')
        report_path = '/api/reports?'+urllib.parse.urlencode({'from':day,'to':day,'groupBy':'day'})
        check(c.ok(report_path)['summary']['total']==1 and a.ok(report_path)['summary']['total']==1 and b.ok(report_path)['summary']['total']==1,'Reports aggregate each clinic independently')
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda i: Client(second,'main' if i%2==0 else 'east',a.token if i%2==0 else b.token).ok('/api/appointments/'+(aa['id'] if i%2==0 else bb['id'])+'/history')['entries'][0]['afterStatus'],range(24)))
        check(results==['Cancelled' if i%2==0 else 'Confirmed' for i in range(24)],'Concurrent mixed-clinic requests do not leak scoped DbContext state')
        browser=Client(web_url)
        page=browser.ok('/Account/Login')
        check(all(name in page for name in ['Прва клиника','Втора клиника','Нова клиника']), 'Login presents available clinic names in Macedonian')
        browser.web_login('main')
        old_csrf=browser.csrf
        check(any(x['id']==aa['id'] for x in browser.ok('/data/bootstrap')['appointments']), 'MVC uses clinic from protected session')
        check(browser.request('/data/bootstrap',headers={'X-Clinic':'east'})[0]==200 and any(x['id']==aa['id'] for x in browser.ok('/data/bootstrap')['appointments']), 'Client-supplied API clinic header cannot override MVC session')
        browser.web_login('east',password+'-east')
        check(browser.request('/data/bootstrap',headers={'X-Workspace-Clinic':'main'})[0]==409,'Stale tab cannot read new clinic data')
        check(browser.request('/data/patients',{'name':'Stale tab'},headers={'X-Workspace-Clinic':'main'})[0]==409,'Stale tab cannot write to new clinic')
        browser.csrf=old_csrf
        check(browser.request('/data/patients',{'name':'Stale form'})[0]==400,'Old clinic anti-forgery token fails even with current clinic header')
        browser.csrf=''
        check(browser.request('/Accounts/Access',{'id':rb['id'],'enabled':False,'__RequestVerificationToken':old_csrf},form=True)[0]==400,'Razor forms are also bound to original clinic')
        check(all(x['id']!=aa['id'] for x in browser.ok('/data/bootstrap')['appointments']),'After explicit login switch MVC sees only new clinic')
        # Both demo admins have the same ID; only the added clinic binding distinguishes their CSRF tokens.
        demo_browser=Client(web_url)
        old_demo_csrf=None
        for selected in ['main','east']:
            demo_browser.csrf=''
            _,page=demo_browser.request('/Demo?clinicId='+selected)
            form_token=re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"',page)[1]
            code,page=demo_browser.request('/Demo/Enter',{'userId':'admin','ClinicId':selected,'__RequestVerificationToken':form_token},form=True)
            check(code==200 and 'main-content' in page,'Demo workspace selected in '+selected)
            if selected=='main': old_demo_csrf=re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"',page)[1]
        demo_browser.clinic='east'; demo_browser.csrf=old_demo_csrf
        check(demo_browser.request('/data/patients',{'name':'Wrong clinic form'})[0]==400,'Clinic-bound CSRF rejects old form when both account IDs are identical')
        subprocess.run([dotnet,fixture_dll,'--tenant-check',fixture],env=fixture_env,check=True)
        # Disable a clinic by controlled registry reload. Other clinic sessions remain valid.
        one.terminate(); one.wait(timeout=15)
        disabled=dict(env,Tenancy__Clinics__1__Enabled='false')
        one=start('Appointments.Api',first,disabled,temporary)
        check(b.request('/api/bootstrap')[0]==404 and 'east' not in {x['id'] for x in Client(first).ok('/api/clinics')},'Disabled clinic rejects existing sessions and disappears from directory')
        check(a.ok('/api/auth/me')['clinic']['id']=='main','Other clinic remains available after disabling tenant')
        # Misconfiguration cannot silently bind one database to two clients.
        duplicate=dict(env,ConnectionStrings__Clinic1=conns[0])
        start('Appointments.Api',url(),duplicate,temporary,expect_failure='Each clinic must use a different PostgreSQL database')
        renamed=dict(env,Tenancy__Clinics__0__Id='wrong-clinic')
        start('Appointments.Api',url(),renamed,temporary,expect_failure="Database belongs to clinic 'main', not 'wrong-clinic'")
        print(f'\n{checks}/{checks} multi-tenant API/MVC isolation checks passed.',flush=True)
    except Exception:
        # Test accounts are disposable. Avoid dumping connection strings or session-bearing payloads.
        for log in logs:
            log.flush(); log.seek(0)
            lines=log.read().splitlines()
            print('\n'.join(line for line in lines[-25:] if 'Password=' not in line and 'accessToken' not in line))
        raise
    finally:
        for p in reversed(processes):
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=10)
                except subprocess.TimeoutExpired:p.kill();p.wait()
        for log in logs:log.close()
        if Path(fixture).exists(): subprocess.run([dotnet,fixture_dll,'--tenant-drop',fixture],env=fixture_env,check=True)
