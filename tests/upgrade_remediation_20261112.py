"""Offline upgrade rehearsal from retained audit binaries, generated loopback DBs only."""
import os,pathlib,sys,socket
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests/audit'))
from common_20261112 import *
os.environ['QA_RESULTS_FILE']='upgrade-results.json'
private=WORK/'upgrade';private.mkdir(exist_ok=True);fixture=private/'fixtures.json'
utility=ROOT/'tests/Appointments.DatabaseTests/bin/Release/net10.0/Appointments.DatabaseTests.dll'
old=pathlib.Path(os.environ.get('QA_OLD_API_DLL','/workspace/.setup/qa-20261112-publish/api/Appointments.Api.dll'))
new=pathlib.Path(os.environ['TEST_API_DLL']);hosts=[];handles=[];created=False
parent=os.environ['CARELINE_TEST_CONNECTION']
if not re.search(r'Host=(127\.0\.0\.1|localhost)(;|$)',parent,re.I) or not re.search(r'Database=[^;]*(test|integration)',parent,re.I):raise RuntimeError('Disposable loopback coordinator required')
def fixtures(operation):subprocess.run(['dotnet',str(utility),operation,str(fixture)],env=dict(os.environ,ConnectionStrings__Appointments=parent),capture_output=True,check=True,timeout=90)
def query(sqltext,index=0):
 dsn=connections[index];db=re.search('Database=([^;]+)',dsn,re.I)[1];user=re.search('Username=([^;]+)',dsn,re.I)[1]
 if not re.fullmatch('careline_test_[a-f0-9]{12}_[01]',db):raise RuntimeError('Unsafe database')
 p=subprocess.run(['docker','--host=unix:///var/run/docker.sock','exec','-i',R['container'],'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',user,'-d',db],input=sqltext,text=True,capture_output=True,check=True,timeout=60);return p.stdout.strip()
def migrate(dll,label):
 with (OUT/'logs'/('upgrade-'+label+'.log')).open('w') as log:p=subprocess.run(['dotnet',str(dll),'--migrate'],cwd=dll.parent,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180)
 record(label+' offline migration succeeds',p.returncode==0)
 if p.returncode:raise RuntimeError('Migration failed: '+label)
def start(dll,label):
 with socket.socket() as s:s.bind(('127.0.0.1',0));base='http://127.0.0.1:'+str(s.getsockname()[1])
 log=(private/(label+'.log')).open('w');handles.append(log);host=subprocess.Popen(['dotnet',str(dll),'--urls',base],cwd=dll.parent,env=env,stdout=log,stderr=log);hosts.append(host)
 for _ in range(600):
  if host.poll() is not None:raise RuntimeError(label+' exited')
  try:
   if Client(base=base).req('/health')[0]==200:return base,host
  except OSError:pass
  time.sleep(.1)
 raise RuntimeError(label+' did not start')
def fingerprints():
 return {schema+'.'+table:query(f'''SELECT count(*)||':'||md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) FROM {schema}."{table}" t''') for schema,table in [('public','Doctors'),('public','Patients'),('public','Accounts'),('public','Appointments'),('public','AppointmentHistory'),('clinic_east','Accounts'),('careline_identity','PatientAccounts'),('careline_identity','PatientMemberships'),('careline_identity','PatientBookings')]}
try:
 if not old.is_file():raise RuntimeError('Retained pre-fix publish is required; cannot simulate an upgrade using only new binaries')
 fixtures('--tenant-create');created=True;os.chmod(fixture,0o600);connections=json.loads(fixture.read_text())
 env={k:v for k,v in os.environ.items() if not k.startswith(('Tenancy__','Bootstrap__','Platform__','Demo__','Database__','ConnectionStrings__','Hosting__','Backend__'))}
 env.update(ASPNETCORE_ENVIRONMENT='Production',Hosting__AllowHttpForTesting='true',Hosting__WebProxyKey=R['key'],ConnectionStrings__Appointments=connections[0],ConnectionStrings__Platform=connections[1],Database__ApplyMigrations='false',Demo__Enabled='false',Platform__Bootstrap__Email='platform@upgrade.test',Platform__Bootstrap__Password=R['password'],Logging__LogLevel__Default='Warning',AllowedHosts='localhost;127.0.0.1')
 for i,cid in enumerate(['main','east']):
  for k,v in dict(Id=cid,Name='QA Upgrade '+cid,TimeZone='Europe/Skopje',ImportSourceDoctors='false',SeedDemoData='false',AllowRegistration='true',BootstrapEmail=cid+'@upgrade.test',BootstrapPassword=R['password']).items():env[f'Tenancy__Clinics__{i}__{k}']=v
 migrate(old,'old');base,host=start(old,'old-api');a=Client('old-reception',base=base).login('main@upgrade.test');c=Client('old-company',base=base);c.token=c.ok('/api/platform/login',dict(email='platform@upgrade.test',password=R['password']))['accessToken'];c.ok('/api/platform/clinics/main/adopt',{})
 specialty=a.ok('/api/catalogue/specialties',dict(name='QA Upgrade Specialty'));doctor=a.ok('/api/catalogue/doctors',dict(name='QA Upgrade Doctor',specialtyId=specialty['id'],subspecialty='',enabled=True,requiresConfirmation=False,staffOnly=False));a.ok('/api/schedule/'+doctor['id'],dict(version=1,durationMinutes=30,periods=[dict(day=d,start='08:00',end='18:00') for d in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]));service=a.ok('/api/catalogue/services',dict(name='QA Upgrade Service',specialtyId=specialty['id'],durationMinutes=30,enabled=True,doctorIds=[doctor['id']]))
 Client(base=base).ok('/api/auth/register',dict(name='QA Upgrade Patient',email='patient@upgrade.test',phone='070123456',password=R['password']));patient=Client('old-patient',base=base).login('patient@upgrade.test');patient.ok('/api/patient/clinics/east',{});pid=patient.ok('/api/bootstrap')['actor']['patientId'];day=(dt.date.fromisoformat(a.ok('/api/bootstrap')['today'])+dt.timedelta(days=70)).isoformat();visit=a.ok('/api/appointments',dict(doctorId=doctor['id'],patientId=pid,serviceId=service['id'],date=day,time='09:00',durationMinutes=30,requestId=uuid.uuid4().hex));before=fingerprints()
 record('Pre-fix binaries produce real shared identity, two memberships and booking',query('SELECT count(*) FROM careline_identity."PatientMemberships"')=='2' and query('SELECT count(*) FROM "__EFMigrationsHistory"')=='7' and query('SELECT max("Version") FROM "PlatformSchemaVersions"',1)=='3')
 host.terminate();host.wait(timeout=15);record('All hosts for upgrade pair stopped before maintenance',host.poll() is not None)
 migrate(new,'new');migrate(new,'repeat');after=fingerprints();record('Upgrade preserves clinical rows, accounts, memberships, busy times and appointment history',before==after,fingerprints=after)
 record('Both clinic schemas receive eight migrations',all(query(f'SELECT count(*) FROM {s}."__EFMigrationsHistory"')=='8' for s in ['public','clinic_east']))
 record('Shared security and platform audit stores installed',query("SELECT to_regclass('careline_identity.\"SecurityEvents\"') IS NOT NULL")=='t' and query('SELECT max("Version") FROM "PlatformSchemaVersions"',1)=='4')
 base,host=start(new,'new-api');staff=a.clone(base=base);patient=patient.clone(base=base);company=c.clone(base=base)
 record('Existing staff session and booking remain usable after upgrade',staff.ok('/api/workspace/appointments/'+visit['id'])['appointment']['id']==visit['id'])
 record('Existing global patient session works in both clinic memberships',all(patient.clone(clinic=cid).req('/api/bootstrap')[0]==200 for cid in ['main','east']))
 record('Existing company session and managed clinic survive upgrade',any(x['id']=='main' and x['managed'] for x in company.ok('/api/platform/clinics')))
 record('Existing patient credentials still authenticate',Client(base=base).login('patient@upgrade.test').req('/api/patient/home')[0]==200)
 second=staff.ok('/api/appointments',dict(doctorId=doctor['id'],patientId=pid,serviceId=service['id'],date=day,time='10:00',durationMinutes=30,requestId=uuid.uuid4().hex));record('Upgraded database accepts a new booking with atomic history',query('SELECT count(*) FROM "AppointmentHistory" WHERE "AppointmentId"=\''+second['id']+"'")=='1')
 record('New paging returns complete old and new patient history',staff.ok('/api/workspace/patients/'+pid+'?take=1')['total']==2)
except Exception as e:record('Upgrade rehearsal completes',False,error=str(e))
finally:
 for p in hosts:
  if p.poll() is None:p.terminate();p.wait(timeout=15)
 for f in handles:f.close()
 if created:fixtures('--tenant-drop');fixture.unlink(missing_ok=True);record('Generated upgrade databases and roles removed',True)
raise SystemExit(1 if any(x['status']!='PASS' for x in RESULTS) else 0)
