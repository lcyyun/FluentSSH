using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace FluentSSH.Core;

public abstract class ObservableObject : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        Raise(propertyName);
        return true;
    }

    protected void Raise([CallerMemberName] string? propertyName = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}

public enum AuthKind
{
    Password,
    PrivateKey,
    KeyboardInteractive
}

public enum TunnelKind
{
    Local,
    Remote,
    Dynamic
}

public enum TunnelStatus
{
    Stopped,
    Running,
    Error
}

public enum AuditLevel
{
    Info,
    Warning,
    Error
}

public sealed class HostGroup : ObservableObject
{
    private string _name = string.Empty;
    private string _color = "#0f6cbd";

    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get => _name; set { if (Set(ref _name, value)) Raise(nameof(DisplayName)); } }
    public string Color { get => _color; set => Set(ref _color, value); }
    [JsonIgnore] public string DisplayName => Name;
}

public sealed class HostProfile : ObservableObject
{
    private string _name = string.Empty;
    private string _hostname = string.Empty;
    private int _port = 22;
    private string _username = "root";
    private string? _groupId;
    private bool _favorite;
    private string _color = "#0f6cbd";
    private AuthKind _authKind = AuthKind.Password;
    private string? _keyId;
    private string? _proxyJumpId;
    private string _startupCommand = string.Empty;
    private string _defaultPath = string.Empty;
    private string _notes = string.Empty;
    private string _tagsText = string.Empty;
    private DateTime? _lastConnectedAt;
    private int _connectCount;
    private bool _keepAlive = true;

    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get => _name; set { if (Set(ref _name, value)) { Raise(nameof(Initials)); } } }
    public string Hostname { get => _hostname; set { if (Set(ref _hostname, value)) { Raise(nameof(Address)); Raise(nameof(DisplayAddress)); } } }
    public int Port { get => _port; set { if (Set(ref _port, value)) { Raise(nameof(Address)); Raise(nameof(DisplayAddress)); } } }
    public string Username { get => _username; set { if (Set(ref _username, value)) { Raise(nameof(DisplayAddress)); } } }
    public string? GroupId { get => _groupId; set => Set(ref _groupId, value); }
    public bool Favorite { get => _favorite; set => Set(ref _favorite, value); }
    public string Color { get => _color; set => Set(ref _color, value); }
    public AuthKind AuthKind { get => _authKind; set { if (Set(ref _authKind, value)) Raise(nameof(AuthLabel)); } }
    public string? KeyId { get => _keyId; set => Set(ref _keyId, value); }
    public string? ProxyJumpId { get => _proxyJumpId; set => Set(ref _proxyJumpId, value); }
    public string StartupCommand { get => _startupCommand; set => Set(ref _startupCommand, value); }
    public string DefaultPath { get => _defaultPath; set => Set(ref _defaultPath, value); }
    public string Notes { get => _notes; set => Set(ref _notes, value); }
    public string TagsText { get => _tagsText; set { if (Set(ref _tagsText, value)) Raise(nameof(Tags)); } }
    public DateTime? LastConnectedAt { get => _lastConnectedAt; set { if (Set(ref _lastConnectedAt, value)) Raise(nameof(LastConnectedLabel)); } }
    public int ConnectCount { get => _connectCount; set => Set(ref _connectCount, value); }
    public bool KeepAlive { get => _keepAlive; set => Set(ref _keepAlive, value); }
    public DateTime CreatedAt { get; set; } = DateTime.Now;

    [JsonIgnore] public string? Password { get; set; }
    [JsonIgnore] public string? Passphrase { get; set; }

    [JsonIgnore] public bool HasPassword => !string.IsNullOrEmpty(Password);
    [JsonIgnore] public bool HasPassphrase => !string.IsNullOrEmpty(Passphrase);
    [JsonIgnore] public string Address => $"{Username}@{Hostname}:{Port}";
    [JsonIgnore] public string DisplayAddress => $"{Username}@{Hostname}:{Port}";
    [JsonIgnore] public string AuthLabel => AuthKind switch
    {
        AuthKind.Password => "密码",
        AuthKind.PrivateKey => "密钥",
        AuthKind.KeyboardInteractive => "交互式",
        _ => "密码"
    };
    [JsonIgnore] public string GroupName { get; set; } = "未分组";
    [JsonIgnore] public string Initials
    {
        get
        {
            var trimmed = Name.Trim();
            if (trimmed.Length == 0) return "?";
            var first = trimmed[0];
            return char.IsLetter(first) ? first.ToString().ToUpperInvariant() : first.ToString();
        }
    }
    [JsonIgnore] public string LastConnectedLabel => LastConnectedAt is null ? "从未连接" : FormatRelative(LastConnectedAt.Value);
    [JsonIgnore]
    public IReadOnlyList<string> Tags
        => TagsText.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(6).ToList();

    private static string FormatRelative(DateTime time)
    {
        var diff = DateTime.Now - time;
        if (diff.TotalMinutes < 1) return "刚刚连接";
        if (diff.TotalHours < 1) return $"{(int)diff.TotalMinutes} 分钟前";
        if (diff.TotalDays < 1) return $"{(int)diff.TotalHours} 小时前";
        if (diff.TotalDays < 7) return $"{(int)diff.TotalDays} 天前";
        return time.ToString("yyyy-MM-dd");
    }
}

public sealed class SshKeyRecord : ObservableObject
{
    private string _name = string.Empty;

    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get => _name; set => Set(ref _name, value); }
    public string Algorithm { get; set; } = "RSA";
    public int Bits { get; set; } = 3072;
    public string PublicKey { get; set; } = string.Empty;
    public string Fingerprint { get; set; } = string.Empty;
    public string PrivateKeyPath { get; set; } = string.Empty;
    public bool GeneratedByApp { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    [JsonIgnore] public string CreatedLabel => CreatedAt.ToString("yyyy-MM-dd HH:mm");
}

public sealed class KnownHostRecord : ObservableObject
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Hostname { get; set; } = string.Empty;
    public int Port { get; set; } = 22;
    public string KeyType { get; set; } = string.Empty;
    public string Fingerprint { get; set; } = string.Empty;
    public DateTime AddedAt { get; set; } = DateTime.Now;
    public DateTime LastSeenAt { get; set; } = DateTime.Now;
    [JsonIgnore] public string DisplayAddress => $"{Hostname}:{Port}";
    [JsonIgnore] public string AddedLabel => AddedAt.ToString("yyyy-MM-dd HH:mm");
}

public sealed class TunnelConfig : ObservableObject
{
    private string _name = string.Empty;
    private string _bindHost = "127.0.0.1";
    private int _bindPort;
    private string _targetHost = "127.0.0.1";
    private int _targetPort;
    private bool _autoStart;
    private TunnelStatus _status = TunnelStatus.Stopped;
    private string _lastError = string.Empty;
    private int _connections;

    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get => _name; set => Set(ref _name, value); }
    public string HostId { get; set; } = string.Empty;
    public TunnelKind Kind { get; set; } = TunnelKind.Local;
    public string BindHost { get => _bindHost; set => Set(ref _bindHost, value); }
    public int BindPort { get => _bindPort; set { if (Set(ref _bindPort, value)) Raise(nameof(RouteLabel)); } }
    public string TargetHost { get => _targetHost; set { if (Set(ref _targetHost, value)) Raise(nameof(RouteLabel)); } }
    public int TargetPort { get => _targetPort; set { if (Set(ref _targetPort, value)) Raise(nameof(RouteLabel)); } }
    public bool AutoStart { get => _autoStart; set => Set(ref _autoStart, value); }
    public DateTime CreatedAt { get; set; } = DateTime.Now;

    [JsonIgnore] public TunnelStatus Status { get => _status; set { if (Set(ref _status, value)) { Raise(nameof(StatusLabel)); Raise(nameof(IsRunning)); } } }
    [JsonIgnore] public string LastError { get => _lastError; set => Set(ref _lastError, value); }
    [JsonIgnore] public int Connections { get => _connections; set => Set(ref _connections, value); }
    [JsonIgnore] public bool IsRunning => Status == TunnelStatus.Running;
    [JsonIgnore] public string StatusLabel => Status switch
    {
        TunnelStatus.Running => "运行中",
        TunnelStatus.Error => "异常",
        _ => "已停止"
    };
    [JsonIgnore] public string KindLabel => Kind switch
    {
        TunnelKind.Local => "本地转发",
        TunnelKind.Remote => "远程转发",
        TunnelKind.Dynamic => "SOCKS5 动态",
        _ => "本地转发"
    };
    [JsonIgnore] public string RouteLabel => Kind switch
    {
        TunnelKind.Dynamic => $"{BindHost}:{BindPort} → SOCKS5",
        TunnelKind.Remote => $"{BindHost}:{BindPort} → {TargetHost}:{TargetPort}",
        _ => $"{BindHost}:{BindPort} → {TargetHost}:{TargetPort}"
    };
    [JsonIgnore] public string HostName { get; set; } = string.Empty;
}

public sealed class Snippet : ObservableObject
{
    private string _name = string.Empty;
    private string _command = string.Empty;
    private string _description = string.Empty;
    private string _tags = string.Empty;

    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get => _name; set => Set(ref _name, value); }
    public string Command { get => _command; set => Set(ref _command, value); }
    public string Description { get => _description; set => Set(ref _description, value); }
    public string Tags { get => _tags; set => Set(ref _tags, value); }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public sealed class CommandHistoryRecord : ObservableObject
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string HostId { get; set; } = string.Empty;
    public string HostLabel { get; set; } = string.Empty;
    public string Command { get; set; } = string.Empty;
    public string Output { get; set; } = string.Empty;
    public string Error { get; set; } = string.Empty;
    public int? ExitCode { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.Now;
    public long DurationMs { get; set; }
    [JsonIgnore] public string TimeLabel => StartedAt.ToString("MM-dd HH:mm:ss");
    [JsonIgnore] public string ExitLabel => ExitCode?.ToString() ?? "—";
}

public sealed class AuditEvent : ObservableObject
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime At { get; set; } = DateTime.Now;
    public AuditLevel Level { get; set; } = AuditLevel.Info;
    public string Category { get; set; } = "system";
    public string Message { get; set; } = string.Empty;
    public string? HostLabel { get; set; }
    public string? Detail { get; set; }
    [JsonIgnore] public string TimeLabel => At.ToString("yyyy-MM-dd HH:mm:ss");
    [JsonIgnore] public string CategoryLabel => Category switch
    {
        "connection" => "连接",
        "sftp" => "文件",
        "tunnel" => "隧道",
        "command" => "命令",
        "security" => "安全",
        "vault" => "保险库",
        _ => "系统"
    };
    [JsonIgnore] public string LevelLabel => Level switch
    {
        AuditLevel.Error => "错误",
        AuditLevel.Warning => "警告",
        _ => "信息"
    };
}

public sealed class AppSettings : ObservableObject
{
    private string _theme = "Light";
    private string _fontFamily = "Cascadia Mono";
    private double _fontSize = 14;
    private string _defaultUsername = "root";
    private int _defaultPort = 22;
    private int _keepAliveSeconds = 30;
    private bool _confirmDelete = true;
    private bool _recordSessions = true;
    private bool _strictHostKeys = true;
    private bool _showHiddenFiles = false;
    private string _hostView = "Grid";

    public string Theme { get => _theme; set => Set(ref _theme, value); }
    public string FontFamily { get => _fontFamily; set => Set(ref _fontFamily, value); }
    public double FontSize { get => _fontSize; set => Set(ref _fontSize, value); }
    public string DefaultUsername { get => _defaultUsername; set => Set(ref _defaultUsername, value); }
    public int DefaultPort { get => _defaultPort; set => Set(ref _defaultPort, value); }
    public int KeepAliveSeconds { get => _keepAliveSeconds; set => Set(ref _keepAliveSeconds, value); }
    public bool ConfirmDelete { get => _confirmDelete; set => Set(ref _confirmDelete, value); }
    public bool RecordSessions { get => _recordSessions; set => Set(ref _recordSessions, value); }
    public bool StrictHostKeys { get => _strictHostKeys; set => Set(ref _strictHostKeys, value); }
    public bool ShowHiddenFiles { get => _showHiddenFiles; set => Set(ref _showHiddenFiles, value); }
    public string HostView { get => _hostView; set => Set(ref _hostView, value); }
}

public sealed class AppData
{
    public int SchemaVersion { get; set; } = 1;
    public ObservableCollection<HostProfile> Hosts { get; set; } = new();
    public ObservableCollection<HostGroup> Groups { get; set; } = new();
    public ObservableCollection<SshKeyRecord> Keys { get; set; } = new();
    public ObservableCollection<KnownHostRecord> KnownHosts { get; set; } = new();
    public ObservableCollection<TunnelConfig> Tunnels { get; set; } = new();
    public ObservableCollection<Snippet> Snippets { get; set; } = new();
    public ObservableCollection<CommandHistoryRecord> CommandHistory { get; set; } = new();
    public ObservableCollection<AuditEvent> Audit { get; set; } = new();
    public AppSettings Settings { get; set; } = new();
}
