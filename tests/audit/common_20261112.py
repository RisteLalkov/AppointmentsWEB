"""Audit-only helpers. No application imports/mutations; safe generated local fixture only."""
import datetime as dt,hashlib,hmac,json,os,pathlib,re,subprocess,time,urllib.request,urllib.error,urllib.parse,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/os.environ.get('QA_OUTPUT','docs/audit/2026-11-12');WORK=pathlib.Path(os.environ.get('QA_WORK','/workspace/.setup/qa20261112'))
R=json.loads((WORK/'runtime.json').read_text());RESULTS=[];SERIAL=0
for value in R['dsn']:
 if not re.search(r'Host=(?:127\.0\.0\.1|localhost)(?:;|$)',value,re.I) or not re.search(r'Database=careline_test_[a-f0-9]{12}_[01](?:;|$)',value,re.I):raise RuntimeError('Invalid QA fixture database.')
def save(name,value):(OUT/'evidence'/name).write_text(json.dumps(value,ensure_ascii=False,indent=2,default=str))
def record(name,passed,**detail):
 value=dict(id=f'X{len(RESULTS)+1:04}',name=name,status='PASS' if passed is True else 'FAIL' if passed is False else 'NOT TESTED',**detail);RESULTS.append(value);save(os.environ.get('QA_RESULTS_FILE','targeted-results.json'),RESULTS);print(json.dumps(value,ensure_ascii=False,default=str),flush=True);return value
class Client:
 def __init__(self,role='anonymous',token='',clinic='main',base=None):self.role,self.token,self.clinic,self.base=role,token,clinic,base or R['api']
 def req(self,path,body=None,method=None,headers=None,raw=None):
  global SERIAL
  SERIAL+=1;stamp=int(time.time());address='2001:db8::'+format(SERIAL,'x');signature=hmac.new(R['key'].encode(),(address+'\n'+str(stamp)).encode(),hashlib.sha256).hexdigest().upper()
  head={'X-Clinic':self.clinic,'X-Web-Client':address,'X-Web-Time':str(stamp),'X-Web-Signature':signature}
  if self.token:head['Authorization']='Bearer '+self.token
  head.update(headers or {})
  data=raw
  if body is not None:data=json.dumps(body,ensure_ascii=False).encode()
  if data is not None:head.setdefault('Content-Type','application/json')
  request=urllib.request.Request(self.base+path,data,head,method=method);start=time.monotonic()
  try:response=urllib.request.urlopen(request,timeout=40)
  except urllib.error.HTTPError as e:response=e
  payload=response.read();text=payload.decode(errors='replace')
  try:value=json.loads(text)
  except ValueError:value=text
  code=response.status;elapsed=round((time.monotonic()-start)*1000,2)
  with (OUT/'evidence/http-ledger.jsonl').open('a') as f:f.write(json.dumps(dict(method=request.get_method(),path=path,role=self.role,clinic=self.clinic,status=code,milliseconds=elapsed,bytes=len(payload)),ensure_ascii=False)+'\n')
  return code,value,dict(response.headers),elapsed,len(payload)
 def ok(self,path,body=None,method=None):
  code,value,*_=self.req(path,body,method)
  if code!=200:raise RuntimeError(path+' returned '+str(code)+' '+str(value)[:250])
  return value
 def login(self,email,clinic=None):
  data=dict(email=email,password=R['password'])
  if clinic:data['clinicId']=clinic
  self.token=self.ok('/api/auth/login',data)['accessToken'];return self
 def clone(self,**kw):return Client(kw.get('role',self.role),kw.get('token',self.token),kw.get('clinic',self.clinic),kw.get('base',self.base))
def sql(query,index=0,owner=True,stop=True):
 dsn=R['dsn'][index];db=re.search(r'Database=([^;]+)',dsn,re.I)[1];user=re.search(r'Username=([^;]+)',dsn,re.I)[1] if owner else 'postgres'
 args=['docker','--host=unix:///var/run/docker.sock','exec','-i',R['container'],'psql','-X','-qAt','-v','ON_ERROR_STOP='+('1' if stop else '0'),'-U',user,'-d',db]
 p=subprocess.run(args,input=query,text=True,capture_output=True,timeout=90)
 if p.returncode and stop:raise RuntimeError(p.stderr[-1500:])
 return p.stdout.strip(),p.stderr,p.returncode
def jsql(query,index=0):
 text,_,_=sql(query,index);return True if text=='t' else False if text=='f' else json.loads(text) if text else None
def seed():
 if (WORK/'seed.json').exists():return json.loads((WORK/'seed.json').read_text())
 admin=Client('reception-main').login('main@audit.test');east=Client('reception-east',clinic='east').login('east@audit.test');company=Client('platform');company.token=company.ok('/api/platform/login',dict(email='platform@audit.test',password=R['password']))['accessToken']
 catalogs={}
 for cid,client in [('main',admin),('east',east)]:
  specialty=client.ok('/api/catalogue/specialties',dict(name='QA Кардиологија'))
  doctors=[]
  for i,(name,pending,staff,hours) in enumerate([('Јован Нешковски',False,False,True),('Доктор Потврда',True,False,True),('Доктор По договор',False,False,False),('Доктор Рецепција',False,True,True)]):
   doctor=client.ok('/api/catalogue/doctors',dict(name=name,specialtyId=specialty['id'],subspecialty='',enabled=True,requiresConfirmation=pending,staffOnly=staff))
   if hours:client.ok('/api/schedule/'+doctor['id'],dict(version=1,durationMinutes=30,periods=[dict(day=d,start='08:00',end='18:00') for d in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]))
   doctors.append(doctor)
  service=client.ok('/api/catalogue/services',dict(name='QA Преглед',specialtyId=specialty['id'],durationMinutes=30,enabled=True,doctorIds=[d['id'] for d in doctors]))
  short=client.ok('/api/catalogue/services',dict(name='QA Контрола',specialtyId=specialty['id'],durationMinutes=20,enabled=True,doctorIds=[doctors[0]['id']]))
  catalogs[cid]=dict(specialty=specialty,doctors=doctors,service=service,short=short)
  for i in range(6):client.ok('/api/patients',dict(name=f'QA Контакт {i:02}',email=f'{cid}-contact-{i}@audit.test',phone='070123456'))
 staff2=admin.ok('/api/accounts',dict(name='QA Втор рецепционер',email='second@audit.test',password=R['password'],role='Administrator'))
 doctor_account=admin.ok('/api/accounts',dict(name='QA Лекар',email='doctor@audit.test',password=R['password'],role='Doctor',doctorId=catalogs['main']['doctors'][0]['id']))
 identity=Client('anonymous').ok('/api/auth/register',dict(name='QA Ана Пациент',email='patient@audit.test',phone='071123456',password=R['password']))
 patient=Client('patient').login('patient@audit.test');patient.ok('/api/patient/clinics/east',{})
 main_pid=patient.ok('/api/bootstrap')['actor']['patientId'];east_pid=patient.clone(clinic='east').ok('/api/bootstrap')['actor']['patientId']
 other=Client('anonymous').ok('/api/auth/register',dict(name='QA Друг Пациент',email='other@audit.test',phone='072123456',password=R['password']))
 today=dt.date.fromisoformat(admin.ok('/api/bootstrap')['today']);day=(today+dt.timedelta(days=10)).isoformat()
 command=dict(doctorId=catalogs['main']['doctors'][0]['id'],patientId=main_pid,serviceId=catalogs['main']['service']['id'],date=day,time='09:00',durationMinutes=30,requestId=uuid.uuid4().hex)
 visit=patient.ok('/api/appointments',command)
 exception=admin.ok('/api/exceptions/'+catalogs['main']['doctors'][0]['id'],dict(date=day,start='12:00',end='13:00',isAvailable=False,reason='QA Пауза'))
 data=dict(catalogs=catalogs,staff2=staff2,doctorAccount=doctor_account,patient=identity,other=other,mainPid=main_pid,eastPid=east_pid,day=day,today=today.isoformat(),visit=visit,exception=exception)
 (WORK/'seed.json').write_text(json.dumps(data,ensure_ascii=False));os.chmod(WORK/'seed.json',0o600);return data
