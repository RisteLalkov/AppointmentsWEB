# Manual acceptance and visual checklist

The C# rule suite and real HTTP tests have executed successfully. The provided cloud browser could not access the local server. These UI/visual checks are **still to be executed in a real local browser**; they are not marked passed.

## Patient

- Enter as Ana Petrova (Demo). Search by Macedonian name and specialty, clear filters, inspect a profile.
- Choose a future working day for a provider with hours, select a slot, review and confirm. Check reference and status.
- Find the appointment under Upcoming, open details, reschedule to another slot, and cancel it.
- Switch to another patient and confirm the first patient's visits do not appear.
- Try a provider without hours and a secretary-only provider; check the explanatory states rather than fabricated slots.
- Test Dr. Filip Duma's Tuesday-first behavior within the same week.

## Reception and doctor

- Reception: inspect all-doctor calendar, select one doctor, then use day/week/month, Today and date navigation.
- Click a free slot and create an appointment for an existing demo patient.
- Add a fictional patient within the booking flow; verify the selected doctor/date are retained, finish booking and switch to that patient.
- Doctor: select the matching identity, find the same appointment, create a second visit and verify the patient view.
- Open a confirmation-dependent appointment and confirm it. Mark a past confirmed visit completed/no-show when eligible.
- Drag an upcoming visit to a valid slot; confirm. Drag into a conflict/closed hour; verify error and revert. Decline a move and verify original time.
- Add a lunch break, a full-day exception, and an extra Saturday session. Check slot backgrounds and the patient picker.
- Try changing hours so that an existing future booking would fall outside them; expect rejection.
- In explicit standalone JSON Demo mode, test reset in Reception with disposable data. In API mode verify that this reset button is absent.

## Responsive and accessible behavior

- Desktop 1440×900, tablet 768×1024, phone 390×844. Check navigation, page width, tables, calendar controls and dialog scrolling.
- Mobile: open/close sidebar, use day view, book through all steps, view patient cards and edit exceptions.
- Keyboard: Tab through navigation, Enter on actions, visible focus, Escape to close dialogs, restored focus, date/slot selection and confirmation dialogs.
- Use the Appointments list as the keyboard alternative to calendar dragging/cell clicks.
- Check screen-reader labels/status announcements, contrast, 200% zoom, long Cyrillic names, empty/error states and reduced motion.
- Run the browser in a timezone other than Europe/Skopje; confirm displayed/dragged times still match the clinic's timezone.

## Reliability

- Two browser profiles book the same slot simultaneously; one succeeds, the other receives a useful conflict.
- Open appointment details in two windows, change in one, save stale details in the other; expect refresh guidance.
- Stop/restart the app; appointments persist. Source checkout stays clean.
- Disable network access after startup; assets still load locally. No external font/CDN dependency exists.

## Connected backend follow-up

- Run the README Windows setup path, select both startup projects, press F5, and verify the initial administrator signs in.
- Register a new patient; verify booking/reschedule/cancel across reception and doctor sessions.
- In Accounts & access, create a linked normal patient account, convert a demo doctor to password sign-in, disable/re-enable an account, and change your password.
- Check password, registration and account management pages at phone/tablet/desktop widths and with keyboard-only navigation.
- Stop API and verify useful web errors with no JSON fallback; restart and verify data remains.
- Repeat calendar drag/revert with another browser occupying the destination time.
- Validate TLS/cookie behavior with your actual production reverse proxy before deployment.

The automated PostgreSQL suite exercises these server-side behaviors and jsdom workflows. It does not certify visual layouts, interactive Visual Studio installation/setup, browser autofill or pointer dragging.
