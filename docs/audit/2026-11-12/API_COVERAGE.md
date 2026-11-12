# API operation inventory and executed boundaries

Generated from the real running API OpenAPI document and request matrix. All documented operations were invoked. A POST boundary check is not a successful CRUD mutation; positive write coverage is supplied by the named integration suites and browser/database cases below. Nonexistent, malformed, version, method and ownership cases are itemized in the assertion ledger.

| Method | Path | Session required | Anonymous | Invalid token | Authorized read | Wrong-role probe | Positive feature evidence |
|---|---|---|---|---|---|---|---|
| GET | `/api/clinics` | False | 200 | — | 200 | — | baseline-platform; discovery contracts/browser; targeted matrix |
| GET | `/health/live` | False | 200 | — | 200 | — | baseline-high/API; targeted matrix; actual restored-host startup |
| GET | `/health` | False | 200 | — | 200 | — | baseline-high/API; targeted matrix; actual restored-host startup |
| GET | `/health/database` | True | 401 | 401 | 200 | — | baseline-high/API; targeted matrix; actual restored-host startup |
| GET | `/api/accounts` | True | 401 | 401 | 200 | 403 | baseline-api/high; feedback browser; global staff boundaries |
| POST | `/api/accounts` | True | 401 | 401 | — | 403 | baseline-api/high; feedback browser; global staff boundaries |
| POST | `/api/accounts/{id}/credentials` | True | 401 | 401 | — | 403 | baseline-api/high; feedback browser; global staff boundaries |
| POST | `/api/accounts/{id}/access` | True | 401 | 401 | — | 403 | baseline-api/high; feedback browser; global staff boundaries |
| GET | `/api/accounts/audit` | True | 401 | 401 | 200 | 403 | baseline-api/high; feedback browser; global staff boundaries |
| GET | `/api/reports` | True | 401 | 401 | 200 | 403 | baseline-api/core; UI DOM/calendar reporting |
| POST | `/api/catalogue/doctors` | True | 401 | 401 | — | 403 | baseline-api/core/high; round2 catalogue browser |
| POST | `/api/catalogue/specialties` | True | 401 | 401 | — | 403 | baseline-api/core/high; round2 catalogue browser |
| POST | `/api/catalogue/services` | True | 401 | 401 | — | 403 | baseline-api/core/high; round2 catalogue browser |
| GET | `/api/bootstrap` | True | 401 | 401 | 200 | — | baseline-high/API; targeted matrix; actual restored-host startup |
| GET | `/api/appointments` | True | 401 | 401 | 200 | — | baseline-api/core/round2; browser complete booking; range/ownership/history |
| POST | `/api/appointments` | True | 401 | 401 | — | — | baseline-api/core/round2; browser complete booking; range/ownership/history |
| GET | `/api/appointments/{id}/history` | True | 401 | 401 | 200 | — | baseline-api/core/round2; browser complete booking; range/ownership/history |
| GET | `/api/slots` | True | 401 | 401 | 200 | — | baseline-api/core/booking/round2; bounds and next-slot summary |
| GET | `/api/availability/days` | True | 401 | 401 | 200 | — | baseline-api/core/booking/round2; bounds and next-slot summary |
| GET | `/api/availability/next` | True | 401 | 401 | 200 | — | baseline-api/core/booking/round2; bounds and next-slot summary |
| GET | `/api/exceptions` | True | 401 | 401 | 200 | — | baseline-api/core/booking/round2; stale schedule and duplicate exceptions |
| POST | `/api/appointments/{id}/move` | True | 401 | 401 | — | — | baseline-api/booking; cross-host race; physical pointer drag |
| POST | `/api/appointments/{id}/status` | True | 401 | 401 | — | — | 225-case real API/database transition matrix; browser confirm/cancel |
| GET | `/api/patients/{id}` | True | 401 | 401 | 200 | — | baseline-api; round2; contact/number/ownership tests; stored-HTML browser |
| POST | `/api/patients/{id}` | True | 401 | 401 | — | — | baseline-api; round2; contact/number/ownership tests; stored-HTML browser |
| POST | `/api/patients` | True | 401 | 401 | — | 403 | baseline-api; round2; contact/number/ownership tests; stored-HTML browser |
| POST | `/api/schedule/{doctorId}` | True | 401 | 401 | — | — | baseline-api/core/booking/round2; stale schedule and duplicate exceptions |
| POST | `/api/exceptions/{doctorId}` | True | 401 | 401 | — | — | baseline-api/core/booking/round2; stale schedule and duplicate exceptions |
| POST | `/api/exceptions/{id}/remove` | True | 401 | 401 | — | — | baseline-api/core/booking/round2; stale schedule and duplicate exceptions |
| POST | `/api/auth/register` | False | 400 | — | — | — | baseline-api/global/high; security lockout/expiry; browser settings |
| GET | `/api/auth/me` | True | 401 | 401 | 200 | — | baseline-api/global/high; security lockout/expiry; browser settings |
| POST | `/api/auth/logout` | True | 401 | 401 | — | — | baseline-api/global/high; security lockout/expiry; browser settings |
| POST | `/api/auth/password` | True | 401 | 401 | — | — | baseline-api/global/high; security lockout/expiry; browser settings |
| GET | `/api/auth/demo-users` | False | 404 | — | 404 | — | baseline-api/global/high; security lockout/expiry; browser settings |
| POST | `/api/auth/demo-login` | False | 400 | — | — | — | baseline-api/global/high; security lockout/expiry; browser settings |
| GET | `/api/public/clinics` | False | 200 | — | 200 | — | baseline-platform; discovery contracts/browser; targeted matrix |
| GET | `/api/public/clinics/{id}` | False | 200 | — | 200 | — | baseline-platform; discovery contracts/browser; targeted matrix |
| GET | `/api/public/doctors` | False | 200 | — | 200 | — | baseline-platform; discovery contracts/browser; targeted matrix |
| GET | `/api/public/clinics/{clinicId}/doctors/{doctorId}/availability` | False | 200 | — | 200 | — | baseline-platform; discovery contracts/browser; targeted matrix |
| GET | `/api/public/clinics/{clinicId}/doctors/{doctorId}` | False | 200 | — | 200 | — | baseline-platform; discovery contracts/browser; targeted matrix |
| POST | `/api/auth/login` | False | 400 | — | — | — | baseline-api/global/high; security lockout/expiry; browser settings |
| GET | `/api/patient/home` | True | 401 | 401 | 200 | 403 | global-revalidated; round2; real browser registration/join/home |
| GET | `/api/patient/clinics` | True | 401 | 401 | 200 | 403 | global-revalidated; round2; real browser registration/join/home |
| POST | `/api/patient/clinics/{clinicId}` | True | 401 | 401 | — | 403 | global-revalidated; round2; real browser registration/join/home |
| POST | `/api/platform/login` | False | 400 | — | — | — | baseline-platform; global revalidation; browser company recovery; API adoption |
| GET | `/api/platform/clinics` | True | 401 | 401 | 200 | 401 | baseline-platform; global revalidation; browser company recovery; API adoption |
| POST | `/api/platform/clinics` | True | 401 | 401 | — | 401 | baseline-platform; global revalidation; browser company recovery; API adoption |
| POST | `/api/platform/clinics/{id}/adopt` | True | 401 | 401 | — | 401 | baseline-platform; global revalidation; browser company recovery; API adoption |
| POST | `/api/platform/clinics/{id}/details` | True | 401 | 401 | — | 401 | baseline-platform; global revalidation; browser company recovery; API adoption |
| GET | `/api/platform/patients` | True | 401 | 401 | 200 | 401 | baseline-platform; global revalidation; browser company recovery; API adoption |
| POST | `/api/platform/patients/{id}/password` | True | 401 | 401 | — | 401 | baseline-platform; global revalidation; browser company recovery; API adoption |
| POST | `/api/platform/password` | True | 401 | 401 | — | 401 | baseline-platform; global revalidation; browser company recovery; API adoption |
| POST | `/api/platform/logout` | True | 401 | 401 | — | 401 | baseline-platform; global revalidation; browser company recovery; API adoption |

Additional routes/assets: `/swagger`, `/swagger/index.html`, local Swagger CSS/JS and `/openapi/v1.json` were exercised by the baseline API suite. MVC `/data` proxies, Account, PatientClinics, Accounts, Platform and Preferences are recorded separately in source route declarations and browser/HTTP tests. The raw source declaration inventory is `evidence/route-declarations.json`.

**Known documentation failure:** GET/POST `/api/patients/{id}` and POST `/api/patients` omit X-Clinic from their schema. `swagger-header-defect.json` records 400 without selection versus 200 with selection. Positive mapping above identifies suite-level evidence; it does not assert a separate successful manual Swagger mutation for each operation.
