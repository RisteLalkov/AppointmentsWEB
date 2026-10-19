namespace Appointments.Data;

/// <summary>Locale-independent Cyrillic casing for database search expressions.</summary>
public static class PostgresText
{
    // Includes Macedonian letters Ѓ, Ѕ, Ј, Љ, Њ, Ќ and Џ. PostgreSQL's C locale
    // lower() only folds ASCII; translate these explicitly before lower().
    public const string CyrillicUpper = "ЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ";
    public static readonly string CyrillicLower = CyrillicUpper.ToLowerInvariant();

    // Mapped to PostgreSQL's existing built-in; never evaluated on the client.
    public static string Translate(string value, string from, string to) =>
        throw new InvalidOperationException("This function is only available in database queries.");
}
