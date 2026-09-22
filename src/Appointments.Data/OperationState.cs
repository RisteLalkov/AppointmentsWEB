using Appointments.Core;

namespace Appointments.Data;

/// <summary>A transaction-scoped subset for the existing domain rules; never a database snapshot or persistence format.</summary>
internal sealed class OperationState(DemoState state) : IDemoStore
{
    public T Read<T>(Func<DemoState, T> query) => query(state);
    public T Write<T>(Func<DemoState, T> change) => change(state);
    public void Reset() => throw new NotSupportedException("Database reset is not a domain operation.");
}
