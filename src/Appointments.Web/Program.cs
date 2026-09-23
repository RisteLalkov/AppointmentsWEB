using System.Globalization;
using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;

// Macedonian is the application default on every host, regardless of OS language.
CultureInfo.DefaultThreadCurrentCulture = CultureInfo.GetCultureInfo("mk-MK");
CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.GetCultureInfo("mk-MK");
var builder = WebApplication.CreateBuilder(args);
var allowHttp = builder.Environment.IsDevelopment()
    || builder.Configuration.GetValue<bool>("Hosting:AllowHttpForTesting");
var mode = builder.Configuration["Backend:Mode"] ?? "Api";
if (mode is not ("Api" or "Demo")) throw new InvalidOperationException("Backend:Mode must be Api or Demo.");
var settings = new BackendSettings(mode == "Api", builder.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("Demo:Enabled"));
if (!settings.UseApi && !settings.DemoEnabled) throw new InvalidOperationException("The JSON demo backend is allowed only in explicitly enabled Development mode.");
builder.Services.AddSingleton(settings);
builder.Services.AddHttpClient<ApiClient>(client =>
{
    var address = new Uri(builder.Configuration["Backend:ApiBaseUrl"] ?? "http://localhost:5181/");
    if (!allowHttp && address.Scheme != "https")
        throw new InvalidOperationException("The API connection must use HTTPS.");
    client.BaseAddress = address; client.Timeout = TimeSpan.FromSeconds(20);
});
builder.Services.AddControllersWithViews(o => o.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()))
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddAntiforgery(o => o.HeaderName = "X-CSRF-TOKEN");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.LoginPath = settings.UseApi ? "/Account/Login" : "/Demo"; o.AccessDeniedPath = "/Account/Login"; o.Cookie.Name = "Careline.Session"; o.SlidingExpiration = false;
    o.Cookie.SecurePolicy = allowHttp
        ? CookieSecurePolicy.SameAsRequest
        : CookieSecurePolicy.Always;
    o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict; o.ExpireTimeSpan = TimeSpan.FromHours(8);
    o.Events.OnRedirectToLogin = c => { if (c.Request.Path.StartsWithSegments("/data")) c.Response.StatusCode = 401; else c.Response.Redirect(c.RedirectUri); return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { if (c.Request.Path.StartsWithSegments("/data")) c.Response.StatusCode = 403; else c.Response.Redirect(c.RedirectUri); return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => new SchedulingClock(sp.GetRequiredService<TimeProvider>(), builder.Configuration["Scheduling:TimeZone"] ?? "Europe/Skopje"));
if (!settings.UseApi)
{
builder.Services.AddSingleton<IDemoStore>(sp =>
{
    var path = builder.Configuration["Demo:DataPath"];
    if (string.IsNullOrWhiteSpace(path)) path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CarelineAppointments", "demo-state.json");
    var seed = File.ReadAllText(Path.Combine(builder.Environment.ContentRootPath, "Seed", "doctors.json"));
    var clock = sp.GetRequiredService<SchedulingClock>();
    return new JsonDemoStore(path, () => DemoSeed.Create(seed, clock));
});
builder.Services.AddSingleton<IAppointmentService, AppointmentService>();
}
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<DemoIdentity>();
var app = builder.Build();
app.UseRequestLocalization(new RequestLocalizationOptions()
    .SetDefaultCulture("mk-MK")
    .AddSupportedCultures("mk-MK")
    .AddSupportedUICultures("mk-MK"));
app.UseExceptionHandler("/Home/Error");
if (!allowHttp)
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
app.Use(async (context, next) => { context.Response.Headers["X-Content-Type-Options"] = "nosniff"; context.Response.Headers["Referrer-Policy"] = "same-origin"; await next(); });
app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllerRoute("default", "{controller=Home}/{action=Index}/{id?}");
// Initialize once and fail visibly if the demo store is corrupt or already in use.
if (!settings.UseApi) _ = app.Services.GetRequiredService<IDemoStore>();
app.Run();

public partial class Program { }
