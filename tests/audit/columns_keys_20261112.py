"""Independent rollback probes for canonical columns, primary/unique keys, exclusions and cascades."""
from common_20261112 import *
os.environ['QA_RESULTS_FILE']='database-column-key-results.json';S=seed();probes=[]
def qi(value):return '"'+value.replace('"','""')+'"'
def table(schema,name):return qi(schema)+'.'+qi(name)
SOURCE_SETUP='''INSERT INTO public."SourceSchedules" ("DoctorId","Row","Days","Start","End","Type","Note") SELECT "Id",0,'Monday','08:00','18:00','QA','Fixture' FROM public."Doctors" LIMIT 1;'''
def probe(label,statement,index=0,expected='23505',constraint=None,column=None,setup=''):
 query=f'''BEGIN;{SOURCE_SETUP if index==0 else ''}{setup}
 DO $qa$ DECLARE st text;cn text;col text;affected integer;BEGIN
  BEGIN {statement};GET DIAGNOSTICS affected=ROW_COUNT;RAISE NOTICE '%',json_build_object('state','ACCEPTED','affected',affected);
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS st=RETURNED_SQLSTATE,cn=CONSTRAINT_NAME,col=COLUMN_NAME;RAISE NOTICE '%',json_build_object('state',st,'constraint',cn,'column',col);END;
 END $qa$;ROLLBACK;'''
 stdout,stderr,code=sql(query,index,stop=False)
 lines=[line.split('NOTICE:',1)[1].strip() for line in stderr.splitlines() if 'NOTICE:' in line and '{' in line]
 actual=json.loads(lines[-1]) if lines else dict(state='HARNESS_ERROR',error=stderr[-700:])
 passed=actual.get('state')==expected and (not constraint or actual.get('constraint')==constraint) and (not column or actual.get('column')==column)
 probes.append(dict(name=label,status='PASS' if passed else 'NOT TESTED' if actual.get('state')=='ACCEPTED' and actual.get('affected')==0 else 'FAIL',expected=expected,actual=actual))
 record(label,passed,expected=expected,actual=actual)
 return actual
def clone(schema,name,patch=None,where='true'):
 tab=table(schema,name);payload=json.dumps(patch or {}).replace("'","''")
 return f'''INSERT INTO {tab} OVERRIDING SYSTEM VALUE SELECT (jsonb_populate_record(NULL::{tab},to_jsonb(src)||'{payload}'::jsonb)).* FROM {tab} src WHERE {where} LIMIT 1'''
for kind,index in [('clinical',0),('platform',1)]:
 cols=json.loads((OUT/f'evidence/{kind}-columns.json').read_text());cons=json.loads((OUT/f'evidence/{kind}-constraints.json').read_text());indexes=json.loads((OUT/f'evidence/{kind}-indexes.json').read_text())
 for c in cols:
  if c['table_schema'] not in ['public','careline_identity']:continue
  tab=table(c['table_schema'],c['table_name']);col=qi(c['column_name'])
  if c['is_nullable']=='NO':probe('NOT NULL '+kind+'.'+c['table_schema']+'.'+c['table_name']+'.'+c['column_name'],f'UPDATE {tab} SET {col}=NULL WHERE ctid=(SELECT ctid FROM {tab} LIMIT 1)',index,'428C9' if c.get('identity_generation')=='ALWAYS' else '23502',column=None if c.get('identity_generation')=='ALWAYS' else c['column_name'])
  if c['character_maximum_length']:
   probe('Length '+kind+'.'+c['table_schema']+'.'+c['table_name']+'.'+c['column_name'],f"UPDATE {tab} SET {col}=repeat('x',{c['character_maximum_length']+1}) WHERE ctid=(SELECT ctid FROM {tab} LIMIT 1)",index,'22001')
 for c in cons:
  if c['contype']!='p' or c['schema_name'] not in ['public','careline_identity']:continue
  name=c['table_name'];patch={};where='true';unique=uuid.uuid4().hex
  if name=='Accounts':patch=dict(Email=unique+'@audit.test',NormalizedEmail=unique+'@audit.test',Role='Administrator',PatientId=None,DoctorId=None,GlobalPatientId=None);where='"Role"=\'Administrator\''
  elif name=='Appointments':patch=dict(Status='Cancelled',CreatedBy='qa-pk-'+unique,RequestId=unique)
  elif name=='AppointmentHistory':patch=dict(AppointmentVersion=10000000)
  elif name=='Patients':patch=dict(Email=unique+'@audit.test',Number=900000000000)
  elif name in ['Services','Specialties']:patch=dict(Name='QA PK '+unique)
  elif name in ['PatientAccounts','PlatformOperators']:patch=dict(Email=unique+'@audit.test')
  elif name=='PatientMemberships':patch=dict(AccountId='qa-'+unique,PatientId='qa-'+unique)
  elif name=='PatientBookings':patch=dict(Start='2100-01-01T10:00:00Z',End='2100-01-01T10:30:00Z')
  elif name=='clinics':patch=dict(schema_name='qa_'+unique)
  probe('Primary key '+kind+'.'+c['conname'],clone(c['schema_name'],name,patch,where),index,'23505',constraint=c['conname'])
 for item in indexes:
  if not item['indisunique'] or item['indisprimary'] or item['schema_name'] not in ['public','careline_identity']:continue
  name=item['index_name'];schema=item['schema_name'];tab=item['table_name'];unique=uuid.uuid4().hex;patch={'Id':unique};where='true';setup=''
  if name=='IX_Accounts_NormalizedEmail':where='"Role"=\'Administrator\''
  elif name=='IX_Accounts_DoctorId':patch.update(Email=unique+'@audit.test',NormalizedEmail=unique+'@audit.test');where='"Role"=\'Doctor\''
  elif name=='IX_Accounts_PatientId':patch.update(Email=unique+'@audit.test',NormalizedEmail=unique+'@audit.test',GlobalPatientId=None);where='"Role"=\'Patient\''
  elif name=='IX_Accounts_GlobalPatientId':
   pid='qa-contact-'+unique
   setup=f'''INSERT INTO public."Patients" ("Id","Name","Email","Phone","IsDemonstration","Version") VALUES ('{pid}','QA unique','{unique}@audit.test','070123456',false,1);'''
   patch.update(Email=unique+'@audit.test',NormalizedEmail=unique+'@audit.test',PatientId=pid);where='"GlobalPatientId" IS NOT NULL'
  elif name=='IX_Patients_Email':patch.update(Number=900000000001);where='"Email"<>\'\''
  elif name=='IX_Patients_Number':patch.update(Email=unique+'@audit.test')
  elif name=='IX_Appointments_CreatedBy_RequestId':patch.update(Status='Cancelled')
  elif name in ['IX_Services_SpecialtyId_Name','IX_Specialties_Name','IX_AppointmentHistory_AppointmentId_AppointmentVersion','PatientAccounts_Email_key','PlatformOperators_Email_key']:pass
  elif name=='clinics_schema_name_key':patch=dict(clinic_id='qa-'+unique)
  elif name in ['PatientMemberships_ClinicId_AccountId_key','PatientMemberships_ClinicId_PatientId_key']:
   central='qa-identity-'+unique
   setup=f'''INSERT INTO careline_identity."PatientAccounts" ("Id","Email","Name","PasswordHash","HomeClinicId","Phone") VALUES ('{central}','{unique}@audit.test','QA identity','test-only-hash','main','070123456');'''
   patch=dict(PatientAccountId=central,**({'PatientId':'qa-'+unique} if 'AccountId_key' in name else {'AccountId':'qa-'+unique}))
  else:probes.append(dict(name='Unique '+kind+'.'+name,status='NOT TESTED',reason='Unmapped unique key; catalogue inspected'));continue
  probe('Unique '+kind+'.'+name,clone(schema,tab,patch,where),index,'23505',constraint=name,setup=setup)
# Each exclusion is isolated from the other local exclusion and request identity.
constraints=json.loads((OUT/'evidence/clinical-constraints.json').read_text())
for c in constraints:
 if c['contype']!='x' or c['schema_name'] not in ['public','careline_identity']:continue
 u=uuid.uuid4().hex
 if c['schema_name']=='careline_identity':patch=dict(ClinicId='qa-'+u,AppointmentId='qa-'+u);where='true'
 else:
  patch=dict(Id=u,RequestId=u,CreatedBy='qa-exclusion-'+u,Status='Confirmed');where='"Status"=\'Confirmed\''
  if 'DoctorId' in c['definition']:patch['PatientId']=next(p['id'] for p in Client('reception').login('main@audit.test').ok('/api/bootstrap')['patients'] if p['email']=='main-contact-4@audit.test')
  else:patch['DoctorId']=S['catalogs']['main']['doctors'][1]['id'];where+=' AND "DoctorId"<>\''+patch['DoctorId']+'\''
 probe('Exclusion '+c['conname'],clone(c['schema_name'],c['table_name'],patch,where),0,'23P01',constraint=c['conname'])
# Session cascading and parent-delete restrictions; a result scalar is returned inside a rolled-back DO block.
for kind,index,accounts,sessions,fk in [('clinical',0,'Accounts','Sessions','AccountId'),('platform',1,'PlatformOperators','PlatformSessions','OperatorId')]:
 u='qa-cascade-'+uuid.uuid4().hex;email=u+'@audit.test';setup=clone('public',accounts,dict(Id=u,Email=email,**({'NormalizedEmail':email} if accounts=='Accounts' else {})), '"Role"=\'Administrator\'' if accounts=='Accounts' else 'true')+';'
 setup+=f'''INSERT INTO public."{sessions}" ("TokenHash","{fk}","ExpiresAt"{',"IsDemo"' if sessions=='Sessions' else ''}) VALUES ('{u}','{u}',now()+interval '1 hour'{',false' if sessions=='Sessions' else ''});'''
 query=f'''BEGIN;{setup}DELETE FROM public."{accounts}" WHERE "Id"='{u}';SELECT count(*) FROM public."{sessions}" WHERE "{fk}"='{u}';ROLLBACK;'''
 out,err,code=sql(query,index);record('Cascade '+kind+' account sessions',code==0 and out=='0',rows_after_delete=out)
save('column-key-probes.json',probes)
