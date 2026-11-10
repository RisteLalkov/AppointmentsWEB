"""One patient login, clinic-local records/staff, two API instances and actual MVC forms.
Uses only isolated databases/roles created under a guarded CARELINE_TEST_CONNECTION.
"""
import concurrent.futures
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import socket
import base64
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

root=Path(__file__).resolve().parents[1]
parent=os.environ.get('CARELINE_TEST_CONNECTION','')
match=re.search(r'(?:^|;)Database=([^;]+)',parent,re.I)
if not match or not any(s in match[1].lower() for s in ['test','integration']):raise SystemExit('Disposable test/integration coordinator required.')
dotnet=os.environ.get('TEST_DOTNET','dotnet'); password='Global-test-'+uuid.uuid4().hex; proxy_key=uuid.uuid4().hex+uuid.uuid4().hex
processes=[];logs=[];count=0;ip=0

def check(ok,label):
 global count
 if not ok:raise AssertionError(label)
 count+=1;print('PASS global '+label,flush=True)

def address():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return 'http://127.0.0.1:'+str(s.getsockname()[1])

class Client:
 def __init__(self,base,token='',clinic='main'):
  global ip
  ip+=1;self.base=base;self.token=token;self.clinic=clinic;self.identity='203.0.'+str(ip//254)+'.'+str(1+ip%254)
  self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 def request(self,path,body=None):
  stamp=str(int(time.time()));headers={'X-Web-Client':self.identity,'X-Web-Time':stamp,'X-Web-Signature':hmac.new(proxy_key.encode(),(self.identity+'\n'+stamp).encode(),hashlib.sha256).hexdigest()}
  if self.token:headers['Authorization']='Bearer '+self.token
  if self.clinic is not None:headers['X-Clinic']=self.clinic
  if body is not None:headers['Content-Type']='application/json'
  try:r=self.opener.open(urllib.request.Request(self.base+path,None if body is None else json.dumps(body).encode(),headers),timeout=30)
  except urllib.error.HTTPError as e:r=e
  raw=r.read().decode()
  try:body=json.loads(raw)
  except ValueError:body=raw
  return r.status,body
 def ok(self,path,body=None):
  status,result=self.request(path,body)
  if status!=200:raise AssertionError(f'{path}: {status}: {result}')
  return result
 def login(self,email,secret=password,clinic=None):
  data=dict(email=email,password=secret)
  if clinic is not None:data['clinicId']=clinic
  result=self.ok('/api/auth/login',data);self.token=result['accessToken'];return result

with tempfile.TemporaryDirectory(prefix='medtermin-global-') as folder:
 fixture=str(Path(folder)/'fixtures.json')
 dll=root/'tests/Appointments.DatabaseTests/bin/Release/net10.0/Appointments.DatabaseTests.dll'
 def op(action,data=None):
  r=subprocess.run([dotnet,str(dll),action,fixture],env=dict(os.environ,ConnectionStrings__Appointments=parent),input=None if data is None else json.dumps(data),text=True,capture_output=True,check=True,timeout=60)
  return r.stdout.strip()
 def sql(query):return json.loads(op('--tenant-query',dict(database=0,sql=query)))
 def start(project,base,env,maintenance=None):
  key='TEST_API_DLL' if project.endswith('Api') else 'TEST_WEB_DLL'
  assembly=Path(os.environ.get(key,str(root/'src'/project/f'bin/Release/net10.0/{project}.dll')))
  log=open(Path(folder)/(project+str(len(logs))+'.log'),'w+');logs.append(log)
  p=subprocess.Popen([dotnet,str(assembly)]+(maintenance or ['--urls',base]),cwd=assembly.parent if os.environ.get(key) else root/'src'/project,env=env,stdout=log,stderr=log);processes.append(p)
  if maintenance:
   if p.wait(timeout=60):raise AssertionError('Maintenance failed')
   return p
  for _ in range(400):
   if p.poll() is not None:raise AssertionError(project+' failed startup')
   try:
    if Client(base).request('/health/live' if project.endswith('Api') else '/Account/Login')[0]==200:return p
   except OSError:pass
   time.sleep(.1)
  raise AssertionError('Startup timeout')
 try:
  op('--tenant-create');clinical,platform=json.loads(Path(fixture).read_text())
  op('--tenant-legacy-patient-schema')
  salt=os.urandom(16); secret=password.encode(); hashed=base64.b64encode(b'\x01'+struct.pack('>III',2,210000,len(salt))+salt+hashlib.pbkdf2_hmac('sha512',secret,salt,210000,32)).decode()
  legacy_token='c1.main.'+uuid.uuid4().hex+uuid.uuid4().hex
  sql(f"""INSERT INTO public."Patients" ("Id","Name","Email","Phone","IsDemonstration","Version") VALUES ('legacy-patient','Постоечки пациент','legacy@global.test','',false,1);
    INSERT INTO public."Accounts" ("Id","Name","Email","NormalizedEmail","PasswordHash","Role","PatientId","Enabled","IsDemo","FailedAttempts","CreatedAt") VALUES ('legacy-account','Постоечки пациент','legacy@global.test','legacy@global.test','{hashed}','Patient','legacy-patient',true,false,0,now());
    INSERT INTO public."Sessions" ("TokenHash","AccountId","ExpiresAt","IsDemo") VALUES ('{hashlib.sha256(legacy_token.encode()).hexdigest().upper()}','legacy-account',now()+interval '1 hour',false);
    SELECT 1""")
  env={k:v for k,v in os.environ.items() if not k.startswith(('Tenancy__','Bootstrap__','Platform__','Demo__','Database__','ConnectionStrings__','Hosting__','Backend__'))}
  env.update(ASPNETCORE_ENVIRONMENT='Development',Hosting__AllowHttpForTesting='true',Hosting__WebProxyKey=proxy_key,
    ConnectionStrings__Appointments=clinical,ConnectionStrings__Platform=platform,Database__ApplyMigrations='true',Demo__Enabled='false',
    Platform__Bootstrap__Email='company@global.test',Platform__Bootstrap__Password=password,Logging__LogLevel__Default='Warning')
  for i,cid in enumerate(['main','east','closed']):
   for key,value in dict(Id=cid,Name='Клиника '+cid,TimeZone='Europe/Skopje',ImportSourceDoctors='false',SeedDemoData='false',BootstrapEmail=cid+'@global.test',BootstrapPassword=password,AllowRegistration='false' if cid=='closed' else 'true').items():env[f'Tenancy__Clinics__{i}__{key}']=value
  api,api2,web=address(),address(),address();first=start('Appointments.Api',api,env);second=start('Appointments.Api',api2,env)
  legacy=Client(api);old_session=legacy.login('legacy@global.test')
  check(old_session['globalPatient'] and old_session['actor']['id']=='legacy-account' and old_session['actor']['patientId']=='legacy-patient','An existing patient retains its password and clinic profile after the upgrade')
  check(Client(api,legacy_token).request('/api/bootstrap')[0]==401,'The upgrade revokes old clinic-only patient sessions')
  check(sql('SELECT count(*) FROM public."Accounts" WHERE "Id"=\'legacy-account\' AND "PasswordHash"=\'\' AND "GlobalPatientId" IS NOT NULL')==1,'Legacy credentials move centrally rather than creating a second local password')
  staff=Client(api);staff_session=staff.login('main@global.test');east=Client(api,clinic='east');east.login('east@global.test')
  check(staff_session['accessToken'].startswith('c1.main.'),'Reception retains a clinic-bound staff token')
  check(Client(api,staff.token,'east').request('/api/bootstrap')[0]==401,'Reception cannot use its session in another clinic')
  check(staff.request('/api/patient/home')[0]==403,'Reception cannot enter personal patient membership endpoints')
  doctors={};services={}
  for cid,admin in [('main',staff),('east',east)]:
   spec=admin.ok('/api/catalogue/specialties',dict(name='Кардиологија'))
   d=admin.ok('/api/catalogue/doctors',dict(name='Д-р '+cid,specialtyId=spec['id'],subspecialty='',enabled=True,requiresConfirmation=False))
   admin.ok('/api/schedule/'+d['id'],dict(version=1,durationMinutes=30,periods=[dict(day=day,start='09:00',end='17:00') for day in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]))
   svc=admin.ok('/api/catalogue/services',dict(name='Преглед '+cid,specialtyId=spec['id'],durationMinutes=30,enabled=True,doctorIds=[d['id']]))
   doctors[cid]=d;services[cid]=svc
  check(Client(api).request('/api/auth/register',dict(name='  ',email='spaces@global.test',password=password))[0]==400,'Whitespace-only patient names remain invalid')
  visitor=Client(api,clinic='main');registration=visitor.ok('/api/auth/register',dict(name='Ана Петрова',email='ana@global.test',password=password,role='Administrator'))
  patient=Client(api,clinic='main');session=patient.login('ANA@global.test')
  check(session.get('globalPatient') is True and patient.token.startswith('u1.') and session['actor']['role']=='Patient','Self-registration creates a shared patient login without privilege escalation')
  check(sql('SELECT count(*) FROM careline_identity."PatientAccounts"')==2,'One canonical account is stored for the patient')
  a=patient.ok('/api/bootstrap');date=(dt.date.fromisoformat(a['today'])+dt.timedelta(days=2)).isoformat()
  check(a['actor']['patientId']==registration['patientId'] and len(a['patients'])==1,'The initial clinic retains a private local patient profile')
  check(sql('SELECT count(*) FROM careline_identity.accounts WHERE email=\'ana@global.test\'')==0,'Patient memberships do not reserve duplicate staff login identities')
  check(Client(api,patient.token,'east').request('/api/bootstrap')[0]==403,'A global login alone cannot read an unjoined clinic')
  check(Client(api,patient.token,None).ok('/api/auth/me')['globalPatient'],'Patient identity can be checked independently of an active clinic')
  before=sql('SELECT count(*) FROM clinic_east."Patients"')
  home=Client(api,patient.token,None).ok('/api/patient/home')
  check(any(c['clinic']['id']=='east' and not c['joined'] for c in home['clinics']) and sql('SELECT count(*) FROM clinic_east."Patients"')==before,'Browsing clinics never creates memberships or clinical records')
  for body in [dict(name='Duplicate',email='ana@global.test',password=password),dict(name='Staff takeover',email='main@global.test',password=password)]:
   check(Client(api,clinic='east').request('/api/auth/register',body)[0]==409,'A second clinic cannot register an existing patient/staff email again')
  check(east.request('/api/accounts',dict(name='Forged staff',email='ana@global.test',password=password,role='Administrator'))[0]==409,'A global patient email cannot be used for another clinic staff account')
  with concurrent.futures.ThreadPoolExecutor() as pool:
   joined=list(pool.map(lambda base:Client(base,patient.token,None).ok('/api/patient/clinics/east',{}),[api,api2]))
  b=Client(api2,patient.token,'east');bs=b.ok('/api/bootstrap')
  check(joined[0]['actor']['patientId']==joined[1]['actor']['patientId'] and sql('SELECT count(*) FROM clinic_east."Patients"')==before+1,'Concurrent joins across API instances create one clinic profile')
  check(bs['actor']['patientId']!=a['actor']['patientId'] and sql('SELECT count(*) FROM careline_identity."PatientAccounts"')==2,'Separate clinic profiles use the same single login identity')
  check(sql('SELECT count(*) FROM public."Accounts" WHERE "GlobalPatientId" IS NOT NULL AND "PasswordHash" <> \'\'')==0,'Local memberships contain no independent patient password')
  def book(client,cid):
   state=client.ok('/api/bootstrap');slots=client.ok('/api/slots?doctorId='+doctors[cid]['id']+'&serviceId='+services[cid]['id']+'&date='+date)
   return client.ok('/api/appointments',dict(doctorId=doctors[cid]['id'],patientId=state['actor']['patientId'],date=date,time=slots[0]['time'],durationMinutes=30,requestId=str(uuid.uuid4()),serviceId=services[cid]['id']))
  aa=book(patient,'main')
  east_slots=b.ok('/api/slots?doctorId='+doctors['east']['id']+'&serviceId='+services['east']['id']+'&date='+date)
  check(all(slot['start']!=aa['start'] for slot in east_slots),'Patient availability excludes an overlapping visit at another clinic')
  global_days=b.ok('/api/availability/days?doctorId='+doctors['east']['id']+'&from='+date+'&to='+date+'&serviceId='+services['east']['id'])
  check(global_days[0]['count']==len(east_slots),'Colored-day summaries retain cross-clinic patient busy intervals')
  first=b.ok('/api/availability/next?doctorIds='+doctors['east']['id']+'&from='+date+'&serviceId='+services['east']['id'])
  check(first[0]['slot']['start']!=aa['start'],'First-free summaries cannot suggest an overlapping visit at another clinic')
  check(east.request('/api/appointments',dict(doctorId=doctors['east']['id'],patientId=bs['actor']['patientId'],date=date,time='09:00',durationMinutes=30,requestId=str(uuid.uuid4()),serviceId=services['east']['id']))[0]==409,'Reception cannot bypass a shared patient’s cross-clinic overlap rule')
  bb=book(b,'east')
  race_date=(dt.date.fromisoformat(date)+dt.timedelta(days=1)).isoformat()
  def simultaneous(cid):
   client=patient if cid=='main' else b;pid=a['actor']['patientId'] if cid=='main' else bs['actor']['patientId']
   return client.request('/api/appointments',dict(doctorId=doctors[cid]['id'],patientId=pid,date=race_date,time='12:00',durationMinutes=30,requestId=str(uuid.uuid4()),serviceId=services[cid]['id']))
  with concurrent.futures.ThreadPoolExecutor() as pool:booking_race=list(pool.map(simultaneous,['main','east']))
  check(sorted(r[0] for r in booking_race)==[200,409],'Concurrent bookings at two clinics cannot double-book the same global patient')
  winner=next((i,r[1]) for i,r in enumerate(booking_race) if r[0]==200)
  (patient if winner[0]==0 else b).ok('/api/appointments/'+winner[1]['id']+'/status',dict(status='Cancelled',version=winner[1]['version']))
  check(sql('SELECT count(*) FROM careline_identity."PatientBookings" WHERE "AppointmentId"=\''+winner[1]['id']+'\'')==0,'Cancellation releases the shared busy interval atomically')
  home=Client(api,patient.token,None).ok('/api/patient/home')
  check({v['appointmentId'] for v in home['appointments']}=={aa['id'],bb['id']},'The personal page aggregates only this patient’s upcoming visits across clinics')
  check(all(x['id']!=bb['id'] for x in staff.ok('/api/bootstrap')['appointments']) and all(x['id']!=aa['id'] for x in east.ok('/api/bootstrap')['appointments']),'Reception sees only its own clinic, including for a shared patient')
  check(patient.request('/api/patients/'+bs['actor']['patientId'])[0]==404 and b.request('/api/patients/'+a['actor']['patientId'])[0]==404,'Local patient IDs cannot expose records across clinics')
  check(staff.request('/api/accounts',dict(name='Manual patient',email='manual@global.test',password=password,role='Patient',patientId=a['actor']['patientId']))[0]==403,'Reception cannot create/link patient login accounts')
  check(staff.request('/api/accounts/'+a['actor']['id']+'/credentials',dict(email='ana@global.test',password=password+'-staff'))[0]==403,'Reception cannot reset the global password from a local membership')
  staff.ok('/api/accounts/'+a['actor']['id']+'/access',dict(enabled=False))
  check(patient.request('/api/bootstrap')[0]==403 and b.request('/api/bootstrap')[0]==200,'Disabling clinic A access does not disable clinic B or the shared account')
  check(Client(api,patient.token,None).request('/api/patient/clinics/main',{})[0]==403,'Joining again cannot reactivate a disabled membership')
  check(Client(api,patient.token,None).request('/api/patient/clinics/closed',{})[0]==403,'Closed registration still prevents new clinic memberships')
  check(Client(api,clinic='closed').request('/api/auth/register',dict(name='Closed clinic',email='closed-patient@global.test',password=password))[0]==403,'Initial registration still respects clinic policy')
  check(sql('SELECT count(*) FROM careline_identity."PatientAccounts"')==2,'Rejected joins/registration do not leave extra identities')
  staff.ok('/api/accounts/'+a['actor']['id']+'/access',dict(enabled=True))
  # A public email alone must never claim a phone-created contact or reveal its history.
  old=staff.ok('/api/patients',dict(name='Private old contact',email='unclaimed@global.test',phone='+38970123456'))
  new=Client(api).ok('/api/auth/register',dict(name='Independent patient',email='unclaimed@global.test',password=password))
  safe=Client(api);safe.login('unclaimed@global.test')
  check(new['patientId']!=old['id'] and safe.request('/api/patients/'+old['id'])[0]==404,'Matching contact email never unlocks or merges somebody’s clinic record')
  check(len(safe.ok('/api/bootstrap')['patients'])==1,'A newly registered patient sees only the new owned profile')
  # Registration races use one shared identity namespace, including across different clinics.
  def signup(cid):return Client(api if cid=='main' else api2,clinic=cid).request('/api/auth/register',dict(name='Concurrent patient',email='race@global.test',password=password))[0]
  with concurrent.futures.ThreadPoolExecutor() as pool:results=list(pool.map(signup,['main','east']))
  check(sorted(results)==[200,409] and sql('SELECT count(*) FROM careline_identity."PatientAccounts" WHERE "Email"=\'race@global.test\'')==1,'Concurrent cross-clinic signups create one account')
  company=Client(api,clinic=None);company.token=company.ok('/api/platform/login',dict(email='company@global.test',password=password))['accessToken']
  check(Client(api,patient.token,None).request('/api/platform/clinics')[0]==401 and Client(api,company.token,'main').request('/api/bootstrap')[0]==401,'Patient and company session tokens cannot cross authentication schemes')
  check(staff.request('/api/platform/patients?email=ana%40global.test')[0]==401,'Reception cannot use the company patient-support directory')
  check(company.ok('/api/platform/patients')==[],'Company support does not list all patient identities without an exact search')
  found=company.ok('/api/platform/patients?email=unclaimed%40global.test')
  check(len(found)==1 and set(found[0])=={'id','name','email'},'Support finds one login identity without returning clinical history')
  # Lockout is central, shared between API instances, and recoverable by company support.
  for i in range(5):check(Client(api if i%2 else api2).request('/api/auth/login',dict(email='unclaimed@global.test',password='incorrect-secret'))[0]==401,'Wrong password contributes to one shared patient lockout')
  check(Client(api2).request('/api/auth/login',dict(email='unclaimed@global.test',password=password))[0]==401,'A central lockout cannot be bypassed through another API or clinic')
  company.ok('/api/platform/patients/'+found[0]['id']+'/password',dict(newPassword=password+'-support'))
  check(safe.request('/api/bootstrap')[0]==401 and Client(api2).login('unclaimed@global.test',password+'-support')['globalPatient'],'Company support revokes all sessions and restores access with one new password')
  check(sql('SELECT count(*) FROM careline_identity."PatientEvents" WHERE "PatientAccountId"=\''+found[0]['id']+'\' AND "ActorType"=\'PlatformOperator\' AND "Action"=\'password.reset\'')==1,'Company recovery records an audit event with the operator identity')
  sql('UPDATE clinic_east."Settings" SET "Value"=\'wrong-clinic\' WHERE "Key"=\'ClinicId\'; SELECT 1')
  try:
   fallback=Client(api,clinic=None);fallback_session=fallback.login('ana@global.test',clinic='east');fallback_home=fallback.ok('/api/patient/home')
   check(fallback_session['globalPatient'] and fallback_session['clinic'] is None and any(c['clinic']['id']=='main' and c['available'] for c in fallback_home['clinics']) and any(c['clinic']['id']=='east' and not c['available'] for c in fallback_home['clinics']),'A damaged default clinic cannot lock the patient out of their personal account or healthy clinic')
   fallback.ok('/api/patient/clinics/main',{})
  finally:sql('UPDATE clinic_east."Settings" SET "Value"=\'east\' WHERE "Key"=\'ClinicId\'; SELECT 1')
  # Keep the password unchanged until the real browser finishes its cross-clinic flows.
  if os.environ.get('TEST_BROWSER_EXECUTABLE'):
   start('Appointments.Web',web,dict(env,Backend__Mode='Api',Backend__ApiBaseUrl=api+'/'))
   subprocess.run(['node','tests/frontend/global-patients-browser.cjs'],cwd=root,env=dict(env,TEST_WEB_URL=web,TEST_PASSWORD=password,TEST_GLOBAL_FIXTURE=json.dumps(dict(doctor=doctors['east'],service=services['east'],date=date,mainVisit=aa['id'],eastVisit=bb['id']))),check=True,timeout=120)
  Client(api,patient.token,None).ok('/api/patient/clinics/east',{})
  other=Client(api2,clinic='east');other.login('ana@global.test')
  b.ok('/api/auth/password',dict(currentPassword=password,newPassword=password+'-changed'))
  check(patient.request('/api/bootstrap')[0]==401 and other.request('/api/bootstrap')[0]==401,'A patient password change revokes sessions in every clinic and API instance')
  check(Client(api).request('/api/auth/login',dict(email='ana@global.test',password=password))[0]==401,'The old patient password stops working everywhere')
  refreshed=Client(api2,clinic=None);again=refreshed.login('ana@global.test',password+'-changed')
  check(again['globalPatient'] and again['clinic']['id']=='east','The same new password signs in to the last selected clinic')
  refreshed.ok('/api/auth/logout',{})
  check(refreshed.request('/api/auth/me')[0]==401,'Global sign-out revokes the patient token')
  # An unchanged staff identity remains assigned to exactly one clinic after the redesign.
  check(Client(api,staff.token,'main').request('/api/bootstrap')[0]==200 and Client(api,staff.token,'east').request('/api/bootstrap')[0]==401,'Patient changes cannot broaden receptionist permissions')
  start('Appointments.Api',address(),env,['--migrate'])
  check(sql('SELECT count(*) FROM careline_identity."PatientMemberships" WHERE "PatientAccountId"=(SELECT "Id" FROM careline_identity."PatientAccounts" WHERE "Email"=\'ana@global.test\')')==2,'Repeated maintenance preserves the one-account/two-membership model')
  quota_registration=Client(api).ok('/api/auth/register',dict(name='Пациент со повеќе клиники',email='quota@global.test',password=password))
  qa=Client(api);qa.login('quota@global.test');qb=Client(api2,qa.token,'east')
  Client(api,qa.token,None).ok('/api/patient/clinics/east',{})
  qb_state=qb.ok('/api/bootstrap');quota_date=(dt.date.fromisoformat(date)+dt.timedelta(days=40)).isoformat()
  def quota_book(client,cid,pid,hour):return client.request('/api/appointments',dict(doctorId=doctors[cid]['id'],patientId=pid,date=quota_date,time=f'{hour:02}:00',durationMinutes=30,requestId=str(uuid.uuid4()),serviceId=services[cid]['id']))
  for hour in [10,11,12]:check(quota_book(qa,'main',quota_registration['patientId'],hour)[0]==200,'Patient can reach its configured clinic-local allowance')
  code,visit=quota_book(qb,'east',qb_state['actor']['patientId'],14)
  check(code==200,'Three bookings at clinic A do not consume the allowance at clinic B')
  moved=qb.ok('/api/appointments/'+visit['id']+'/move',dict(date=quota_date,time='15:00',version=visit['version']))
  check(moved['start']!=visit['start'],'Other-clinic bookings cannot prevent a valid reschedule at clinic B')
  check(quota_book(qa,'main',quota_registration['patientId'],16)[0]==409,'The original clinic still enforces its own future-booking cap')
  print(f'{count}/{count} global patient API/PostgreSQL checks passed.',flush=True)
 except Exception:
  for log in logs:log.flush();log.seek(0);print(log.read()[-11000:])
  raise
 finally:
  for proc in reversed(processes):
   if proc.poll() is None:proc.terminate()
  for proc in processes:
   try:proc.wait(timeout=15)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
  for log in logs:log.close()
  if Path(fixture).exists():op('--tenant-drop')
