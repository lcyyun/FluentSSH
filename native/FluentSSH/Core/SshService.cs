using System.IO;
using System.Net.Sockets;
using System.Windows;
using Renci.SshNet;
using Renci.SshNet.Common;
using FluentSSH.Dialogs;

namespace FluentSSH.Core;

public sealed class CommandResult
{
    public string Output { get; init; } = string.Empty;
    public string Error { get; init; } = string.Empty;
    public int? ExitCode { get; init; }
    public long DurationMs { get; init; }
}

/// <summary>
/// SSH.NET connection plumbing shared by terminal, SFTP, tunnels and commands.
/// Includes known-hosts verification, DPAPI credentials, keyboard-interactive
/// prompts and friendly error messages.
/// </summary>
public sealed class SshService
{
    public async Task<SshClient> ConnectAsync(HostProfile host, CancellationToken cancellationToken = default)
        => await Task.Run(() => ConnectInternal(host), cancellationToken);

    public async Task<SftpClient> ConnectSftpAsync(HostProfile host, CancellationToken cancellationToken = default)
        => await Task.Run(() => ConnectSftpInternal(host), cancellationToken);

    private SshClient ConnectInternal(HostProfile host)
    {
        var client = new SshClient(BuildConnectionInfo(host));
        AttachVerification(client, host);
        try
        {
            client.Connect();
            client.KeepAliveInterval = KeepAlive(host);
            AppServices.Audit.Record("connection", $"已连接 {host.Name}", AuditLevel.Info, host);
            return client;
        }
        catch (Exception ex)
        {
            client.Dispose();
            AppServices.Audit.Record("connection", $"连接失败 {host.Name}：{FriendlyError(ex)}", AuditLevel.Error, host);
            throw new InvalidOperationException(FriendlyError(ex), ex);
        }
    }

    private SftpClient ConnectSftpInternal(HostProfile host)
    {
        var client = new SftpClient(BuildConnectionInfo(host));
        AttachVerification(client, host);
        try
        {
            client.Connect();
            client.KeepAliveInterval = KeepAlive(host);
            AppServices.Audit.Record("sftp", $"SFTP 已连接 {host.Name}", AuditLevel.Info, host);
            return client;
        }
        catch (Exception ex)
        {
            client.Dispose();
            AppServices.Audit.Record("sftp", $"SFTP 连接失败 {host.Name}：{FriendlyError(ex)}", AuditLevel.Error, host);
            throw new InvalidOperationException(FriendlyError(ex), ex);
        }
    }

    private static TimeSpan KeepAlive(HostProfile host)
    {
        if (!host.KeepAlive) return TimeSpan.FromMilliseconds(-1);
        var seconds = Math.Clamp(AppServices.Settings.KeepAliveSeconds, 10, 600);
        return TimeSpan.FromSeconds(seconds);
    }

    private ConnectionInfo BuildConnectionInfo(HostProfile host)
    {
        var methods = new List<AuthenticationMethod>();
        var settings = AppServices.Settings;
        switch (host.AuthKind)
        {
            case AuthKind.Password:
                if (string.IsNullOrEmpty(host.Password))
                    throw new InvalidOperationException("该主机尚未保存密码，请编辑主机填写密码。");
                methods.Add(new PasswordAuthenticationMethod(host.Username, host.Password));
                break;
            case AuthKind.PrivateKey:
            {
                var key = AppServices.Store.FindKey(host.KeyId);
                if (key is null || !File.Exists(key.PrivateKeyPath))
                    throw new InvalidOperationException("该主机未选择有效的私钥，请编辑主机选择密钥。");
                PrivateKeyFile privateKey;
                try
                {
                    privateKey = string.IsNullOrEmpty(host.Passphrase)
                        ? new PrivateKeyFile(key.PrivateKeyPath)
                        : new PrivateKeyFile(key.PrivateKeyPath, host.Passphrase);
                }
                catch (Exception ex)
                {
                    throw new InvalidOperationException($"读取私钥失败：{ex.Message}", ex);
                }
                methods.Add(new PrivateKeyAuthenticationMethod(host.Username, privateKey));
                break;
            }
            case AuthKind.KeyboardInteractive:
                break;
        }

        var keyboard = new KeyboardInteractiveAuthenticationMethod(host.Username);
        keyboard.AuthenticationPrompt += (_, args) => PromptKeyboardInteractive(host, args);
        methods.Add(keyboard);

        var connectionInfo = new ConnectionInfo(
            host.Hostname,
            host.Port,
            host.Username,
            methods.ToArray())
        {
            Timeout = TimeSpan.FromSeconds(20),
            RetryAttempts = 1
        };
        _ = settings;
        return connectionInfo;
    }

    private void AttachVerification(BaseClient client, HostProfile host)
    {
        client.HostKeyReceived += (_, args) => args.CanTrust = VerifyHostKey(host, args);
    }

    private static bool VerifyHostKey(HostProfile host, HostKeyEventArgs args)
    {
        var fingerprint = $"SHA256:{args.FingerPrintSHA256}";
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null)
        {
            return AppServices.Store.FindKnownHost(host.Hostname, host.Port)?.Fingerprint == fingerprint;
        }

        return dispatcher.Invoke(() =>
        {
            var store = AppServices.Store;
            var existing = store.FindKnownHost(host.Hostname, host.Port);
            if (existing is not null && existing.Fingerprint == fingerprint)
            {
                existing.LastSeenAt = DateTime.Now;
                return true;
            }

            if (existing is null && !AppServices.Settings.StrictHostKeys)
            {
                store.Data.KnownHosts.Add(new KnownHostRecord
                {
                    Hostname = host.Hostname,
                    Port = host.Port,
                    KeyType = args.HostKeyName,
                    Fingerprint = fingerprint
                });
                store.Save();
                return true;
            }

            var dialog = new HostKeyDialog(host, args, existing)
            {
                Owner = AppServices.MainWindow
            };
            if (dialog.ShowDialog() != true)
            {
                AppServices.Audit.Record("security", $"已拒绝 {host.Hostname}:{host.Port} 的主机密钥", AuditLevel.Warning, host,
                    fingerprint);
                return false;
            }

            if (existing is null)
            {
                store.Data.KnownHosts.Add(new KnownHostRecord
                {
                    Hostname = host.Hostname,
                    Port = host.Port,
                    KeyType = args.HostKeyName,
                    Fingerprint = fingerprint
                });
            }
            else
            {
                existing.KeyType = args.HostKeyName;
                existing.Fingerprint = fingerprint;
                existing.LastSeenAt = DateTime.Now;
            }
            store.Save();
            AppServices.Audit.Record("security", $"已信任 {host.Hostname}:{host.Port} 的主机密钥", AuditLevel.Info, host, fingerprint);
            return true;
        });
    }

    private static void PromptKeyboardInteractive(HostProfile host, AuthenticationPromptEventArgs args)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            foreach (var prompt in args.Prompts) prompt.Response = string.Empty;
            return;
        }

        dispatcher.Invoke(() =>
        {
            var dialog = new AuthPromptDialog(host, args)
            {
                Owner = AppServices.MainWindow
            };
            var accepted = dialog.ShowDialog() == true;
            var responses = accepted ? dialog.GetResponses() : Array.Empty<string>();
            for (var i = 0; i < args.Prompts.Count; i++)
            {
                args.Prompts[i].Response = i < responses.Length ? responses[i] : string.Empty;
            }
        });
    }

    public async Task<CommandResult> ExecuteAsync(HostProfile host, string command, int timeoutSeconds = 120,
        CancellationToken cancellationToken = default)
    {
        return await Task.Run(() =>
        {
            var started = DateTime.Now;
            using var client = ConnectInternal(host);
            using var cmd = client.CreateCommand(command);
            cmd.CommandTimeout = TimeSpan.FromSeconds(Math.Clamp(timeoutSeconds, 5, 600));
            try
            {
                var output = cmd.Execute();
                return new CommandResult
                {
                    Output = output,
                    Error = cmd.Error,
                    ExitCode = cmd.ExitStatus,
                    DurationMs = (long)(DateTime.Now - started).TotalMilliseconds
                };
            }
            catch (Exception ex)
            {
                return new CommandResult
                {
                    Output = string.Empty,
                    Error = FriendlyError(ex),
                    ExitCode = null,
                    DurationMs = (long)(DateTime.Now - started).TotalMilliseconds
                };
            }
        }, cancellationToken);
    }

    public static string FriendlyError(Exception ex)
    {
        return ex switch
        {
            SshAuthenticationException => "认证失败，请检查用户名、密码或密钥。",
            SshConnectionException { Message: var msg } when msg.Contains("host key", StringComparison.OrdinalIgnoreCase)
                => "主机密钥校验失败，连接已中止。",
            SshConnectionException ssh => $"SSH 连接失败：{ssh.Message}",
            SocketException => "无法连接到服务器，请检查地址、端口与网络。",
            TimeoutException => "连接超时。",
            _ => ex.Message
        };
    }
}
