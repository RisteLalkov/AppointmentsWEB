# Една пациентска сметка за сите клиники

Верзија: 10 ноември 2026. Важи за API/PostgreSQL; изолираниот Development JSON demo останува непроменет.

## Како работи за корисниците

1. Пациентот се регистрира еднаш, со име, е-пошта и лозинка. При регистрацијата се избира првата клиника, како досега.
2. Истата најава важи за сите клиники. Не се регистрира нова сметка за друга клиника.
3. Од **Мои клиники** пациентот ги гледа своите претстојни термини во сите достапни клиники. Со **Отвори клиника** го отвора постојниот работен простор за таа клиника.
4. Ако избере лекар од друга клиника на јавната страница, прво потврдува дека сака пациентски профил во таа клиника. Избраниот лекар, датум, време и услуга се пренесуваат во закажувањето. Прегледувањето на страница само по себе не создава профил или термин.
5. Секоја клиника има свој пациентски профил, број на пациент и историја. Клиниката ги гледа само своите записи. Нема пристап до термините или податоците од друга клиника.
6. Постоен контакт внесен по телефон **не се поврзува автоматски** само затоа што има иста е-пошта. Непроверена е-пошта не е доказ за идентитет. Новата регистрација или приклучување создава независен профил; стариот запис и неговата историја остануваат приватни. Постоечка вистинска пациентска *сметка со лозинка* се надградува со нејзината веќе утврдена врска до профилот.

Работното време, услугите, согласените термини, потврдувањето, статусите, историјата, извештаите и останатите работни екрани ги задржуваат своите правила. Пациентот не може да има преклопени активни термини ни во различни клиники. Ограничувањата за број на самостојно закажани термини остануваат по клиника.

## Рецепција и лекари

- Вработената сметка останува во **точно една клиника**. Нема избор на друга клиника за рецепционер или лекар. Истата е-пошта не може повторно да се употреби за друга вработена сметка или пациентска најава.
- **Сметки и пристап** создава само лекарски и администраторски сметки. Опцијата за создавање/поврзување пациентска сметка е отстранета и од формата и од API.
- Рецепцијата сè уште внесува пациенти, уредува локални контактни податоци и закажува по телефон. Пациент не мора да има онлајн сметка за да добие термин преку рецепција.
- Кај пациентските сметки рецепцијата може да го овозможи/оневозможи **само пристапот до својата клиника**. Ова не ја менува личната лозинка и не блокира друга клиника. Повторно приклучување не ја заобиколува забраната.
- Клиника што не прима нови онлајн пациенти не дозволува прво приклучување. Веќе приклучен пациент продолжува да има пристап ако клиниката и неговото локално членство се овозможени.
- Промената на име/е-пошта во локалниот пациентски контакт не ја менува личната е-пошта за најава.

## Лозинки и поддршка

Пациентот ја менува својата лозинка преку постојната **Промени лозинка**, со внесување на тековната. Новата лозинка важи насекаде и ги одјавува сите негови сесии.

Заборавена пациентска лозинка ја обновува **компаниската поддршка**, не рецепцијата. По компаниска најава во `/Platform`, отворете **Пациентски сметки** (`/PatientSupport`), пребарајте ја точната е-пошта, потврдете го идентитетот преку доверлив канал и поставете нова лозинка. Предадете ја приватно. Се запишува операторот што ја извршил промената и се одјавуваат сите пациентски сесии. Екранот не прикажува клиничка историја. Не е додаден сервис за е-пошта или автоматска проверка на идентитет.

Вработените и понатаму добиваат помош со своите локални лозинки од рецепцијата/администраторот.

## Објавување на серверот — потребно за оваа верзија

Не треба нова база, бришење податоци или повторно генерирање тест-податоци.

1. Повлечете ја најновата верзија од `main`. Направете резервни копии на **целите** `appointments` и `appointments_platform` бази.
2. Запрете ги Web и API во IIS, на сите инстанци што ја користат истата база.
3. Објавете ги **двата** проекти од истата верзија. Може со десен клик → Publish како досега. На серверот пренесете го целиот publish output, со сите DLL, статички ресурси и папката `database`. Зачувајте ги серверските `appsettings`/connection strings, истиот `Hosting:WebProxyKey`, и поставките за домени/HTTPS.
4. Во објавената API папка мора да постојат `database/008-identity-directory.sql` и **`database/009-global-patients.sql`**, покрај останатите SQL датотеки.
5. На **серверот со API/Web**, отворете PowerShell во вистинската API publish папка. За досегашната патека:

   ```powershell
   Set-Location C:\inetpub\AppointmentsAPI
   dotnet .\Appointments.Api.dll --migrate
   if ($LASTEXITCODE -ne 0) { throw "Надградбата не успеа. Не ги стартувајте апликациите." }
   ```

   Командата се поврзува со базите од серверските API поставки, вклучувајќи ги продукциските ако тие се конфигурирани. Не користете `--clinic`: надградете ги сите регистрирани активни клиники заедно. Не извршувајте само EF SQL скрипта во DBeaver: потребни се и заедничките SQL функции, тригерите и преносот на постоечките пациентски сметки.
6. Почекајте успешно завршување, па стартувајте API и Web. Ако има грешка, оставете ги запрени и зачувајте ја целата порака. Нормалното стартување намерно одбива нецелосна надградба.
7. Пациентите со старите локални сесии се најавуваат повторно со истата лозинка. Проверете регистрација, приклучување кон втора клиника, закажување, рецепциска изолација и **Мои клиники**.

`appointments_platform` останува потребна за компанијата и регистарот на клиники. Оваа верзија нема нова platform миграција. Сите клинички шеми и пациентските лични сметки остануваат во постојната **appointments** база. Не се менуваат имиња на бази, корисници или лозинки за PostgreSQL.

## Technical design

The shared credential store is **`appointments.careline_identity`**, alongside the existing identity directory. Keeping it in the same database as all clinic schemas makes registration, membership creation and appointment busy-interval updates atomic transactions. It does not introduce another database or move clinical records into the platform database.

| Storage | Purpose |
| --- | --- |
| `careline_identity.PatientAccounts` | One normalized email, password hash, lockout state and default clinic per patient identity |
| `careline_identity.PatientSessions` | Hashed opaque patient tokens, two-hour expiry, central revocation |
| `careline_identity.PatientMemberships` | Identity → clinic/local account/local patient/number; unique per identity and clinic |
| `careline_identity.PatientEvents` | Registration, successful sign-in, personal password change and operator password-reset audit; no passwords or contact-history snapshots |
| `careline_identity.PatientBookings` | Only identity, clinic, appointment ID and UTC busy interval for active appointments; exclusion constraint prevents concurrent overlaps |
| Clinic `Accounts.GlobalPatientId` | Nullable FK to shared patient identity; linked patient membership has no local password |
| Clinic `Patients`, `Appointments`, history, catalogues, schedules | Existing local clinical records and permissions |
| `appointments_platform` | Existing company operators, sessions, clinic registry and provisioning |

`009-global-patients.sql` installs shared objects once. EF migration `20261110131050_GlobalPatientMemberships` upgrades each clinic. Full API maintenance adopts non-demo local patient logins, clears their old local password hashes, revokes their old `c1.` sessions, and installs/rebuilds appointment-busy triggers. The upgrade preserves established local profile IDs/numbers. It deliberately refuses conflicting legacy login identities rather than merging histories by email. No automatic merge/reset or production data mutation occurs during development of this change.

Staff sessions retain `c1.<clinic>.` tokens. Company sessions retain `p1.` tokens and a separate scheme. Shared patient sessions use `u1.` tokens. A patient clinical request still requires server-resolved `X-Clinic` plus a live enabled membership whose account, patient and shared identity agree. A global token alone never grants another clinic's private data. Personal home/password/logout work without an active clinic. Joining/selecting is an explicit authenticated antiforgery-protected MVC POST; GET remains read-only.

The shared identity write lease and SQL email triggers reserve one login namespace. Per-patient PostgreSQL advisory locks serialize concurrent joins, password changes and session creation/revocation across API instances. A shared GiST exclusion plus local appointment triggers rejects simultaneous overlapping visits across clinics; the normal scheduler receives anonymous busy intervals as internal inputs only. Other clinic records are not returned to staff or persisted into the local appointment list. Local optimistic concurrency, idempotency and doctor/patient exclusion constraints remain in place.

The existing HTTPS, proxy-key, cookie, stale-workspace and antiforgery protections continue to apply. There is no browser localStorage token, external authentication provider, new runtime package, or cross-clinic staff permission.

## Verification

`tests/global_patients_integration.py` uses generated disposable databases with ordinary database-owner roles, two API processes and optional real Chromium/MVC flows. It covers legacy password/profile adoption, repeated maintenance, identity uniqueness, concurrent joins/signups/bookings, cross-clinic record isolation, local disabling, closed registration, contact-email non-claiming, central lockout, self/service password recovery, token-scheme separation and session revocation. Its browser companion checks public-slot continuation, explicit consent, clinic switching, stale tabs/CSRF, aggregate privacy, English, 320px layout and staff account restrictions. CI runs it against complete published API/Web outputs. These are isolated test databases; no deployed database is inspected or changed by the suite.
