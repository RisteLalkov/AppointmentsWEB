"""Every role x current status x requested status x time phase, real API + PostgreSQL.
Synthetic starting states are inserted directly to reach all boundaries, then removed.
This is a state-transition audit, not a claim that each starting state came from normal booking.
"""
from common_20261112 import *
os.environ['QA_RESULTS_FILE']='status-matrix.json';S=seed();clients=[('reception',Client('reception').login('main@audit.test')),('doctor',Client('doctor').login('doctor@audit.test')),('patient',Client('patient').login('patient@audit.test'))];statuses=['Scheduled','Confirmed','Completed','Cancelled','NoShow'];now=dt.datetime.now(dt.timezone.utc).replace(second=0,microsecond=0);doctor=S['catalogs']['main']['doctors'][0]['id'];pid=S['mainPid']
for role,client in clients:
 for initial in statuses:
  for target in statuses:
   for phase,delta in [('future',dt.timedelta(days=62)),('in progress',dt.timedelta(minutes=-15)),('past',dt.timedelta(hours=-2))]:
    key='qa-status-'+uuid.uuid4().hex;start=now+delta;end=start+dt.timedelta(minutes=30)
    allowed=(target=='Cancelled' and (initial in ['Scheduled','Confirmed'] and phase=='future' or initial=='Scheduled' and role!='patient')) or role!='patient' and (initial=='Scheduled' and target=='Confirmed' and phase=='future' or initial in ['Scheduled','Confirmed'] and target in ['Completed','NoShow'] and phase=='past')
    sql(f'''INSERT INTO "Appointments" ("Id","DoctorId","PatientId","Start","End","Status","Version","CreatedBy","UpdatedAt","RequestId") VALUES ('{key}','{doctor}','{pid}','{start.isoformat()}','{end.isoformat()}','{initial}',1,'qa-status',now(),'{key}')''')
    try:
     code,response,*_=client.req('/api/appointments/'+key+'/status',dict(status=target,version=1));db=jsql(f'''SELECT json_build_object('status',"Status",'version',"Version",'history',(SELECT count(*) FROM "AppointmentHistory" WHERE "AppointmentId"='{key}'),'busy',(SELECT count(*) FROM careline_identity."PatientBookings" WHERE "AppointmentId"='{key}')) FROM "Appointments" WHERE "Id"='{key}' ''')
     expected_code=200 if allowed else 403 if role=='patient' and target!='Cancelled' else 400
     valid=code==expected_code and db['status']==(target if allowed else initial) and db['version']==(2 if allowed else 1) and db['history']==(1 if allowed else 0) and db['busy']==int(db['status'] in ['Scheduled','Confirmed'])
     record(role+' '+initial+' -> '+target+' '+phase,valid,expected_http=expected_code,actual_http=code,database=db)
    finally:sql(f'''BEGIN;DELETE FROM "AppointmentHistory" WHERE "AppointmentId"='{key}';DELETE FROM "Appointments" WHERE "Id"='{key}';COMMIT;''')
