"""Additional cross-instance identity, session, tenant and booking boundary verification."""
from common_20261112 import *
import concurrent.futures
os.environ['QA_RESULTS_FILE']='security-results.json';S=seed();A=Client('reception').login('main@audit.test');E=Client('reception-east',clinic='east').login('east@audit.test');P=Client('patient').login('patient@audit.test');D=Client('doctor').login('doctor@audit.test');O=Client('other-patient').login('other@audit.test');C=Client('platform');C.token=C.ok('/api/platform/login',dict(email='platform@audit.test',password=R['password']))['accessToken']
for role,client in [('anonymous',Client()),('reception',A),('doctor',D),('patient',P),('other patient',O),('platform',C)]:
 for path,roles in [('/api/bootstrap',['reception','doctor','patient','other patient']),('/api/accounts',['reception']),('/api/accounts/audit',['reception']),('/api/reports?from='+S['today']+'&to='+S['day'],['reception']),('/api/platform/clinics',['platform']),('/api/platform/patients?email=patient%40audit.test',['platform']),('/api/patient/home',['patient','other patient']),('/api/patient/clinics',['patient','other patient'])]:
  code=client.req(path)[0];record('Role matrix '+role+' '+path,code==200 if role in roles else code in [401,403],actual=code)
for client in [P,O,D]:
 code,history,*_=client.req('/api/appointments/'+S['visit']['id']+'/history');allowed=client in [P,D];record('Appointment history object ownership '+client.role,code==200 if allowed else code==404,actual=code)
 code,patient,*_=client.req('/api/patients/'+S['mainPid']);allowed=client in [P,D];record('Patient details object ownership '+client.role,code==200 if allowed else code==404,actual=code)
 if client is D:record('Main staff token cannot select east '+client.role,client.clone(clinic='east').req('/api/bootstrap')[0] in [401,403])
for client in [A,D]:record('Staff token remains clinic bound '+client.role,client.clone(clinic='east').req('/api/bootstrap')[0]==401)
# Race one shared patient across two clinics AND two API processes.
day=(dt.date.fromisoformat(S['today'])+dt.timedelta(days=31)).isoformat()
def cross(i):
 cid=['main','east'][i];cat=S['catalogs'][cid];return P.clone(clinic=cid,base=R['api'] if i==0 else R['api2']).req('/api/appointments',dict(doctorId=cat['doctors'][0]['id'],patientId=S['mainPid'] if i==0 else S['eastPid'],serviceId=cat['service']['id'],durationMinutes=30,date=day,time='14:00',requestId=uuid.uuid4().hex))
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:race=list(pool.map(cross,range(2)))
statuses=[r[0] for r in race];record('Global patient cannot double-book across clinics and hosts',sorted(statuses)==[200,409],statuses=statuses)
record('Cross-clinic winner has exactly one central busy record',jsql(f'''SELECT count(*) FROM careline_identity."PatientBookings" WHERE "PatientAccountId"=(SELECT "Id" FROM careline_identity."PatientAccounts" WHERE "Email"='patient@audit.test') AND "Start"='{day} 13:00:00+00' ''')==1)
# New throwaway identities; shared bootstrap/staff accounts are not locked or modified.
suffix=uuid.uuid4().hex[:10];email='lock-'+suffix+'@audit.test';identity=Client().ok('/api/auth/register',dict(name='QA Lockout Patient',email=email,password=R['password'],phone='070123456'))
staffemail='staff-lock-'+suffix+'@audit.test';staff=A.ok('/api/accounts',dict(name='QA Lockout Staff',email=staffemail,password=R['password'],role='Administrator'))
opid='qa-op-'+suffix;opemail='operator-lock-'+suffix+'@audit.test'
sql(f'''INSERT INTO "PlatformOperators" ("Id","Email","Name","PasswordHash","Enabled","FailedAttempts") SELECT '{opid}','{opemail}','QA Lockout Operator',"PasswordHash",true,0 FROM "PlatformOperators" LIMIT 1''',1)
for kind,loginemail,path,index,table,emailcol in [('patient',email,'/api/auth/login',0,'careline_identity."PatientAccounts"','Email'),('staff',staffemail,'/api/auth/login',0,'public."Accounts"','NormalizedEmail'),('company',opemail,'/api/platform/login',1,'public."PlatformOperators"','Email')]:
 before=jsql('SELECT count(*) FROM careline_identity."PatientEvents"') if kind=='patient' else None
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:answers=list(pool.map(lambda i:Client(base=R['api'] if i%2 else R['api2']).req(path,dict(email=loginemail,password='Wrong-password-12345'))[0],range(8)))
 state=jsql(f'''SELECT json_build_object('attempts',"FailedAttempts",'locked',"LockedUntil">now()) FROM {table} WHERE "{emailcol}"='{loginemail}' ''',index)
 record('Distributed persistent lockout '+kind,answers==[401]*8 and state['locked'],statuses=answers,state=state)
 record('Correct password cannot bypass lockout '+kind,Client().req(path,dict(email=loginemail,password=R['password']))[0]==401)
 # Expiry verified by moving the dedicated test lock timestamp; no 15-minute natural wait claimed.
 sql(f'''UPDATE {table} SET "LockedUntil"=now()-interval '1 second' WHERE "{emailcol}"='{loginemail}' ''',index)
 code,response,*_=Client().req(path,dict(email=loginemail,password=R['password']));record('Expired lock permits valid login '+kind,code==200,clock='test SQL expired timestamp')
 token=response['accessToken'];expired=Client('expired-'+kind,token=token)
 sessions='careline_identity."PatientSessions"' if kind=='patient' else 'public."Sessions"' if kind=='staff' else 'public."PlatformSessions"'
 sql(f'''UPDATE {sessions} SET "ExpiresAt"=now()-interval '1 second' WHERE "TokenHash"='{hashlib.sha256(token.encode()).hexdigest().upper()}' ''',index)
 # HashToken uses uppercase hex; confirm a row was expired rather than accepting a no-op mutation.
 code=expired.req('/api/platform/clinics' if kind=='company' else '/api/auth/me')[0];record('Expired session is rejected '+kind,code==401,actual=code)
 if kind=='patient':
  events=jsql(f'''SELECT json_agg("Action") FROM careline_identity."PatientEvents" WHERE "PatientAccountId"=(SELECT "Id" FROM careline_identity."PatientAccounts" WHERE "Email"='{email}')''');save('patient-audit-actions.json',dict(actions=events,failedLoginRequests=8))
record('Registration accepts an unverified inbox identity',True,observation='A synthetic .test mailbox registered and signed in without an email/SMS challenge; assurance policy review required, not a claimed validation failure.')
for header,value in [('X-Clinic','main,east'),('X-Clinic','public'),('X-Clinic','../main'),('X-Clinic',"main';DROP SCHEMA public;--")]:
 code=Client().req('/api/bootstrap',headers={header:value})[0];record('Invalid clinic header '+value,code in [400,401,404],actual=code)
save('security-summary.json',dict(cases=len(RESULTS),failed=[r for r in RESULTS if r['status']=='FAIL']))
