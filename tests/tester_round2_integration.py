"""Tester round two regressions against a disposable clinic, real Web/API/PostgreSQL and Chromium."""
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

with tempfile.TemporaryDirectory(prefix='medtermin-round2-') as temporary:
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
        for key,value in dict(Id='east',Name='Источна клиника',TimeZone='Europe/Skopje',ImportSourceDoctors='false',SeedDemoData='false',BootstrapEmail='east@round2.test',BootstrapPassword=password).items():env['Tenancy__Clinics__1__'+key]=value
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
            count+=1;print(('PASS' if ok else 'FAIL')+' tester2 '+label,flush=True)
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
        doctors,service=catalogue()
        main_doctors,main_service=doctors,service
        admin_token=token
        today=dt.date.fromisoformat(request('/api/bootstrap')['today']);day=(today+dt.timedelta(days=5)).isoformat()
        check(status('/api/patients',dict(name='No telephone',email=''))[0]==400,'New clinic contacts require a phone')
        person=request('/api/patients',dict(name='Пациент без е-пошта',email='',phone='070123456'))
        check(person['email']=='' and person['phone']=='070123456','Valid phone permits an empty contact email')
        check(status('/api/patients/'+person['id'],dict(name=person['name'],email='',phone='',version=person['version']))[0]==400,'Editing a contact cannot remove its required phone')
        # Actual weekly replacement, inclusive boundaries, stale versions and no partial writes.
        begin=today+dt.timedelta(days=(7-today.weekday())%7 or 7);finish=begin+dt.timedelta(days=6)
        base=[dict(day=d,start='09:00',end='12:00') for d in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]
        dated=[dict(day='Monday',start='14:00',end='18:00',validFrom=begin.isoformat(),validTo=finish.isoformat())]
        request('/api/schedule/'+doctors[0]['id'],dict(version=2,durationMinutes=30,periods=base+dated))
        slots=request(f'/api/slots?doctorId={doctors[0]["id"]}&date={begin.isoformat()}&serviceId={service["id"]}')
        check(slots and all(s['time']>='14:00' for s in slots),'A dated afternoon week replaces the regular morning hours')
        check(request(f'/api/slots?doctorId={doctors[0]["id"]}&date={(begin+dt.timedelta(days=1)).isoformat()}&serviceId={service["id"]}')==[],'Omitted weekdays in a date-limited week do not inherit regular hours')
        after=request(f'/api/slots?doctorId={doctors[0]["id"]}&date={(finish+dt.timedelta(days=1)).isoformat()}&serviceId={service["id"]}')
        check(after[0]['time'].startswith('09:00'),'Regular hours automatically resume after the dated schedule')
        check(status('/api/schedule/'+doctors[0]['id'],dict(version=2,durationMinutes=30,periods=base))[0]==409,'A stale schedule version cannot remove a dated week')
        overlap=dated+[dict(day='Tuesday',start='13:00',end='16:00',validFrom=(begin+dt.timedelta(days=1)).isoformat(),validTo=(finish+dt.timedelta(days=1)).isoformat())]
        check(status('/api/schedule/'+doctors[0]['id'],dict(version=3,durationMinutes=30,periods=base+overlap))[0]==400,'Overlapping date ranges are rejected atomically')
        public=request(f'/api/public/clinics/main/doctors/{doctors[0]["id"]}/availability?date={begin.isoformat()}&serviceId={service["id"]}')
        check(public['slots'] and public['slots'][0]['time'].startswith('14:00'),'Public discovery applies the same dated working hours')
        selected_clinic='east';token=request('/api/auth/login',dict(email='east@round2.test',password=password))['accessToken']
        east_doctors,east_service=catalogue();east_admin=token
        selected_clinic='main';token=admin_token
        check(status('/api/auth/register',dict(name='Missing phone',email='no-phone@round2.test',password=password))[0]==400,'Shared account registration requires a phone')
        alice=request('/api/auth/register',dict(name='Ана Заедничка',email='alice@round2.test',password=password,phone='+38970123456'))
        session=request('/api/auth/login',dict(email='alice@round2.test',password=password));alice_token=session['accessToken']
        check(session['clinic'] is None and session['patientIdentityId'],'Ordinary patient login starts with the shared identity, without silently selecting a clinic')
        token=alice_token
        request('/api/patient/clinics/east',{})
        selected_clinic='east';east_state=request('/api/bootstrap');east_pid=east_state['actor']['patientId']
        check(east_state['patients'][0]['phone']=='+38970123456','Joining a new clinic carries the patient’s own phone')
        selected_clinic='main';main_state=request('/api/bootstrap');main_pid=main_state['actor']['patientId']
        def book(cid,doctor,svc,pid,at):
            global selected_clinic
            selected_clinic=cid
            return status('/api/appointments',dict(doctorId=doctor['id'],patientId=pid,date=day,time=at,durationMinutes=30,serviceId=svc['id'],requestId=str(uuid.uuid4())))
        code,main_visit=book('main',main_doctors[1],main_service,main_pid,'10:00')
        check(code==200,'Shared patient books through the selected clinic profile')
        check(book('east',east_doctors[0],east_service,east_pid,'10:00')[0]==409,'Cross-clinic patient overlaps remain blocked')
        code,east_visit=book('east',east_doctors[0],east_service,east_pid,'11:00')
        check(code==200,'Non-overlapping appointments in a second clinic remain available')
        home=request('/api/patient/home')
        check({v['clinicId'] for v in home['appointments']}=={'main','east'},'Patient home aggregates appointments with explicit clinic identifiers')
        selected_clinic='main';request('/api/appointments/'+main_visit['id']+'/status',dict(status='Cancelled',version=main_visit['version']))
        home=request('/api/patient/home')
        check(len(home['appointments'])==1 and home['appointments'][0]['clinicId']=='east' and home['history'][0]['clinicId']=='main','Upcoming and history views retain the correct clinic context')
        token=admin_token
        bob=request('/api/auth/register',dict(name='Бојан Приватен',email='bob@round2.test',password=password,phone='071123456'))
        token=request('/api/auth/login',dict(email='bob@round2.test',password=password))['accessToken']
        check(not request('/api/patient/home')['appointments'] and not request('/api/patient/home')['history'],'An unrelated patient cannot see the first patient’s current or cancelled visits')
        selected_clinic='east'
        check(status('/api/bootstrap')[0]==403,'A patient account alone cannot read an unjoined clinic')
        token=admin_token
        check(status('/api/bootstrap')[0]==401,'Receptionist credentials remain bound to their own clinic')
        selected_clinic='main'
        short=request('/api/catalogue/services',dict(name='Краток контролен преглед',specialtyId=main_service['specialtyId'],durationMinutes=20,enabled=True,doctorIds=[main_doctors[1]['id']]))
        request('/api/schedule/'+main_doctors[1]['id'],dict(version=2,durationMinutes=30,periods=[dict(day='Monday',start='09:00',end='09:20')]))
        brief=request(f'/api/slots?doctorId={main_doctors[1]["id"]}&date={begin.isoformat()}&serviceId={short["id"]}')
        check(len(brief)==1,'A twenty-minute service fits twenty-minute hours despite the thirty-minute fallback')
        start('Appointments.Web',web,dict(env,Backend__Mode='Api',Backend__ApiBaseUrl=api+'/'))
        subprocess.run(['node','tests/frontend/tester-round2-browser.cjs'],cwd=root,env=dict(env,TEST_WEB_URL=web,TEST_PASSWORD=password,TEST_ROUND2_FIXTURE=json.dumps(dict(doctors=main_doctors,service=main_service,eastDoctors=east_doctors,eastService=east_service,day=day,begin=begin.isoformat(),finish=finish.isoformat(),shortService=short))),check=True,timeout=240)
        # More than one page of another clinic's cancelled history must not hide this clinic.
        def sql(index,command):
            result=subprocess.run([dotnet,str(fixture_dll),'--tenant-query',fixture],input=json.dumps(dict(database=index,sql=command)),env=dict(os.environ,ConnectionStrings__Appointments=parent),capture_output=True,text=True,check=True,timeout=30)
            return json.loads(result.stdout)
        sql(0,f"""INSERT INTO public.\"Appointments\" (\"Id\",\"DoctorId\",\"PatientId\",\"Start\",\"End\",\"Status\",\"Version\",\"CreatedBy\",\"UpdatedAt\",\"RequestId\")
            SELECT 'history-round2-'||g,'{main_doctors[1]['id']}','{main_pid}',now()+interval '20 days'+g*interval '1 hour',now()+interval '20 days'+g*interval '1 hour'+interval '30 minutes','Cancelled',1,'round2',now(),md5(g::text) FROM generate_series(1,101) g;
            INSERT INTO clinic_east.\"Appointments\" (\"Id\",\"DoctorId\",\"PatientId\",\"Start\",\"End\",\"Status\",\"Version\",\"CreatedBy\",\"UpdatedAt\",\"RequestId\")
            VALUES ('history-east-round2','{east_doctors[0]['id']}','{east_pid}',now()+interval '1 day',now()+interval '1 day 30 minutes','Cancelled',1,'round2',now(),'round2-east-history');SELECT 1""")
        token=alice_token
        filtered=request('/api/patient/home?clinicId=east')
        check(len(filtered['history'])==1 and filtered['history'][0]['clinicId']=='east','Clinic filtering happens before the global history limit')
        check(len(request('/api/patient/home')['history'])==100,'Global history remains bounded')
        # Simulate an upgraded identity whose old record has no phone, without fabricating contact data.
        sql(0,"UPDATE careline_identity.\"PatientAccounts\" SET \"Phone\"='' WHERE \"Email\"='bob@round2.test';SELECT 1")
        token=request('/api/auth/login',dict(email='bob@round2.test',password=password))['accessToken']
        check(status('/api/patient/clinics/east',{})[0]==400,'A legacy identity must provide a phone before creating another clinic profile')
        request('/api/patient/clinics/east',dict(phone='072123456'))
        selected_clinic='east';check(request('/api/bootstrap')['patients'][0]['phone']=='072123456','A supplied legacy phone is used only for that patient’s new clinic profile')
        selected_clinic='main';check(request('/api/bootstrap')['patients'][0]['phone']=='071123456','Joining another clinic does not overwrite existing clinic contact records')
        # Offline full maintenance must be repeatable and preserve all existing clinic bindings/data.
        for process in reversed(processes):
            process.terminate();process.wait(timeout=12)
        # Recreate the previous release's columns in one already populated tenant,
        # alongside another tenant which already has the new dated rows.
        east_periods=sql(0,'SELECT count(*) FROM clinic_east."WorkingPeriods"')
        sql(0,'ALTER TABLE clinic_east."WorkingPeriods" DROP CONSTRAINT "CK_WorkingPeriod_Dates", DROP COLUMN "ValidFrom", DROP COLUMN "ValidTo"; DELETE FROM clinic_east."__EFMigrationsHistory" WHERE "MigrationId"=\'20261111122943_DatedWorkingHours\';SELECT 1')
        assembly=Path(os.environ.get('TEST_API_DLL',str(root/'src/Appointments.Api/bin/Release/net10.0/Appointments.Api.dll')))
        for _ in range(2):
            maintenance=subprocess.run([dotnet,str(assembly),'--migrate'],cwd=assembly.parent if os.environ.get('TEST_API_DLL') else root/'src/Appointments.Api',env=dict(env,Database__ApplyMigrations='false'),capture_output=True,text=True,timeout=90)
            check(maintenance.returncode==0,'Offline full database upgrade is repeatable')
        check(sql(0,"SELECT count(*) FROM public.\"WorkingPeriods\" WHERE \"ValidFrom\" IS NOT NULL")>0,'Database maintenance preserves date-limited working hours')
        check(sql(0,'SELECT count(*) FROM clinic_east."WorkingPeriods"')==east_periods,'Upgrading an older clinic schema preserves its existing regular working hours')
        check(sql(0,"SELECT \"Phone\" FROM careline_identity.\"PatientAccounts\" WHERE \"Email\"='bob@round2.test'")=='072123456','Database maintenance preserves the shared patient contact')
        identities=sql(0,'SELECT count(*) FROM careline_identity."PatientAccounts"')
        sql(0,'ALTER TABLE careline_identity."PatientAccounts" DROP COLUMN "Phone";SELECT 1')
        maintenance=subprocess.run([dotnet,str(assembly),'--migrate'],cwd=assembly.parent if os.environ.get('TEST_API_DLL') else root/'src/Appointments.Api',env=dict(env,Database__ApplyMigrations='false'),capture_output=True,text=True,timeout=90)
        check(maintenance.returncode==0,'The full maintenance command upgrades the previous shared identity schema')
        check(sql(0,'SELECT count(*) FROM careline_identity."PatientAccounts"')==identities and sql(0,'SELECT count(*) FROM careline_identity."PatientAccounts" WHERE "Phone"=\'\'')==identities,'Identity schema upgrade retains accounts without fabricating missing legacy phones')
        if os.environ.get('TEST_API_DLL'):check((assembly.parent/'upgrade-databases.cmd').exists(),'Complete API publish contains the checked-exit-code database upgrade launcher')
        if failures:raise AssertionError('; '.join(failures))
        print(f'{count}/{count} tester round two API/database checks passed.',flush=True)
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
