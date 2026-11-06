# МедТермин — user guides / прирачници за користење

Two complete, nontechnical editions of the same user guide:

| Language / Јазик | Word | PDF | Editable source |
| --- | --- | --- | --- |
| Македонски | [Прирачник за користење](MedTermin-User-Guide-MK.docx) | [PDF](MedTermin-User-Guide-MK.pdf) | [Markdown](MedTermin-User-Guide-MK.md) |
| English | [Complete user guide](MedTermin-User-Guide-EN.docx) | [PDF](MedTermin-User-Guide-EN.pdf) | [Markdown](MedTermin-User-Guide-EN.md) |

Both editions cover visitors, patients, doctors, receptionists/clinic administrators, and company administrators. They explain navigation, public search, booking, all five appointment statuses, rescheduling, calendars, schedules and exceptions, patient profiles, login accounts, services, reports, clinic registration, personal settings, conflicts, and common problems. Each contains 32 chapters, clickable contents, practical examples, and 12 screenshots.

Двете изданија ги објаснуваат сите кориснички улоги, навигацијата и секојдневните постапки. Содржат 32 поглавја, содржина со врски, практични примери и 12 слики од интерфејсот. Сликите се на македонски, првичниот јазик на апликацијата.

Reviewed against application commit `9c83651` on 6 November 2026. The deployed website may differ until updated. Screenshots were captured from local demonstration/example hosts; they contain no production patient information or working credentials. No production database was accessed or changed to prepare these documents.

## Updating the guides

Edit the corresponding Markdown files and keep the two language editions aligned. The screenshots are in `screens/`; the cover workflow diagrams are generated into `assets/`.

With Python, `python-docx`, Pillow, and DejaVu fonts installed, run from this directory:

```sh
python3 build_guides.py
```

The builder uses only these documentation files. It does not start the application or connect to a database. Optional `pages-en.json` and `pages-mk.json` maps can override the checked contents-page numbers after substantial edits. Word can also refresh the page fields. Re-render and inspect both editions after any change.

To generate matching PDFs with LibreOffice:

```sh
soffice --headless --convert-to pdf --outdir . MedTermin-User-Guide-EN.docx MedTermin-User-Guide-MK.docx
```

The delivered PDFs were checked at 48 A4 pages each. Pagination in Word can vary with installed fonts and printer settings. This guide describes user operations; the older technical system guide in `docs/print/` serves a different purpose.
