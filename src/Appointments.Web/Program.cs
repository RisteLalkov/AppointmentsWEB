using Appointments.Core;
using Appointments.Web.Services;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllersWithViews(o => o.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()))
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddAntiforgery(o => o.HeaderName = "X-CSRF-TOKEN");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.LoginPath = "/Demo"; o.AccessDeniedPath = "/Demo"; o.Cookie.Name = "Careline.Demo";
    o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict; o.ExpireTimeSpan = TimeSpan.FromHours(8);
    o.Events.OnRedirectToLogin = c => { if (c.Request.Path.StartsWithSegments("/data")) c.Response.StatusCode = 401; else c.Response.Redirect(c.RedirectUri); return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { if (c.Request.Path.StartsWithSegments("/data")) c.Response.StatusCode = 403; else c.Response.Redirect(c.RedirectUri); return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => new SchedulingClock(sp.GetRequiredService<TimeProvider>(), builder.Configuration["Scheduling:TimeZone"] ?? "Europe/Skopje"));
builder.Services.AddSingleton<IDemoStore>(sp =>
{
    var path = builder.Configuration["Demo:DataPath"];
    if (string.IsNullOrWhiteSpace(path)) path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CarelineAppointments", "demo-state.json");
    var seed = File.ReadAllText(Path.Combine(builder.Environment.ContentRootPath, "Seed", "doctors.json"));
    var clock = sp.GetRequiredService<SchedulingClock>();
    return new JsonDemoStore(path, () => DemoSeed.Create(seed, clock));
});
builder.Services.AddSingleton<IAppointmentService, AppointmentService>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<DemoIdentity>();
var app = builder.Build();
app.UseExceptionHandler("/Home/Error");
app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllerRoute("default", "{controller=Home}/{action=Index}/{id?}");
// Initialize once and fail visibly if the demo store is corrupt or already in use.
_ = app.Services.GetRequiredService<IDemoStore>();
app.Run();

public partial class Program { }
