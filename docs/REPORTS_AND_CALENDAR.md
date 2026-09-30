# Calendar and reports

The calendar is wider and taller, with working-schedule details collapsed below it. Staff retain day/week/month, event details, creation, cancellation and validated drag rescheduling. Administrators can combine doctor, specialty, existing service-profile and status filters. The custom period form accepts 1–31 inclusive days; previous/next moves by that period. Doctors remain restricted to their own calendar. Availability highlights still require selecting a provider; all-provider views show matching bookings.

## Reports

Administrators open **Извештаи**. Choose inclusive start/end dates (maximum 366 days), day/week/month grouping, doctor/profile, specialty and service. Today/week/month shortcuts and filter reset are provided. The summary, timeline and period/provider/specialty/service tables share the same server-calculated data. CSV exports the selected table with dates, filters, timezone and capacity caveat. It contains aggregate counts, not patient names/contact data. Spreadsheet formula prefixes are escaped.

`GET /api/reports?from=2026-09-01&to=2026-09-30&groupBy=day` is administrator-only. Optional query fields: `doctorId`, `specialty`, `serviceId` (an existing service-profile ID or `unassigned`). The MVC proxy is `/data/reports`. Invalid dates/grouping/filter identifiers are rejected; empty matching combinations return zero totals. The API reads one repeatable-read PostgreSQL snapshot. Demo mode uses the same Core reporting calculations. No database migration is required.

## Definitions and limitations

- Date membership uses the appointment START date in the configured clinic timezone. Both endpoint dates are included. Statuses are current statuses, not historical snapshots of status at a past date. Rescheduled visits appear on their current date.
- Total appointments includes scheduled, confirmed, completed, cancelled and no-show. Individual status counts are separate.
- Cancellation percentage = cancelled / all appointments. It is zero for an empty result.
- No-show percentage = no-show / (completed + no-show). It is undefined (displayed as —) before any of those outcomes exist.
- Patients in period = distinct patients with matching appointments, including cancellations. Registered patients is the current clinic-wide total, unaffected by report filters. Counts of distinct patients across table rows must not be added together.
- Day/week/month tables include zero periods. Weeks begin Monday; endpoint weeks/months may be partial.
- **Estimated utilisation** = occupied minutes inside reconstructed capacity / reconstructed capacity minutes. All non-cancelled appointments, including no-shows, consume reserved time. Available slots are reconstructed using CURRENT weekly schedules, current appointment duration and saved dated exceptions. Complete slot intervals are merged to avoid counting overlapping additions twice. DST-invalid/ambiguous intervals are omitted consistently with booking rules. Tuesday-first release preference does not reduce physical capacity.
- There are no historical schedule snapshots. Historical utilisation is therefore an estimate, not a historical capacity audit. Booked time outside today's reconstructed schedule is disclosed separately. A zero-capacity denominator displays —. Cancellations free capacity.
- **Service grouping uses the existing `Doctor.IsService` profiles.** Bookings against named doctors have no independent service ID and are explicitly grouped under **Без заведена услуга**. No service is inferred from specialty. A future service catalogue/doctor-service relationship is still needed for detailed per-examination reporting. Doctor/profile and specialty descriptions likewise reflect current stored metadata.
- Reports are on-demand snapshots: submit again to refresh. No background report scheduler, delivery or notifications are implied.

## Deployment

Pull main, rebuild and publish BOTH Appointments.Api and Appointments.Web. Preserve server connection strings, API URL and hosting flags. Ensure the Web publish includes `wwwroot/js/app.js` and `wwwroot/css/site.css`; refresh the browser with Ctrl+F5. Existing patient/appointment data is preserved. No database reset, re-import or migration is needed.

The booking request-ID generator now supports intranet HTTP browsers that lack `crypto.randomUUID`, using `crypto.getRandomValues`. HTTPS remains the production deployment target.
