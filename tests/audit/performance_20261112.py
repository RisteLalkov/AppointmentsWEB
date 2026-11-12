"""Bounded local growth experiment, not a production hardware/capacity certification."""
from common_20261112 import *
import concurrent.futures,statistics
os.environ['QA_RESULTS_FILE']='performance-results.json';S=seed();A=Client('reception').login('main@audit.test');D=Client('doctor').login('doctor@audit.test');P=Client('patient').login('patient@audit.test')
previous=json.loads((OUT/'evidence/performance.json').read_text()) if (OUT/'evidence/performance.json').exists() else {};previous=previous if previous.get('fixture_started_utc')==R['started_utc'] else {};data=previous.get('summary',{});samples=previous.get('samples',[]);RESULTS.extend(json.loads((OUT/'evidence/performance-results.json').read_text()) if previous and (OUT/'evidence/performance-results.json').exists() else [])
def series(label,client,path,n=10,parallel=1):
 if label in data:return data[label]
 def one(i):
  code,value,headers,ms,size=client.req(path);value=value if isinstance(value,dict) else {};return dict(status=code,ms=ms,bytes=size,patients=len(value.get('patients',[])),appointments=len(value.get('appointments',[])),items=len(value.get('items',[])))
 with concurrent.futures.ThreadPoolExecutor(max_workers=parallel) as pool:rows=list(pool.map(one,range(n)))
 times=sorted(r['ms'] for r in rows);summary=dict(samples=n,concurrency=parallel,p50_ms=round(statistics.median(times),2),p95_ms=times[max(0,__import__('math').ceil(n*.95)-1)],max_ms=max(times),response_bytes=rows[0]['bytes'],patients=rows[0]['patients'],appointments=rows[0]['appointments'],items=rows[0]['items'],statuses={str(code):sum(r['status']==code for r in rows) for code in set(r['status'] for r in rows)})
 data[label]=summary;samples.extend(dict(label=label,**r) for r in rows);record(label,all(r['status']==200 for r in rows),measurement=summary);save('performance.json',dict(fixture_started_utc=R['started_utc'],summary=data,samples=samples));return summary
series('Small receptionist bootstrap',A,'/api/bootstrap')
# Only synthetic generated rows in the dedicated QA database; ON CONFLICT makes reruns bounded.
sql('''INSERT INTO public."Patients" ("Id","Name","Email","Phone","IsDemonstration","Version") SELECT 'qa-load-p-'||g,'QA Benchmark '||lpad(g::text,5,'0'),'benchmark-'||g||'@audit.test','070123456',false,1 FROM generate_series(1,5000) g ON CONFLICT ("Id") DO NOTHING;''')
doc=S['catalogs']['main']['doctors'][0]['id'];service=S['catalogs']['main']['service']['id']
sql(f'''INSERT INTO public."Appointments" ("Id","DoctorId","PatientId","ServiceId","ServiceName","Start","End","Status","Version","CreatedBy","RequestId","UpdatedAt") SELECT 'qa-load-a-'||g,'{doc}','qa-load-p-'||(g%5000+1),'{service}','QA Benchmark','2024-01-01 00:00+00'::timestamptz+g*interval '30 minutes','2024-01-01 00:00+00'::timestamptz+(g+1)*interval '30 minutes','Completed',1,'qa-load','qa-load-r-'||g,now() FROM generate_series(1,30000) g ON CONFLICT ("Id") DO NOTHING; ANALYZE public."Appointments"; ANALYZE public."Patients";''')
save('performance-row-counts.json',jsql('''SELECT json_build_object('patients',(SELECT count(*) FROM "Patients"),'appointments',(SELECT count(*) FROM "Appointments"),'fixture_bulk_patients',(SELECT count(*) FROM "Patients" WHERE "Id" LIKE 'qa-load-p-%'),'fixture_bulk_appointments',(SELECT count(*) FROM "Appointments" WHERE "Id" LIKE 'qa-load-a-%'))'''))
for role,client in [('Reception',A),('Doctor',D),('Patient',P)]:series('Large '+role+' bootstrap',client,'/api/bootstrap',10)
series('Large paged appointments take=12',A,'/api/appointments?take=12',10)
series('Large Reception bootstrap concurrent',A,'/api/bootstrap',24,8)
series('Large next-slot summary',A,'/api/availability/next?doctorIds='+doc+'&from='+S['today'],5)
save('query-plans.json',dict(patient_history=jsql(f'''EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM "Appointments" WHERE "PatientId"='qa-load-p-100' ORDER BY "Start" DESC LIMIT 12'''),doctor_range=jsql(f'''EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM "Appointments" WHERE "DoctorId"='{doc}' AND "Start">='2026-11-12' ORDER BY "Start" LIMIT 100'''),tables=jsql('''SELECT json_agg(json_build_object('table',relname,'live_estimate',n_live_tup,'dead_estimate',n_dead_tup)) FROM pg_stat_user_tables WHERE schemaname='public' ''')))
save('performance-budget.json',dict(assumption='20 staff users, one bootstrap every 20 seconds; uncompressed response bytes; excludes TLS, browser work, intermediary compression and additional reads',uncompressed_bytes_per_second=data['Large Reception bootstrap']['response_bytes'],requests_per_minute=60))
