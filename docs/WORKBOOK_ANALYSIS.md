# Workbook analysis and source decisions

Input: `Raspored_Doktori_Restrukturiran.xlsx`. The binary source is deliberately excluded from Git. The original-data sheet contains personal telephone numbers; none were copied into the seed, UI or this document.

## All four sheets

| Sheet | Contents | Treatment |
| --- | --- | --- |
| Распоред_Доктори | 46 rows; doctor, category, day, start, end, schedule type, booking method, funding, note | Authoritative normalized schedule source |
| Категории | 33 specialty/category labels | Cross-checked against source values; retained source spelling/combinations |
| Начин_закажување | 9 booking-method labels | Vocabulary reference; actual rows also contain variants |
| Оригинални_податоци | 32 flattened original rows | Reviewed for ambiguities; no direct import or publication |

The 46 clean rows consolidate into **40 profiles**: **38 named providers**, plus unnamed **Дијагностика – РТГ/МНР** and **Офталмологија** services. Duplicate names represent multiple periods for the same provider; they are not separate doctors. There are 87 expanded weekly periods across 25 profiles. Fifteen profiles have no precise bookable hours. The seed retains all 46 clean-sheet source-row references.

## Complete / varied schedules

Schedules are not homogenized. Examples of retained variation:

| Provider | Source schedule |
| --- | --- |
| Др. Ивица Клељонски | Monday–Friday 08:00–15:00 |
| Др. Мирко Крстевски | Tuesday/Wednesday 10:00–13:00 |
| Др. Филип Дума | Tuesday 14:30–19:00; Wednesday 16:00–19:00, Tuesday priority |
| Др. Кирил Петковски | Monday/Wednesday 14:00–20:00; Tuesday/Thursday/Friday 08:00–14:00 |
| Проф. Зафировски | Monday/Wednesday 08:00–12:00; Thursday 12:00–16:00; “new schedule” note retained |
| Др. Наташа Доргут | Monday/Wednesday/Friday 08:00–16:00; Tuesday/Thursday 12:00–20:00 |
| Проф. Мирче Симеонов | Monday/Wednesday 14:00–20:00; Tuesday/Thursday/Friday 08:00–14:00 |
| Гордана Иванова | Wednesday 15:00–17:00; explicitly private only |
| Др. Лидија Дубровска Милетиќ | Monday–Thursday 10:00–14:00 |

Every source row is available in the respective profile/availability view. Normalization expands inclusive day ranges and semicolon-separated lists to `DayOfWeek`. All supplied hours are same-day intervals.

## Incomplete schedules

- Др. Виктор Тевчев: Tuesday–Thursday, but no hours.
- Др. Драган Тантуровски: Monday–Friday, but no hours.
- Др. Зоран Шандуловски: Monday/Friday first shift and Tuesday/Wednesday/Thursday second shift, with no definitions of the shift hours.
- Проф. Анте Поповски: by agreement, possibly Saturday; no time window.
- Јован Нешковски: on call after 14:00; no end time or fixed day.
- Проф. Владо Поповски, Др. Алан Андоновски, Др. Снежана Бонгард, Др. Владимир Михајловски, Горан Кондов, Др. Катерина Адамова, Проф. Илбер Бесими, Проф. Ленче Милошева: on-call/by-request/by-agreement without exact recurring hours.
- Саде Чагри: once monthly, with no date or time.
- Др. Емил Угриновски: secretary-only arrangement; no specialty or hours. Specialty is shown as unspecified.

These remain real source profiles but expose no invented slots. Staff may add an explicit available session or a demonstration weekly schedule. Such changes remain in runtime data, with source information preserved.

## Booking restrictions and ambiguities

- Exact `Директно закажување` is treated as direct/confirmed booking. Other methods conservatively require confirmation after a time is actually made available.
- Entries mentioning `секретарка` require staff booking. Patients can see them and the booking instruction but cannot book/reschedule them directly.
- Daily counts/notification notes (08:00 or 08:30) remain operational notes. There is no simulated notification sending or assertion that a doctor has been contacted.
- Tuesday-first priority is implemented for Dr. Filip Duma within the same week. The source does not specify how far ahead to compare Tuesdays, so cross-week priority is not inferred.
- The original flattened material mentions inconsistent older names/hours (for example, another gastroenterology name and a radiology closing-time variant). The clean sheet wins; no extra doctor or alternate schedule is inferred from flattened column positions.
- `Наведено во изворот` in the funding column is a provenance placeholder, not an eligibility value. The UI marks it unspecified. Explicit fund/private values are preserved.
- No standalone duration, break, holiday, location or explicit date exception is supplied. No patient records are supplied.
- The clean sheet's Monday–Friday ranges are used even when flattened source text says “every day.” Weekends are not added.

## Demonstration-only defaults

Default duration is 30 minutes, configurable independently per doctor. There are no assumed breaks or holidays. The booking horizon is 180 days. Original provider names and specialties are treated as professional directory data as requested, with no personal contact information published. All patient names/emails and sample visits are explicitly fictional. Additional availability and schedule edits in the UI are demonstration overrides, not corrections to the source workbook.
