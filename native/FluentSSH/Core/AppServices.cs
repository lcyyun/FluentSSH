using System.IO;

namespace FluentSSH.Core;

/// <summary>
/// Process-wide native application services (data, SSH, tunnels, audit).
/// Initialized once at startup from App.OnStartup.
/// </summary>
public static class AppServices
{
    public static AppPaths Paths { get; } = new();
    public static DataStore Store { get; } = new(Paths);
    public static SshService Ssh { get; } = new();
    public static TunnelService Tunnels { get; } = new();
    public static AuditService Audit { get; } = new();

    public static AppData Data => Store.Data;
    public static AppSettings Settings => Store.Data.Settings;
    public static MainWindow? MainWindow { get; set; }

    public static event Action<HostProfile>? HostConnected;
    public static event Action? HostsChanged;

    public static void Initialize()
    {
        Paths.Ensure();
        Store.Load();
        Audit.Initialize(Store);
        Tunnels.Initialize(Store);
        Log($"FluentSSH Native 启动，数据目录：{Paths.Root}");
    }

    public static void Shutdown()
    {
        try
        {
            Tunnels.StopAll();
            Store.Save();
        }
        catch (Exception ex)
        {
            LogError("退出时保存数据失败", ex);
        }
    }

    public static void MarkHostConnected(HostProfile host)
    {
        host.LastConnectedAt = DateTime.Now;
        host.ConnectCount += 1;
        Store.Save();
        HostConnected?.Invoke(host);
    }

    public static void NotifyHostsChanged()
    {
        Store.Save();
        HostsChanged?.Invoke();
    }

    public static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Paths.Root);
            File.AppendAllText(Path.Combine(Paths.Root, "app.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}");
        }
        catch
        {
            // logging must never crash the app
        }
    }

    public static void LogError(string message, Exception? ex = null)
    {
        Log($"ERROR {message}{(ex is null ? string.Empty : $": {ex.GetType().Name}: {ex.Message}")}");
        if (ex is not null)
            Log(ex.StackTrace ?? string.Empty);
    }
}
