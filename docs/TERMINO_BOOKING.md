# Термино: confirmation and agreed appointments

Visible web branding is Термино. Existing configuration keys, cookies, database names,
clinic identities and stored user names are unchanged.

## Doctor confirmation setting

An administrator can use **Шифрарници → Лекари → Измени → Потребна е потврда за
закажување**. It is also available when creating a doctor. New doctors default to
immediate confirmation. Editing a doctor through an older client that omits the
setting preserves its existing value.

The setting controls ordinary new bookings and rescheduling, not the status of
appointments already saved.

## Reception booking an agreed time

In the appointment dialog, reception can choose **Термин договорен со лекар**, select
a date and enter the time the doctor has approved. A service, when configured, still
determines duration; legacy doctors without configured services use their default
visit duration. These appointments are immediately confirmed, including for doctors
who normally require confirmation.

Only the Administrator/reception role can use this option. Patients and doctor-role
accounts cannot bypass schedule availability by submitting the flag directly.
Existing patient and doctor conflicts, absences, future-date limits (180 days),
service eligibility, duration and local-time checks still apply. An agreement can
bypass weekly hours and the Tuesday-first preference, but cannot override an absence.

The appointment and an exact-duration one-off availability period are saved in the
same PostgreSQL transaction, under the existing doctor lock and exclusion constraints.
The one-off period uses `agreed-{appointmentId}` and does not alter weekly hours.
Cancellation removes it atomically; moving to another available time removes the
original period. A failed or repeated booking does not leave duplicate availability.
The booking history and audit record identify its creator; audit action is
`appointment.created.agreed`.

Deploy the full **API and Web** publish output, including Web `wwwroot`, preserving
server settings. No database migration or SQL script is required: confirmation uses
an existing doctor column, and agreed availability uses the existing exceptions table.
