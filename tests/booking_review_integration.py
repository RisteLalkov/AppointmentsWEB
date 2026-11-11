"""Booking-review regressions against a disposable clinic, real Web/API/PostgreSQL and Chromium."""
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

with tempfile.TemporaryDirectory(prefix='medtermin-booking-review-') as temporary:
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
        count = 0
        def check(ok, label):
            global count
            if not ok: raise AssertionError(label)
            count += 1; print('PASS review '+label, flush=True)
        def reject(path, data=None, expected=400):
            try: request(path, data); raise AssertionError('Unexpected success: '+path)
            except urllib.error.HTTPError as e: check(e.code==expected, path+' rejects invalid/unauthorized input')
        spec=request('/api/catalogue/specialties',dict(name='Кардиологија'))
        neuro=request('/api/catalogue/specialties',dict(name='Неврологија'))
        doctors=[]
        for i in range(4):
            d=request('/api/catalogue/doctors',dict(name=['Д-р Јован Нешковски','Д-р Ана Петровска','Д-р Ева Милевска','Д-р Виктор Стојанов'][i],specialtyId=(spec if i in [0,3] else neuro)['id'],subspecialty='',enabled=True,requiresConfirmation=False))
            if i != 3: request('/api/schedule/'+d['id'],dict(version=1,durationMinutes=30,periods=[dict(day=day,start='09:00',end='10:00') for day in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]))
            doctors.append(d)
        sa=request('/api/catalogue/services',dict(name='Кардиолошки преглед',specialtyId=spec['id'],durationMinutes=30,enabled=True,doctorIds=[doctors[0]['id']]))
        sb=request('/api/catalogue/services',dict(name='Невролошки преглед',specialtyId=neuro['id'],durationMinutes=20,enabled=True,doctorIds=[doctors[1]['id'],doctors[2]['id']]))
        people=[request('/api/patients',dict(name='Ана Петрова',email=f'patient-{i}@review.test',phone='070123456')) for i in range(2)]
        state=request('/api/bootstrap');date=(dt.date.fromisoformat(state['today'])+dt.timedelta(days=2)).isoformat();green=(dt.date.fromisoformat(date)+dt.timedelta(days=2)).isoformat()
        for i in range(2):request('/api/appointments',dict(doctorId=doctors[0]['id'],patientId=people[i]['id'],serviceId=sa['id'],date=date,time=['09:00','09:30'][i],durationMinutes=30,requestId=uuid.uuid4().hex))
        blocked=(dt.date.fromisoformat(date)+dt.timedelta(days=1)).isoformat()
        request('/api/exceptions/'+doctors[0]['id'],dict(date=blocked,start='00:00',end='23:59',isAvailable=False,reason='Отсуство'))
        days=request(f'/api/availability/days?doctorId={doctors[0]["id"]}&from={date}&to={green}&serviceId={sa["id"]}')
        check([d['count'] for d in days]==[0,0,2],'Calendar days reflect full bookings, absence and remaining capacity')
        check(all(d['count']==len(request(f'/api/slots?doctorId={doctors[0]["id"]}&date={d["date"]}&serviceId={sa["id"]}')) for d in days),'Month counts agree with authoritative single-day slots')
        nexts=request(f'/api/availability/next?doctorIds={doctors[0]["id"]},{doctors[1]["id"]},{doctors[3]["id"]}&from={date}')
        check(nexts[0]['slot']['date']==green and nexts[0]['slot']['time'].startswith('09:00'),'First available skips fully booked days and absences chronologically')
        check(nexts[1]['serviceId']==sb['id'] and (dt.datetime.fromisoformat(nexts[1]['slot']['end'])-dt.datetime.fromisoformat(nexts[1]['slot']['start'])).seconds==1200,'First available retains the actual service and its duration')
        check(nexts[2]['slot'] is None and nexts[2]['reason']=='NoAvailability','No schedule does not invent free slots')
        reject(f'/api/availability/days?doctorId={doctors[0]["id"]}&from={date}&to={(dt.date.fromisoformat(date)+dt.timedelta(days=31)).isoformat()}')
        reject(f'/api/availability/days?doctorId={doctors[0]["id"]}&from=2000-01-01&to=2000-01-02')
        reject(f'/api/availability/next?doctorIds=missing&from={date}',expected=404)
        filtered=request(f'/api/slots?doctorId={doctors[1]["id"]}&date={date}&serviceId={sb["id"]}&patientId={people[0]["id"]}')
        check([s['time'][:5] for s in filtered]==['09:40'],'Reception’s patient context excludes that patient’s overlapping appointments')
        doctor_account=request('/api/accounts',dict(name=doctors[0]['name'],email='doctor@review.test',password=password,role='Doctor',doctorId=doctors[0]['id']))
        staff_token=token;token=request('/api/auth/login',dict(email='doctor@review.test',password=password))['accessToken']
        reject(f'/api/availability/next?doctorIds={doctors[1]["id"]}&from={date}',expected=403)
        token=staff_token
        patient=request('/api/auth/register',dict(name='Марија Стојанова',email='patient@review.test',password=password,phone="070123456"))
        token=request('/api/auth/login',dict(email='patient@review.test',password=password))['accessToken']
        reject(f'/api/availability/days?doctorId={doctors[0]["id"]}&from={date}&to={green}&serviceId={sa["id"]}&patientId={people[0]["id"]}',expected=403)
        token=staff_token
        start('Appointments.Web',web,dict(env,Backend__Mode='Api',Backend__ApiBaseUrl=api+'/'))
        subprocess.run(['node','tests/frontend/booking-review-browser.cjs'],cwd=root,env=dict(env,TEST_WEB_URL=web,TEST_PASSWORD=password,TEST_REVIEW_FIXTURE=json.dumps(dict(doctors=doctors,services=[sa,sb],people=people,date=date,green=green))),check=True,timeout=120)
        # Existing valid boundary-length names and disabled services must survive the seed.
        long_spec=request('/api/catalogue/specialties',dict(name=('Долга специјалност '+'а'*200)[:200]))
        request('/api/catalogue/doctors',dict(name='Д-р Горан Димов',specialtyId=long_spec['id'],subspecialty='',enabled=True,requiresConfirmation=False))
        disabled=request('/api/catalogue/services',dict(name='Специјалистички преглед · Кардиологија',specialtyId=spec['id'],durationMinutes=30,enabled=False,doctorIds=[doctors[3]['id']]))
        # The explicit sample seed is run on this disposable clinic only.
        assembly=Path(os.environ.get('TEST_API_DLL',str(root/'src/Appointments.Api/bin/Release/net10.0/Appointments.Api.dll')))
        if os.environ.get('TEST_API_DLL'):check((assembly.parent/'seed-sample-clinic.cmd').is_file(),'Complete API publish contains the sample-data launcher')
        def sql(query):
            r=subprocess.run([dotnet,str(fixture_dll),'--tenant-query',fixture],input=json.dumps(dict(database=0,sql=query)),env=dict(os.environ,ConnectionStrings__Appointments=parent),capture_output=True,text=True,check=True,timeout=30)
            return json.loads(r.stdout.strip())
        before=sql('SELECT count(*) FROM public."Appointments" WHERE "Id" NOT LIKE \'preview-%\'');accounts=sql('SELECT count(*) FROM public."Accounts"')
        def seed():
            r=subprocess.run([dotnet,str(assembly),'--seed-preview','--clinic','main'],cwd=assembly.parent if os.environ.get('TEST_API_DLL') else root/'src/Appointments.Api',env=dict(env,Database__ApplyMigrations='false',Preview__AllowSeed='true'),capture_output=True,text=True,timeout=100)
            if r.returncode: raise AssertionError(r.stdout+r.stderr)
        seed()
        check(sql('SELECT count(*) FROM public."Doctors" WHERE "Id" LIKE \'preview-doctor-%\'')==12,'Sample seed adds twelve named doctors')
        check(sql('SELECT count(*) FROM public."Patients" WHERE "Id" LIKE \'preview-p%\'')==160,'Sample seed adds 160 named patients')
        check(sql('SELECT count(*) FROM public."Services" WHERE "Id" LIKE \'preview-service-%\'')>=20,'Sample seed adds specialties, services and assignments')
        check(sql('SELECT bool_and(length("Name")<=200) FROM public."Services"'),'Seeded service names respect the existing database length limit')
        check(sql(f'''SELECT "Enabled" FROM public."Services" WHERE "Id"='{disabled['id']}' ''') is False,'Sample seed does not reactivate an existing disabled service')
        total=sql('SELECT count(*) FROM public."Appointments"')
        check(total>before+500,'Sample seed adds substantial past and upcoming appointment data')
        check(sql('SELECT count(*) FROM public."Accounts"')==accounts and sql('SELECT count(*) FROM public."Appointments" WHERE "Id" NOT LIKE \'preview-%\'')==before,'Sample seeding preserves existing bookings and creates no login credentials')
        check(sql('SELECT count(*) FROM public."Appointments" a WHERE a."CreatedBy"=\'preview-seed\' AND NOT EXISTS (SELECT 1 FROM public."AppointmentHistory" h WHERE h."AppointmentId"=a."Id" AND h."AppointmentVersion"=a."Version" AND h."AfterStatus"=a."Status")')==0,'Every sample appointment retains matching status history')
        seed();check(sql('SELECT count(*) FROM public."Appointments"')==total and sql('SELECT count(*) FROM public."Doctors" WHERE "Id" LIKE \'preview-doctor-%\'')==12,'Running the sample seed twice does not duplicate doctors or appointments')
        print(f'{count}/{count} booking-review API/database checks passed.',flush=True)
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
