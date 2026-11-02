using System.Globalization;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Appointments.Api.Services;
using Appointments.Core;
using Appointments.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

// Macedonian is the application default on every host, regardless of OS language.
CultureInfo.DefaultThreadCurrentCulture = CultureInfo.GetCultureInfo("mk-MK");
CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.GetCultureInfo("mk-MK");
// Maintenance switches are valueless; remove them before ASP.NET configuration parsing.
var hostingArgs = new List<string>();
for (var i = 0; i < args.Length; i++)
{
    if (args[i] is "--migrate" or "--seed-preview") continue;
    if (args[i] == "--clinic")
    {
        if (i + 1 >= args.Length || args[i + 1].StartsWith("--", StringComparison.Ordinal))
            throw new InvalidOperationException("--clinic requires a clinic ID.");
        i++; continue;
    }
    hostingArgs.Add(args[i]);
}
var builder = WebApplication.CreateBuilder(hostingArgs.ToArray());
var proxySecret = builder.Configuration["Hosting:WebProxyKey"] ?? "";
if (proxySecret.Length is > 0 and < 32) throw new InvalidOperationException("Hosting:WebProxyKey must have at least 32 random characters.");
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(o => {
    o.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    // Defaults trust loopback; remove them so only explicitly configured proxy addresses are trusted.
    o.KnownProxies.Clear(); o.KnownIPNetworks.Clear();
    foreach (var address in builder.Configuration.GetSection("Hosting:TrustedProxies").Get<string[]>() ?? [])
        o.KnownProxies.Add(System.Net.IPAddress.Parse(address));
    if (o.KnownProxies.Count == 0) o.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.None;
});

builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 64 * 1024);
if (!builder.Environment.IsDevelopment() && proxySecret.Length < 32)
    throw new InvalidOperationException("Configure the same random Hosting:WebProxyKey on API and Web before production startup.");
var clinics = new ClinicRegistry(builder.Configuration);
builder.Services.AddSingleton(clinics);
builder.Services.AddScoped<ClinicContext>();
builder.Services.AddSingleton<ClinicConnections>();
builder.Services.AddSingleton<IdentityDirectory>();
builder.Services.AddHostedService<RegistryRefreshService>();
builder.Services.AddScoped<AutomaticLogin>();
builder.Services.AddScoped<PublicDiscovery>();
builder.Services.AddScoped<PlatformService>();
builder.Services.AddScoped<PreviewSeeder>();
builder.Services.AddDbContext<AppointmentsDbContext>((sp, o) => o.UseNpgsql(sp.GetRequiredService<ClinicContext>().Current.ConnectionString));
builder.Services.AddSingleton(TimeProvider.System);
var bookingPolicy = builder.Configuration.GetSection("Booking").Get<BookingPolicy>() ?? new();
if (bookingPolicy.MaxFutureAppointments is < 1 or > 20 || bookingPolicy.MaxPendingPerDoctorPerDay is < 1 or > 3)
    throw new InvalidOperationException("Booking limits must be 1–20 future visits and 1–3 pending requests per doctor/day.");
builder.Services.AddSingleton(bookingPolicy);
builder.Services.AddScoped(sp => new SchedulingClock(sp.GetRequiredService<TimeProvider>(), sp.GetRequiredService<ClinicContext>().Current.TimeZone));
builder.Services.AddScoped<PostgresAppointments>(); builder.Services.AddScoped<AccountService>(); builder.Services.AddScoped<DatabaseInitializer>();
builder.Services.AddScoped<IPasswordHasher<Account>, PasswordHasher<Account>>();
builder.Services.Configure<PasswordHasherOptions>(o => o.IterationCount = 210000);
builder.Services.AddAuthentication("Session").AddScheme<AuthenticationSchemeOptions, SessionAuthentication>("Session", _ => { })
    .AddScheme<AuthenticationSchemeOptions, PlatformAuthentication>("PlatformSession", _ => { });
builder.Services.AddAuthorization(o => o.AddPolicy("Platform", p => p.AddAuthenticationSchemes("PlatformSession").RequireAuthenticatedUser().RequireRole("PlatformAdministrator")));
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.Configure<ApiBehaviorOptions>(o => o.InvalidModelStateResponseFactory = context => new BadRequestObjectResult(new { error = "Невалидни податоци. Проверете ги задолжителните полиња, е-поштата, датумите, времињата и должината на текстот." }));
builder.Services.AddApiDocumentation();
string RateKey(HttpContext context)
{
    var address = context.Request.Headers["X-Web-Client"].ToString();
    if (WebProxyIdentity.Verify(proxySecret, address, context.Request.Headers["X-Web-Time"].ToString(),
        context.Request.Headers["X-Web-Signature"].ToString(), DateTimeOffset.UtcNow.ToUnixTimeSeconds())) return "web:" + address;
    if (context.Request.Headers.ContainsKey("X-Web-Client") || context.Request.Headers.ContainsKey("X-Web-Time") || context.Request.Headers.ContainsKey("X-Web-Signature"))
        throw new RuleException("Барањето не можеше да се потврди.", 403);
    return "direct:" + (context.Connection.RemoteIpAddress?.ToString() ?? "unknown");
}
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.OnRejected = async (context, ct) => {
        context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsJsonAsync(new { error = "Премногу барања. Почекајте една минута и обидете се повторно." }, ct);
    };
    o.AddPolicy("discovery", context => RateLimitPartition.GetFixedWindowLimiter(RateKey(context), _ => new FixedWindowRateLimiterOptions { PermitLimit = 90, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(RateKey(context), _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
var app = builder.Build();
app.UseForwardedHeaders();
app.UseRequestLocalization(new RequestLocalizationOptions()
    .SetDefaultCulture("mk-MK")
    .AddSupportedCultures("mk-MK")
    .AddSupportedUICultures("mk-MK"));
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    try { await next(); }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (RuleException e) { context.Response.StatusCode = e.StatusCode; await context.Response.WriteAsJsonAsync(new { error = e.Message }); }
    catch (Exception e) when (e is NpgsqlException or DbUpdateException)
    {
        app.Logger.LogError(e, "Database request failed."); context.Response.StatusCode = 503;
        await context.Response.WriteAsJsonAsync(new { error = "Базата на податоци е привремено недостапна. Обидете се повторно." });
    }
    catch (Exception e)
    {
        app.Logger.LogError(e, "Request failed."); context.Response.StatusCode = 500;
        await context.Response.WriteAsJsonAsync(new { error = "Барањето не можеше да се изврши. Обидете се повторно." });
    }
});
if (!app.Environment.IsDevelopment()
    && !builder.Configuration.GetValue<bool>("Hosting:AllowHttpForTesting"))
{
    app.UseHttpsRedirection();
    app.Use(async (context, next) => {
        if (!context.Request.IsHttps) {
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new { error = "Потребна е безбедна HTTPS врска." });
            return;
        }
        await next();
    });
}
app.UseSwaggerUI(options =>
{
    options.RoutePrefix = "swagger";
    options.SwaggerEndpoint("../openapi/v1.json", "МедТермин API v1");
    options.DocumentTitle = "МедТермин API — Swagger";
    options.DisplayRequestDuration();
});
app.UseRouting();
app.UseRateLimiter();
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value?.TrimEnd('/') ?? "";
    if (context.Request.Path.StartsWithSegments("/api") && !context.Request.Path.StartsWithSegments("/api/platform")) clinics.RequireFresh();
    var directory = path.Equals("/api/clinics", StringComparison.OrdinalIgnoreCase) || path.Equals("/api/auth/login", StringComparison.OrdinalIgnoreCase)
        || context.Request.Path.StartsWithSegments("/api/public") || context.Request.Path.StartsWithSegments("/api/platform");
    if (!directory && (context.Request.Path.StartsWithSegments("/api") || path.Equals("/health/database", StringComparison.OrdinalIgnoreCase)))
    {
        var values = context.Request.Headers["X-Clinic"];
        if (values.Count > 1) throw new RuleException("Изберете една клиника.");
        var clinic = clinics.Resolve(values.ToString());
        context.RequestServices.GetRequiredService<ClinicContext>().Select(clinic);
        // Also fail closed if a database is restored/repointed while the API is running.
        var db = context.RequestServices.GetRequiredService<AppointmentsDbContext>();
        var binding = await ClinicConnections.BindingAsync(db, clinic, context.RequestAborted);
        if (binding?.Value != clinic.Id) throw new RuleException("Клиниката е привремено недостапна. Контактирајте го администраторот.", 503);
    }
    await next();
});
app.UseAuthentication(); app.UseAuthorization();
app.MapControllers();
app.MapGet("/api/clinics", () => clinics.Clinics.Where(c => c.Enabled && c.Discoverable).Select(c => c.Summary())).AllowAnonymous();
app.MapGet("/health/live", () => Results.Ok(new { status = "alive" })).AllowAnonymous();
app.MapGet("/health", async (CancellationToken ct) => {
    if (!clinics.IsReady) return Results.Json(new { status = "unavailable" }, statusCode: 503);
    try {
        await using var connection = new NpgsqlConnection(SharedClinicDatabase.Connection(builder.Configuration, "main"));
        await connection.OpenAsync(ct);
        await using var command = new NpgsqlCommand("SELECT 1 FROM careline_identity.accounts LIMIT 1", connection);
        await command.ExecuteScalarAsync(ct);
        return Results.Ok(new { status = "ready" });
    }
    catch (NpgsqlException) { return Results.Json(new { status = "unavailable" }, statusCode: 503); }
}).AllowAnonymous();
app.MapGet("/health/database", async (AppointmentsDbContext db, CancellationToken ct) => await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503)).RequireAuthorization();
app.MapOpenApi().AllowAnonymous();
var explicitMigration = args.Contains("--migrate");
var previewSeed = args.Contains("--seed-preview");
var selectedIndex = Array.IndexOf(args, "--clinic");
if (selectedIndex >= 0 && (!explicitMigration && !previewSeed || selectedIndex + 1 >= args.Length))
    throw new InvalidOperationException("Use --clinic <id> only together with --migrate or --seed-preview.");
await using (var platformScope = app.Services.CreateAsyncScope())
    await platformScope.ServiceProvider.GetRequiredService<PlatformService>().InitializeAsync(explicitMigration || app.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("Database:ApplyMigrations"), CancellationToken.None);
var identityDirectory = app.Services.GetRequiredService<IdentityDirectory>();
var migrateClinics = explicitMigration || app.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("Database:ApplyMigrations");
var initialize = selectedIndex >= 0 ? new[] { clinics.Resolve(args[selectedIndex + 1]) }
    : clinics.Clinics.Where(c => c.Enabled || migrateClinics && clinics.Configured.Any(configured => configured.Id == c.Id));
if (migrateClinics) await identityDirectory.InitializeAsync(CancellationToken.None);
foreach (var clinic in initialize)
{
    await using var scope = app.Services.CreateAsyncScope();
    scope.ServiceProvider.GetRequiredService<ClinicContext>().Select(clinic);
    var auto = app.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("Database:ApplyMigrations");
    try
    {
        await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().InitializeAsync(explicitMigration || auto, CancellationToken.None);
        if (migrateClinics) await identityDirectory.AttachAsync(clinic, CancellationToken.None);
        else await identityDirectory.RequireInstalledAsync(clinic, CancellationToken.None);
    }
    catch (Exception e) when (!migrateClinics)
    {
        // Per-request binding checks still reject the damaged clinic. Healthy clinics can start.
        app.Logger.LogError(e, "Clinic {ClinicId} failed startup validation; its requests will fail closed.", clinic.Id);
        clinics.MarkUnavailable(clinic.Id);
    }
}
if (selectedIndex < 0)
    await identityDirectory.RequireCoverageAsync(clinics.Clinics.Where(c => c.Enabled || clinics.Configured.Any(configured => configured.Id == c.Id)), CancellationToken.None);
if (previewSeed)
{
    if (selectedIndex < 0 || explicitMigration) throw new InvalidOperationException("Use --seed-preview --clinic <id> separately from --migrate.");
    await using var scope = app.Services.CreateAsyncScope();
    scope.ServiceProvider.GetRequiredService<ClinicContext>().Select(clinics.Resolve(args[selectedIndex + 1]));
    await scope.ServiceProvider.GetRequiredService<PreviewSeeder>().SeedAsync(CancellationToken.None);
    return;
}
if (explicitMigration) return;
await app.RunAsync();

public partial class Program { }
