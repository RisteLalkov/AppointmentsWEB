# Production readiness audit — 2 November 2026

Audited application snapshot: `fcf2a0a`. **Assessment: not ready for an unrestricted public production launch.** There are 22 findings: 7 High, 9 Medium and 6 Low. No Critical issue was demonstrated; inaccessible production infrastructure remains unverified.

- [Read the full report](PRODUCTION_READINESS_AUDIT.md), including reproduction steps, exact source locations, recommended fixes, coverage and deployment verification gaps.
- [Download the printable 39-page PDF](PRODUCTION_READINESS_AUDIT.pdf).
- [Standalone HTML copy](PRODUCTION_READINESS_AUDIT.html), suitable for opening locally or printing.
- [Structured findings](findings.json), [summary](audit-summary.json) and [sanitized evidence](evidence/).

The audit exercised local Web → API → real PostgreSQL workflows, concurrency and fault scenarios, schema constraints, published output and paired backup/restore. It did **not** inspect the live server's database, IIS configuration, TLS or production permissions.

This directory contains documentation and evidence only. Application source and live data were unchanged. Private test credentials, tokens, cookies and database backups are excluded.
