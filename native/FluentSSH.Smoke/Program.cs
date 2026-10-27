using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using FluentSSH.Core;
using Renci.SshNet;

var failures = 0;
var passed = 0;

var smokeData = Path.Combine(Path.GetTempPath(), "fluentssh-native-smoke");
try
{
    if (Directory.Exists(smokeData)) Directory.Delete(smokeData, recursive: true);
}
catch
{
    // previous process may still hold a log handle; reuse the directory
}
Environment.SetEnvironmentVariable("FLUENTSSH_DATA_DIR", smokeData);
AppServices.Initialize();

void SeedLab()
{
    string? FindLab()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        for (var i = 0; i < 6 && dir is not null; i++)
        {
            var candidate = Path.Combine(dir.FullName, "tests", ".artifacts", "mock-lab.json");
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return null;
    }

    var labPath = Environment.GetEnvironmentVariable("FLUENTSSH_LAB_FILE") ?? FindLab();
    if (labPath is null || !File.Exists(labPath))
        throw new FileNotFoundException("mock-lab.json not found. Start pnpm mock-lab first.");
    using var doc = JsonDocument.Parse(File.ReadAllText(labPath));
    var root = doc.RootElement;
    var group = AppServices.Data.Groups.FirstOrDefault(g => g.Name == "Smoke Lab")
                ?? new HostGroup { Id = "smoke-lab", Name = "Smoke Lab" };
    if (!AppServices.Data.Groups.Contains(group)) AppServices.Data.Groups.Add(group);

    HostProfile EnsureHost(string name, JsonElement server)
    {
        var host = AppServices.Data.Hosts.FirstOrDefault(h => h.Name == name);
        if (host is null)
        {
            host = new HostProfile { Id = name.Replace(" ", "-").ToLowerInvariant(), Name = name };
            AppServices.Data.Hosts.Add(host);
        }
        host.Hostname = server.GetProperty("host").GetString()!;
        host.Port = server.GetProperty("port").GetInt32();
        host.Username = server.GetProperty("username").GetString()!;
        host.Password = server.GetProperty("password").GetString();
        host.AuthKind = AuthKind.Password;
        host.GroupId = group.Id;
        host.KeepAlive = true;
        return host;
    }

    var sshHost = EnsureHost("Mock SSH", root.GetProperty("ssh"));
    var sftpHost = EnsureHost("Mock SFTP", root.GetProperty("sftp"));
    foreach (var server in new[] { root.GetProperty("ssh"), root.GetProperty("sftp") })
    {
        var hostname = server.GetProperty("host").GetString()!;
        var port = server.GetProperty("port").GetInt32();
        var fingerprint = server.GetProperty("fingerprint").GetString()!;
        var keyType = server.GetProperty("keyType").GetString()!;
        var known = AppServices.Data.KnownHosts.FirstOrDefault(k => k.Hostname == hostname && k.Port == port);
        if (known is null)
        {
            AppServices.Data.KnownHosts.Add(new KnownHostRecord
            {
                Hostname = hostname,
                Port = port,
                KeyType = keyType,
                Fingerprint = fingerprint
            });
        }
        else
        {
            known.Fingerprint = fingerprint;
            known.KeyType = keyType;
        }
    }
    _ = sshHost;
    _ = sftpHost;
    AppServices.Store.Save();
}

void Check(string name, bool ok, string detail = "")
{
    if (ok) { passed++; Console.WriteLine($"PASS {name} {detail}"); }
    else { failures++; Console.WriteLine($"FAIL {name} {detail}"); }
}

try
{
    SeedLab();
}
catch (Exception ex)
{
    Console.WriteLine($"FAIL seed lab {ex.Message}");
    return 1;
}

Console.WriteLine($"data={AppServices.Paths.Root}");

var sshHost = AppServices.Data.Hosts.FirstOrDefault(h => h.Name == "Mock SSH");
var sftpHost = AppServices.Data.Hosts.FirstOrDefault(h => h.Name == "Mock SFTP");
Check("seed hosts", sshHost is not null && sftpHost is not null);
if (sshHost is null || sftpHost is null) return 1;

try
{
    using var client = await AppServices.Ssh.ConnectAsync(sshHost);
    Check("ssh connect", client.IsConnected);
    var exec = await AppServices.Ssh.ExecuteAsync(sshHost, "uname -a");
    Check("exec", exec.ExitCode is not null || !string.IsNullOrWhiteSpace(exec.Output) || !string.IsNullOrWhiteSpace(exec.Error),
        $"exit={exec.ExitCode} out={exec.Output.Trim()} err={exec.Error.Trim()}");

    using var shell = client.CreateShellStream("xterm-256color", 120, 32, 0, 0, 8192);
    await Task.Delay(300);
    var buffer = new byte[8192];
    var banner = new StringBuilder();
    while (shell.DataAvailable)
    {
        var read = shell.Read(buffer, 0, buffer.Length);
        if (read <= 0) break;
        banner.Append(Encoding.UTF8.GetString(buffer, 0, read));
    }
    shell.Write("uname -a\r");
    await Task.Delay(500);
    while (shell.DataAvailable)
    {
        var read = shell.Read(buffer, 0, buffer.Length);
        if (read <= 0) break;
        banner.Append(Encoding.UTF8.GetString(buffer, 0, read));
    }
    Check("shell stream", banner.Length > 0 && banner.ToString().Contains("shell #", StringComparison.OrdinalIgnoreCase),
        banner.ToString().Replace("\r", " ").Replace("\n", " ").Trim());
}
catch (Exception ex)
{
    failures++;
    Console.WriteLine($"FAIL ssh core {ex}");
}

try
{
    using var sftp = await AppServices.Ssh.ConnectSftpAsync(sftpHost);
    var entries = sftp.ListDirectory("/").Where(e => e.Name is not "." and not "..").ToList();
    Check("sftp list", entries.Count > 0, string.Join(",", entries.Select(e => e.Name)));
    var tempUpload = Path.Combine(Path.GetTempPath(), "fluentssh-native-upload.txt");
    await File.WriteAllTextAsync(tempUpload, "native sftp check\n");
    using (var uploadStream = File.OpenRead(tempUpload)) sftp.UploadFile(uploadStream, "/native-upload.txt", true);
    Check("sftp upload", sftp.Exists("/native-upload.txt"));
    using var download = new MemoryStream();
    sftp.DownloadFile("/native-upload.txt", download);
    Check("sftp download", Encoding.UTF8.GetString(download.ToArray()).Contains("native sftp check"));
    sftp.DeleteFile("/native-upload.txt");
    File.Delete(tempUpload);
}
catch (Exception ex)
{
    failures++;
    Console.WriteLine($"FAIL sftp {ex}");
}

try
{
    var lab = System.Text.Json.JsonDocument.Parse(File.ReadAllText(@"D:\ssh\tests\.artifacts\mock-lab.json"));
    var targetPort = lab.RootElement.GetProperty("httpTarget").GetProperty("port").GetInt32();
    var tunnel = new TunnelConfig
    {
        Name = "smoke-native",
        HostId = sshHost.Id,
        Kind = TunnelKind.Local,
        BindHost = "127.0.0.1",
        BindPort = 18980,
        TargetHost = "127.0.0.1",
        TargetPort = targetPort
    };
    var started = await AppServices.Tunnels.StartAsync(tunnel, sshHost);
    Check("tunnel start", started, tunnel.LastError);
    if (started)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var response = await http.GetAsync("http://127.0.0.1:18980/health");
        var text = await response.Content.ReadAsStringAsync();
        Check("tunnel http", response.IsSuccessStatusCode, $"{(int)response.StatusCode} {text.Trim()}");
        AppServices.Tunnels.Stop(tunnel);
    }
}
catch (Exception ex)
{
    failures++;
    Console.WriteLine($"FAIL tunnel {ex}");
}

try
{
    var key = KeyService.GenerateRsa("smoke-key");
    AppServices.Data.Keys.Add(key);
    Check("key generate", File.Exists(key.PrivateKeyPath) && key.Fingerprint.StartsWith("SHA256:"), key.Fingerprint);
    Check("key parse", KeyService.ValidatePrivateKey(key.PrivateKeyPath), key.PrivateKeyPath);
    AppServices.Data.Keys.Remove(key);
    File.Delete(key.PrivateKeyPath);
    var pub = key.PrivateKeyPath + ".pub";
    if (File.Exists(pub)) File.Delete(pub);
}
catch (Exception ex)
{
    failures++;
    Console.WriteLine($"FAIL key {ex}");
}

Console.WriteLine($"RESULT passed={passed} failed={failures}");
return failures == 0 ? 0 : 1;
