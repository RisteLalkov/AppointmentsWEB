"""Actual catalogue inspection and rollback-only integrity probes on generated fixture databases."""
from common_20261112 import *
S=seed();RESULTS.clear();os.environ['QA_RESULTS_FILE']='database-probe-results.json'
SCHEMA_FILTER="n.nspname NOT IN ('pg_catalog','information_schema','careline_extensions') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'"
queries={
'columns':'''SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY table_schema,table_name,ordinal_position),'[]') FROM (SELECT table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,character_maximum_length,is_identity,identity_generation FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema','careline_extensions')) c''',
'constraints':f'''SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY schema_name,table_name,conname),'[]') FROM (SELECT n.nspname schema_name,r.relname table_name,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) definition,ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY ord) columns FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE {SCHEMA_FILTER}) c''',
'indexes':f'''SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY schema_name,table_name,index_name),'[]') FROM (SELECT n.nspname schema_name,t.relname table_name,c.relname index_name,i.indisvalid,i.indisready,i.indisunique,i.indisprimary,pg_get_indexdef(i.indexrelid) definition FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class c ON c.oid=i.indexrelid WHERE {SCHEMA_FILTER}) i''',
'triggers':f'''SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY schema_name,table_name,tgname),'[]') FROM (SELECT n.nspname schema_name,c.relname table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND {SCHEMA_FILTER}) t''',
'functions':'''SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid))),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='careline_identity' ''',
'grants':'''SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (SELECT table_schema,table_name,grantee,privilege_type FROM information_schema.table_privileges WHERE table_schema NOT IN ('pg_catalog','information_schema','careline_extensions') ORDER BY table_schema,table_name,grantee,privilege_type) x'''
}
metadata={}
for index,label in [(0,'clinical'),(1,'platform')]:
 metadata[label]={}
 for kind,query in queries.items():
  data=jsql(query,index);metadata[label][kind]=data;save(label+'-'+kind+'.json',data)
 record('All '+label+' constraints are validated',all(c['convalidated'] for c in metadata[label]['constraints']),count=len(metadata[label]['constraints']))
 record('All '+label+' indexes are valid and ready',all(i['indisvalid'] and i['indisready'] for i in metadata[label]['indexes']),count=len(metadata[label]['indexes']))
 save(label+'-migrations.json',jsql('SELECT jsonb_agg(to_jsonb(t)) FROM public."__EFMigrationsHistory" t' if index==0 else 'SELECT jsonb_agg(to_jsonb(t)) FROM "PlatformSchemaVersions" t',index))
 record('Ordinary '+label+' owner has no cluster administration privileges',jsql("SELECT NOT(rolsuper OR rolcreatedb OR rolcreaterole) FROM pg_roles WHERE rolname=current_user",index))
# Populate a compatibility-only table so its FK and PK are exercised too. Rolled back below.
setup='''INSERT INTO public."SourceSchedules" ("DoctorId","Row","Days","Start","End","Type","Note") SELECT "Id",0,'Monday','08:00','18:00','QA','Audit fixture' FROM public."Doctors" LIMIT 1;'''
checks={
'CK_Account_RoleLink':'"Role"=\'Invalid\'',
'CK_Account_GlobalPatient':'"PasswordHash"=\'not-empty\'',
'CK_History_AfterRange':'"AfterEnd"="AfterStart"',
'CK_History_Before':'"Kind"=\'Created\',"BeforeStart"=now(),"BeforeEnd"=now()+interval \'1 minute\',"BeforeStatus"=\'Confirmed\'',
'CK_History_Version':'"AppointmentVersion"=0',
'CK_Appointment_Range':'"End"="Start"',
'CK_Appointment_Status':'"Status"=\'Invalid\'',
'CK_Appointment_Version':'"Version"=0',
'CK_Exception_Range':'"End"="Start"',
'CK_Doctor_Duration':'"DurationMinutes"=0',
'CK_Patient_Version':'"Version"=0',
'CK_Patient_Number':'"Number"=0',
'CK_Service_Duration':'"DurationMinutes"=0',
'CK_WorkingPeriod_Range':'"Day"=99',
'CK_WorkingPeriod_Dates':'"ValidFrom"=\'2026-12-31\',"ValidTo"=\'2026-01-01\'',
'PatientBookings_check':'"End"="Start"',
'PatientMemberships_PatientNumber_check':'"PatientNumber"=0',
'PatientEvents_ActorType_check':'"ActorType"=\'Invalid\'',
'PlatformClinics_State_check':'"State"=\'Invalid\''
}
probes=[]
for label,index in [('clinical',0),('platform',1)]:
 for c in metadata[label]['constraints']:
  if c['schema_name'] not in ['public','careline_identity']:continue
  table='"'+c['schema_name']+'"."'+c['table_name']+'"';where='true';statement=None;state=None
  if c['contype']=='f':
   col=c['columns'][0];where='"'+col+'" IS NOT NULL'
   if c['table_name']=='Accounts' and col=='DoctorId':where+=' AND "Role"=\'Doctor\''
   if c['table_name']=='Accounts' and col=='PatientId':where+=' AND "Role"=\'Patient\''
   statement=f'''UPDATE {table} SET "{col}"='audit-missing-parent' WHERE ctid=(SELECT ctid FROM {table} WHERE {where} LIMIT 1)''';state='23503'
  elif c['contype']=='c' and c['conname'] in checks:
   if c['conname']=='CK_Account_GlobalPatient':where='"GlobalPatientId" IS NOT NULL'
   statement=f'''UPDATE {table} SET {checks[c['conname']]} WHERE ctid=(SELECT ctid FROM {table} WHERE {where} LIMIT 1)''';state='23514'
  if statement:
   # GET DIAGNOSTICS prevents an empty-table UPDATE from being mistaken for a test.
   block=f'''BEGIN;{setup if index==0 else ''}
DO $qa$ DECLARE affected integer; actual text; BEGIN
 BEGIN {statement};GET DIAGNOSTICS affected=ROW_COUNT;RAISE NOTICE 'NOT_REJECTED affected=%',affected;
 EXCEPTION WHEN SQLSTATE '{state}' THEN GET STACKED DIAGNOSTICS actual=CONSTRAINT_NAME;RAISE NOTICE 'REJECTED state={state} constraint=%',actual;END;
END $qa$;ROLLBACK;'''
   stdout,stderr,code=sql(block,index,stop=False)
   passed=('REJECTED state='+state+' constraint='+c['conname']) in stderr and 'NOT_REJECTED' not in stderr
   result=dict(database=label,schema=c['schema_name'],table=c['table_name'],constraint=c['conname'],expected=state,status='PASS' if passed else 'FAIL',evidence=stderr.strip())
   probes.append(result);record('SQL rollback '+label+'.'+c['conname'],passed,expected=state,observed=stderr.strip()[-500:])
  elif c['contype']=='c':probes.append(dict(database=label,schema=c['schema_name'],table=c['table_name'],constraint=c['conname'],status='NOT TESTED',reason='Catalogue inspected; no independent malformed-row probe yet.'))
save('constraint-probes.json',probes)
# Every table has an actual row count; no credentials or row values are exported.
counts={}
for label,index in [('clinical',0),('platform',1)]:
 tables=sorted({(c['table_schema'],c['table_name']) for c in metadata[label]['columns']})
 counts[label]=[]
 for schema,table in tables:
  n=jsql(f'SELECT count(*) FROM "{schema}"."{table}"',index);counts[label].append(dict(schema=schema,table=table,rows=n))
save('table-counts.json',counts);save('database-probe-results.json',RESULTS)
