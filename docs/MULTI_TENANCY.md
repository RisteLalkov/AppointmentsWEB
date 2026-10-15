# Multiple clinics on one Careline deployment

One Web and API deployment now serves all clinics in **one PostgreSQL clinical
database**, with a separate schema per clinic. The optional platform database
remains separate. Database-per-clinic routing and the finite clinic database pool
have been replaced.

See [shared database setup, existing test deployment, isolation and verification](SHARED_DATABASE.md)
for the current configuration and migration commands.

Login still resolves the clinic from credentials. Patient registration selects its
intended clinic; accounts and patient profiles are clinic-local. Globally unique
sign-in emails, role checks, protected MVC cookies, clinic-bound bearer sessions,
stale-tab checks and antiforgery tokens continue to enforce clinic boundaries.

Company operators use `/Platform`; clinic administrators cannot create clinics or
access platform administration. Operator-configured clinics use `Tenancy:Clinics`
with the common `ConnectionStrings:Appointments`. Clinical migration history and
timezone settings are stored separately in each clinic schema. Disabling a clinic
preserves its data and rejects its sessions until it is re-enabled.

The standalone JSON demo remains a single-clinic Development sandbox. Shared
database multi-tenancy requires the API/PostgreSQL backend.
