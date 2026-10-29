using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi;

namespace Appointments.Api.Services;

public static class ApiDocumentation
{
    public static IServiceCollection AddApiDocumentation(this IServiceCollection services)
    {
        services.AddOpenApi(options =>
        {
            options.AddDocumentTransformer((document, context, ct) =>
            {
                document.Info.Title = "Термино API";
                document.Info.Version = "v1";
                document.Info.Description = "Appointment scheduling and clinic platform API. Sign in through /api/auth/login " +
                    "(or /api/platform/login for company operations), copy accessToken, then use Authorize. " +
                    "These are opaque session tokens, not JWTs. Clinic operations also require the X-Clinic header. " +
                    "Try it out calls the real API and can change data according to the signed-in account's permissions.";
                document.Components ??= new();
                document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
                document.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
                {
                    Type = SecuritySchemeType.Http, Scheme = "bearer",
                    Description = "Paste accessToken only. Use a clinic token for clinic operations or a platform token for company operations."
                };
                return Task.CompletedTask;
            });
            options.AddOperationTransformer((operation, context, ct) =>
            {
                var metadata = context.Description.ActionDescriptor.EndpointMetadata;
                if (metadata.OfType<IAuthorizeData>().Any() && !metadata.OfType<IAllowAnonymous>().Any())
                    operation.Security = [new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference("Bearer", context.Document)] = [] }];
                var path = "/" + context.Description.RelativePath;
                if ((path.Equals("/health/database", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
                    && !path.StartsWith("/api/public", StringComparison.OrdinalIgnoreCase)
                    && !path.StartsWith("/api/platform", StringComparison.OrdinalIgnoreCase)
                    && !path.Equals("/api/clinics", StringComparison.OrdinalIgnoreCase)
                    && !path.Equals("/api/auth/login", StringComparison.OrdinalIgnoreCase))
                {
                    operation.Parameters ??= [];
                    operation.Parameters.Add(new OpenApiParameter
                    {
                        Name = "X-Clinic", In = ParameterLocation.Header, Required = true,
                        Description = "Clinic identifier, for example main. Must match the clinic session. Registration also uses this header.",
                        Schema = new OpenApiSchema { Type = JsonSchemaType.String }
                    });
                }
                return Task.CompletedTask;
            });
        });
        return services;
    }
}
