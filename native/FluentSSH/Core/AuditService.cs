using System.Collections.ObjectModel;
using System.Windows;

namespace FluentSSH.Core;

/// <summary>Audit trail persisted inside the local store.</summary>
public sealed class AuditService
{
    private DataStore? _store;
    private const int MaxEvents = 3000;

    public ObservableCollection<AuditEvent> Events => _store?.Data.Audit ?? new ObservableCollection<AuditEvent>();
    public event Action<AuditEvent>? Recorded;

    public void Initialize(DataStore store)
    {
        _store = store;
    }

    public void Record(string category, string message, AuditLevel level = AuditLevel.Info, HostProfile? host = null, string? detail = null)
    {
        if (_store is null) return;
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is not null && !dispatcher.CheckAccess())
        {
            dispatcher.BeginInvoke(() => Record(category, message, level, host, detail));
            return;
        }

        var evt = new AuditEvent
        {
            At = DateTime.Now,
            Category = category,
            Level = level,
            Message = message,
            HostLabel = host?.Name,
            Detail = detail
        };
        _store.Data.Audit.Insert(0, evt);
        while (_store.Data.Audit.Count > MaxEvents) _store.Data.Audit.RemoveAt(_store.Data.Audit.Count - 1);
        _store.Save();
        Recorded?.Invoke(evt);
    }

    public void Clear()
    {
        if (_store is null) return;
        _store.Data.Audit.Clear();
        _store.Save();
    }
}
