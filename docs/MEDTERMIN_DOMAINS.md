# МедТермин: name and domain deployment

The visible product name is **МедТермин**, with the public domain **medtermin.mk**.
The existing company symbol and CODEX credit remain unchanged. Project/assembly
names, clinic IDs/schemas, cookie identifiers, browser preferences and database
names keep their existing values so this release requires no data migration.
Stored account names are user data and are not silently renamed.

## Intended entry points

| Host | Root behavior | Application |
|---|---|---|
| `medtermin.mk` | `/` → `/Discover` | Public website / Appointments.Web |
| `app.medtermin.mk` | `/` → `/Workspace`, which requires clinic sign-in | Clinic workspace / Appointments.Web |
| `admin.medtermin.mk` | `/` → `/Platform`, which requires company sign-in | Company platform / Appointments.Web |
| `api.medtermin.mk` | Existing API routes; `/swagger` for API documentation | Appointments.Api |

These are entry points to the existing routes, not four new codebases. All three
Web hostnames can bind to the same Web deployment. The API binds separately. On
localhost and existing intranet addresses the current root behavior is preserved.
Hostnames are not an authorization boundary: clinic and platform permissions remain
checked by their existing session policies regardless of the hostname used.

Redirects remain relative to the current host. A public doctor booking continuation
stays on that host through login and booking, instead of losing its clinic/doctor
selection in a cross-host redirect. Cookies remain host-only; this release does not
introduce shared subdomain cookies or cross-host single sign-on. A user may need to
sign in separately when opening another Web hostname.

## One-time infrastructure setup (not performed from this checkout)

1. Ask IT to point all four hostnames to the appropriate reachable server or reverse
   proxy. Public DNS normally needs a public/reachable endpoint, not a private
   `10.x` LAN address. Confirm the intended internal/external access with IT.
2. Configure IIS HTTPS bindings for the three Web names on the Web site, and
   `api.medtermin.mk` on the API site. Use certificates that cover the exact hosts.
   A `*.medtermin.mk` wildcard does not cover the bare `medtermin.mk` domain.
3. Merge the names into the server's existing `AllowedHosts` values. Preserve any
   intranet hosts still needed for testing. Repository defaults now allow the
   appropriate new hostnames plus localhost; an existing server configuration
   override must be updated separately.
4. Set the Web server's `Backend:ApiBaseUrl` to the reachable HTTPS API address,
   normally `https://api.medtermin.mk/`. Confirm the Web server itself can resolve
   and reach that address. The browser still calls Web `/data` endpoints; no CORS
   wildcard or browser database/API credentials are needed.
5. After HTTPS works end to end, use `Hosting:AllowHttpForTesting=false` on API and
   Web. Keep `Demo:Enabled=false`, normal connection strings and current clinic
   settings. Follow your actual IIS/proxy forwarding and certificate setup.
6. Publish the complete API and Web outputs, preserving server-specific settings
   and protected keys. Include Web `wwwroot` and every API dependency DLL. This
   branding release needs no SQL scripts or `--migrate` run.
7. Test each host root, public doctor/clinic pages, sign-in/booking, platform
   sign-in/details, and `https://api.medtermin.mk/swagger`. Hard-refresh cached
   pages after publishing. Verify unrelated Host headers remain rejected.

Example settings to MERGE after DNS/TLS are ready (not complete appsettings files):

Web:
```json
{
  "AllowedHosts": "localhost;127.0.0.1;10.20.1.100;medtermin.mk;app.medtermin.mk;admin.medtermin.mk",
  "Backend": { "Mode": "Api", "ApiBaseUrl": "https://api.medtermin.mk/" },
  "Hosting": { "AllowHttpForTesting": false }
}
```

API:
```json
{
  "AllowedHosts": "localhost;127.0.0.1;10.20.1.100;10.20.1.102;api.medtermin.mk",
  "Hosting": { "AllowHttpForTesting": false }
}
```

Database passwords, connection strings, clinic IDs and database role names do not
need to change for a product/domain rename. Domain registration alone does not
configure DNS, IIS bindings, certificate trust or network reachability.
