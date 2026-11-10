# Tester feedback — 10 November 2026

Resolutions for the nine observations in “КК-04-ФР-122 Извештај од тестирање”, supplied by the company tester. Patient deletion was explicitly excluded by the product owner.

| Observation | Resolution |
| --- | --- |
| American date format | Shared date controls display `DD.MM.YYYY` in both languages, retain native calendar pickers, and submit the original ISO dates. Typed dates are validated strictly, including leap years, required values and minimum/maximum bounds. Numeric phone entry inserts the separators. Invalid text clears the previous date instead of silently using it. |
| “Поврзано” is unclear | Removed the technical indicator from ordinary workspaces. The explicit training-mode label remains in demonstration sessions. |
| Same-name patients cannot be identified clearly | Permanent clinic-scoped numbers, such as `PT-000001`, are allocated by PostgreSQL. Numbers appear in lists, cards, profiles, booking choices, review and appointment details. Patient search includes the number; booking choices also include available contact details. |
| Patient deletion | Unchanged, as requested. No deletion, archival or merging feature was added. |
| Specialties always display Active | Removed the specialty status column, badges and irrelevant deactivation explanation. Services retain their genuine activation state. |
| Report group names overlap totals | Gave the first column a defined width, wrapped long labels, preserved separate numeric columns and kept the table horizontally scrollable. CSV data and calculations are unchanged. |
| Mobile navigation cannot be dismissed | Added a visible close button, outside-tap backdrop, Escape support, contained keyboard focus, background interaction protection, navigation dismissal and cleanup when resizing to desktop. |
| Account creation success is too subtle | Added a persistent green success panel with an icon, heading, account name/email and focus after redirect. Text contrast is checked in Standard, Dark and Vibrant. |
| Existing accounts need filtering | Added case-insensitive name/email search, role/access filters, result counts, explicit empty states and 20-row pagination. Access/credential updates preserve the list URL and filters. Linked-profile eligibility still considers all accounts, including other pages. |

## Deployment

Both API and Web must be published. Run the regular API `--migrate` maintenance command before restarting the hosts. The patient-number migration backfills the existing clinic schemas and preserves record links. No reset or preview seeding is needed. See [database instructions](DATABASE.md#patient-numbers-10-november-2026).

## Verification

The changes are verified using local, disposable PostgreSQL databases and browser fixtures, with no production data access. Regression suites cover core scheduling/persistence, Web forms, API and database constraints, two-instance operation, clinic isolation, platform provisioning, localization and account settings.

New coverage includes legacy same-name patient backfill, repeated migrations, concurrent sequence allocation in two clinic schemas, immutable numbers during contact updates, strict date validation in both languages, actual native-calendar opening, complete booking through Web/API/PostgreSQL, report label boundaries, phone navigation, account filtering/pagination, success-message contrast and 320px layouts.

Final local results:

| Suite | Result |
| --- | --- |
| Release solution build | Passed; no warnings or errors |
| EF model versus latest migration | No pending model changes |
| Core scheduling and persistence | 95 passed |
| Date-control validation, Macedonian and English | 42 passed |
| Existing DOM workflows | 85 passed |
| MVC HTTP checks | 38 passed |
| Discovery/company MVC contract checks | 89 passed with a stub API |
| PostgreSQL/API/MVC integration | 125 passed, plus direct database constraint and legacy-upgrade checks |
| Patient-number upgrade and concurrent allocation | Passed in two separate clinic schemas, with 12 parallel inserts per schema |
| Multi-tenant isolation | 75 passed, plus 12 tenant DOM checks |
| Platform provisioning/discovery | 103 passed |
| Published high-severity/security regressions | 65 passed |
| Published tester-feedback browser workflows | 52 passed, plus server verification that contact updates cannot change patient numbers |
| Published account-settings browser workflows | 75 passed |
| Published theme browser workflows | 40 passed |
| Published language browser workflows | 55 passed |

The focused browser suite uses Chromium with a US browser locale to verify the day-first fields, including 390px and 320px phone viewports. Physical iPhones/Android devices and Safari were not exercised locally. The suite also checks that partially typed dates keep focus, that completed history filters apply correctly, and that invalid entries can still open the native calendar.

Re-run the focused end-to-end suite with a disposable test coordinator and installed Chromium/Playwright:

```sh
python tests/tester_feedback_integration.py
```

It requires `CARELINE_TEST_CONNECTION` with a test/integration database name, `NODE_PATH` for Playwright, and `TEST_BROWSER_EXECUTABLE`. It creates isolated test roles/databases and removes them when finished. `tests/frontend/dates.mjs` runs as part of the normal frontend checks. The PostgreSQL and browser regressions are included in CI.
