# Термино: confirmation and agreed appointments

Visible web branding is Термино. Existing configuration keys, cookies, database names,
clinic identities and stored user names are unchanged.

## Doctor confirmation setting

An administrator can use **Управување → Лекари → Измени лекар → Потребна е потврда за
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

## Management navigation and views

**Управување** groups doctors and patients, plus specialties and services for reception.
Doctors have one navigation entry with profile, booking, availability, add/edit, active
status and confirmation controls. Existing `#catalogue/doctors` links still open the
full doctor workspace. Doctor-role accounts retain their existing permissions.

Doctor, patient, specialty and service pages offer **Список / Картички**. The preference
is remembered locally by record type; filtering and available actions remain usable
in both layouts. Lists scroll within their own table on narrow screens.

Availability exception submissions disable the form button while pending. The server
rejects the same doctor/date/start/end/type with HTTP 409, regardless of reason text.
The existing transaction and doctor lock prevent duplicates across API instances.
Existing saved duplicates can still be removed with the normal remove action; this
change does not rewrite availability records already stored.

## Overdue confirmation requests and safe schedule edits

Reception and the appointment's own doctor can resolve an overdue **Чека потврда**
request in its details. Once its start has passed they can cancel it; once its end
has passed they can record **Завршен** or **Не се појавил** directly. This is an
explicit reconciliation, not automatic confirmation or expiry. Each resolution
records the previous pending status, new outcome and staff identity in history.
Patients cannot resolve overdue requests, other doctors cannot access them, and
terminal appointments cannot be reopened. Late confirmation remains unavailable.

The weekly hours form submits the revision of the hours originally displayed.
Background refresh cannot update that revision. A conflicting save preserves the
entered values and offers an explicit action to discard them and load the latest
hours. Successful saves advance the form revision so repeated saves remain valid.
Rescheduling opens on the original appointment date in the clinic's time zone.

Publish both API and Web for these changes. No database migration is required.

## Public doctor availability

Doctor profiles show an anonymous, read-only availability preview with a date picker,
seven quick day links, and active service selection. Free times use the same schedule,
service duration, exceptions, booked intervals, Tuesday-first policy, time zone and
180-day horizon as booking. Staff-only doctors, unpublished schedules, unavailable
services and fully booked days have distinct messages. No booking or reservation is
created by viewing times. Availability is checked again during authenticated booking.

The public endpoint returns only the selected date/service and free start/end times.
It excludes patient identities, appointment identifiers, reasons for absences and
account data. Hidden clinics, inactive doctors and service-only profiles are excluded.
Both API and Web must be published. No database changes are needed.

## Public clinic location and contact card

Selecting a clinic shows its public description, an address/phone information card,
a callable phone link when configured, and an address-based Google Maps embed.
The map replaces the generic landing illustration only on clinic profiles; the
public landing page retains its existing artwork. The external **Отвори во Maps**
link searches the same saved address. A missing address shows a clear empty state
without loading a map. No coordinates or fictional contact details are generated.

The iframe is lazy-loaded, requires no application API key, and depends on the
visitor's access to Google Maps. The provider resolves the saved address, so use a
complete street/city address for accuracy; the interface retains an external-link
fallback if the embedded map cannot load. Map requests disclose the public address
and normal browser/network metadata to Google. No patient/account data is included.

Publish Web including its views and wwwroot. No API or database update is required.

For the original main clinic using the legacy single-clinic configuration, public
contact fields are API settings `Tenancy:Address`, `Tenancy:Phone` and
`Tenancy:Description`. Explicit configured clinics use the corresponding fields
under `Tenancy:Clinics`. Managed clinics use the details supplied during platform
registration. The map itself does not change or generate those saved details.

Configured clinics can now become platform-managed through the one-time transfer
button; afterward address/phone edits use `/Platform` just like newly registered
clinics. See [PLATFORM_CLINIC_TRANSFER.md](PLATFORM_CLINIC_TRANSFER.md). The earlier
configuration-field instructions apply only before that adoption.


## Login, session expiry and browser history

Signed-in clinic users opening login or registration are returned to their local
continuation (or the workspace). Authentication pages are excluded as continuations
to prevent redirect loops. Users log out before signing into a different clinic
account. Company login independently checks the platform cookie.
Both flows verify an existing session against the API before redirecting; revoked
sessions clear their matching cookie and show login again. An API outage shows an
error without discarding a valid session. Authenticated API responses with HTTP 401
also remove the corresponding web cookie; HTTP 403 does not sign out the user.

Wrong-role page requests show an access-denied page, rather than redirecting to
login. JSON requests retain their HTTP 401/403 responses. Restoring a document from
the browser's back/forward cache revisits its URL so current authorization applies.
The browser Back button remains available; it cannot keep an obsolete login form
or signed-out workspace active after revalidation.

Account creation dropdowns exclude profiles already linked to an account (including
disabled accounts) and service-only doctor records. Server-side validation remains
the final authority when another administrator creates an account concurrently.

Publish Web including its views and wwwroot. No API update or database migration
is required for these navigation and account-form changes.
