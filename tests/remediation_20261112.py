"""Post-audit regressions. Generated loopback fixture only; never a production database."""
import os,pathlib,sys,uuid,datetime as dt,concurrent.futures
ROOT=pathlib.Path(__file__).resolve().parents[1]
os.environ.setdefault('QA_WORK','/workspace/.setup/qa-fixes-20261112');os.environ.setdefault('QA_OUTPUT','docs/verification/2026-11-12')
os.environ['QA_RESULTS_FILE']='remediation-api.json';sys.path.insert(0,str(ROOT/'tests/audit'))
from common_20261112 import *
S=seed();A=Client('reception').login('main@audit.test');E=Client('east',clinic='east').login('east@audit.test');P=Client('patient').login('patient@audit.test');O=Client('other-patient').login('other@audit.test');D=Client('doctor').login('doctor@audit.test');C=Client('platform');C.token=C.ok('/api/platform/login',dict(email='platform@audit.test',password=R['password']))['accessToken']
def case(name,fn):
 try:record(name,bool(fn()))
 except Exception as e:record(name,False,error=str(e))
def expect(client,path,status,body=None):return client.req(path,body)[0]==status
boot=A.ok('/api/bootstrap');case('API bootstrap explicitly advertises windowed collections',lambda:boot['windowed'] and boot['overview'] and len(boot['appointments'])<=100 and len(boot['patients'])<=150)
for role,client in [('reception',A),('doctor',D),('patient',P)]:
 for path in ['/api/workspace/patients?take=2','/api/workspace/appointments?take=2','/api/workspace/appointments/'+S['visit']['id'],'/api/workspace/patients/'+S['mainPid']+'?take=2']:
  case('Authorized paged read '+role+' '+path,lambda c=client,p=path:expect(c,p,200))
  case('Anonymous denial '+path+' '+role,lambda p=path:expect(Client(),p,401))
for path in ['/api/workspace/appointments/'+S['visit']['id'],'/api/workspace/patients/'+S['mainPid']]:
 case('Unrelated patient cannot read '+path,lambda p=path:expect(O,p,404))
case('Patient directory search returns only own contact',lambda:all(p['id']==S['mainPid'] for p in P.ok('/api/workspace/patients?take=500')['items']))
case('Staff token cannot select another clinic for workspace pages',lambda:expect(A.clone(clinic='east'),'/api/workspace/patients',401))
for query in ['take=0','take=501','skip=-1','period=invalid','status=999','from=2027-01-01&to=2026-01-01','to=9999-12-31','from=not-a-date','search='+('x'*201)]:
 case('Invalid page query '+query[:80],lambda q=query:expect(A,'/api/workspace/appointments?'+q,400))
for payload in ["' OR 1=1 --",'<script>alert(1)</script>']:
 case('Patient search literal '+payload,lambda x=payload:A.ok('/api/workspace/patients?search='+urllib.parse.quote(x))['total']==0)
for payload in ['ЈОВАН','Нешковски','Јован Нешковски']:
 case('Cyrillic appointment search '+payload,lambda x=payload:A.ok('/api/workspace/appointments?search='+urllib.parse.quote(x))['total']>=1)
# Minimal independent directory fixtures exercise pages, same-name ordering, locating a newly added record and remote search.
people=[]
for i in range(70):people.append(A.ok('/api/patients',dict(name=f'QA Paging {i:03}',email=f'paging-{i:03}@fix.test',phone='070123456')))
for text in [people[-1]['email'],'QA Paging 069','PT-'+str(people[-1]['number']).zfill(6),'070123456']:
 case('Full-directory search reaches records outside bootstrap '+text,lambda q=text:any(p['id']==people[-1]['id'] for p in A.ok('/api/workspace/patients?take=500&search='+urllib.parse.quote(q))['items']))
page1=A.ok('/api/workspace/patients?take=12');page2=A.ok('/api/workspace/patients?take=12&skip=12')
case('Patient pages have stable totals and disjoint records',lambda:page1['total']==page2['total'] and len(page1['items'])==12 and len(page2['items'])==12 and not(set(p['id'] for p in page1['items'])&set(p['id'] for p in page2['items'])))
last=A.ok('/api/workspace/patients?take=12&locateId='+people[-1]['id'])
case('Locate a new patient on its actual server page',lambda:last['locatedSkip'] is not None and any(p['id']==people[-1]['id'] for p in last['items']))
case('A doctor cannot use another doctor scope to enumerate linked patients',lambda:D.ok('/api/workspace/patients?doctorId='+S['catalogs']['main']['doctors'][1]['id'])['total']==0)
# Default bootstrap must not silently determine all-history counts or access to older details.
long=A.ok('/api/patients',dict(name='QA Long History',email='long-history@fix.test',phone='070123456'));cat=S['catalogs']['main'];doc=cat['doctors'][0]['id'];service=cat['service']['id']
sql(f'''INSERT INTO "Appointments" ("Id","DoctorId","PatientId","ServiceId","ServiceName","Start","End","Status","Version","CreatedBy","RequestId","UpdatedAt") SELECT 'fix-history-'||g,'{doc}','{long['id']}','{service}','QA History','2022-01-01'::timestamptz+g*interval '30 minutes','2022-01-01'::timestamptz+(g+1)*interval '30 minutes','Completed',1,'fix-history','fix-history-'||g,now() FROM generate_series(1,2000) g ON CONFLICT DO NOTHING;''')
sql(f'''INSERT INTO "Appointments" ("Id","DoctorId","PatientId","ServiceId","ServiceName","Start","End","Status","Version","CreatedBy","RequestId","UpdatedAt") VALUES ('fix-overnight','{doc}','{people[0]['id']}','{service}','QA Midnight','2021-12-31 22:30+00','2021-12-31 23:30+00','Completed',1,'fix-history','fix-overnight',now()) ON CONFLICT DO NOTHING;''')
case('Calendar range includes an overnight visit beginning before the first local day',lambda:any(a['id']=='fix-overnight' for a in A.ok('/api/workspace/appointments?from=2022-01-01&to=2022-01-01&overlap=true&take=500')['items']))
case('Default list date filter retains start-date semantics',lambda:all(a['id']!='fix-overnight' for a in A.ok('/api/workspace/appointments?from=2022-01-01&to=2022-01-01&take=500')['items']))
old=A.ok('/api/workspace/patients/'+long['id']+'?take=12&skip=1980&status=Completed');case('Patient profile includes all history in count, only requested page in response',lambda:old['total']==2000 and len(old['appointments'])==12 and old['counts']['completed']==2000)
case('Details outside initial window remain accessible to staff',lambda:expect(A,'/api/workspace/appointments/fix-history-1',200))
case('Old details remain private from other patients',lambda:expect(P,'/api/workspace/appointments/fix-history-1',404))
case('Bootstrap remains bounded after history growth',lambda:len(A.ok('/api/bootstrap')['appointments'])<=100)
case('Overview totals include history outside bootstrap',lambda:A.ok('/api/bootstrap')['overview']['closedCount']>=2000)
for path in ['/api/patients','/api/patients/{id}','/api/workspace/patients','/api/workspace/appointments','/api/workspace/appointments/{id}','/api/workspace/patients/{id}']:
 schema=Client().ok('/openapi/v1.json')
 for verb,operation in schema['paths'][path].items():case('Swagger requires clinic '+verb+' '+path,lambda op=operation:any(p['name']=='X-Clinic' and p.get('required') for p in op.get('parameters',[])))
# Security events survive the rejection, share the lockout transaction and never impersonate the victim.
tag=uuid.uuid4().hex[:10]
gp='audit-patient-'+tag+'@fix.test';Client().ok('/api/auth/register',dict(name='QA Security Patient',email=gp,phone='070123456',password=R['password']))
staffemail='audit-staff-'+tag+'@fix.test';staff=A.ok('/api/accounts',dict(name='QA Security Staff',email=staffemail,role='Administrator',password=R['password']))
opid='qa-security-'+tag;opemail='audit-company-'+tag+'@fix.test';sql(f'''INSERT INTO "PlatformOperators" ("Id","Email","Name","PasswordHash","Enabled","FailedAttempts") SELECT '{opid}','{opemail}','QA Security Company',"PasswordHash",true,0 FROM "PlatformOperators" LIMIT 1''',1)
for kind,email,path,index,table,lookup in [('patient',gp,'/api/auth/login',0,'careline_identity."SecurityEvents"',f'''(SELECT "Id" FROM careline_identity."PatientAccounts" WHERE "Email"='{gp}')'''),('staff',staffemail,'/api/auth/login',0,'public."AuditEvents"',"'"+staff['id']+"'"),('company',opemail,'/api/platform/login',1,'public."PlatformAuditEvents"',"'"+opid+"'")]:
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:statuses=list(pool.map(lambda i:Client(base=R['api'] if i%2 else R['api2']).req(path,dict(email=email,password='Wrong-test-password-12345'))[0],range(8)))
 events=jsql(f'''SELECT json_agg(json_build_object('action',"Action",'actor',"ActorId")) FROM {table} WHERE "TargetId"={lookup} AND "Action" LIKE 'auth.%' ''',index)
 case('Distributed failure/lockout audit '+kind,lambda ev=events,st=statuses:st==[401]*8 and sum(e['action']=='auth.login.failed' for e in ev)==5 and sum(e['action']=='auth.account.locked' for e in ev)==1 and sum(e['action']=='auth.login.blocked' for e in ev)==3 and all(e['actor']=='anonymous' for e in ev))
case('Unknown identity rejected without storing its email',lambda:expect(Client(),'/api/auth/login',401,dict(email='unknown-'+tag+'@fix.test',password=R['password'])) and jsql('''SELECT count(*) FROM careline_identity."SecurityEvents" WHERE "Scope"='Identity' AND "TargetId" IS NULL AND "Action"='auth.login.failed' ''')>=1)
adopt=C.ok('/api/platform/clinics/main/adopt',{});update=C.ok('/api/platform/clinics/main/details',dict(name=adopt['name'],description='QA verified metadata',address='Skopje',phone='',discoverable=True,allowRegistration=True,version=adopt['version']))
events=C.ok('/api/platform/audit?take=500');case('Company adoption and metadata edit record operator and clinic',lambda:all(any(e['action']==act and e['targetId']=='main' and e['actorId']!='anonymous' for e in events) for act in ['clinic.adopted','clinic.updated']))
case('Reception cannot read company audit',lambda:expect(A,'/api/platform/audit',401))
case('Patient cannot read company audit',lambda:expect(P,'/api/platform/audit',401))
case('Clinical detail/history reads are auditable without contact payloads',lambda:any(e['action']=='patient.history.viewed' and e['targetId']==long['id'] for e in A.ok('/api/accounts/audit?take=500')))
save('remediation-browser-fixture.json',dict(longPatient=long,people=people,doctor=doc,service=service,day=S['day']))
(WORK/'remediation-data.json').write_text(json.dumps(dict(longPatient=long,people=people,doctor=doc,service=service,day=S['day'])));os.chmod(WORK/'remediation-data.json',0o600)
save('remediation-api-summary.json',dict(cases=len(RESULTS),passed=sum(x['status']=='PASS' for x in RESULTS),failed=[x for x in RESULTS if x['status']!='PASS']))
raise SystemExit(1 if any(x['status']!='PASS' for x in RESULTS) else 0)
