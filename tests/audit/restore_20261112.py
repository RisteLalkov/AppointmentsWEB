"""Real paired backup/restore rehearsal. Raw synthetic DB dumps stay private and are deleted."""
from common_20261112 import *
import socket
os.environ['QA_RESULTS_FILE']='restore-results.json';results=[];created=[];children=[];private=WORK/'restore';private.mkdir(exist_ok=True)
container=R['container'];prefix=['docker','--host=unix:///var/run/docker.sock','exec','-i',container]
def command(args,data=None):
 p=subprocess.run(prefix+args,input=data,capture_output=True,timeout=180)
 if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace')[-2000:])
 return p.stdout
def psql(query,db='postgres',user='postgres'):return command(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',user,'-d',db],query.encode()).decode().strip()
def catalogue(db):
 tables=json.loads(psql("SELECT json_agg(json_build_object('schema',schemaname,'table',tablename)) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema','careline_extensions')",db));r=[]
 for t in sorted(tables,key=lambda t:(t['schema'],t['table'])):
  table='"'+t['schema'].replace('"','""')+'"."'+t['table'].replace('"','""')+'"';fingerprint=json.loads(psql(f"SELECT json_build_object('rows',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM {table} t",db));r.append(dict(**t,**fingerprint))
 return r
try:
 # No audit mutators/browser suites may be active during this phase. Background hosts only read registry metadata.
 before=[];after=[];original=[];restored=[];newdsn=[]
 for i,dsn in enumerate(R['dsn']):
  source=re.search('Database=([^;]+)',dsn,re.I)[1];owner=re.search('Username=([^;]+)',dsn,re.I)[1];target='careline_restore_'+uuid.uuid4().hex[:12]+'_'+str(i);before.append(catalogue(source));original.append(source)
  dump=command(['pg_dump','-U','postgres','-d',source,'-Fc']);file=private/(str(i)+'.dump');file.write_bytes(dump);os.chmod(file,0o600)
  psql(f'CREATE DATABASE "{target}" OWNER "{owner}"');created.append(target);command(['pg_restore','-U','postgres','-d',target,'--exit-on-error'],dump);restored.append(catalogue(target));after.append(catalogue(source));newdsn.append(re.sub('Database=[^;]+','Database='+target,dsn,flags=re.I));record('Backup restores every '+['clinical','platform'][i]+' table with identical row fingerprint',before[i]==restored[i] and before[i]==after[i],tables=len(restored[i]),dump_bytes=len(dump),dump_sha256=hashlib.sha256(dump).hexdigest())
 # Recheck the first source after the second backup so the pair's stable-data window is explicit.
 record('Both source databases remained unchanged across paired backup window',before[0]==catalogue(original[0]) and before[1]==catalogue(original[1]))
 save('restore-table-fingerprints.json',dict(original=before,restored=restored))
 env={k:v for k,v in os.environ.items() if not k.startswith(('Tenancy__','Bootstrap__','Platform__','Demo__','Database__','ConnectionStrings__','Hosting__','Backend__'))}
 env.update(ASPNETCORE_ENVIRONMENT='Production',Hosting__AllowHttpForTesting='true',Hosting__WebProxyKey=R['key'],ConnectionStrings__Appointments=newdsn[0],ConnectionStrings__Platform=newdsn[1],Database__ApplyMigrations='false',Demo__Enabled='false',Logging__LogLevel__Default='Warning',AllowedHosts='localhost;127.0.0.1')
 for i,cid in enumerate(['main','east','closed']):
  for k,v in dict(Id=cid,Name={'main':'Главна QA клиника','east':'Источна QA клиника','closed':'Затворена QA клиника'}[cid],TimeZone='Europe/Skopje',ImportSourceDoctors='false',SeedDemoData='false',AllowRegistration='false' if cid=='closed' else 'true').items():env[f'Tenancy__Clinics__{i}__{k}']=v
 dll=pathlib.Path('/workspace/.setup/qa-20261112-publish/api/Appointments.Api.dll')
 with (OUT/'logs/restore-migrate.log').open('w') as log:p=subprocess.run(['dotnet',str(dll),'--migrate'],cwd=dll.parent,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=180)
 record('Restored pair passes complete offline migration/identity validation',p.returncode==0,exit=p.returncode)
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));base='http://127.0.0.1:'+str(sock.getsockname()[1])
 log=(private/'api.log').open('w');host=subprocess.Popen(['dotnet',str(dll),'--urls',base],cwd=dll.parent,env=env,stdout=log,stderr=log);children.append(host)
 for _ in range(300):
  if host.poll() is not None:raise RuntimeError('Restored host exited')
  try:
   if Client(base=base).req('/health/live')[0]==200:break
  except OSError:pass
  time.sleep(.1)
 admin=Client('restored-reception',base=base).login('main@audit.test');east=Client('restored-east',base=base,clinic='east').login('east@audit.test');patient=Client('restored-patient',base=base).login('patient@audit.test')
 for label,client in [('main',admin),('east',east),('global patient',patient)]:record('Restored pair authenticates and reads '+label,client.req('/api/bootstrap')[0]==200)
 company=Client('restored-company',base=base);company.token=company.ok('/api/platform/login',dict(email='platform@audit.test',password=R['password']))['accessToken'];record('Restored platform login and clinic registry work',company.req('/api/platform/clinics')[0]==200)
 S=seed();day=(dt.date.fromisoformat(S['today'])+dt.timedelta(days=48)).isoformat();contact=next(p for p in admin.ok('/api/bootstrap')['patients'] if p['email']=='main-contact-5@audit.test');cat=S['catalogs']['main'];code,visit,*_=admin.req('/api/appointments',dict(doctorId=cat['doctors'][0]['id'],patientId=contact['id'],serviceId=cat['service']['id'],date=day,time='14:00',durationMinutes=30,requestId=uuid.uuid4().hex));record('Restored pair creates a new appointment',code==200,actual=code)
 if code==200:record('Restored booking has one history row and never touched source',psql(f'''SELECT count(*) FROM "AppointmentHistory" WHERE "AppointmentId"='{visit['id']}' ''',created[0])=='1' and psql(f'''SELECT count(*) FROM "Appointments" WHERE "Id"='{visit['id']}' ''',original[0])=='0')
except Exception as e:record('Backup/restore rehearsal completed',False,error=str(e))
finally:
 for p in children:p.terminate();p.wait(timeout=15)
 for db in reversed(created):psql(f'DROP DATABASE "{db}" WITH (FORCE)')
 for f in private.glob('*.dump'):f.unlink()
 record('Temporary restore databases and raw dumps removed',not any(private.glob('*.dump')) and all(psql(f"SELECT count(*) FROM pg_database WHERE datname='{db}'")=='0' for db in created))
