using System.Text.Json;
using System.Text.Json.Serialization;

namespace Appointments.Core;

/// <summary>Single application process; serializes writes, clones transactions, atomically replaces JSON.</summary>
public sealed class JsonDemoStore : IDemoStore, IDisposable
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    { WriteIndented = true, Converters = { new JsonStringEnumConverter() } };
    private readonly object gate = new();
    private readonly string path;
    private readonly Func<DemoState> seed;
    private readonly FileStream ownership;
    private DemoState state;
    public JsonDemoStore(string path, Func<DemoState> seed)
    {
        this.path = path; this.seed = seed;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        // Fail clearly if two servers try to share this demo file.
        ownership = new FileStream(path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        try
        {
            state = File.Exists(path)
                ? JsonSerializer.Deserialize<DemoState>(File.ReadAllText(path), JsonOptions) ?? throw new InvalidDataException("Empty demo state.")
                : seed();
            if (state.SchemaVersion != 1) throw new InvalidDataException("Unsupported demo data version. Back up the file before resetting.");
            if (state.TimeZoneId != seed().TimeZoneId) throw new InvalidDataException("Scheduling time zone changed. Reset the demo file before restarting.");
            if (!File.Exists(path)) Persist(state);
        }
        catch { ownership.Dispose(); throw; }
    }
    private static DemoState Clone(DemoState input) => JsonSerializer.Deserialize<DemoState>(JsonSerializer.Serialize(input, JsonOptions), JsonOptions)!;
    public T Read<T>(Func<DemoState, T> query) { lock (gate) return query(Clone(state)); }
    public T Write<T>(Func<DemoState, T> change)
    {
        lock (gate)
        {
            var next = Clone(state);
            var result = change(next); // Failed validation leaves the live state untouched.
            Persist(next);
            state = Clone(next); // Do not expose references to the live state.
            return result;
        }
    }
    private void Persist(DemoState next)
    {
        var temp = path + ".tmp";
        using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
        { JsonSerializer.Serialize(stream, next, JsonOptions); stream.Flush(true); }
        File.Move(temp, path, true);
    }
    public void Reset() { lock (gate) { var next = seed(); Persist(next); state = next; } }
    public void Dispose() => ownership.Dispose();
}
