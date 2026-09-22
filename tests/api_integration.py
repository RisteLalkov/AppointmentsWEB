"""Destructive integration suite for a NEW, EMPTY, disposable PostgreSQL database.
Set CARELINE_TEST_CONNECTION (database name MUST contain 'test' or 'integration').
Build Release first. Starts two independent API processes and an MVC process.
Uses stdlib HTTP clients; optionally runs npm DOM tests with --dom.
"""
import argparse
import concurrent.futures
import datetime as dt
import http.cookiejar
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
parser.add_argument('--dom', action='store_true')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
connection = os.environ.get('CARELINE_TEST_CONNECTION', '')
database = re.search(r'(?:^|;)Database=([^;]+)', connection, re.I)
if not database or not any(s in database[1].lower() for s in ('test', 'integration')):
    raise SystemExit('CARELINE_TEST_CONNECTION must name a disposable test/integration database.')
count = 0
processes = []
logs = []
password = 'Integration-only-' + uuid.uuid4().hex

def check(condition, name):
    global count
    if not condition: raise AssertionError(name)
    count += 1
    print('PASS', name, flush=True)

def free_url():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return 'http://127.0.0.1:' + str(s.getsockname()[1])

class Client:
    def __init__(self, base, token=''):
        self.base, self.token, self.csrf = base, token, ''
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(self, path, data=None, form=False, csrf=True):
        headers = {'Authorization': 'Bearer ' + self.token} if self.token else {}
        if data is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
            data = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
            if csrf and self.csrf: headers['X-CSRF-TOKEN'] = self.csrf
        try: response = self.opener.open(urllib.request.Request(self.base + path, data, headers), timeout=30)
        except urllib.error.HTTPError as e: response = e
        text = response.read().decode()
        try: body = json.loads(text)
        except ValueError: body = text
        return response.status, body
    def ok(self, path, data=None):
        code, body = self.request(path, data)
        if code != 200: raise AssertionError(f'{path}: {code}: {body}')
        return body
    def demo(self, user):
        self.token = self.ok('/api/auth/demo-login', {'userId': user})['accessToken']
        return self
    def login(self, email, secret=password):
        self.token = self.ok('/api/auth/login', {'email': email, 'password': secret})['accessToken']
        return self
    def web_login(self, email, secret=password):
        _, html = self.request('/Account/Login')
        token = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', html)[1]
        code, html = self.request('/Account/Login', {'Email': email, 'Password': secret, '__RequestVerificationToken': token}, form=True)
        check(code == 200 and 'main-content' in html, 'Password login renders MVC workspace')
        self.csrf = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', html)[1]
        return html

def start(project, url, env, temporary):
    log = open(pathlib.Path(temporary) / f'{project}-{len(logs)}.log', 'w+')
    logs.append(log)
    directory = root / 'src' / project
    proc = subprocess.Popen([args.dotnet, str(directory / f'bin/Release/net10.0/{project}.dll'), '--urls', url], cwd=directory, env=env, stdout=log, stderr=log)
    processes.append(proc)
    client = Client(url)
    for _ in range(300):
        if proc.poll() is not None: raise AssertionError(f'{project} exited with {proc.returncode}')
        try:
            if client.request('/health' if project.endswith('Api') else '/Account/Login')[0] == 200: return proc
        except (OSError, urllib.error.URLError): pass
        time.sleep(.1)
    raise AssertionError(project + ' failed to become ready')

with tempfile.TemporaryDirectory(prefix='careline-api-') as temporary:
    api1, api2, web_url = free_url(), free_url(), free_url()
    env = dict(os.environ, ASPNETCORE_ENVIRONMENT='Development', ConnectionStrings__Appointments=connection,
        Database__ApplyMigrations='true', Demo__Enabled='true', Bootstrap__Email='admin@integration.test', Bootstrap__Password=password,
        Logging__LogLevel__Default='Warning', Logging__LogLevel__Microsoft='Warning')
    try:
        server1 = start('Appointments.Api', api1, env, temporary)
        server2 = start('Appointments.Api', api2, env, temporary)
        anon = Client(api1)
        check(anon.request('/api/bootstrap')[0] == 401, 'Anonymous appointment access rejected')
        admin = Client(api1).login('admin@integration.test')
        admin2 = Client(api2, admin.token)
        check(admin2.ok('/health/database')['status'] == 'ready', 'Session and PostgreSQL work across two API instances')
        state = admin.ok('/api/bootstrap')
        check(len(state['doctors']) == 40 and sum(len(d['workingPeriods']) for d in state['doctors']) == 87, 'Database imports source doctors and 87 schedule periods')
        check(state['backend'] == 'Api' and not state['canReset'] and not state['demoMode'], 'API mode advertises real persistence and disables browser reset')
        check(anon.request('/openapi/v1.json')[0] == 200, 'Development OpenAPI document generated')
        check(anon.request('/api/auth/register', {'name': 'Weak', 'email': 'weak@integration.test', 'password': 'short'})[0] == 400, 'Weak password rejected')
        registration = anon.ok('/api/auth/register', {'name': 'Integration Patient', 'email': 'patient@integration.test', 'password': password, 'role': 'Administrator'})
        patient = Client(api1).login('patient@integration.test')
        check(registration['role'] == 'Patient' and patient.ok('/api/auth/me')['actor']['role'] == 'Patient', 'Registration cannot choose elevated role')
        check(patient.request('/api/accounts')[0] == 403, 'Patient cannot administer accounts')
        check(patient.request('/api/patients', {'name': 'Forbidden'})[0] == 403, 'Patient cannot create patient records')
        check(anon.request('/api/auth/register', {'name': 'Duplicate', 'email': 'PATIENT@integration.test', 'password': password})[0] == 409, 'Registration normalizes email and rejects duplicate identities')
        patient2 = Client(api2).demo('p02')
        doctor = Client(api2).demo('user-d01')
        other_doctor = Client(api1).demo('user-d03')
        date = dt.date.fromisoformat(state['today']) + dt.timedelta(days=35)
        while date.weekday() > 4: date += dt.timedelta(days=1)
        day = date.isoformat()
        provider = next(d for d in state['doctors'] if d['id'] == 'd01')
        slots = admin.ok('/api/slots?' + urllib.parse.urlencode({'doctorId': 'd01', 'date': day}))
        check(len(slots) > 3, 'Real schedule produces future availability')
        def command(slot, pid=registration['patientId'], did='d01'):
            return {'doctorId': did, 'patientId': pid, 'date': day, 'time': slot['time'], 'durationMinutes': provider['durationMinutes'], 'requestId': uuid.uuid4().hex}
        booking = command(slots[0])
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda client: client.request('/api/appointments', booking), [admin, admin2]))
        check(all(code == 200 for code, _ in responses) and responses[0][1]['id'] == responses[1][1]['id'], 'Concurrent identical requests return one durable booking')
        appt = responses[0][1]
        check(admin2.request('/api/appointments', dict(booking, time=slots[1]['time']))[0] == 409, 'Idempotency key cannot be reused with another payload')
        check(patient.ok('/api/bootstrap')['appointments'][0]['id'] == appt['id'], 'Reception booking appears for patient')
        check(any(a['id'] == appt['id'] for a in doctor.ok('/api/bootstrap')['appointments']), 'Reception booking appears for doctor on second API instance')
        check(not any(a['id'] == appt['id'] for a in patient2.ok('/api/bootstrap')['appointments']), 'Another patient cannot read the booking')
        check(other_doctor.request(f"/api/appointments/{appt['id']}/status", {'status': 'Cancelled', 'version': 1})[0] == 404, 'Another doctor cannot mutate the booking')
        contested = slots[1]
        race = [command(contested, 'p03'), command(contested, 'p04')]
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda pair: pair[0].request('/api/appointments', pair[1]), [(admin, race[0]), (admin2, race[1])]))
        check(sorted(code for code, _ in responses) == [200, 409], 'Two API processes cannot double-book one doctor')
        move = {'date': day, 'time': slots[2]['time'], 'version': appt['version']}
        moved = patient.ok(f"/api/appointments/{appt['id']}/move", move)
        check(moved['version'] == 2 and moved['start'] != appt['start'], 'Patient rescheduling persists and increments version')
        check(admin2.request(f"/api/appointments/{appt['id']}/move", move)[0] == 409, 'Stale appointment update rejected')
        check(admin2.ok('/api/appointments', booking)['start'] == appt['start'], 'Idempotency replay is stable after appointment changes')
        check(patient.request('/api/appointments', command(slots[3], 'p02'))[0] == 403, 'Patient cannot book for another patient')
        check(patient.request('/api/appointments', dict(command(slots[3]), durationMinutes=0))[0] == 409, 'Invalid duration rejected')
        check(patient.request('/api/appointments', dict(command(slots[3]), date='2000-01-01'))[0] == 409, 'Past appointment rejected')
        # Schedule revision tokens protect lost updates as well as bookings.
        schedule = {'periods': provider['workingPeriods'], 'durationMinutes': provider['durationMinutes'], 'version': provider['scheduleVersion']}
        check(admin.request('/api/schedule/d01', schedule)[0] == 200, 'Working periods save through EF owned collections')
        check(admin2.request('/api/schedule/d01', schedule)[0] == 409, 'Stale schedule update rejected')
        check(admin.request('/api/schedule/d01', dict(schedule, periods=[], version=schedule['version']+1))[0] == 409, 'Schedule change cannot strand an existing booking')
        check(doctor.request('/api/schedule/d03', schedule)[0] == 403, 'Doctor cannot edit another schedule')
        check(admin.request('/api/exceptions/d01', {'date': day, 'start': slots[2]['time'], 'end': slots[3]['time'], 'isAvailable': False, 'reason': 'Integration break'})[0] == 409, 'Unavailable period cannot cover existing appointment')
        block = admin.ok('/api/exceptions/d01', {'date': day, 'start': slots[-2]['time'], 'end': slots[-1]['time'], 'isAvailable': False, 'reason': 'Integration break'})
        check(all(s['time'] != slots[-2]['time'] for s in patient.ok(f'/api/slots?doctorId=d01&date={day}')), 'Persisted break removes availability')
        doctor.ok(f"/api/exceptions/{block['id']}/remove", {})
        cancelled = patient.ok(f"/api/appointments/{appt['id']}/status", {'status': 'Cancelled', 'version': moved['version']})
        check(cancelled['status'] == 'Cancelled' and any(s['time'] == slots[2]['time'] for s in admin2.ok(f'/api/slots?doctorId=d01&date={day}')), 'Cancellation frees the slot on second API instance')
        check(patient.request(f"/api/appointments/{appt['id']}/status", {'status': 'Confirmed', 'version': cancelled['version']})[0] == 403, 'Patient cannot elevate appointment status')
        new_patient = admin.ok('/api/patients', {'name': 'Phone Patient', 'email': 'phone@integration.test'})
        check(not new_patient['isDemonstration'], 'Normal receptionist creates a non-demo scheduling profile')
        check(anon.request('/api/auth/register', {'name': 'Impersonator', 'email': 'phone@integration.test', 'password': password})[0] == 409, 'Registration cannot claim an existing patient record')
        linked = admin.ok('/api/accounts', {'email': 'phone-login@integration.test', 'name': 'Phone Patient', 'password': password, 'role': 'Patient', 'patientId': new_patient['id']})
        linked_client = Client(api2).login('phone-login@integration.test')
        check(linked_client.ok('/api/auth/me')['actor']['patientId'] == new_patient['id'], 'Reception provisions account linked to existing patient')
        # Direct SQL checks deliberately bypass all API validation; constraints must still hold.
        subprocess.run([args.dotnet, str(root/'tests/Appointments.DatabaseTests/bin/Release/net10.0/Appointments.DatabaseTests.dll')], env=env, check=True)
        # API-backed MVC does not need a JSON store; its browser-facing requests use anti-forgery.
        web_env = dict(env, Backend__Mode='Api', Backend__ApiBaseUrl=api1+'/', Demo__DataPath=str(pathlib.Path(temporary)/'must-not-exist.json'))
        start('Appointments.Web', web_url, web_env, temporary)
        web = Client(web_url)
        html = web.web_login('patient@integration.test')
        check('accessToken' not in html and patient.token not in html, 'API session token is not rendered into HTML')
        check(any(a['id'] == appt['id'] and a['status'] == 'Cancelled' for a in web.ok('/data/bootstrap')['appointments']), 'MVC reads shared database state through API')
        check(web.request('/data/appointments', command(slots[3]), csrf=False)[0] == 400, 'MVC rejects mutations without anti-forgery token')
        web_booking = web.ok('/data/appointments', command(slots[3]))
        check(any(a['id'] == web_booking['id'] for a in doctor.ok('/api/bootstrap')['appointments']), 'Browser booking reaches doctor through database')
        admin_web = Client(web_url)
        admin_web.web_login('admin@integration.test')
        check('People &amp; access' in admin_web.ok('/Accounts'), 'Administrator account management Razor page renders')
        check(not pathlib.Path(web_env['Demo__DataPath']).exists(), 'API-backed MVC never creates a local JSON store')
        # Restart an API; sessions, schedules and appointments survive.
        server1.terminate(); server1.wait(timeout=15)
        server1 = start('Appointments.Api', api1, env, temporary)
        check(any(a['id'] == web_booking['id'] for a in patient.ok('/api/bootstrap')['appointments']), 'Appointments and sessions survive API restart')
        check(next(d for d in admin.ok('/api/bootstrap')['doctors'] if d['id']=='d01')['scheduleVersion'] == 2, 'Schedule revision survives API restart')
        audit = admin.ok('/api/accounts/audit?take=500')
        check(any(a['action'] == 'appointment.created' for a in audit) and all('password' not in a and 'token' not in a for a in audit), 'Administrative audit records actions without credential payloads')
        admin.ok(f"/api/accounts/{linked['id']}/access", {'enabled': False})
        check(linked_client.request('/api/bootstrap')[0] == 401, 'Disabling account revokes sessions across API instances')
        # Changing a password invalidates even sessions created on the other instance.
        patient_other = Client(api2).login('patient@integration.test')
        patient.ok('/api/auth/password', {'currentPassword': password, 'newPassword': password+'-changed'})
        check(patient_other.request('/api/bootstrap')[0] == 401 and patient.request('/api/bootstrap')[0] == 401, 'Password change revokes every session')
        patient.login('patient@integration.test', password+'-changed')
        patient.ok('/api/auth/logout', {})
        check(patient.request('/api/auth/me')[0] == 401, 'Logout revokes the database session')
        # Provision a demo identity and prove anonymous demo login no longer works for it.
        admin.ok('/api/accounts/user-d03/credentials', {'email': 'doctor@integration.test', 'password': password})
        check(Client(api2).login('doctor@integration.test').ok('/api/auth/me')['actor']['doctorId'] == 'd03', 'Doctor password credentials preserve profile link')
        check(anon.request('/api/auth/demo-login', {'userId': 'user-d03'})[0] == 404, 'Provisioned doctor removed from anonymous demo login')
        # Keep auth attempts on second process below the fixed-window limit for deterministic tests.
        for _ in range(5): check(Client(api2).request('/api/auth/login', {'email': 'phone-login@integration.test', 'password': 'incorrect-password'})[0] == 401, 'Disabled account cannot sign in')
        admin.ok(f"/api/accounts/{linked['id']}/access", {'enabled': True})
        for _ in range(5): Client(api2).request('/api/auth/login', {'email': 'phone-login@integration.test', 'password': 'incorrect-password'})
        check(Client(api2).request('/api/auth/login', {'email': 'phone-login@integration.test', 'password': password})[0] == 401, 'Five failures lock an enabled account')
        if args.dom:
            subprocess.run(['npm', 'test', '--prefix', str(root/'tests/frontend')], env=dict(env, TEST_API_BASE=api1+'/', TEST_DOTNET=args.dotnet), check=True)
        restricted_url = free_url()
        start('Appointments.Api', restricted_url, dict(env, ASPNETCORE_ENVIRONMENT='Production', Database__ApplyMigrations='false'), temporary)
        restricted = Client(restricted_url)
        check(restricted.request('/api/auth/demo-users')[0] == 404 and restricted.request('/api/auth/demo-login', {'userId':'admin'})[0] == 404, 'Production rejects demo endpoints even if Demo enabled in configuration')
        check(Client(restricted_url, doctor.token).request('/api/bootstrap')[0] == 401, 'Production refuses previously issued demo sessions')
        check(restricted.request('/openapi/v1.json')[0] == 404, 'OpenAPI discovery disabled outside Development')
        print(f'\n{count}/{count} PostgreSQL/API/MVC integration checks passed.', flush=True)
    except Exception:
        for log in logs:
            log.flush(); log.seek(0); print('\nSERVER LOG:', log.name, '\n', log.read()[-18000:])
        raise
    finally:
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.kill()
        for log in logs: log.close()
