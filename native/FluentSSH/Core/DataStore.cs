using System.Collections.ObjectModel;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FluentSSH.Core;

public sealed class AppPaths
{
    public string Root { get; }
    public string StoreFile => Path.Combine(Root, "store.json");
    public string SecretsFile => Path.Combine(Root, "secrets.json");
    public string KeysDirectory => Path.Combine(Root, "keys");
    public string LogsDirectory => Path.Combine(Root, "logs");
    public string ExportsDirectory => Path.Combine(Root, "exports");

    public AppPaths()
    {
        var overrideRoot = Environment.GetEnvironmentVariable("FLUENTSSH_DATA_DIR");
        Root = string.IsNullOrWhiteSpace(overrideRoot)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FluentSSH")
            : Path.GetFullPath(overrideRoot);
    }

    public void Ensure()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(KeysDirectory);
        Directory.CreateDirectory(LogsDirectory);
        Directory.CreateDirectory(ExportsDirectory);
    }
}

internal sealed class SecretsFile
{
    public Dictionary<string, string> HostPasswords { get; set; } = new();
    public Dictionary<string, string> HostPassphrases { get; set; } = new();
}

/// <summary>
/// Local JSON persistence with Windows DPAPI protection for credentials.
/// Data lives under %APPDATA%\FluentSSH by default. Atomic writes, no cloud.
/// </summary>
public sealed class DataStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly object _sync = new();
    private readonly byte[] _entropy = Encoding.UTF8.GetBytes("FluentSSH.Native.v1");
    private bool _loaded;

    public AppPaths Paths { get; }
    public AppData Data { get; private set; } = new();
    public AppSettings Settings => Data.Settings;

    public DataStore(AppPaths paths)
    {
        Paths = paths;
    }

    public void Load()
    {
        lock (_sync)
        {
            if (_loaded) return;
            Paths.Ensure();
            Data = LoadJson<AppData>(Paths.StoreFile) ?? new AppData();
            Normalize(Data);
            LoadSecrets();
            _loaded = true;
        }
    }

    private static void Normalize(AppData data)
    {
        data.Hosts ??= new ObservableCollection<HostProfile>();
        data.Groups ??= new ObservableCollection<HostGroup>();
        data.Keys ??= new ObservableCollection<SshKeyRecord>();
        data.KnownHosts ??= new ObservableCollection<KnownHostRecord>();
        data.Tunnels ??= new ObservableCollection<TunnelConfig>();
        data.Snippets ??= new ObservableCollection<Snippet>();
        data.CommandHistory ??= new ObservableCollection<CommandHistoryRecord>();
        data.Audit ??= new ObservableCollection<AuditEvent>();
        data.Settings ??= new AppSettings();
    }

    public void Save()
    {
        lock (_sync)
        {
            try
            {
                Paths.Ensure();
                SaveSecrets();
                SaveJson(Paths.StoreFile, Data);
            }
            catch (Exception ex)
            {
                AppServices.LogError("保存本地数据失败", ex);
            }
        }
    }

    private void LoadSecrets()
    {
        var secrets = LoadJson<SecretsFile>(Paths.SecretsFile) ?? new SecretsFile();
        foreach (var host in Data.Hosts)
        {
            if (secrets.HostPasswords.TryGetValue(host.Id, out var password))
                host.Password = Unprotect(password);
            if (secrets.HostPassphrases.TryGetValue(host.Id, out var passphrase))
                host.Passphrase = Unprotect(passphrase);
        }
    }

    private void SaveSecrets()
    {
        var secrets = new SecretsFile();
        foreach (var host in Data.Hosts)
        {
            if (!string.IsNullOrEmpty(host.Password))
                secrets.HostPasswords[host.Id] = Protect(host.Password);
            if (!string.IsNullOrEmpty(host.Passphrase))
                secrets.HostPassphrases[host.Id] = Protect(host.Passphrase);
        }
        SaveJson(Paths.SecretsFile, secrets);
    }

    public string Protect(string value)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(value);
            var protectedBytes = ProtectedData.Protect(bytes, _entropy, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(protectedBytes);
        }
        catch (Exception ex)
        {
            AppServices.LogError("Windows DPAPI 加密失败", ex);
            throw;
        }
    }

    public string? Unprotect(string value)
    {
        try
        {
            var bytes = Convert.FromBase64String(value);
            var clear = ProtectedData.Unprotect(bytes, _entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(clear);
        }
        catch
        {
            return null;
        }
    }

    private static T? LoadJson<T>(string path) where T : class
    {
        try
        {
            if (!File.Exists(path)) return null;
            var text = File.ReadAllText(path, Encoding.UTF8);
            return string.IsNullOrWhiteSpace(text) ? null : JsonSerializer.Deserialize<T>(text, JsonOptions);
        }
        catch
        {
            TryBackupCorrupt(path);
            return null;
        }
    }

    private static void SaveJson<T>(string path, T value)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(value, JsonOptions), new UTF8Encoding(false));
        File.Move(tmp, path, overwrite: true);
    }

    private static void TryBackupCorrupt(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Copy(path, $"{path}.corrupt-{DateTime.Now:yyyyMMddHHmmss}", overwrite: true);
        }
        catch
        {
            // ignore
        }
    }

    public HostProfile? FindHost(string? id) => string.IsNullOrEmpty(id) ? null : Data.Hosts.FirstOrDefault(h => h.Id == id);
    public HostGroup? FindGroup(string? id) => string.IsNullOrEmpty(id) ? null : Data.Groups.FirstOrDefault(g => g.Id == id);
    public SshKeyRecord? FindKey(string? id) => string.IsNullOrEmpty(id) ? null : Data.Keys.FirstOrDefault(k => k.Id == id);
    public TunnelConfig? FindTunnel(string id) => Data.Tunnels.FirstOrDefault(t => t.Id == id);
    public string HostGroupName(HostProfile host) => FindGroup(host.GroupId)?.Name ?? "未分组";
    public KnownHostRecord? FindKnownHost(string hostname, int port) => Data.KnownHosts.FirstOrDefault(k => k.Hostname.Equals(hostname, StringComparison.OrdinalIgnoreCase) && k.Port == port);
    public void RemoveHost(HostProfile host) => Data.Hosts.Remove(host);
    public string NewSessionLogPath(HostProfile host)
    {
        var safe = string.Concat(host.Name.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch));
        return Path.Combine(Paths.LogsDirectory, $"{DateTime.Now:yyyyMMdd-HHmmss}-{safe}.log");
    }
}
