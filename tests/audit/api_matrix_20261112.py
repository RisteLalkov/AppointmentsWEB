"""Black-box API route/method/role/validation audit; records failures without changing the application."""
from common_20261112 import *
import concurrent.futures,statistics
os.environ['QA_RESULTS_FILE']='api-matrix-results.json';S=seed();A=Client('reception-main').login('main@audit.test');E=Client('reception-east',clinic='east').login('east@audit.test');P=Client('patient').login('patient@audit.test');D=Client('doctor').login('doctor@audit.test');C=Client('platform');C.token=C.ok('/api/platform/login',dict(email='platform@audit.test',password=R['password']))['accessToken']
ANON=Client();INVALID=Client('invalid-token',token='c1.main.'+'f'*64);MC=S['catalogs']['main'];DOCTOR=MC['doctors'][0]['id'];VISIT=S['visit']['id'];PATIENT=S['mainPid'];EX=S['exception']['id'];DAY=S['day']
openapi=ANON.ok('/openapi/v1.json');save('openapi.json',openapi)
inventory=[]
def concrete(path):
 ident=VISIT if '/appointments/' in path else S['staff2']['id'] if '/accounts/' in path else S['patient']['id'] if '/platform/patients/' in path else PATIENT if '/patients/' in path else 'main'
 if '/exceptions/{id}' in path:ident=EX
 path=path.replace('{id}',ident).replace('{doctorId}',DOCTOR).replace('{clinicId}','main')
 query={}
 if path in ['/api/slots','/api/availability/days','/api/availability/next','/api/exceptions']:query['doctorId']=DOCTOR
 if path=='/api/slots':query.update(date=DAY,serviceId=MC['service']['id'])
 if path=='/api/availability/days':query.update(**{'from':DAY,'to':DAY,'serviceId':MC['service']['id']})
 if path=='/api/availability/next':query.update(doctorIds=DOCTOR,**{'from':DAY,'serviceId':MC['service']['id']})
 if path=='/api/reports':query.update(**{'from':S['today'],'to':DAY})
 if path.endswith('/availability'):query.update(date=DAY,serviceId=MC['service']['id'])
 if path=='/api/platform/patients':query.update(email='patient@audit.test')
 return path+('?' + urllib.parse.urlencode(query) if query else '')
for path,operations in openapi['paths'].items():
 verbs={m.upper() for m in operations if m.lower() in ['get','post','put','patch','delete','head','options']}
 for method in sorted(verbs):
  operation=operations[method.lower()];url=concrete(path);protected=bool(operation.get('security'))
  row=dict(path=path,method=method,protected=protected,parameters=operation.get('parameters',[]))
  try:
   code,value,*_=ANON.req(url,{} if method=='POST' else None,method)
   row['anonymous']=code
   if protected:record('Anonymous boundary '+method+' '+path,code==401,expected=401,actual=code)
   elif method=='GET':record('Anonymous read '+path,code in ([404] if 'demo-' in path else [200]),actual=code)
   if protected:
    code=INVALID.req(url,{} if method=='POST' else None,method)[0];row['invalidToken']=code;record('Invalid session '+method+' '+path,code==401,actual=code)
   if method=='GET':
    client=C if path.startswith('/api/platform') else P if path.startswith('/api/patient/') else A
    code,value,*_=client.req(url);row['authorizedRead']=code
    record('Authorized read '+path,code in ([404] if 'demo-users' in path else [200]),actual=code,role=client.role)
   wrong=P if path.startswith('/api/accounts') or path.startswith('/api/platform') or path=='/api/reports' or '/catalogue/' in path or path=='/api/patients' and method=='POST' else A if path.startswith('/api/patient/') else None
   if wrong and protected:
    code=wrong.req(url,{} if method=='POST' else None,method)[0];row['wrongRole']=code;record('Role boundary '+method+' '+path,code in [401,403],actual=code,role=wrong.role)
  except Exception as error:row['error']=str(error);record('Route execution '+method+' '+path,False,error=str(error))
  inventory.append(row)
 for method in ['PUT','PATCH','DELETE','OPTIONS']:
  if method in verbs:continue
  try:
   code=A.req(concrete(path),method=method)[0];record('Unsupported method '+method+' '+path,code==405,actual=code)
  except Exception as error:record('Unsupported method '+method+' '+path,False,error=str(error))
save('endpoint-matrix.json',inventory)
# Validation against actual authenticated endpoints. Each case is read-only or rejected before mutation.
fuzz=[('/api/patients',dict(name='Missing email',email='',phone='070123456')),('/api/patients',dict(name='Missing phone',email='missing@audit.test',phone='')),('/api/patients',dict(name='Bad email',email='not-an-email',phone='070123456')),('/api/patients',dict(name='N'*81,email='long@audit.test',phone='070123456')),('/api/patients',dict(name='Bad phone',email='badphone@audit.test',phone='+389+70123456')),('/api/catalogue/doctors',dict(name='Bad doctor',specialtyId='missing',subspecialty='',enabled=True)),('/api/catalogue/specialties',dict(name=' ')),('/api/catalogue/services',dict(name='Bad service',specialtyId=MC['specialty']['id'],durationMinutes=0,enabled=True,doctorIds=[])),('/api/catalogue/services',dict(name='Bad assignment',specialtyId=MC['specialty']['id'],durationMinutes=30,enabled=True,doctorIds=['missing'])),('/api/schedule/'+DOCTOR,dict(periods=[None],durationMinutes=30,version=2)),('/api/schedule/'+DOCTOR,dict(periods=[],durationMinutes=30,version=-1)),('/api/schedule/'+DOCTOR,dict(periods=[dict(day='Monday',start='10:00',end='09:00')],durationMinutes=30,version=2)),('/api/schedule/'+DOCTOR,dict(periods=[dict(day='Monday',start='08:00:01',end='09:00')],durationMinutes=30,version=2)),('/api/exceptions/'+DOCTOR,dict(date=DAY,start='10:00',end='09:00',isAvailable=False,reason='Bad range')),('/api/exceptions/'+DOCTOR,dict(date='2000-01-01',start='10:00',end='11:00',isAvailable=False,reason='Past')),('/api/appointments',dict(doctorId=DOCTOR,patientId=PATIENT,date=DAY,time='11:00',durationMinutes=30,requestId='not-guid',serviceId=MC['service']['id'])),('/api/appointments',dict(doctorId=DOCTOR,patientId=PATIENT,date=DAY,time='11:00',durationMinutes=20,requestId=uuid.uuid4().hex,serviceId=MC['service']['id'])),('/api/appointments/'+VISIT+'/status',dict(status=999,version=1)),('/api/appointments/'+VISIT+'/move',dict(date='2000-01-01',time='10:00',version=1)),('/api/accounts',dict(name='Invalid role',email='invalidrole@audit.test',password=R['password'],role=999)),('/api/auth/register',dict(name='Bad registration',email='bad',phone='070123456',password=R['password']))]
for i,(path,body) in enumerate(fuzz):
 try:
  client=ANON if path=='/api/auth/register' else A;code,value,*_=client.req(path,body);record('Validation '+str(i+1)+' '+path,code in [400,403,404,409],actual=code,response=value if code>=500 else None)
 except Exception as error:record('Validation '+str(i+1)+' '+path,False,error=str(error))
for path in ['/api/slots?doctorId='+DOCTOR+'&date=9999-12-31','/api/slots?doctorId='+DOCTOR+'&date=0001-01-01','/api/slots?doctorId='+DOCTOR+'&date=garbage','/api/appointments?skip=-1','/api/appointments?take=501','/api/appointments?status=999','/api/reports?from=9999-12-31&to=9999-12-31','/api/reports?from=2026-11-12&to=2025-01-01','/api/availability/next?doctorIds=&from='+DAY,'/api/availability/days?doctorId='+DOCTOR+'&from='+DAY+'&to=9999-12-31','/api/patients/missing','/api/appointments/missing/history','/api/slots?doctorId=missing&date='+DAY]:
 code,value,*_=A.req(path);record('Boundary '+path,code in [200,400,404,409],actual=code,response=value if code>=500 else None)
for method in ['POST','GET']:
 path='/api/patients' if method=='POST' else '/api/appointments'
 for raw in ([b'null',b'[]',b'{',b'"text"'] if method=='POST' else [None]):
  code,value,*_=A.req(path,method=method,raw=raw);record('Malformed body '+method+' '+str(raw),code in ([400] if method=='POST' else [200]),actual=code)
for payload in ["' OR 1=1 --",'<script>globalThis.qaXss=1</script>','ЈОВАН','Нешковски','Јован Нешковски']:
 code,value,*_=ANON.req('/api/public/doctors?clinicId=main&search='+urllib.parse.quote(payload));record('Public search '+payload,code==200 and (value.get('total',0)>=1 if payload in ['ЈОВАН','Нешковски','Јован Нешковски'] else value.get('total',0)==0),actual=code,total=value.get('total') if isinstance(value,dict) else None)
# Real races across two API instances, each outcome recorded independently.
contacts=A.ok('/api/bootstrap')['patients'];person=next(p for p in contacts if p['email']=='main-contact-0@audit.test')
run_file=WORK/'matrix-runs.json';run_number=int(run_file.read_text())+1 if run_file.exists() else 1;run_file.write_text(str(run_number))
race_day=(dt.date.fromisoformat(S['today'])+dt.timedelta(days=20+run_number)).isoformat()
cmd=dict(doctorId=DOCTOR,patientId=person['id'],date=race_day,time='14:00',durationMinutes=30,serviceId=MC['service']['id'],requestId=uuid.uuid4().hex)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:out=list(pool.map(lambda i:A.clone(base=R['api'] if i%2==0 else R['api2']).req('/api/appointments',dict(cmd,requestId=uuid.uuid4().hex))[0],range(8)))
record('Eight simultaneous bookings across two API hosts',out.count(200)==1 and out.count(409)==7,statuses=out)
new=next(a for a in A.ok('/api/appointments?patientId='+person['id']+'&take=500')['items'] if a['start'].startswith(race_day))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:out=list(pool.map(lambda i:A.clone(base=R['api'] if i%2==0 else R['api2']).req('/api/appointments/'+new['id']+'/move',dict(date=race_day,time='15:00',version=new['version']))[0],range(4)))
record('Concurrent rescheduling preserves one version winner',out.count(200)==1 and out.count(409)==3,statuses=out)
# Platform adoption is a real mutation; keep the same registry binding and records.
code,value,*_=C.req('/api/platform/clinics/main/adopt',{});record('Platform adopts the existing public-schema clinic',code==200,actual=code)
(WORK/'clients.json').write_text(json.dumps(dict(admin=A.token,east=E.token,patient=P.token,doctor=D.token,platform=C.token)));os.chmod(WORK/'clients.json',0o600)
save('api-summary.json',dict(cases=len(RESULTS),passed=sum(r['status']=='PASS' for r in RESULTS),failed=[r for r in RESULTS if r['status']=='FAIL']))
