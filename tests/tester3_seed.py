"""Tester report 3 fixtures: only the generated loopback audit databases are accepted."""
import os,sys,pathlib,json
root=pathlib.Path(__file__).resolve().parents[1]
if not os.environ.get('QA_WORK') or not os.environ.get('QA_OUTPUT'):raise SystemExit('Dedicated fixture paths required')
sys.path.insert(0,str(root/'tests/audit'))
from common_20261112 import *
s=seed();cache=WORK/'tester3-data.json'
if cache.exists():raise SystemExit('Start a fresh fixture instead of duplicating report 3 data')
a=Client('reception').login('main@audit.test');cat=s['catalogs']['main']
periods=[dict(day=d,start='08:00',end='18:00') for d in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']]
extra=[]
for i in range(10):
 d=a.ok('/api/catalogue/doctors',dict(name=f'QA Дополнителен {i:02}',specialtyId=cat['specialty']['id'],subspecialty='',enabled=True,requiresConfirmation=False,staffOnly=False))
 a.ok('/api/schedule/'+d['id'],dict(version=1,durationMinutes=30,periods=periods));extra.append(d)
other=a.ok('/api/catalogue/specialties',dict(name='QA Ендокринологија'))
endocrine=a.ok('/api/catalogue/doctors',dict(name='QA Ендокринолог',specialtyId=other['id'],subspecialty='',enabled=True,requiresConfirmation=False,staffOnly=False))
a.ok('/api/schedule/'+endocrine['id'],dict(version=1,durationMinutes=30,periods=periods))
service=a.ok('/api/catalogue/services',dict(name='QA Заедничка услуга',specialtyId=cat['specialty']['id'],enabled=True,durationMinutes=30,doctorIds=[cat['doctors'][0]['id'],endocrine['id']]+[d['id'] for d in extra]))
data=dict(service=service,extra=extra,other=other,endocrine=endocrine,day=s['day'],main=cat,east=s['catalogs']['east'])
cache.write_text(json.dumps(data,ensure_ascii=False));os.chmod(cache,0o600)
print('PASS report 3: two specialties, cross-specialty selections and more than twelve doctors prepared through API')
