using System.Collections.Frozen;
using System.Globalization;
using System.Text.Json;

namespace Appointments.Core;

// Only explicit application literals are translated. Names/records supplied by a clinic are data.
public static class UiText
{
    private static readonly FrozenDictionary<string, string> English = Load();
    private static FrozenDictionary<string, string> Load()
    {
        using var stream = typeof(UiText).Assembly.GetManifestResourceStream("Appointments.Core.Localization.en.json")
            ?? throw new InvalidOperationException("The English translation catalogue is missing.");
        return JsonSerializer.Deserialize<Dictionary<string, string>>(stream)!.ToFrozenDictionary(StringComparer.Ordinal);
    }
    public static bool IsEnglish => CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "en";
    public static string T(string source, params object[] values)
    {
        var text = source;
        if (IsEnglish && English.TryGetValue(source.Trim(), out var translation))
            text = source[..(source.Length - source.TrimStart().Length)] + translation + source[source.TrimEnd().Length..];
        return values.Length == 0 ? text : string.Format(CultureInfo.CurrentCulture, text, values);
    }
}
