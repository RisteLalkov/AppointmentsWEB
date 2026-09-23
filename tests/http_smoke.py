"""Real HTTP smoke tests, using only Python's standard library.
Build Release first, then: python tests/http_smoke.py [--dotnet /path/to/dotnet]
Starts a disposable loopback server with an isolated JSON store. No production data.
"""
import argparse
import concurrent.futures
import datetime as dt
import http.cookiejar
import html as html_module
import json
import os
import pathlib
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--dotnet', default='dotnet')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
count = 0

def check(condition, name):
    global count
    if not condition:
        raise AssertionError(name)
    count += 1
    print('PASS', name, flush=True)

class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ''
    def request(self, path, data=None, form=False, csrf=True):
        headers = {}
        if data is not None:
            if form:
                data = urllib.parse.urlencode(data).encode()
                headers['Content-Type'] = 'application/x-www-form-urlencoded'
            else:
                data = json.dumps(data).encode()
                headers['Content-Type'] = 'application/json'
                if csrf:
                    headers['X-CSRF-TOKEN'] = self.csrf
        try:
            response = self.opener.open(urllib.request.Request(base+path, data, headers), timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        text = response.read().decode()
        try: body = json.loads(text)
        except ValueError: body = text
        return response.status, html_module.unescape(body) if isinstance(body, str) else body
    def login(self, user):
        code, html = self.request('/Demo')
        token = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', html).group(1)
        code, html = self.request('/Demo/Enter', {'userId':user,'__RequestVerificationToken':token}, form=True)
        check(code == 200 and 'main-content' in html, 'Razor workspace renders for '+user)
        self.csrf = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', html).group(1)
        return html

with tempfile.TemporaryDirectory(prefix='careline-http-') as temp:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    base = 'http://127.0.0.1:'+str(port)
    env = dict(os.environ, Backend__Mode="Demo", Demo__Enabled="true", Demo__DataPath=str(pathlib.Path(temp)/'demo-state.json'), ASPNETCORE_ENVIRONMENT='Development')
    with open(pathlib.Path(temp)/'server.log', 'w+') as log:
        web = root / 'src/Appointments.Web'
        proc = subprocess.Popen([args.dotnet,str(web/'bin/Release/net10.0/Appointments.Web.dll'),'--urls',base],cwd=web,env=env,stdout=log,stderr=log)
        try:
            anon=Client()
            for _ in range(150):
                try:
                    if anon.request('/Demo')[0] == 200: break
                except (OSError, urllib.error.URLError): pass
                time.sleep(.1)
            else: raise RuntimeError('Server did not start.')
            check('lang="mk"' in anon.request('/Demo')[1], 'Macedonian is the default document language')
            code, error = anon.request('/Home/Error')
            check('Не можевме да го извршиме барањето.' in error, 'Error page is Macedonian')
            check(anon.request('/data/bootstrap')[0]==401,'Anonymous data access denied')
            check(anon.request('/Demo/Enter',{'userId':'admin'},form=True)[0]==400,'Role switch requires antiforgery token')
            reception, pat, other, doctor = Client(), Client(), Client(), Client()
            html=reception.login('admin')
            check('Календар' in html and 'Достапност' in html,'Reception navigation includes schedule management')
            html=pat.login('p01')
            check('Пронајди лекар' in html and 'data-page="patients"' not in html,'Patient navigation is role-specific')
            other.login('p02');doctor.login('user-d01')
            code,data=pat.request('/data/bootstrap')
            check(code==200 and len(data['doctors'])==40,'Bootstrap provides complete workbook directory')
            check(len(data['patients'])==1 and all(a['patientId']=='p01' for a in data['appointments']),'Patient HTTP payload excludes other patients')
            check(pat.request('/data/patients',{'name':'Example Demo','email':'','phone':''})[0]==403,'Patient cannot create patient through direct HTTP')
            check(doctor.request('/data/schedule/d03',{'periods':[],'durationMinutes':30})[0]==403,'Doctor cannot edit another schedule through HTTP')
            code, invalid = reception.request('/data/patients',{'name':'','email':'','phone':''})
            check(code==400 and 'Некои полиња се невалидни' in invalid['error'], 'Invalid fields rejected with Macedonian feedback')
            check(reception.request('/data/patients',{'name':'HTTP Demo','email':'http@example.test','phone':''},csrf=False)[0]==400,'Write endpoints reject missing antiforgery token')
            code,p=reception.request('/data/patients',{'name':'HTTP Example (Demo)','email':'http@example.test','phone':''})
            check(code==200 and p['isDemonstration'],'Reception creates a fictional patient')
            date=(dt.date.fromisoformat(data['today'])+dt.timedelta(days=20))
            while date.weekday()>4:date+=dt.timedelta(days=1)
            date=date.isoformat()
            code,slots=pat.request('/data/slots?doctorId=d01&date='+date)
            check(code==200 and len(slots)>2,'Server returns real future availability')
            command={'doctorId':'d01','patientId':'p01','date':date,'time':slots[0]['time'],'durationMinutes':30,'requestId':str(uuid.uuid4())}
            code,a=pat.request('/data/appointments',command)
            check(code==200 and a['status']=='Confirmed','Patient booking succeeds through MVC endpoint')
            check(pat.request('/data/appointments',command)[1]['id']==a['id'],'HTTP duplicate submission is idempotent')
            conflict=dict(command,patientId='p02',requestId=str(uuid.uuid4()))
            code, conflict_result = other.request('/data/appointments',conflict)
            check(code==409 and 'повеќе не е достапен' in conflict_result['error'], 'Conflict returns 409 with Macedonian feedback')
            check(any(x['id']==a['id'] for x in doctor.request('/data/bootstrap')[1]['appointments']),'Patient booking immediately visible to doctor')
            check(any(x['id']==a['id'] for x in reception.request('/data/bootstrap')[1]['appointments']),'Patient booking immediately visible to reception')
            check(other.request('/data/appointments/'+a['id']+'/status',{'status':'Cancelled','version':1})[0]==403,'Other patient cannot mutate appointment by ID')
            code,moved=pat.request('/data/appointments/'+a['id']+'/move',{'date':date,'time':slots[1]['time'],'version':1})
            check(code==200 and moved['version']==2,'Patient reschedules through HTTP')
            check(reception.request('/data/appointments/'+a['id']+'/status',{'status':'Cancelled','version':1})[0]==409,'HTTP optimistic concurrency rejects stale revision')
            check(pat.request('/data/appointments/'+a['id']+'/status',{'status':'Cancelled','version':2})[0]==200,'Patient cancels through HTTP')
            command.update(patientId=p['id'],requestId=str(uuid.uuid4()))
            code,a=reception.request('/data/appointments',command)
            check(code==200,'Reception books for a newly created patient')
            command.update(patientId='p02',time=slots[2]['time'],requestId=str(uuid.uuid4()))
            code,a=doctor.request('/data/appointments',command)
            check(code==200,'Doctor books on own schedule')
            check(any(x['id']==a['id'] for x in other.request('/data/bootstrap')[1]['appointments']),'Doctor-created booking appears in patient workspace')
            code,e=doctor.request('/data/exceptions/d01',{'date':date,'start':'12:00','end':'13:00','isAvailable':False,'reason':'Demo lunch'})
            check(code==200,'Doctor adds unavailable period')
            check(all(not('12:00'<=s['time']<'13:00') for s in pat.request('/data/slots?doctorId=d01&date='+date)[1]),'Unavailable period changes patient availability')
            check(doctor.request('/data/exceptions/'+e['id']+'/remove',{})[0]==200,'Doctor removes exception')
            for path in ['/css/site.css','/js/app.js','/js/demo.js','/vendor/fullcalendar.min.js','/favicon.svg']:
                check(anon.request(path)[0]==200,'Locally bundled asset '+path)
            print(f'\n{count}/{count} HTTP integration checks passed.',flush=True)
        except Exception:
            log.flush();log.seek(0);print(log.read());raise
        finally:
            proc.terminate()
            try:proc.wait(timeout=10)
            except subprocess.TimeoutExpired:proc.kill();proc.wait()
