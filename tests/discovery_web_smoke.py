"""MVC-only contract tests using a deterministic local API stub.
Validates Razor, redirects, cookies, CSRF and request forwarding, NOT PostgreSQL
or real API authorization. Run platform_integration.py for the latter.
"""
import datetime as dt
import http.cookiejar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from html import unescape
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parents[1]
dotnet = os.environ.get('TEST_DOTNET', 'dotnet')
count, calls = 0, []
clinic = dict(id='main',name='Тест клиника',timeZone='Europe/Skopje',allowRegistration=True,description='Јавен опис',address='Плоштад Македонија, Скопје',phone='+389 2 000 0000')
doctor = dict(id='d01',name='Тест лекар',specialty='Кардиологија',subspecialty='',clinic=clinic,services=[dict(id='s01',name='Преглед',durationMinutes=30)],staffOnly=False)
platform_clinic=dict(id='main',name=clinic['name'],state='Ready',discoverable=True,address=clinic['address'],phone=clinic['phone'],description=clinic['description'],managed=False,version=1,allowRegistration=True)
expires=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat()

def check(ok, label):
    global count
    if not ok: raise AssertionError(label)
    count+=1
    print('PASS',label,flush=True)

class Stub(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()
    def handle_request(self):
        global platform_clinic
        path = urllib.parse.urlparse(self.path)
        if self.headers.get('Transfer-Encoding','').lower() == 'chunked':
            chunks=[]
            while True:
                size=int(self.rfile.readline().split(b';')[0],16)
                if size==0:
                    self.rfile.readline();break
                chunks.append(self.rfile.read(size));self.rfile.read(2)
            raw=b''.join(chunks)
        else: raw=self.rfile.read(int(self.headers.get('Content-Length',0)))
        body = json.loads(raw or b'{}')
        calls.append((path.path,urllib.parse.parse_qs(path.query),body,dict(self.headers)))
        code=200
        if path.path=='/api/public/doctors':
            term=urllib.parse.parse_qs(path.query).get('search',[''])[0]
            result=dict(items=[] if term=='без-резултат' else [doctor],total=0 if term=='без-резултат' else 25,page=1,pageSize=12)
            if term=='unavailable-test': code,result=503,dict(error='Пребарувањето е привремено недостапно.')
        elif path.path=='/api/public/clinics': result=dict(items=[clinic],total=1,page=1,pageSize=12)
        elif path.path=='/api/public/clinics/main': result=clinic
        elif path.path=='/api/public/clinics/no-address': result=dict(clinic,id='no-address',name='Клиника без адреса',address=None,phone=None)
        elif path.path=='/api/public/clinics/main/doctors/d01': result=doctor
        elif path.path=='/api/public/clinics/main/doctors/staff': result=dict(doctor,id='staff',staffOnly=True)
        elif path.path=='/api/public/clinics/east/doctors/d01': result=dict(doctor,clinic=dict(clinic,id='east'))
        elif path.path.endswith('/availability') and path.path.startswith('/api/public/clinics/'):
            day=urllib.parse.parse_qs(path.query).get('date',[dt.date.today().isoformat()])[0]
            result=dict(date=day,today=dt.date.today().isoformat(),lastDate=(dt.date.today()+dt.timedelta(days=180)).isoformat(),serviceId='s01',message=None,slots=[dict(time='09:00:00',start=day+'T07:00:00+00:00',end=day+'T07:30:00+00:00')])
        elif path.path=='/api/clinics': result=[clinic]
        elif path.path=='/api/auth/register': result=dict(id='a01',email=body['email'],name=body['name'],role='Patient',patientId='p01',doctorId=None,enabled=True)
        elif path.path=='/api/auth/login':
            is_admin=body.get('email')=='accounts-admin@test.test'
            result=dict(accessToken='c1.main.'+'a'*64,expiresAt=expires,actor=dict(id='a01',name='Тест администратор' if is_admin else 'Тест пациент',role='Administrator' if is_admin else 'Patient',patientId=None if is_admin else 'p01',doctorId=None),demoMode=False,clinic=clinic)
        elif path.path=='/api/bootstrap': result=dict(actor=dict(id='a01',name='Тест администратор',role='Administrator'),doctors=[dict(id='d01',name='Тест лекар',specialty='Кардиологија')],patients=[dict(id='p01',name='Тест пациент',email='patient@test.test',phone='')],appointments=[],today='2026-10-19',localNow='2026-10-19T10:00:00',timeZone='Europe/Skopje',utcNow=expires)
        elif path.path=='/api/accounts': result=[] if self.command=='GET' else dict(id='created',email=body['email'],name=body['name'],role=body['role'],patientId=body.get('patientId'),doctorId=body.get('doctorId'),enabled=True)
        elif path.path=='/api/platform/login': result=dict(accessToken='p1.'+'p'*64,expiresAt=expires,id='company',name='Тест компанија')
        elif path.path=='/api/platform/clinics':
            if self.headers.get('Authorization')!='Bearer p1.'+'p'*64: code,result=401,dict(error='Unauthorized')
            elif self.command=='POST': code,result=409,dict(error='Потребна е проверка на базата.')
            else: result=[platform_clinic]
        elif path.path=='/api/platform/clinics/main/adopt':
            platform_clinic=dict(platform_clinic,managed=True);result=platform_clinic
        elif path.path=='/api/platform/clinics/main/details':
            if body['version']!=platform_clinic['version']: code,result=409,dict(error='Податоците се променети во друга сесија.')
            else:
                platform_clinic=dict(platform_clinic,**body);platform_clinic['version']+=1;result=platform_clinic
        elif path.path=='/api/platform/logout': result=dict(signedOut=True)
        else: code,result=404,dict(error='Not found')
        payload=json.dumps(result).encode();self.send_response(code)
        self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
class Client:
    def __init__(self,base):
        self.base=base
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(self,path,data=None,headers=None):
        h=dict(headers or {})
        if data is not None: data=urllib.parse.urlencode(data).encode();h['Content-Type']='application/x-www-form-urlencoded'
        try:r=self.opener.open(urllib.request.Request(self.base+path,data,h),timeout=15)
        except urllib.error.HTTPError as e:r=e
        return r.status,unescape(r.read().decode()),r.headers
    def csrf(self,path):
        status,html,_=self.request(path)
        if status!=200: raise AssertionError(path+' did not render')
        return re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"',html)[1]

api=ThreadingHTTPServer(('127.0.0.1',0),Stub)
threading.Thread(target=api.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='careline-public-web-') as temp:
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    base='http://127.0.0.1:'+str(port)
    env=dict(os.environ,Backend__Mode='Api',Backend__ApiBaseUrl='http://127.0.0.1:'+str(api.server_port)+'/',ASPNETCORE_ENVIRONMENT='Development',Demo__Enabled='false')
    web=root/'src/Appointments.Web'
    with open(Path(temp)/'web.log','w+') as log:
        process=subprocess.Popen([dotnet,str(web/'bin/Release/net10.0/Appointments.Web.dll'),'--urls',base],cwd=web,env=env,stdout=log,stderr=log)
        try:
            anon=Client(base)
            for _ in range(150):
                try:
                    if anon.request('/Account/Login')[0]==200:break
                except (OSError,urllib.error.URLError):pass
                time.sleep(.1)
            else:raise AssertionError('Web startup failed')
            check(anon.request('/')[2].get('Location')=='/Discover','Anonymous root opens public discovery')
            for host,target in [('medtermin.mk','/Discover'),('app.medtermin.mk','/Workspace'),('admin.medtermin.mk','/Platform')]:
                status,_,response_headers=anon.request('/',headers={'Host':host})
                check(status==302 and response_headers.get('Location')==target,'Domain entry point: '+host)
            check(anon.request('/',headers={'Host':'unexpected.example'})[0]==400,'Host filtering rejects unrelated domains')
            status,html,_=anon.request('/Discover')
            check(status==200 and 'Тест лекар' in html and 'Јавен' not in html and 'ПРЕБАРУВАЊЕ' in html,'Anonymous doctor directory renders public DTOs')
            check('Следна' in html and 'name="Clinic"' in html,'Directory exposes pagination and clinic filter')
            anon.request('/Discover?Search=Ana&Clinic=Test&Specialty=Cardio&Service=Visit&Page=2')
            check(calls[-1][1].get('page')==['2'] and calls[-1][1].get('clinic')==['Test'] and calls[-1][1].get('search')==['Ana'],'Search and page parameters reach the API')
            status,html,_=anon.request('/Discover?Search='+urllib.parse.quote('Горан')+'&ClinicId=main&Specialty=Cardio&Service=Visit&Page=2')
            quick=re.search(r'<form[^>]*id="discovery-search".*?</form>',html,re.S)[0]
            check('name="Search"' in quick and not any('name="'+key+'"' in quick for key in ['ClinicId','Clinic','Specialty','Service','Page']), 'New broad search cannot retain hidden clinic or refinement restrictions')
            check('data-filter="ClinicId"' in html and 'data-filter="Specialty"' in html and 'data-filter="Service"' in html, 'Active scope and refinements are visible and removable')
            removal=re.search(r'data-filter="Specialty" href="([^"]+)"',html)[1]
            params=urllib.parse.parse_qs(urllib.parse.urlparse(removal).query)
            check('Specialty' not in params and params.get('Search')==['Горан'] and params.get('ClinicId')==['main'] and params.get('Page')==['1'], 'Removing one chip preserves other criteria and resets pagination')
            check('Пребарај во сите клиники' in html and '<details class="discovery-refinements" open=' in html, 'Clinic restriction is explicit and active refinements open automatically')
            anon.request('/Discover?Search='+urllib.parse.quote('Горан'))
            check(calls[-1][1].get('search')==['Горан'] and not any(calls[-1][1].get(key) for key in ['clinicId','clinic','specialty','service']), 'Unrestricted Cyrillic search reaches API without refinements')
            status,html,_=anon.request('/Discover?Search='+urllib.parse.quote('без-резултат'))
            check(status==200 and 'Нема резултати' in html and 'Прикажи ги сите лекари' in html, 'Empty search offers a complete reset')
            status,html,_=anon.request('/Discover?Search=unavailable-test')
            check(status==503 and 'role="alert"' in html and 'Обидете се повторно' in html, 'API outage renders a retryable public error')
            anon.request('/Discover?view=clinics&ClinicId=main&Specialty=Hidden&Service=Hidden')
            check(calls[-1][0]=='/api/public/clinics' and not any(calls[-1][1].get(key) for key in ['clinicId','specialty','service']), 'Clinic directory removes irrelevant hidden doctor restrictions')
            _,clean_search,_=anon.request('/Discover')
            check('На пример „Горан“' not in clean_search and 'Доволно е едно поле.' not in clean_search and 'именик' not in clean_search.lower(), 'Search page omits removed instructional copy and directory wording')
            check(anon.request('/Discover?PageSize=99')[0]==400,'Invalid public page size rejected by MVC')
            check(anon.request('/Discover/Clinic/main?page=0')[0]==400,'Clinic route validates internally constructed query')
            status,html,_=anon.request('/Discover/Clinic/main')
            check(status==200 and 'Јавен опис' in html and 'Тест лекар' in html,'Clinic profile renders real public description and doctors')
            check('clinic-contact-card' in html and 'Информации за клиниката' in html and 'tel:+38920000000' in html, 'Clinic profile has address and callable phone in an info card')
            check('maps.google.com/maps?q=' in html and 'output=embed' in html and 'loading="lazy"' in html and 'Отвори во Maps' in html, 'Clinic profile lazily embeds an address map and supplies external Maps link')
            check('data-discovery-art' not in html, 'Clinic map replaces generic landing illustration on clinic profiles')
            no_address_status,no_address_html,_=anon.request('/Discover/Clinic/no-address')
            check(no_address_status==200 and 'Локацијата сè уште не е додадена' in no_address_html and '<iframe' not in no_address_html and 'maps.google.com' not in no_address_html, 'Clinic without address does not invent a map location')
            status,html,_=anon.request('/Discover/Doctor/d01?clinicId=main')
            check(status==200 and 'Преглед' in html and '30 минути' in html,'Doctor profile renders active services')
            check('Продолжи кон закажување' in html and 'Слободните термини се проверуваат' not in html and 'doctor-profile-specialty' in html, 'Doctor profile emphasizes specialty and uses concise booking copy')
            check('именик' not in html.lower(), 'Doctor profile uses the new search terminology')
            check('id="availability"' in html and 'Слободни термини' in html and '09:00' in html, 'Public doctor profile shows anonymous availability')
            check('public-free-slots' in html and 'name="date"' in html and 'name="serviceId"' in html and 'не се резервираат' in html, 'Availability offers date/service filters and read-only times')
            _,staff_html,_=anon.request('/Discover/Doctor/staff?clinicId=main')
            check('закажувањето е преку рецепција' in staff_html and 'Продолжи кон закажување' not in staff_html, 'Reception-only doctors retain their booking boundary and notice')
            book='/Discover/Book?clinicId=main&doctorId=d01'
            status,_,h=anon.request(book)
            check(status==302 and '/Account/Login?' in h['Location'] and 'returnUrl=' in h['Location'],'Anonymous booking preserves a protected return action')
            status,html,_=anon.request(h['Location'])
            check('<select' not in html and 'Внесете ги вашите податоци.' in html and 'Клиниката се препознава автоматски.' not in html,'Normal login has credentials only')
            check('Создајте пациентска сметка' in html and 'doctorId' in html,'Login offers registration while preserving selected doctor')
            check(anon.request('/Account/Login',{'Email':'p@test.test','Password':'Test-password-123'})[0]==400,'Login POST requires CSRF')
            csrf=anon.csrf('/Account/Login?returnUrl='+urllib.parse.quote(book))
            status,_,h=anon.request('/Account/Login',{'Email':'p@test.test','Password':'Test-password-123','clinicId':'east','returnUrl':book,'__RequestVerificationToken':csrf})
            check(status==302 and h['Location']==book,'Successful authentication returns to selected booking action')
            check('X-Clinic' not in calls[-1][3] and set(calls[-1][2])=={'email','password'},'Web sends no chosen tenant to credential resolution')
            status,_,h=anon.request(book)
            check(status==302 and h['Location']=='/Workspace?book=d01#doctors','Matching clinic continues to selected doctor in workspace')
            check(anon.request('/Discover/Book?clinicId=east&doctorId=d01')[0]==403,'Cross-clinic booking does not switch membership')
            check(anon.request('/Platform')[0]==302,'Clinical cookie cannot enter company workspace')
            outsider=Client(base);csrf=outsider.csrf('/Account/Login')
            status,_,h=outsider.request('/Account/Login',{'Email':'p@test.test','Password':'Test-password-123','returnUrl':'https://evil.example/','__RequestVerificationToken':csrf})
            check(status==302 and h['Location']=='/Workspace','External login return URL rejected')
            reg=Client(base);csrf=reg.csrf('/Account/Register?clinicId=main&returnUrl='+urllib.parse.quote(book))
            status,_,h=reg.request('/Account/Register',{'Name':'Test Patient','Email':'new@test.test','Password':'Test-password-123','clinicId':'main','returnUrl':book,'__RequestVerificationToken':csrf})
            check(status==302 and 'returnUrl=' in h['Location'] and 'doctorId' in urllib.parse.unquote(h['Location']),'Registration retains doctor through subsequent login')
            company=Client(base)
            check(company.request('/Platform/Create',{})[0] in (302,400),'Anonymous company POST denied')
            csrf=company.csrf('/Platform/Login')
            status,_,h=company.request('/Platform/Login',{'Email':'company@test.test','Password':'Test-password-123','__RequestVerificationToken':csrf})
            check(status==302 and h['Location']=='/Platform','Company credentials use separate sign-in flow')
            status,html,_=company.request('/Platform')
            check(status==200 and 'Додај нова клиника' in html and 'Тест клиника' in html,'Company onboarding screen renders')
            check('X-Clinic' not in calls[-1][3],'Company API calls do not carry clinical routing headers')
            check(company.request('/Workspace')[0]==302,'Company cookie does not authenticate clinical workspace')
            check(company.request('/Platform/Create',{})[0]==400,'Company onboarding POST requires CSRF')
            csrf=company.csrf('/Platform');secret='Never-render-this-12345'
            payload=dict(Id='new',Name='New Clinic',TimeZone='UTC',AdminName='New Admin',AdminEmail='new@test.test',AdminPassword=secret,Discoverable='true',AllowRegistration='true',__RequestVerificationToken=csrf)
            status,html,_=company.request('/Platform/Create',dict(payload,Id='test_creation'))
            check(status==200 and 'Единствен идентификатор:' in html and 'moja-klinika-2' in html and 'Почетна лозинка на администраторот:' not in html, 'Clinic ID containing an underscore reports identifier rules instead of blaming a valid password')
            check(secret not in html and 'New Clinic' in html, 'Validation preserves nonsecret input without rendering administrator password')
            status,html,_=company.request('/Platform/Create',dict(payload,AdminPassword='short'))
            check(status==200 and 'Почетна лозинка на администраторот:' in html and '12 до 128' in html and 'Единствен идентификатор:' not in html, 'Short administrator password reports its own length requirement')
            status,html,_=company.request('/Platform/Create',payload)
            check(status==200 and 'Потребна е проверка на базата.' in html and secret not in html,'Provisioning error preserves form without exposing password')
            check(calls[-2][2].get('discoverable') is True and calls[-2][2].get('allowRegistration') is True,'Company checkbox values bind correctly')
            del payload['Discoverable'];del payload['AllowRegistration']
            status,html,_=company.request('/Platform/Create',payload)
            check(calls[-2][2].get('discoverable') is False and calls[-2][2].get('allowRegistration') is False,'Unchecked company policies are sent as false')
            check(company.request('/Platform/Adopt/main',{})[0]==400,'Platform adoption requires antiforgery protection')
            check(company.request('/Platform/Edit/main')[0]==404,'Configured clinic cannot edit platform metadata before adoption')
            csrf=company.csrf('/Platform')
            status,_,h=company.request('/Platform/Adopt/main',{'__RequestVerificationToken':csrf})
            check(status==302 and '/Platform/Edit' in h['Location'],'Platform adoption redirects to clinic details')
            status,edit_html,_=company.request(h['Location'])
            check(status==200 and 'name="Address"' in edit_html and 'name="Version"' in edit_html and 'name="AdminPassword"' not in edit_html,'Clinic details form edits metadata without recreating credentials')
            check(company.request('/Platform/Edit/main',{})[0]==400,'Clinic metadata edits require antiforgery protection')
            csrf=company.csrf('/Platform/Edit/main')
            details=dict(Name='Edited clinic',Address='Плоштад Македонија, Скопје',Phone='+389 2 000 0000',Description='Edited public description',Discoverable='true',AllowRegistration='false',Version=1,__RequestVerificationToken=csrf)
            check(company.request('/Platform/Edit/main',details)[0]==302,'Platform metadata form saves successfully')
            status,stale_html,_=company.request('/Platform/Edit/main',dict(details,Name='Stale edit'))
            check(status==200 and 'друга сесија' in stale_html and 'Stale edit' in stale_html and 'вчитај ги тековните' in stale_html,'Metadata conflict preserves entered values and offers explicit reload')
            if os.environ.get('TEST_BROWSER_EXECUTABLE'):
                subprocess.run(['node',str(root/'tests/frontend/discovery-browser.cjs')],env=dict(os.environ,TEST_PUBLIC_WEB=base),check=True,timeout=150)
            print(f'\n{count}/{count} MVC discovery/company contract checks passed (stub API).',flush=True)
        except Exception:
            log.flush();log.seek(0);print(log.read());raise
        finally:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            api.shutdown();api.server_close()
