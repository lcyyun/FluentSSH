using System.IO;
using System.Text;
using System.Windows;
using Renci.SshNet;
using Renci.SshNet.Common;
using XtermSharp;
using XtermSharp.Events;
using XtermSharp.Options;
using XtermSharp.Wpf.Controls;

namespace FluentSSH.Core;

public enum SessionState
{
    Connecting,
    Connected,
    Disconnected,
    Error,
    Closed
}

/// <summary>
/// One native SSH shell session: SSH.NET shell stream ⇄ XtermSharp terminal.
/// The Terminal and its WPF view live for the lifetime of the tab.
/// </summary>
public sealed class TerminalSession : ObservableObject, IDisposable
{
    private readonly object _logSync = new();
    private readonly object _writeSync = new();
    private bool _firstDataLogged;
    private Task? _readTask;
    private SessionState _state = SessionState.Connecting;
    private string _detail = string.Empty;
    private string _title;
    private bool _disposed;

    public string Id { get; } = Guid.NewGuid().ToString("N");
    public HostProfile Host { get; }
    public Terminal Terminal { get; }
    public TerminalView View { get; }
    public SshClient? Client { get; private set; }
    public ShellStream? Shell { get; private set; }
    public DateTime StartedAt { get; } = DateTime.Now;
    public string? Fingerprint { get; private set; }
    public string? LogPath { get; private set; }

    public SessionState State
    {
        get => _state;
        private set
        {
            if (Set(ref _state, value))
            {
                Raise(nameof(StateLabel));
                StateChanged?.Invoke(this);
            }
        }
    }

    public string Detail { get => _detail; private set => Set(ref _detail, value); }
    public string Title { get => _title; private set => Set(ref _title, value); }
    public string StateLabel => State switch
    {
        SessionState.Connecting => "连接中",
        SessionState.Connected => "已连接",
        SessionState.Disconnected => "已断开",
        SessionState.Error => "错误",
        _ => "已关闭"
    };

    public event Action<TerminalSession>? StateChanged;

    public TerminalSession(HostProfile host)
    {
        Host = host;
        _title = host.Name;
        Terminal = new Terminal(new TerminalOptions
        {
            Columns = 120,
            Rows = 32,
            Scrollback = 5000
        });
        View = new TerminalView
        {
            Terminal = Terminal,
            Margin = new Thickness(0),
            Padding = new Thickness(12, 10, 12, 10)
        };
        try
        {
            View.FontFamily = new System.Windows.Media.FontFamily(AppServices.Settings.FontFamily);
            View.FontSize = AppServices.Settings.FontSize;
        }
        catch
        {
            // font settings are best-effort across XtermSharp versions
        }
        Terminal.Data += OnTerminalData;
        Terminal.TitleChanged += (_, e) =>
        {
            var title = e.GetType().GetProperty("Title")?.GetValue(e) as string;
            OnTerminalTitleChanged(title);
        };
    }

    public async Task StartAsync(string? initialCommand = null)
    {
        State = SessionState.Connecting;
        Detail = "正在建立 SSH 连接…";
        try
        {
            var client = await AppServices.Ssh.ConnectAsync(Host);
            if (_disposed)
            {
                client.Dispose();
                return;
            }
            Client = client;
            var shell = await Task.Run(() => client.CreateShellStream(
                "xterm-256color",
                (uint)Math.Max(Terminal.Columns, 20),
                (uint)Math.Max(Terminal.Rows, 5),
                0,
                0,
                8192));
            if (_disposed)
            {
                shell.Dispose();
                client.Dispose();
                return;
            }
            Shell = shell;
            shell.ErrorOccurred += OnShellError;
            shell.Closed += OnShellClosed;
            _readTask = Task.Run(() => ReadShellLoopAsync(shell));

            if (AppServices.Settings.RecordSessions)
            {
                LogPath = AppServices.Store.NewSessionLogPath(Host);
                AppServices.Audit.Record("connection", $"开始记录会话 {Host.Name}", AuditLevel.Info, Host, LogPath);
            }

            Fingerprint = AppServices.Store.FindKnownHost(Host.Hostname, Host.Port)?.Fingerprint;
            State = SessionState.Connected;
            Detail = $"{Host.Username}@{Host.Hostname}:{Host.Port}";
            AppServices.MarkHostConnected(Host);
            AppServices.Audit.Record("connection", $"终端会话已连接 {Host.Name}", AuditLevel.Info, Host);

            if (!string.IsNullOrWhiteSpace(initialCommand))
            {
                await Task.Delay(350);
                SendText(initialCommand + "\r");
            }
        }
        catch (Exception ex)
        {
            State = SessionState.Error;
            Detail = SshService.FriendlyError(ex);
            AppServices.Audit.Record("connection", $"终端连接失败 {Host.Name}：{Detail}", AuditLevel.Error, Host);
        }
    }

    private async Task ReadShellLoopAsync(ShellStream shell)
    {
        var buffer = new byte[16 * 1024];
        try
        {
            while (!_disposed)
            {
                if (!shell.CanRead) break;
                if (!shell.DataAvailable)
                {
                    await Task.Delay(25);
                    continue;
                }
                var read = shell.Read(buffer, 0, buffer.Length);
                if (read <= 0) continue;
                var data = buffer.AsSpan(0, read).ToArray();
                if (!_firstDataLogged)
                {
                    _firstDataLogged = true;
                    AppServices.Log($"终端收到首批数据 {read} 字节");
                }
                _ = WriteToTerminalAsync(data);
                WriteLog(data);
            }
        }
        catch (Exception ex)
        {
            if (!_disposed) AppServices.LogError("读取 SSH 终端数据失败", ex);
        }
    }

    private async Task WriteToTerminalAsync(byte[] data)
    {
        try
        {
            await Terminal.WriteAsync(new ReadOnlyMemory<byte>(data));
        }
        catch (Exception ex)
        {
            AppServices.LogError("写入终端失败", ex);
        }
    }

    private void WriteLog(byte[] data)
    {
        if (LogPath is null) return;
        try
        {
            lock (_logSync)
            {
                using var stream = new FileStream(LogPath, FileMode.Append, FileAccess.Write, FileShare.Read);
                stream.Write(data);
            }
        }
        catch
        {
            // Session logging must never break the terminal.
        }
    }

    private void OnTerminalData(object? sender, TerminalDataEventArgs e)
    {
        if (string.IsNullOrEmpty(e.Data)) return;
        try
        {
            lock (_writeSync)
            {
                Shell?.Write(e.Data);
            }
        }
        catch (Exception ex)
        {
            AppServices.LogError("发送终端输入失败", ex);
        }
    }

    public void SendText(string text)
    {
        try
        {
            lock (_writeSync)
            {
                Shell?.Write(text);
            }
        }
        catch (Exception ex)
        {
            AppServices.LogError("发送文本失败", ex);
        }
    }

    private void OnTerminalTitleChanged(string? rawTitle)
    {
        var title = rawTitle?.Trim();
        if (!string.IsNullOrWhiteSpace(title) && title != Host.Name)
        {
            var dispatcher = Application.Current?.Dispatcher;
            if (dispatcher is not null) dispatcher.BeginInvoke(() => Title = $"{Host.Name} {title}");
        }
    }

    private void OnShellError(object? sender, ExceptionEventArgs e)
    {
        var dispatcher = Application.Current?.Dispatcher;
        dispatcher?.BeginInvoke(() =>
        {
            Detail = e.Exception.Message;
            State = SessionState.Error;
        });
    }

    private void OnShellClosed(object? sender, EventArgs e)
    {
        var dispatcher = Application.Current?.Dispatcher;
        dispatcher?.BeginInvoke(() =>
        {
            Detail = "远程 Shell 已退出";
            State = SessionState.Disconnected;
        });
    }

    public async Task ResizeAsync(int columns, int rows)
    {
        if (columns < 20 || rows < 5) return;
        if (columns == Terminal.Columns && rows == Terminal.Rows) return;
        try
        {
            await Terminal.ResizeAsync(columns, rows);
            Shell?.ChangeWindowSize((uint)columns, (uint)rows, 0, 0);
        }
        catch (Exception ex)
        {
            AppServices.LogError("调整终端尺寸失败", ex);
        }
    }

    public async Task ReconnectAsync()
    {
        DisposeConnection();
        await StartAsync();
    }

    private void DisposeConnection()
    {
        try { Shell?.Dispose(); } catch { /* ignore */ }
        try { Client?.Dispose(); } catch { /* ignore */ }
        Shell = null;
        Client = null;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        DisposeConnection();
        Terminal.Data -= OnTerminalData;
        try { View.Dispose(); } catch { /* ignore */ }
        _ = Terminal.DisposeAsync();
        State = SessionState.Closed;
        AppServices.Audit.Record("connection", $"终端会话已关闭 {Host.Name}", AuditLevel.Info, Host);
    }
}
