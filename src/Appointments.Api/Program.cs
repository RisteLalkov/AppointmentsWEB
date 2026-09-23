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

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 64 * 1024);
var connection = builder.Configuration.GetConnectionString("Appointments");
if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("PostgreSQL is not configured. Run scripts/setup-local.ps1 or set ConnectionStrings:Appointments with dotnet user-secrets.");
builder.Services.AddDbContext<AppointmentsDbContext>(o => o.UseNpgsql(connection));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => new SchedulingClock(sp.GetRequiredService<TimeProvider>(), builder.Configuration["Scheduling:TimeZone"] ?? "Europe/Skopje"));
builder.Services.AddScoped<PostgresAppointments>(); builder.Services.AddScoped<AccountService>(); builder.Services.AddScoped<DatabaseInitializer>();
builder.Services.AddScoped<IPasswordHasher<Account>, PasswordHasher<Account>>();
builder.Services.Configure<PasswordHasherOptions>(o => o.IterationCount = 210000);
builder.Services.AddAuthentication("Session").AddScheme<AuthenticationSchemeOptions, SessionAuthentication>("Session", _ => { });
builder.Services.AddAuthorization();
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.Configure<ApiBehaviorOptions>(o => o.InvalidModelStateResponseFactory = context => new BadRequestObjectResult(new { error = "Invalid input. Check required fields, email, dates, times and text lengths." }));
builder.Services.AddOpenApi();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    try { await next(); }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (RuleException e) { context.Response.StatusCode = e.StatusCode; await context.Response.WriteAsJsonAsync(new { error = e.Message }); }
    catch (Exception e) when (e is NpgsqlException or DbUpdateException)
    {
        app.Logger.LogError(e, "Database request failed."); context.Response.StatusCode = 503;
        await context.Response.WriteAsJsonAsync(new { error = "The database is temporarily unavailable. Please try again." });
    }
    catch (Exception e)
    {
        app.Logger.LogError(e, "Request failed."); context.Response.StatusCode = 500;
        await context.Response.WriteAsJsonAsync(new { error = "The request could not be completed. Please try again." });
    }
});
if (!app.Environment.IsDevelopment()
    && !builder.Configuration.GetValue<bool>("Hosting:AllowHttpForTesting"))
{
    app.UseHttpsRedirection();
}
app.UseRateLimiter(); app.UseAuthentication(); app.UseAuthorization();
app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "ready" })).AllowAnonymous();
app.MapGet("/health/database", async (AppointmentsDbContext db, CancellationToken ct) => await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503)).RequireAuthorization();
if (app.Environment.IsDevelopment()) app.MapOpenApi();
await using (var scope = app.Services.CreateAsyncScope())
{
    var explicitMigration = args.Contains("--migrate");
    var auto = app.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("Database:ApplyMigrations");
    await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().InitializeAsync(explicitMigration || auto, CancellationToken.None);
    if (explicitMigration) return;
}
await app.RunAsync();

public partial class Program { }
