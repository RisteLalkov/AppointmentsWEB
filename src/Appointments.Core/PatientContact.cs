namespace Appointments.Core;

public static class PatientContact
{
    public static string RequirePhone(string? value)
    {
        var phone = (value ?? "").Trim();
        var digits = phone.Count(char.IsAsciiDigit);
        if (phone.Length > 30 || digits is < 7 or > 15 || phone.Any(c => !char.IsAsciiDigit(c) && !"+ -()".Contains(c))
            || phone.Count(c => c == '+') > 1 || phone.Contains('+') && !phone.StartsWith('+'))
            throw new RuleException("Внесете телефонски број со 7 до 15 цифри.");
        return phone;
    }
}
