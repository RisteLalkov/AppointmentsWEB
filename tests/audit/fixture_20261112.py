"""Disposable QA fixture host. Uses ONLY a loopback test coordinator and generated fixture databases."""
import datetime as dt,json,os,pathlib,re,socket,subprocess,time,urllib.request,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
WORK=pathlib.Path(os.environ.get('QA_WORK','/workspace/.setup/qa20261112'));WORK.mkdir(parents=True,exist_ok=True)
OUT=ROOT/os.environ.get('QA_OUTPUT','docs/audit/2026-11-12');OUT.mkdir(parents=True,exist_ok=True)
PARENT=os.environ.get('CARELINE_TEST_CONNECTION','Host=127.0.0.1;Port=55432;Database=medtermin_qa_20261112_test;Username=postgres')
if not re.search(r'Host=(?:127\.0\.0\.1|localhost)(?:;|$)',PARENT,re.I) or not re.search(r'Database=[^;]*(?:test|integration)',PARENT,re.I):raise SystemExit('A loopback test coordinator is required.')
DOTNET=os.environ.get('TEST_DOTNET','dotnet');FIXTURE_DLL=ROOT/'tests/Appointments.DatabaseTests/bin/Release/net10.0/Appointments.DatabaseTests.dll'
FIXTURE=WORK/'fixtures.json';RUNTIME=WORK/'runtime.json';STOP=WORK/'stop'
if RUNTIME.exists():raise SystemExit('An audit fixture already exists. Stop it through its stop file before starting another.')
STOP.unlink(missing_ok=True)
for cache in ['seed.json','clients.json','matrix-runs.json','extra-run.txt']:(WORK/cache).unlink(missing_ok=True)
procs=[];logs=[]
def fixture(operation):subprocess.run([DOTNET,str(FIXTURE_DLL),operation,str(FIXTURE)],env=dict(os.environ,ConnectionStrings__Appointments=PARENT),check=True,capture_output=True,timeout=60)
def address():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return 'http://127.0.0.1:'+str(s.getsockname()[1])
def start(label,assembly,url,env,health):
 log=(WORK/(label+'.log')).open('w+');logs.append(log)
 p=subprocess.Popen([DOTNET,str(assembly),'--urls',url],cwd=assembly.parent,env=env,stdout=log,stderr=log);procs.append(p)
 for _ in range(600):
  if p.poll() is not None:raise RuntimeError(label+' exited; inspect the private fixture log.')
  try:
   with urllib.request.urlopen(url+health,timeout=2) as r:
    if r.status==200:return
  except OSError:pass
  time.sleep(.1)
 raise RuntimeError(label+' did not become ready.')
try:
 fixture('--tenant-create');os.chmod(FIXTURE,0o600);dsn=json.loads(FIXTURE.read_text());password='Audit-'+uuid.uuid4().hex
 api,address2,web=address(),address(),address();key=uuid.uuid4().hex+uuid.uuid4().hex
 env={k:v for k,v in os.environ.items() if not k.startswith(('Tenancy__','Bootstrap__','Platform__','Demo__','Database__','ConnectionStrings__','Hosting__','Backend__'))}
 env.update(ASPNETCORE_ENVIRONMENT='Production',Hosting__AllowHttpForTesting='true',Hosting__WebProxyKey=key,ConnectionStrings__Appointments=dsn[0],ConnectionStrings__Platform=dsn[1],Database__ApplyMigrations='false',Demo__Enabled='false',Platform__Bootstrap__Email='platform@audit.test',Platform__Bootstrap__Password=password,Logging__LogLevel__Default='Warning',AllowedHosts='localhost;127.0.0.1;medtermin.mk;app.medtermin.mk;admin.medtermin.mk;api.medtermin.mk')
 for i,cid in enumerate(['main','east','closed']):
  values=dict(Id=cid,Name={'main':'Главна QA клиника','east':'Источна QA клиника','closed':'Затворена QA клиника'}[cid],TimeZone='Europe/Skopje',ImportSourceDoctors='false',SeedDemoData='false',AllowRegistration='false' if cid=='closed' else 'true',BootstrapEmail=cid+'@audit.test',BootstrapPassword=password)
  for k,v in values.items():env[f'Tenancy__Clinics__{i}__{k}']=v
 api_dll=pathlib.Path(os.environ.get('TEST_API_DLL','/workspace/.setup/qa-20261112-publish/api/Appointments.Api.dll'));web_dll=pathlib.Path(os.environ.get('TEST_WEB_DLL','/workspace/.setup/qa-20261112-publish/web/Appointments.Web.dll'))
 with (OUT/'logs/fixture-migrate.log').open('w') as f:subprocess.run([DOTNET,str(api_dll),'--migrate'],cwd=api_dll.parent,env=env,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=120)
 start('api',api_dll,api,env,'/health/live');start('api2',api_dll,address2,env,'/health/live')
 start('web',web_dll,web,dict(env,Backend__Mode='Api',Backend__ApiBaseUrl=api+'/'),'/Account/Login')
 runtime=dict(api=api,api2=address2,web=web,password=password,key=key,dsn=dsn,fixture=str(FIXTURE),container=os.environ.get('QA_CONTAINER','medtermin-qa-20261112'),pids=[p.pid for p in procs],started_utc=dt.datetime.now(dt.timezone.utc).isoformat())
 RUNTIME.write_text(json.dumps(runtime));os.chmod(RUNTIME,0o600)
 (OUT/'evidence/fixture.json').write_text(json.dumps({k:runtime[k] for k in ['api','api2','web','started_utc']},indent=2))
 print('QA fixture ready; credentials stay in a private runtime file.',flush=True)
 while not STOP.exists():
  if any(p.poll() is not None for p in procs):raise RuntimeError('A QA host exited unexpectedly.')
  time.sleep(1)
finally:
 for p in reversed(procs):
  if p.poll() is None:p.terminate()
 for p in procs:
  try:p.wait(timeout=15)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 for f in logs:f.close()
 if FIXTURE.exists():fixture('--tenant-drop')
 RUNTIME.unlink(missing_ok=True)
