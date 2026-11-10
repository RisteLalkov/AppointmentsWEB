"""Tester-feedback regressions against a disposable clinic, real Web/API/PostgreSQL and Chromium."""
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

with tempfile.TemporaryDirectory(prefix='medtermin-feedback-') as temporary:
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
        api, web = address(), address()
        start('Appointments.Api', api, env)
        token = ''
        def request(path, data=None):
            headers = {'X-Clinic':'main'}
            if token: headers['Authorization'] = 'Bearer '+token
            if data is not None: headers['Content-Type'] = 'application/json'
            with urllib.request.urlopen(urllib.request.Request(api+path, None if data is None else json.dumps(data).encode(), headers), timeout=20) as response:
                return json.load(response)
        token = request('/api/auth/login', dict(email='admin@feedback.test', password=password))['accessToken']
        spec = request('/api/catalogue/specialties', dict(name='Кардиологија и функционална дијагностика на кардиоваскуларниот систем'))
        doctor = request('/api/catalogue/doctors', dict(name='Д-р Александра Стојановска Петровска', specialtyId=spec['id'], enabled=True, subspecialty='', requiresConfirmation=False))
        request('/api/schedule/'+doctor['id'], dict(version=1, durationMinutes=30, periods=[dict(day=day, start='09:00', end='17:00') for day in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]))
        service = request('/api/catalogue/services', dict(name='Електрокардиографски преглед и детална проценка на кардиоваскуларната функција', specialtyId=spec['id'], enabled=True, durationMinutes=30, doctorIds=[doctor['id']]))
        people = [request('/api/patients', dict(name='Ана Петрова', email=f'ana-{i}@feedback.test', phone=f'+3897012345{i}')) for i in range(2)]
        for i in range(22):
            account = request('/api/auth/register', dict(name=f'Корисник {i:02}', email=f'person-{i:02}@feedback.test', password=password))
            if i == 0: request('/api/accounts/'+account['id']+'/access', dict(enabled=False))
        request('/api/accounts', dict(name=doctor['name'], email='doctor@feedback.test', password=password, role='Doctor', doctorId=doctor['id']))
        updated = request('/api/patients/'+people[0]['id'], dict(name=people[0]['name'], email=people[0]['email'], phone=people[0]['phone'], version=people[0]['version'], number=999999))
        assert updated['number'] == people[0]['number'], 'Contact update accepted a forged patient number'
        state = request('/api/bootstrap')
        assert all(p['number'] > 0 for p in state['patients']) and len({p['number'] for p in state['patients']}) == len(state['patients'])
        date = (dt.date.fromisoformat(state['today'])+dt.timedelta(days=1)).isoformat()
        start('Appointments.Web', web, dict(env, Backend__Mode='Api', Backend__ApiBaseUrl=api+'/'))
        browser_env = dict(env, TEST_WEB_URL=web, TEST_PASSWORD=password, TEST_FEEDBACK_FIXTURE=json.dumps(dict(people=people, doctor=doctor, service=service, date=date)))
        subprocess.run(['node', 'tests/frontend/tester-feedback-browser.cjs'], cwd=root, env=browser_env, check=True, timeout=120)
        print('PASS Real PostgreSQL contact updates cannot change assigned patient numbers', flush=True)
    except Exception:
        for log in logs:
            log.flush(); log.seek(0); print(log.read()[-9000:])
        raise
    finally:
        for proc in reversed(processes):
            if proc.poll() is None: proc.terminate()
        for proc in processes:
            try: proc.wait(timeout=12)
            except subprocess.TimeoutExpired: proc.kill(); proc.wait()
        for log in logs: log.close()
        if Path(fixture).exists(): fixture_op('--tenant-drop')
