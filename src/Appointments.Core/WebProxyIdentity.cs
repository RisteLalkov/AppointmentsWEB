using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Appointments.Core;

// Authenticate the Web hop before using a supplied address as a rate-limit key.
public static class WebProxyIdentity
{
    public static string Sign(string secret, string address, long timestamp) =>
        Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret),
            Encoding.UTF8.GetBytes(address + "\n" + timestamp.ToString(CultureInfo.InvariantCulture))));
    public static bool Verify(string secret, string address, string timestamp, string signature, long now)
    {
        if (secret.Length < 32 || !System.Net.IPAddress.TryParse(address, out _) ||
            !long.TryParse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds) ||
            seconds < now - 60 || seconds > now + 10 || signature.Length != 64) return false;
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(signature), Convert.FromHexString(Sign(secret, address, seconds))); }
        catch (FormatException) { return false; }
    }
}
