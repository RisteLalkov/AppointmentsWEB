# Interface languages and icons

Macedonian (`mk-MK`) is the default on every first visit, including browsers configured in English. The **Јазик / Language** control sits next to **Изглед / Appearance** at the bottom of the workspace and public, account and company pages. The flag buttons select Macedonian or English (`en-GB`).

## Behaviour

- The choice is saved for a year in the host-only, HttpOnly `MedTermin.Language` preference cookie. It follows navigation, sign-in and new tabs on the same hostname. It does not change account permissions, clinic selection or database records.
- Switching reloads the page in the selected language and preserves its path, query and fragment. Unsaved form input prompts before reloading. Theme selection is independent.
- Navigation, forms, dialogs, calendars, status labels, reports/CSV headings, validation and service errors support both languages. English uses Monday-first weeks and 24-hour times, preserving clinic time-zone scheduling rules.
- Clinic-entered names, specialties, services, addresses, descriptions and notes retain their original spelling. The МедТермин brand remains unchanged. The legacy empty-funding sentinel has a translated display label.
- Browser/OS date and time popup widgets can use the browser's own language. Configuration, logs, API property names, enum values, routes and database identifiers remain invariant.

## Implementation and maintenance

`Appointments.Core/Localization/en.json` is the canonical English catalogue, embedded in Core and shared by Web/API. Explicit C# literals use `UiText.T`; domain `RuleException` messages use the current request language. Web uses only the language cookie to select request culture, while its API client forwards `Accept-Language`. API requests support `mk-MK` and `en-GB`, defaulting to Macedonian.

Razor uses `T(...)`. Browser text uses `MedTerminI18n.t(...)` and the `html` template helper for static markup fragments. Dynamic interpolated record values retain their caller-provided escaping and are never scanned or translated. Do not pass database names or enum/protocol values through translation helpers. Use `{0}` parameters for variable messages and preserve placeholders in both languages.

After adding/editing English entries, run:

```sh
python scripts/build-localization.py
```

This generates `wwwroot/i18n/en.js`; CI verifies the browser copy matches Core. Only English pages load that catalogue. Translation and icons require no external runtime requests or libraries.

Navigation, actions, menu controls and status graphics use the bundled Lucide sprite at `wwwroot/icons/interface.svg`, with consistent sizing and `currentColor`. Decorative icons are hidden from assistive technology; buttons keep textual accessible labels. Flags are SVG artwork, avoiding emoji/font differences on phones. Lucide's ISC/Feather MIT notices are included in `wwwroot/icons/Lucide.LICENSE.txt`. Existing brand artwork is preserved.

## Deployment

Pull `main`, build, then publish **both API and Web**, including every Web `wwwroot` asset and complete publish output. Preserve server appsettings, database credentials, the matching Web/API proxy key and existing hosting settings. Recycle both IIS application pools. This update requires **no database migration, reset or import**. Refresh with Ctrl+F5 if assets are stale.

## Verification

- Core checks translated validation/errors, placeholders, unchanged record values and concurrent culture isolation.
- MVC contract checks cover the default language, preference cookie, request forwarding, Cyrillic search/return URLs, CSRF and off-site redirect rejection.
- DOM checks cover literal-only translation, original data escaping, password controls, validation and unsaved-input protection.
- Chromium exercises both languages, doctor/patient/reception workspaces, booking, cancellation, public discovery/availability, company forms and independent authentication cookies. Layout checks cover 320/390px screens and all three themes.
- Disposable PostgreSQL/API checks verify translated permission/conflict responses, concurrent request cultures, unchanged stored records and stable protocol roles.

Run the usual solution/Core, MVC, frontend and PostgreSQL suites. `tests/frontend/localization-browser.cjs` needs Playwright and Chromium; `tests/discovery_web_smoke.py` adds public/company browser coverage when `TEST_BROWSER_EXECUTABLE` is set. No production database is used by these checks.
