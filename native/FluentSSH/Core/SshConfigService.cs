using System.IO;
using System.Text;

namespace FluentSSH.Core;

/// <summary>Import and export a practical subset of OpenSSH config files.</summary>
public static class SshConfigService
{
    public static int ImportFromFile(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("找不到 SSH Config 文件。", path);
        var lines = File.ReadAllLines(path);
        var blocks = ParseBlocks(lines);
        if (blocks.Count == 0) return 0;

        var group = AppServices.Data.Groups.FirstOrDefault(g => g.Name == "SSH Config");
        if (group is null)
        {
            group = new HostGroup { Name = "SSH Config" };
            AppServices.Data.Groups.Add(group);
        }

        var imported = 0;
        foreach (var block in blocks)
        {
            if (string.IsNullOrWhiteSpace(block.Alias)) continue;
            if (block.Alias.Contains('*') || block.Alias.Contains('?')) continue;
            if (AppServices.Data.Hosts.Any(h => h.Name.Equals(block.Alias, StringComparison.CurrentCultureIgnoreCase))) continue;

            var hostname = string.IsNullOrWhiteSpace(block.HostName) ? block.Alias : block.HostName;
            var port = block.Port is > 0 and <= 65535 ? block.Port.Value : 22;
            var username = string.IsNullOrWhiteSpace(block.User) ? AppServices.Settings.DefaultUsername : block.User;
            var host = new HostProfile
            {
                Name = block.Alias,
                Hostname = hostname,
                Port = port,
                Username = username,
                GroupId = group.Id,
                Notes = "从 SSH Config 导入",
                KeepAlive = true
            };

            var identity = ExpandPath(block.IdentityFile);
            if (!string.IsNullOrWhiteSpace(identity) && File.Exists(identity))
            {
                var key = AppServices.Data.Keys.FirstOrDefault(k =>
                    string.Equals(Path.GetFullPath(k.PrivateKeyPath), Path.GetFullPath(identity), StringComparison.OrdinalIgnoreCase));
                if (key is null)
                {
                    key = new SshKeyRecord
                    {
                        Name = Path.GetFileNameWithoutExtension(identity),
                        Algorithm = Path.GetExtension(identity).Equals(".pub", StringComparison.OrdinalIgnoreCase) ? "公钥" : "私钥",
                        PrivateKeyPath = identity
                    };
                    AppServices.Data.Keys.Add(key);
                }
                host.AuthKind = AuthKind.PrivateKey;
                host.KeyId = key.Id;
            }
            else
            {
                host.AuthKind = AuthKind.Password;
            }

            AppServices.Data.Hosts.Add(host);
            imported++;
        }

        AppServices.Store.Save();
        AppServices.Audit.Record("system", $"从 SSH Config 导入 {imported} 台主机", AuditLevel.Info, detail: path);
        return imported;
    }

    private static string ExpandPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return string.Empty;
        if (path.StartsWith("~"))
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), path.TrimStart('~', '/', '\\'));
        return Environment.ExpandEnvironmentVariables(path);
    }

    private sealed class Block
    {
        public string Alias { get; set; } = string.Empty;
        public string HostName { get; set; } = string.Empty;
        public string User { get; set; } = string.Empty;
        public int? Port { get; set; }
        public string? IdentityFile { get; set; }
    }

    private static List<Block> ParseBlocks(string[] lines)
    {
        var result = new List<Block>();
        Block? current = null;
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var split = line.Split(new[] { ' ', '\t' }, 2, StringSplitOptions.RemoveEmptyEntries);
            if (split.Length < 2) continue;
            var key = split[0];
            var value = split[1].Trim().Trim('"');
            if (key.Equals("Host", StringComparison.OrdinalIgnoreCase))
            {
                var aliases = value.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                current = new Block { Alias = aliases.FirstOrDefault() ?? string.Empty };
                result.Add(current);
            }
            else if (key.Equals("Match", StringComparison.OrdinalIgnoreCase))
            {
                current = null;
            }
            else if (current is not null)
            {
                if (key.Equals("HostName", StringComparison.OrdinalIgnoreCase)) current.HostName = value;
                else if (key.Equals("User", StringComparison.OrdinalIgnoreCase)) current.User = value;
                else if (key.Equals("Port", StringComparison.OrdinalIgnoreCase) && int.TryParse(value, out var port)) current.Port = port;
                else if (key.Equals("IdentityFile", StringComparison.OrdinalIgnoreCase)) current.IdentityFile = value;
            }
        }
        return result;
    }

    public static string ExportToFile(IEnumerable<HostProfile> hosts, string fileName)
    {
        Directory.CreateDirectory(AppServices.Paths.ExportsDirectory);
        var safe = string.Concat(fileName.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) ? '_' : ch));
        var path = Path.Combine(AppServices.Paths.ExportsDirectory, safe + ".conf");
        var builder = new StringBuilder();
        builder.AppendLine("# Exported by FluentSSH");
        foreach (var host in hosts)
        {
            builder.AppendLine();
            builder.AppendLine($"Host {host.Name}");
            builder.AppendLine($"    HostName {host.Hostname}");
            builder.AppendLine($"    User {host.Username}");
            if (host.Port != 22) builder.AppendLine($"    Port {host.Port}");
            var key = AppServices.Store.FindKey(host.KeyId);
            if (key is not null) builder.AppendLine($"    IdentityFile \"{key.PrivateKeyPath}\"");
        }
        File.WriteAllText(path, builder.ToString(), new UTF8Encoding(false));
        return path;
    }
}
