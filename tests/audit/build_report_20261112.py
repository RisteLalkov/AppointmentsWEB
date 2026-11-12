"""Build human/machine appendices from retained audit evidence. Does not contact running hosts."""
import collections,csv,datetime as dt,hashlib,json,pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'docs/audit/2026-11-12';E=OUT/'evidence'
def read(name):return json.loads((E/name).read_text())
def esc(x):return str(x).replace('|','&#124;').replace('\n',' ')
def write(name,text):(OUT/name).write_text(text,encoding='utf-8')

features='''F01|Architecture/build/publish assets|PASS|Release build/publish logs; dependency and repository inventories|Actual Windows/IIS execution BLOCKED
F02|Public landing, branding, footer, navigation|PASS / GAP|baseline-discovery; real public doctor browser|External social destinations BLOCKED; legal content M08
F03|Public doctor/clinic search and refinements|PASS|baseline-platform; baseline-discovery; API matrix|SQL/HTML strings plus Cyrillic first/surname/full-name cases
F04|Public pagination, empty/error states|PASS|baseline-platform; baseline-discovery|Stub-backed browser contract scenarios are labelled
F05|Public clinic metadata and Maps/fallback URLs|PASS / BLOCKED|baseline-platform; baseline-discovery; Razor source|External map tiles/geocoding accuracy BLOCKED
F06|Public doctor profile and service selection|PASS|browser-targeted; baseline-discovery|By-agreement/reception-only disclosure included
F07|Anonymous free-slot selection to login|PASS|baseline-global revalidation; browser-targeted|Date/time/service retained through login/consent
F08|Registration, required contacts and password visibility|PASS / GAP|baseline-api; round2; browser-targeted|Inbox/phone verification absent, M07
F09|Single patient identity across clinics|PASS|global-revalidated; security-results; browser-targeted|Explicit membership, own profiles and clinic-local history
F10|Existing contact email cannot claim history|PASS|baseline-api; global-revalidated|No automatic contact-to-account merge
F11|Closed/hidden clinics and consent|PASS|baseline-platform; global-revalidated|Existing member versus new registration rules
F12|Global My clinics: visits/history/filter/join|PASS|global-revalidated; baseline-round2|100-item cap disclosed; arbitrary >100 cross-clinic histories not browser-exhausted
F13|Breadcrumb clinic switcher, keyboard/retry/stale tab|PASS / FAIL|baseline-round2; browser-targeted|Clinical stale reads/writes protected; personal actions M01
F14|Reception clinic-bound login/session|PASS|baseline-tenancy; baseline-high; security matrix|No staff cross-clinic membership
F15|Doctor role, own appointments/schedule|PASS|baseline-api; baseline-tenancy; browser-targeted|Clinic contact access is existing policy
F16|Patient own-only records and appointments|PASS|baseline-api; global-revalidated; security matrix|Other patient/doctor object access denied
F17|Independent company and clinical cookies|PASS|browser-targeted B020; baseline settings|Company logout leaves clinic session usable
F18|Login/back/forward/return URL routing|PASS|baseline HTTP/discovery/overnight/settings suites|Cross-browser bfcache behavior NOT TESTED
F19|Password changes and recovery|PASS|global-revalidated; browser-targeted B019; baseline-platform|Manual trusted-channel recovery, no delivery integration
F20|Persistent distributed lockout|PASS|security-results; baseline-high/platform|Eight concurrent wrong logins across API instances for patient/staff/company
F21|Expired/revoked/disabled sessions|PASS|security-results; baseline-api/high|Timestamp expiry forced in test; natural two-hour wait NOT TESTED
F22|Last active administrator/self-disable guards|PASS|baseline-high; baseline-api|Concurrent account changes tested
F23|Overview counts/date/week chart|PASS / FAIL|core/API reports; browser-targeted; browser-performance|Correct small state; H01 large-data usability
F24|Reception/patient/doctor sidebar and responsive drawer|PASS|feedback-revalidated; browser-extra E3|20 repeated mobile/desktop transitions
F25|Doctors cards/list/search/filter/pagination|PASS|baseline-round2; browser-targeted|12/24/48 selection, menus and appropriate actions
F26|Doctor edit/details/availability menus|PASS|baseline API/high/round2; browser-targeted|Catalog version conflicts and booking flags
F27|First-free-slot summaries|PASS|booking-review; baseline-round2; API matrix/performance|Bounded 1–100 doctor query and 180-day horizon
F28|By-agreement/reception-only restrictions|PASS|baseline API/core/high/round2|Patient disabled self-service; staff agreed-time booking
F29|Patient cards/list/search/number/pagination|PASS|feedback-revalidated; baseline-round2|Same-name identities distinguished by permanent number
F30|New manual patient phone+email and normalization|PASS|API matrix; baseline-round2|Legacy edits have separate optional-email semantics
F31|Patient profile/contact edits/history/filtering|PASS|baseline-api; feedback-revalidated; baseline-round2|Concurrent versions, history scope, date controls
F32|No patient deletion|BY DESIGN|Product requirement; source route inventory|History-preserving deletion deliberately deferred
F33|Specialties list/create/edit/duplicates/version|PASS|core/API; round2; DOM|No card-view/status toggle expected
F34|Services list/create/edit/duration/assignment|PASS|core/API; round2; DOM|Disabled/legacy service and duration-preserving reschedule
F35|Booking doctor/service/patient comboboxes|PASS|booking-review; round2; DOM|Service-first doctor filtering, no contact email in label
F36|Coloured availability date picker/date entry|PASS|feedback-revalidated; round2; dates DOM|DD.MM.YYYY, invalid dates, keyboard/Escape and stale responses
F37|Booking slots/review/back/submit/success/details|PASS / FAIL|booking-review; browser-targeted|Full real DB flow PASS; review contrast M03
F38|Reception agreed-time/no-weekly-hours booking|PASS|core/API/booking-review|Atomic one-off availability, overlaps still rejected
F39|Patient quotas and pending-per-doctor limits|PASS|baseline-high; core|Cross-host concurrent requests and staff override
F40|Appointment creation/idempotent retries|PASS|baseline-api; API matrix; real browser|Complete PG fingerprint; demo exception L01
F41|Doctor/patient conflict and adjacency|PASS|core/API/SQL; cross-host matrix|Local doctor, local patient and shared patient exclusions
F42|Cross-clinic shared-patient conflict|PASS|global-revalidated; security-results|Two different API hosts, one 200/one 409
F43|Appointment list/search/combined filters/pagination|PASS|core/API; baseline-round2; browser|Role-scoped list, reversed range and clear/reset
F44|Details/history/actor/version snapshots|PASS|baseline-api; browser-targeted|Atomic writes, negative updates add no history
F45|Confirm/cancel/complete/no-show/overdue|PASS|225-case status matrix; core/API|All roles/current-target statuses/future-in-progress-past
F46|Reschedule original date/duration/version|PASS|booking-review; core/API|No stale overwrite, disabled provider rules retained
F47|Physical calendar pointer drag and confirm|PASS|browser-extra E2|10:00→10:30, HTTP 200, version 2; off-grid rejection also verified
F48|Calendar views/day-week-month/range/filter/today|PASS / FAIL|round2; language/DOM/browser-targeted|Pointer and API work; keyboard scroller M04
F49|Calendar rendering at small screens|PASS|responsive browser and baseline tests|Real device/touch/OS controls NOT TESTED
F50|Regular/dated working periods and ordering|PASS|core/API; round2|Monday-first, date override/fallback, overlapping/invalid ranges
F51|Schedule edit conflict/draft preservation|PASS|booking-review; core/API|Original version retained; other staff update cannot silently overwrite
F52|Exceptions/absence/additional availability/remove|PASS|core/API; booking-review|Duplicate suppression, conflict/stranding rejection, role scope
F53|Date/time/DST/closing-minute/180-day boundaries|PASS|core/API/overnight; API matrix|Invalid/ambiguous wall times fail closed
F54|Imported prose/Tuesday preference not operational|PASS|core baseline and extra Core C002|Wednesday available despite legacy TuesdayFirst flag
F55|Reports range/group/service/status totals|PASS|core/API; UI DOM/browser|Read-only, consistent aggregate snapshot, role guard
F56|Accounts list/filter/search/pagination|PASS|feedback-revalidated; DOM/browser|Patient versus staff permissions and clear empty/success states
F57|Staff account creation/profile choices/access/reset|PASS|core/API/high; global browser|No service-only doctor or occupied profile; no patient credential linking
F58|Platform clinic provision/adopt/edit/retry|PASS|baseline-platform; API matrix; real browser|Shared DB schemas, stale versions, preserved main data and sessions
F59|Platform visibility/registration policy/restart|PASS|baseline-platform|Cross-instance refresh, hidden metadata and non-ready failure handling
F60|Company password/logout/patient recovery|PASS|baseline-platform; browser-targeted|Global session revocation and patient-event evidence
F61|Themes and language/settings/password controls|PASS / FAIL|language/theme/settings/DOM/browser|Controls work; stale-tab M01 and specific contrast M03
F62|Icons, focus traps, menus and dialogs|PASS / PARTIAL|settings/language/feedback/booking browser|Selected keyboard/focus cases; manual assistive-tech review outstanding
F63|Responsive widths 320/768/1360|PASS|browser-targeted; round2/feedback/discovery|No tested document overflow; does not certify physical devices
F64|HTML escaping/SQL-style injection strings|PASS|API matrix; browser-extra E1|Stored patient markup rendered literally, no event execution
F65|CSRF/clinic scope/forged header/role boundaries|PASS / FAIL|global revalidation; API/security matrices|Clinical protections PASS; personal stale-token M01
F66|Framing/CSP policy|FAIL|browser-targeted B059|Authenticated same-site cross-origin frame rendered, M02
F67|HTTPS/proxy/rate-limit/body limits|PASS / BLOCKED|baseline-high/API; API matrix|Real local TLS; actual IIS/proxy/network configuration BLOCKED
F68|Public Swagger/OpenAPI/assets|PASS / FAIL|baseline API; endpoint matrix|UI/authorization work; missing patient clinic headers M05
F69|Registry/cache outage/freshness/recovery|PASS|baseline-high|Brief continuity, bounded stale lease, fail closed and recovery
F70|Migration/identity triggers/tenant binding|PASS|fresh migration, SQL catalogues, high suite, restore|Actual production drift BLOCKED
F71|Every observed column/constraint/index inventory|PASS|DATABASE_CATALOGUE; model comparison|Canonical mutation probes; cloned schemas inventoried, not duplicate-probed exhaustively
F72|Database cascade/unique/FK/range/rollback|PASS|312 additional probes; baseline SQL|Expected SQLSTATE/constraint and affected-row checks
F73|Clinical+platform backup/restore/read/write|PASS|11 restore assertions|Stable source window; hot cross-DB/PITR/new-server recovery NOT TESTED
F74|Preview seeding safety/idempotency/history|PASS|baseline-high|Explicit opt-in, account/old appointment preservation
F75|Authentication and record-access audit|PARTIAL|security patient events; audit source|Successful changes tracked; broader failure/read trail M06
F76|Identity verification/MFA/provider delivery|GAP / NOT TESTED|registration/session source and live registration|Not implemented provider workflow, M07
F77|Privacy/terms/policy content|GAP|landing footer source/browser|Intentionally deferred placeholders, M08
F78|Package advisory checks and bundled assets|PASS / PARTIAL|NuGet/npm audit; asset header|Covered feeds clean; vendor/runtime/OS scope L04
F79|CLI/deployment scripts/configuration|PASS / BLOCKED|published fixture migrate/preview; source review|Windows CMD execution/real server roles unavailable
F80|Soak/hardware fault/failover/capacity certification|NOT TESTED|Bounded experiments only|See explicit production acceptance checklist'''
lines=['# Feature inventory and testing coverage','', 'Status applies only to the stated evidence and scope. PASS is not a claim that every input, theme, device or dataset combination was exercised. A mixed status explicitly retains failures/gaps.','', '| ID | Discoverable feature | Assessment | Evidence | Limits / notes |','|---|---|---|---|---|']
for row in features.splitlines():lines.append('| '+' | '.join(esc(x) for x in row.split('|'))+' |')
write('FEATURE_COVERAGE.md','\n'.join(lines)+'\n')

matrix=read('endpoint-matrix.json');by={(r['path'],r['method']):r for r in matrix};lines=['# API operation inventory and executed boundaries','', 'Generated from the real running API OpenAPI document and request matrix. All documented operations were invoked. A POST boundary check is not a successful CRUD mutation; positive write coverage is supplied by the named integration suites and browser/database cases below. Nonexistent, malformed, version, method and ownership cases are itemized in the assertion ledger.','', '| Method | Path | Session required | Anonymous | Invalid token | Authorized read | Wrong-role probe | Positive feature evidence |','|---|---|---|---|---|---|---|---|']
def positive(p,m):
 if '/platform/' in p:return 'baseline-platform; global revalidation; browser company recovery; API adoption'
 if '/patient/' in p:return 'global-revalidated; round2; real browser registration/join/home'
 if '/public/' in p or p=='/api/clinics':return 'baseline-platform; discovery contracts/browser; targeted matrix'
 if '/auth/' in p:return 'baseline-api/global/high; security lockout/expiry; browser settings'
 if '/accounts' in p:return 'baseline-api/high; feedback browser; global staff boundaries'
 if '/patients' in p:return 'baseline-api; round2; contact/number/ownership tests; stored-HTML browser'
 if '/catalogue/' in p:return 'baseline-api/core/high; round2 catalogue browser'
 if '/schedule/' in p or '/exceptions' in p:return 'baseline-api/core/booking/round2; stale schedule and duplicate exceptions'
 if '/status' in p:return '225-case real API/database transition matrix; browser confirm/cancel'
 if '/move' in p:return 'baseline-api/booking; cross-host race; physical pointer drag'
 if '/appointments' in p:return 'baseline-api/core/round2; browser complete booking; range/ownership/history'
 if 'availability' in p or p=='/api/slots':return 'baseline-api/core/booking/round2; bounds and next-slot summary'
 if p=='/api/reports':return 'baseline-api/core; UI DOM/calendar reporting'
 return 'baseline-high/API; targeted matrix; actual restored-host startup'
for r in matrix:lines.append('| '+' | '.join(esc(x) for x in [r['method'],f"`{r['path']}`",r['protected'],r.get('anonymous','—'),r.get('invalidToken','—'),r.get('authorizedRead','—'),r.get('wrongRole','—'),positive(r['path'],r['method'])])+' |')
lines+=['','Additional routes/assets: `/swagger`, `/swagger/index.html`, local Swagger CSS/JS and `/openapi/v1.json` were exercised by the baseline API suite. MVC `/data` proxies, Account, PatientClinics, Accounts, Platform and Preferences are recorded separately in source route declarations and browser/HTTP tests. The raw source declaration inventory is `evidence/route-declarations.json`.','', '**Known documentation failure:** GET/POST `/api/patients/{id}` and POST `/api/patients` omit X-Clinic from their schema. `swagger-header-defect.json` records 400 without selection versus 200 with selection. Positive mapping above identifies suite-level evidence; it does not assert a separate successful manual Swagger mutation for each operation.']
write('API_COVERAGE.md','\n'.join(lines)+'\n')

lines=['# Actual PostgreSQL catalogue and integrity coverage','', 'Generated from the migrated, running, disposable databases. This is not the actual production catalogue. Exact shared functions, trigger definitions and grants are in the matching JSON evidence. Identical tenant definitions are listed individually; canonical integrity probes do not imply every cloned column was independently mutated.','']
for kind in ['clinical','platform']:
 cols=read(kind+'-columns.json');cons=read(kind+'-constraints.json');idx=read(kind+'-indexes.json');triggers=read(kind+'-triggers.json');lines+=['## '+kind.title()+' database','']
 for schema,table in sorted({(c['table_schema'],c['table_name']) for c in cols}):
  lines+=['### '+schema+'.'+table,'','| Column | Actual type | Nullable | Default / generated |','|---|---|---|---|']
  for c in cols:
   if (c['table_schema'],c['table_name'])!=(schema,table):continue
   typ=c['data_type']+(f"({c['character_maximum_length']})" if c['character_maximum_length'] else '');default=c['column_default'] or '';default+=(' IDENTITY '+c['identity_generation']) if c['is_identity']=='YES' else ''
   lines.append('| '+' | '.join(esc(x) for x in [c['column_name'],typ,c['is_nullable'],default])+' |')
  lines+=['','Constraints:','']
  for c in cons:
   if (c['schema_name'],c['table_name'])==(schema,table):lines.append(f"- `{c['conname']}`: `{c['definition']}`; validated={c['convalidated']}.")
  lines+=['','Indexes:','']
  for c in idx:
   if (c['schema_name'],c['table_name'])==(schema,table):lines.append(f"- `{c['index_name']}`: `{c['definition']}`; valid={c['indisvalid']}; ready={c['indisready']}.")
  for c in triggers:
   if (c['schema_name'],c['table_name'])==(schema,table):lines.append(f"- Trigger `{c['tgname']}` ({c['tgenabled']}): `{c['definition']}`.")
  lines.append('')
lines+=['## Integrity results','', '46 checks/FK/catalogue assertions and 266 column/key/exclusion/cascade assertions passed on the final runs. Full individual cases are in `database-probe-results.json`, `database-column-key-results.json`, `constraint-probes.json` and `column-key-probes.json`.','', 'Model comparison: 156 mapped columns exist with matching nullability, seven EF clinical migrations applied, zero pending migrations and no pending model changes. Manually installed identity/control tables and exact store types are retained in JSON. EF metadata alone is not used as proof of SQL trigger/exclusion behavior.']
write('DATABASE_CATALOGUE.md','\n'.join(lines)+'\n')

# Keep raw execution outcomes, including superseded harness failures. Never rewrite FAIL as PASS silently.
ledger=[]
for log in sorted((OUT/'logs').glob('*.log')):
 for n,line in enumerate(log.read_text(errors='replace').splitlines(),1):
  entry=None
  if line.startswith('PASS '):entry=dict(name=line[5:],status='PASS')
  elif line.startswith('{'):
   try:x=json.loads(line)
   except ValueError:continue
   if 'name' in x and 'status' in x:entry=x
  if not entry:continue
  if log.name=='security-targeted.log' and entry['name'] in ['Main staff token cannot select east patient','Main staff token cannot select east other-patient']:entry=dict(entry,status='NOT TESTED',name=entry['name']+' (guard skipped request; excluded)')
  name=log.name;note='Recorded execution; scope and final adjudication in report/test runs.'
  if 'initial-harness' in name:note='Superseded harness route/role classification; final API matrix passed.'
  elif name in ['columns-keys.log','columns-keys-revalidated.log']:note='Identity SQLSTATE expectation refined; final 266 probes passed.'
  elif name in ['browser-extra.log','browser-extra-final.log','browser-extra-revalidated.log','browser-extra-verified.log','browser-extra-complete.log','browser-extra-small-fixture.log','browser-extra-final-verified.log']:note='Early harness attempt; synchronization/coordinates corrected. Off-grid 409 was expected safe behavior. Final aligned drag passed.'
  elif name in ['browser-targeted.log','browser-targeted-revalidated.log']:note='Early targeted attempt; selector/SQL probe corrections documented; product failures reproduced on final run.'
  elif name in ['restore.log','restore-final.log']:note='Harness process-environment/PATH blocker; final full 11-case restore passed.'
  ledger.append(dict(ExecutionID=f'{log.stem}:{n}',Test=entry['name'],Status=entry['status'],Evidence=f'logs/{log.name}:{n}',Scope='Recorded run (may repeat another suite)',Adjudication=note))
for n,x in enumerate(read('syntax-all.json'),1):ledger.append(dict(ExecutionID='syntax:'+str(n),Test=x['check']+' '+x['file'],Status=x['status'],Evidence='evidence/syntax-all.json',Scope='Tracked baseline syntax',Adjudication='Final'))
for n in ['core-additional.log','core-additional-final.log']:
 text=(OUT/'logs'/n).read_text();start=text.find('[\n')
 if start>=0:
  for x in json.loads(text[start:]):ledger.append(dict(ExecutionID=n+':'+x['id'],Test=x['name'],Status=x['status'],Evidence='logs/'+n,Scope='Additional Core executable',Adjudication='L01 reproduced; not a PostgreSQL production defect'))
ledger.append(dict(ExecutionID='swagger:1',Test='Swagger patient details provides required clinic input',Status=read('swagger-header-defect.json')['status'],Evidence='evidence/swagger-header-defect.json',Scope='Schema + actual authenticated request',Adjudication='M05'))
for n in ['baseline-global.log','baseline-feedback.log']:
 ledger.append(dict(ExecutionID=n+':failure',Test='Original browser assertion stopped suite',Status='FAIL',Evidence='logs/'+n,Scope='Original baseline run',Adjudication='Test maintenance: stronger CSRF test / async resize synchronization; corrected full suites passed'))
with (OUT/'TEST_LEDGER.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,lineterminator='\n',fieldnames=['ExecutionID','Test','Status','Evidence','Scope','Adjudication']);w.writeheader();w.writerows(ledger)
(E/'ledger-summary.json').write_text(json.dumps(dict(recorded_assertion_executions=len(ledger),statuses=dict(collections.Counter(r['Status'] for r in ledger)),warning='Repeated suites and superseded harness attempts included; not a unique test or code coverage count.'),indent=2))

lines=['# Test runs, evidence and unsuccessful-attempt adjudication','', 'Application source revision remained unchanged. Original failures are retained even when the test harness was subsequently corrected. Per-assertion outcomes are in TEST_LEDGER.csv; result JSON and raw logs provide richer request/database detail.','', '## Baseline invocations','', '| Suite | Command | Original status | Exit | Seconds | Raw log |','|---|---|---|---|---|---|']
for r in read('baseline-results.json'):lines.append('| '+' | '.join(esc(x) for x in [r['suite'],' '.join(r['command']),r['status'],r['exit_code'],r['duration_seconds'],r['log']])+' |')
lines+=['','## Revalidation and additional execution','', '| Execution | Final outcome | Evidence |','|---|---|---|',
'| Shared-patient full revalidation | PASS: 64 API + 30 browser | logs/global-revalidated.log |',
'| Feedback full revalidation | PASS: 52 browser + database check | logs/feedback-revalidated.log |',
'| API route/method/role matrix | PASS 379/379 | logs/targeted-api.log; evidence/api-matrix-results.json |',
'| Database checks and keys | PASS 46 + 266 | logs/database-probes.log; logs/columns-keys-final.log |',
'| Role/session/security matrix | PASS 76/76 | logs/security-targeted.log |',
'| Complete status matrix | PASS 225/225 | logs/status-matrix.log |',
'| Additional real-DB browser flows | 49 PASS, 11 FAIL | logs/browser-targeted-final.log |',
'| Stored HTML, aligned physical drag, drawer | PASS 3/3 | logs/browser-extra-final-positive.log |',
'| Off-grid pointer drop | Correctly rejected 409, saved visit unchanged | evidence/calendar-off-grid-rejection.json |',
'| API growth measurements | HTTP requests succeeded; measured acceptance failure H01 | logs/performance.log; logs/performance-final.log |',
'| Browser growth measurements | Rendering completed; 20.5s blocking task, H01 | logs/browser-performance.log |',
'| Paired restore and app verification | PASS 11/11 | logs/restore-verified.log |',
'| EF model inspection | PASS no pending changes/migrations | logs/model-audit-reproducible.log |',
'| Extra Core probes | One PASS / one expected exposed FAIL, executable exit 1 | logs/core-additional-final.log |',
'| Production public access | BLOCKED by environment CONNECT proxy 403 | evidence/production-access.json |',
'','## Attempt adjudication','',
'- Original global browser failure: patient POST /data/patients now receives authorization 403 before CSRF. Replaced with a valid booking to isolate stale-token rejection; full revalidation passed.',
'- Original feedback failure: assertion ran before matchMedia resize event completed. Added event-state wait; full suite and 20 further transitions passed.',
'- Initial API-matrix failures: singular /api/patient route classification accidentally included plural /api/patients; anonymous platform login was not a protected role test. Corrected harness; 379 final assertions passed. Independently found a similar real prefix bug in OpenAPI generation (M05).',
'- SQL harness: JSON t/f parsing and identity ALWAYS versus BY DEFAULT SQLSTATE expectations refined. Final 312 independent database assertions passed. Those refinements did not alter constraints.',
'- Browser harness: awaited slot population, disambiguated password-submit buttons, corrected PatientSessions.PatientAccountId probe, and synchronized seeded data. Final source flow completed with failures only for reproduced application findings.',
'- Early drag requests landed off-grid at 10:40 and were rejected safely. Final pointer coordinates produced a valid 10:30 reschedule with version increment and history verification.',
'- Early restore attempts hit local harness /proc access and SDK PATH issues after successful physical restore. Environment construction/SDK activation corrected; final restore passed completely.',
'- Growth helper initially assumed all JSON responses were objects; the next-slot endpoint returns a list. Corrected measurement adapter and retained existing small/large measurements instead of relabelling large data as a small baseline.',
'- The default intermediate targeted-results filename was superseded by catalogue setup. The complete 379 API records were recovered exactly from the preserved JSON-lines log and the API script now uses its own result filename.',
'','## Log inventory','']
for p in sorted((OUT/'logs').iterdir()):lines.append(f'- [{p.name}](logs/{p.name})')
write('TEST_RUNS.md','\n'.join(lines)+'\n')
print('Built appendices;',len(ledger),'recorded assertion executions, including repeats and superseded attempts.')
