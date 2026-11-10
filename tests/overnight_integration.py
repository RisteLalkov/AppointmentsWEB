"""Overnight reliability regressions against a disposable clinic, real Web/API/PostgreSQL and Chromium."""
import datetime as dt
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

root = Path(__file__).resolve().parents[1]
parent = os.environ.get('CARELINE_TEST_CONNECTION', '')
match = re.search(r'(?:^|;)Database=([^;]+)', parent, re.I)
if not match or not any(v in match[1].lower() for v in ['test', 'integration']):
    raise SystemExit('A disposable test/integration coordinator is required.')
if not os.environ.get('TEST_BROWSER_EXECUTABLE'):
    raise SystemExit('Chromium and Playwright are required for this suite.')
dotnet = os.environ.get('TEST_DOTNET', 'dotnet')
password = 'Feedback-test-' + uuid.uuid4().hex
processes, logs = [], []

def address():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return 'http://127.0.0.1:' + str(sock.getsockname()[1])

with tempfile.TemporaryDirectory(prefix='medtermin-overnight-') as temporary:
    fixture = str(Path(temporary)/'fixtures.json')
    fixture_dll = root/'tests/Appointments.DatabaseTests/bin/Release/net10.0/Appointments.DatabaseTests.dll'
    def fixture_op(operation):
        subprocess.run([dotnet, str(fixture_dll), operation, fixture],
            env=dict(os.environ, ConnectionStrings__Appointments=parent), check=True, capture_output=True, timeout=45)
    def start(project, url, env):
        key = 'TEST_API_DLL' if project.endswith('Api') else 'TEST_WEB_DLL'
        assembly = Path(os.environ.get(key, str(root/'src'/project/f'bin/Release/net10.0/{project}.dll')))
        content = assembly.parent if os.environ.get(key) else root/'src'/project
        log = open(Path(temporary)/(project+'.log'), 'w+')
        logs.append(log)
        proc = subprocess.Popen([dotnet, str(assembly), '--urls', url], cwd=content, env=env, stdout=log, stderr=log)
        processes.append(proc)
        for _ in range(400):
            if proc.poll() is not None: raise AssertionError(project+' exited during startup')
            try:
                with urllib.request.urlopen(url+('/health/live' if project.endswith('Api') else '/Account/Login'), timeout=2) as response:
                    if response.status == 200: return
            except OSError: pass
            time.sleep(.1)
        raise AssertionError(project+' startup timed out')
    try:
        fixture_op('--tenant-create')
        clinical = json.loads(Path(fixture).read_text())[0]
        env = {k:v for k,v in os.environ.items() if not k.startswith(('Tenancy__','Bootstrap__','Platform__','Demo__','Database__','ConnectionStrings__','Hosting__','Backend__'))}
        env.update(ASPNETCORE_ENVIRONMENT='Development', Hosting__AllowHttpForTesting='true', Hosting__WebProxyKey=uuid.uuid4().hex+uuid.uuid4().hex,
            ConnectionStrings__Appointments=clinical, Database__ApplyMigrations='true', Demo__Enabled='false',
            Tenancy__Clinics__0__Id='main', Tenancy__Clinics__0__Name='Клиника за тестирање', Tenancy__Clinics__0__TimeZone='Europe/Skopje',
            Tenancy__Clinics__0__ImportSourceDoctors='false', Tenancy__Clinics__0__SeedDemoData='false',
            Tenancy__Clinics__0__BootstrapEmail='admin@feedback.test', Tenancy__Clinics__0__BootstrapPassword=password,
            Logging__LogLevel__Default='Warning')
        env.update(ConnectionStrings__Platform=json.loads(Path(fixture).read_text())[1],Platform__Bootstrap__Email='company@overnight.test',Platform__Bootstrap__Password=password)
        for key,value in dict(Id='havana',Name='Клиника Хавана',TimeZone='America/Havana',ImportSourceDoctors='false',SeedDemoData='false',BootstrapEmail='havana@overnight.test',BootstrapPassword=password).items():env['Tenancy__Clinics__1__'+key]=value
        selected_clinic='main'
        api, web = address(), address()
        start('Appointments.Api', api, env)
        token = ''
        def request(path, data=None):
            headers = {'X-Clinic':selected_clinic}
            if token: headers['Authorization'] = 'Bearer '+token
            if data is not None: headers['Content-Type'] = 'application/json'
            with urllib.request.urlopen(urllib.request.Request(api+path, None if data is None else json.dumps(data).encode(), headers), timeout=20) as response:
                return json.load(response)
        token = request('/api/auth/login', dict(email='admin@feedback.test', password=password))['accessToken']
        failures=[];count=0
        def check(ok,label):
            global count
            count+=1;print(('PASS' if ok else 'FAIL')+' overnight '+label,flush=True)
            if not ok:failures.append(label)
        def status(path,body=None):
            try:return 200,request(path,body)
            except urllib.error.HTTPError as e:
                raw=e.read().decode()
                try:value=json.loads(raw)
                except ValueError:value=raw
                return e.code,value
        def catalogue():
            sp=request('/api/catalogue/specialties',dict(name='Кардиологија'))
            doctors=[]
            for name in ['Д-р Ана Стојанова','Д-р Петар Николов']:
                d=request('/api/catalogue/doctors',dict(name=name,specialtyId=sp['id'],subspecialty='',enabled=True,requiresConfirmation=False))
                request('/api/schedule/'+d['id'],dict(version=1,durationMinutes=30,periods=[dict(day=day,start='09:00',end='17:00') for day in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]))
                doctors.append(d)
            service=request('/api/catalogue/services',dict(name='Преглед',specialtyId=sp['id'],durationMinutes=30,enabled=True,doctorIds=[d['id'] for d in doctors]))
            return doctors,service
        doctors,service=catalogue();people=[request('/api/patients',dict(name='Пациент '+str(i),email=f'overnight-{i}@example.test',phone='')) for i in range(2)]
        today=dt.date.fromisoformat(request('/api/bootstrap')['today']);day=(today+dt.timedelta(days=5)).isoformat()
        check(status('/api/reports?from=9999-12-31&to=9999-12-31&groupBy=day')[0]==400,'Maximum-date reports produce validation rather than HTTP 500')
        check(status('/api/schedule/'+doctors[0]['id'],dict(version=2,durationMinutes=30,periods=[dict(day='Monday',start='09:00:00.0000001',end='17:00')]))[0]==400,'Fractional-minute working hours are rejected before PostgreSQL can round them')
        check(status('/api/exceptions/'+doctors[0]['id'],dict(date=day,start='09:00:30',end='10:00',isAvailable=True,reason='Extra period'))[0]==400,'Sub-minute availability exceptions receive a controlled validation response')
        check(status('/api/auth/login',dict(email='admin@feedback.test',password=password,padding='x'*70000))[0]==413,'An oversized request is reported as HTTP 413 rather than a server error')
        legacy=request('/api/catalogue/doctors',dict(name='Лекар без услуги',specialtyId=service['specialtyId'],subspecialty='',enabled=True,requiresConfirmation=False))
        request('/api/schedule/'+legacy['id'],dict(version=1,durationMinutes=30,periods=[dict(day=weekday,start='09:00',end='17:00') for weekday in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]))
        empty_service=dict(doctorId=legacy['id'],patientId=people[1]['id'],date=day,time='14:00',durationMinutes=30,requestId=str(uuid.uuid4()),serviceId='')
        code,visit=status('/api/appointments',empty_service)
        check(code==200 and visit.get('serviceId') is None,'An empty optional service is normalized before database writes')
        if code==200:
            replay_code,replay=status('/api/appointments',dict(empty_service,serviceId=None))
            check(replay_code==200 and replay['id']==visit['id'],'Empty and null optional services have the same idempotent booking identity')
        staff_token=token;selected_clinic='havana';token=request('/api/auth/login',dict(email='havana@overnight.test',password=password))['accessToken']
        hd,hs=catalogue()
        # A real midnight gap inside the current test date's 180-day public horizon.
        from zoneinfo import ZoneInfo
        zone=ZoneInfo('America/Havana');gap=None
        for offset in range(181):
            date=today+dt.timedelta(days=offset);local=dt.datetime.combine(date,dt.time.min).replace(tzinfo=zone)
            if local.astimezone(dt.timezone.utc).astimezone(zone).replace(tzinfo=None)!=local.replace(tzinfo=None):gap=date;break
        if gap:
            result,_=status(f'/api/public/clinics/havana/doctors/{hd[0]["id"]}/availability?date={gap.isoformat()}&serviceId={hs["id"]}')
            check(result==200,'Public availability works on a timezone day whose midnight does not exist')
        else:print('SKIP no Havana midnight gap within this run’s public horizon; fixed-clock unit tests cover it.',flush=True)
        check(status('/api/reports?from=2027-03-14&to=2027-03-14&groupBy=day')[0]==200,'Clinic reporting supports a midnight DST change')
        selected_clinic='main';token=staff_token
        start('Appointments.Web',web,dict(env,Backend__Mode='Api',Backend__ApiBaseUrl=api+'/'))
        subprocess.run(['node','tests/frontend/overnight-browser.cjs'],cwd=root,env=dict(env,TEST_WEB_URL=web,TEST_PASSWORD=password,TEST_OVERNIGHT_FIXTURE=json.dumps(dict(doctors=doctors,service=service,people=people,day=day))),check=True,timeout=180)
        if failures:raise AssertionError('; '.join(failures))
        print(f'{count}/{count} overnight API/database checks passed.',flush=True)
    except Exception:
        for log in logs:log.flush();log.seek(0);print(log.read()[-9000:])
        raise
    finally:
        for proc in reversed(processes):
            if proc.poll() is None:proc.terminate()
        for proc in processes:
            try:proc.wait(timeout=12)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
        for log in logs:log.close()
        if Path(fixture).exists():fixture_op('--tenant-drop')
