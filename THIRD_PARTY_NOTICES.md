# Third-party components

## FullCalendar Standard 6.1.20

- Project: https://github.com/fullcalendar/fullcalendar
- Versioned standard bundle: https://cdn.jsdelivr.net/npm/fullcalendar@6.1.20/index.global.min.js
- License: MIT (bundled at `src/Appointments.Web/wwwroot/vendor/FullCalendar.LICENSE.md`).
- Used for day/week/month calendar views and interaction/dragging. No premium/resource plugins or commercial scheduler license are used.
- The downloaded standard bundle is committed locally, preserving its copyright header. No CDN is called at application runtime.

FullCalendar and TOAST UI Calendar were compared using their official project documentation. Both offer MIT standard calendar functionality. FullCalendar was selected for its straightforward no-build standard bundle, time-grid/background events, established MVC integration approach and validated/revertible drag callbacks. Resource timelines were deliberately omitted because they are a separately licensed feature. The pinned v6 bundle is stable; evaluate an upgrade to the current major with regression testing before production.

Official references: https://fullcalendar.io/license, https://fullcalendar.io/docs/v6, https://ui.toast.com/tui-calendar, https://github.com/nhn/tui.calendar.

## Microsoft .NET / ASP.NET Core

The application targets the .NET 10 shared framework and uses the packages listed below. .NET and ASP.NET Core are open-source projects under MIT licensing; the installed SDK includes its own third-party notices. Framework licensing: https://github.com/dotnet/runtime/blob/main/LICENSE.TXT and https://github.com/dotnet/aspnetcore/blob/main/LICENSE.txt.

## Other assets

App CSS, favicon and interface illustrations are authored in source. Typography uses system fonts. Unicode interface symbols are text, not an external icon/font package. There are no paid components, remote images, external account requirements or API keys.

Optional development-only DOM checks use jsdom (MIT) and formatting uses Prettier (MIT); neither is required to run the site or bundled in its browser assets. No telemetry or external integrations have been added by the application.

## PostgreSQL backend packages

| Component | Version | License / source |
| --- | --- | --- |
| Microsoft.EntityFrameworkCore.Relational and Design | 10.0.12 | MIT — https://github.com/dotnet/efcore/blob/main/LICENSE.txt |
| Microsoft.AspNetCore.OpenApi | 10.0.12 | MIT — ASP.NET Core repository license above |
| Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL License — https://github.com/npgsql/efcore.pg/blob/main/LICENSE |
| Npgsql (transitive driver) | 10.0.3 | PostgreSQL License — https://github.com/npgsql/npgsql/blob/main/LICENSE |
| PostgreSQL server | 17 (serviced container tag / local install) | PostgreSQL License — https://www.postgresql.org/about/licence/ |
| dotnet-ef (optional development tool) | 10.0.12 | MIT — EF Core repository license above |

NuGet restores package licenses and notices with the packages. None of these application dependencies requires a paid license. Microsoft ASP.NET Core PasswordHasher is part of the shared framework; no proprietary identity service is required. The optional local Compose recipe uses the official PostgreSQL image. The container engine is separately installed software; Docker Desktop has separate terms and is not required because native PostgreSQL is supported.
