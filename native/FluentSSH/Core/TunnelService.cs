using Renci.SshNet;

namespace FluentSSH.Core;

/// <summary>Manages live SSH.NET forwarded ports for persisted tunnel configs.</summary>
public sealed class TunnelService
{
    private sealed class TunnelRuntime
    {
        public required SshClient Client { get; init; }
        public required ForwardedPort Port { get; init; }
    }

    private DataStore? _store;
    private readonly Dictionary<string, TunnelRuntime> _runtimes = new();

    public void Initialize(DataStore store)
    {
        _store = store;
        foreach (var tunnel in store.Data.Tunnels)
        {
            tunnel.Status = TunnelStatus.Stopped;
            tunnel.LastError = string.Empty;
        }
    }

    public async Task<bool> StartAsync(TunnelConfig tunnel, HostProfile host)
    {
        if (_runtimes.ContainsKey(tunnel.Id)) return true;
        tunnel.Status = TunnelStatus.Stopped;
        tunnel.LastError = string.Empty;
        try
        {
            var client = await AppServices.Ssh.ConnectAsync(host);
            var port = BuildPort(tunnel);
            client.AddForwardedPort(port);
            port.Start();
            _runtimes[tunnel.Id] = new TunnelRuntime { Client = client, Port = port };
            tunnel.Status = TunnelStatus.Running;
            tunnel.HostName = host.Name;
            tunnel.LastError = string.Empty;
            _store?.Save();
            AppServices.Audit.Record("tunnel", $"隧道已启动 {tunnel.Name}，{tunnel.RouteLabel}", AuditLevel.Info, host);
            return true;
        }
        catch (Exception ex)
        {
            tunnel.Status = TunnelStatus.Error;
            tunnel.LastError = SshService.FriendlyError(ex);
            _store?.Save();
            AppServices.Audit.Record("tunnel", $"隧道启动失败 {tunnel.Name}：{tunnel.LastError}", AuditLevel.Error, host);
            return false;
        }
    }

    private static ForwardedPort BuildPort(TunnelConfig tunnel)
    {
        var bindPort = (uint)Math.Clamp(tunnel.BindPort, 0, 65535);
        var targetPort = (uint)Math.Clamp(tunnel.TargetPort, 0, 65535);
        return tunnel.Kind switch
        {
            TunnelKind.Dynamic => new ForwardedPortDynamic(
                string.IsNullOrWhiteSpace(tunnel.BindHost) ? "127.0.0.1" : tunnel.BindHost,
                bindPort),
            TunnelKind.Remote => new ForwardedPortRemote(
                string.IsNullOrWhiteSpace(tunnel.BindHost) ? "127.0.0.1" : tunnel.BindHost,
                bindPort,
                string.IsNullOrWhiteSpace(tunnel.TargetHost) ? "127.0.0.1" : tunnel.TargetHost,
                targetPort),
            _ => new ForwardedPortLocal(
                string.IsNullOrWhiteSpace(tunnel.BindHost) ? "127.0.0.1" : tunnel.BindHost,
                bindPort,
                string.IsNullOrWhiteSpace(tunnel.TargetHost) ? "127.0.0.1" : tunnel.TargetHost,
                targetPort)
        };
    }

    public void Stop(TunnelConfig tunnel)
    {
        if (!_runtimes.Remove(tunnel.Id, out var runtime)) return;
        try { runtime.Port.Stop(); } catch { /* ignore */ }
        try { runtime.Port.Dispose(); } catch { /* ignore */ }
        try { runtime.Client.Dispose(); } catch { /* ignore */ }
        tunnel.Status = TunnelStatus.Stopped;
        tunnel.LastError = string.Empty;
        _store?.Save();
        AppServices.Audit.Record("tunnel", $"隧道已停止 {tunnel.Name}", AuditLevel.Info,
            _store?.FindHost(tunnel.HostId));
    }

    public bool IsRunning(string tunnelId) => _runtimes.ContainsKey(tunnelId);

    public async Task AutoStartAsync()
    {
        if (_store is null) return;
        foreach (var tunnel in _store.Data.Tunnels.Where(t => t.AutoStart).ToList())
        {
            var host = _store.FindHost(tunnel.HostId);
            if (host is null) continue;
            await StartAsync(tunnel, host);
        }
    }

    public void StopAll()
    {
        foreach (var tunnel in _store?.Data.Tunnels.ToList() ?? new List<TunnelConfig>())
        {
            Stop(tunnel);
        }
        _runtimes.Clear();
    }
}
