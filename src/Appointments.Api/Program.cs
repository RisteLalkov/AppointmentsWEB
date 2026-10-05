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
    if (args[i] == "--migrate") continue;
    if (args[i] == "--clinic")
    {
        if (i + 1 >= args.Length || args[i + 1].StartsWith("--", StringComparison.Ordinal))
            throw new InvalidOperationException("--clinic requires a clinic ID.");
        i++; continue;
    }
    hostingArgs.Add(args[i]);
}
var builder = WebApplication.CreateBuilder(hostingArgs.ToArray());
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 64 * 1024);
var clinics = new ClinicRegistry(builder.Configuration);
builder.Services.AddSingleton(clinics);
builder.Services.AddScoped<ClinicContext>();
builder.Services.AddDbContext<AppointmentsDbContext>((sp, o) => o.UseNpgsql(sp.GetRequiredService<ClinicContext>().Current.ConnectionString));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped(sp => new SchedulingClock(sp.GetRequiredService<TimeProvider>(), sp.GetRequiredService<ClinicContext>().Current.TimeZone));
builder.Services.AddScoped<PostgresAppointments>(); builder.Services.AddScoped<AccountService>(); builder.Services.AddScoped<DatabaseInitializer>();
builder.Services.AddScoped<IPasswordHasher<Account>, PasswordHasher<Account>>();
builder.Services.Configure<PasswordHasherOptions>(o => o.IterationCount = 210000);
builder.Services.AddAuthentication("Session").AddScheme<AuthenticationSchemeOptions, SessionAuthentication>("Session", _ => { });
builder.Services.AddAuthorization();
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.Configure<ApiBehaviorOptions>(o => o.InvalidModelStateResponseFactory = context => new BadRequestObjectResult(new { error = "Невалидни податоци. Проверете ги задолжителните полиња, е-поштата, датумите, времињата и должината на текстот." }));
builder.Services.AddOpenApi();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
var app = builder.Build();
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
}
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value?.TrimEnd('/') ?? "";
    var directory = path.Equals("/api/clinics", StringComparison.OrdinalIgnoreCase);
    if (!directory && (context.Request.Path.StartsWithSegments("/api") || path.Equals("/health/database", StringComparison.OrdinalIgnoreCase)))
    {
        var values = context.Request.Headers["X-Clinic"];
        if (values.Count > 1) throw new RuleException("Изберете една клиника.");
        var clinic = clinics.Resolve(values.ToString());
        context.RequestServices.GetRequiredService<ClinicContext>().Select(clinic);
        // Also fail closed if a database is restored/repointed while the API is running.
        var db = context.RequestServices.GetRequiredService<AppointmentsDbContext>();
        var binding = await db.Settings.AsNoTracking().SingleOrDefaultAsync(s => s.Key == "ClinicId", context.RequestAborted);
        if (binding?.Value != clinic.Id) throw new RuleException("Клиниката е привремено недостапна. Контактирајте го администраторот.", 503);
    }
    await next();
});
app.UseRateLimiter(); app.UseAuthentication(); app.UseAuthorization();
app.MapControllers();
app.MapGet("/api/clinics", () => clinics.Clinics.Where(c => c.Enabled).Select(c => c.Summary())).AllowAnonymous();
app.MapGet("/health", () => Results.Ok(new { status = "ready" })).AllowAnonymous();
app.MapGet("/health/database", async (AppointmentsDbContext db, CancellationToken ct) => await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503)).RequireAuthorization();
if (app.Environment.IsDevelopment()) app.MapOpenApi();
var explicitMigration = args.Contains("--migrate");
var selectedIndex = Array.IndexOf(args, "--clinic");
if (selectedIndex >= 0 && (!explicitMigration || selectedIndex + 1 >= args.Length))
    throw new InvalidOperationException("Use --clinic <id> only together with --migrate.");
var initialize = selectedIndex >= 0 ? new[] { clinics.Resolve(args[selectedIndex + 1]) } : clinics.Clinics.Where(c => c.Enabled);
foreach (var clinic in initialize)
{
    await using var scope = app.Services.CreateAsyncScope();
    scope.ServiceProvider.GetRequiredService<ClinicContext>().Select(clinic);
    var auto = app.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("Database:ApplyMigrations");
    await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().InitializeAsync(explicitMigration || auto, CancellationToken.None);
}
if (explicitMigration) return;
await app.RunAsync();

public partial class Program { }
