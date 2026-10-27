using System.IO;
using System.Windows;
using System.Windows.Threading;
using FluentSSH.Core;
using FluentSSH.Dialogs;

namespace FluentSSH;

public partial class App : Application
{
    private string? _capturePath;
    private string? _capturePage;
    private string? _connectHost;
    private string? _filesHost;
    private string? _dialog;
    private string? _theme;
    private string? _terminalCommand;
    private string? _runHost;
    private string? _runCommand;
    private int _captureDelayMs = 600;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += OnDispatcherUnhandledException;
        ParseCaptureArgs();
        try
        {
            AppServices.Initialize();
            if (!string.IsNullOrWhiteSpace(_theme)) AppServices.Settings.Theme = _theme;
            ThemeService.Apply(AppServices.Settings.Theme);
            var window = new MainWindow();
            AppServices.MainWindow = window;
            MainWindow = window;
            window.Show();

            if (_capturePath is not null)
            {
                window.ContentRendered += OnCaptureReady;
            }
        }
        catch (Exception ex)
        {
            AppServices.LogError("启动失败", ex);
            MessageBox.Show($"FluentSSH 启动失败：\n{ex.Message}", "FluentSSH", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private void ParseCaptureArgs()
    {
        var args = Environment.GetCommandLineArgs().Skip(1).ToArray();
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--capture" when i + 1 < args.Length:
                    _capturePath = Path.GetFullPath(args[++i]);
                    break;
                case "--page" when i + 1 < args.Length:
                    _capturePage = args[++i];
                    break;
                case "--connect" when i + 1 < args.Length:
                    _connectHost = args[++i];
                    break;
                case "--files" when i + 1 < args.Length:
                    _filesHost = args[++i];
                    break;
                case "--dialog" when i + 1 < args.Length:
                    _dialog = args[++i];
                    break;
                case "--theme" when i + 1 < args.Length:
                    _theme = args[++i];
                    break;
                case "--type" when i + 1 < args.Length:
                    _terminalCommand = args[++i];
                    break;
                case "--run-host" when i + 1 < args.Length:
                    _runHost = args[++i];
                    break;
                case "--run" when i + 1 < args.Length:
                    _runCommand = args[++i];
                    break;
                case "--delay" when i + 1 < args.Length && int.TryParse(args[++i], out var delay):
                    _captureDelayMs = Math.Clamp(delay, 100, 15000);
                    break;
            }
        }
    }

    private async void OnCaptureReady(object? sender, EventArgs e)
    {
        if (MainWindow is not MainWindow window || _capturePath is null) return;
        window.ContentRendered -= OnCaptureReady;
        try
        {
            await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Loaded);
            if (!string.IsNullOrWhiteSpace(_dialog))
            {
                CaptureDialog(window);
                return;
            }
            if (!string.IsNullOrWhiteSpace(_capturePage))
                window.Navigate(_capturePage);
            if (!string.IsNullOrWhiteSpace(_connectHost))
            {
                var host = AppServices.Data.Hosts.FirstOrDefault(h =>
                    h.Name.Equals(_connectHost, StringComparison.OrdinalIgnoreCase));
                if (host is not null) window.OpenTerminal(host);
            }
            if (!string.IsNullOrWhiteSpace(_filesHost))
            {
                var host = AppServices.Data.Hosts.FirstOrDefault(h =>
                    h.Name.Equals(_filesHost, StringComparison.OrdinalIgnoreCase));
                if (host is not null) window.OpenFiles(host);
            }
            if (!string.IsNullOrWhiteSpace(_terminalCommand))
            {
                await Task.Delay(1600);
                window.SendTerminalInput(_terminalCommand + "\r");
                await Task.Delay(900);
            }
            if (!string.IsNullOrWhiteSpace(_runCommand))
            {
                await window.RunCommandForCaptureAsync(_runHost ?? "Mock SSH", _runCommand);
                await Task.Delay(400);
            }
            await Task.Delay(_captureDelayMs);
            NativeScreenshot.Capture(window, _capturePath);
        }
        catch (Exception ex)
        {
            AppServices.LogError("截图失败", ex);
        }
        finally
        {
            Shutdown();
        }
    }

    private void CaptureDialog(MainWindow window)
    {
        Window? dialog = _dialog switch
        {
            "hostnew" => new HostDialog(AppServices.Data.Groups, AppServices.Data.Keys, null) { Owner = window },
            "tunnelnew" => new TunnelDialog(null) { Owner = window },
            "snippetnew" => new SnippetDialog(null) { Owner = window },
            "sessionpicker" => new SessionPickerDialog { Owner = window },
            _ => null
        };
        if (dialog is null) return;
        dialog.Loaded += async (_, _) =>
        {
            await Task.Delay(_captureDelayMs);
            NativeScreenshot.Capture(dialog, _capturePath!);
            dialog.Close();
        };
        dialog.ShowDialog();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        AppServices.Shutdown();
        base.OnExit(e);
    }

    private void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        AppServices.LogError("未处理的界面异常", e.Exception);
        MessageBox.Show($"发生未处理的错误：\n{e.Exception.Message}", "FluentSSH", MessageBoxButton.OK, MessageBoxImage.Warning);
        e.Handled = true;
    }
}
