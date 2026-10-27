using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FluentSSH.Core;
using FluentSSH.Features;
using Wpf.Ui.Controls;

namespace FluentSSH;

public interface IActivatablePage
{
    void OnActivated();
}

public partial class MainWindow : FluentWindow
{
    private readonly Dictionary<string, UserControl> _pages = new();
    private bool _navigating;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        AppServices.HostsChanged += () => Dispatcher.BeginInvoke(RefreshVisiblePage);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Navigate("hosts");
        UpdateThemeButton();
        Dispatcher.BeginInvoke(() =>
        {
            var page = ContentHost.Content as FrameworkElement;
            AppServices.Log($"layout window={ActualWidth}x{ActualHeight} root={((FrameworkElement)Content).ActualWidth}x{((FrameworkElement)Content).ActualHeight} content={ContentHost.ActualWidth}x{ContentHost.ActualHeight} page={page?.ActualWidth}x{page?.ActualHeight}");
        });
        _ = AppServices.Tunnels.AutoStartAsync();
    }

    private UserControl CreatePage(string tag)
    {
        return tag switch
        {
            "hosts" => new HostsPage(),
            "terminal" => new TerminalPage(),
            "files" => new FilesPage(),
            "tunnels" => new TunnelsPage(),
            "commands" => new CommandsPage(),
            "security" => new SecurityPage(),
            "logs" => new LogsPage(),
            "settings" => new SettingsPage(),
            _ => new HostsPage()
        };
    }

    public void Navigate(string tag)
    {
        if (!_pages.TryGetValue(tag, out var page))
        {
            page = CreatePage(tag);
            _pages[tag] = page;
        }
        ContentHost.Content = page;
        (page as IActivatablePage)?.OnActivated();
        SetNavSelection(tag);
    }

    private void SetNavSelection(string tag)
    {
        _navigating = true;
        try
        {
            foreach (var list in new[] { NavList, ToolNavList })
            {
                list.SelectedItem = list.Items.OfType<ListBoxItem>()
                    .FirstOrDefault(item => string.Equals(item.Tag as string, tag, StringComparison.Ordinal));
            }
        }
        finally
        {
            _navigating = false;
        }
    }

    private void RefreshVisiblePage()
    {
        if (ContentHost.Content is IActivatablePage activatable) activatable.OnActivated();
    }

    private void NavList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_navigating) return;
        if (NavList.SelectedItem is ListBoxItem { Tag: string tag })
        {
            ToolNavList.SelectedItem = null;
            Navigate(tag);
        }
    }

    private void ToolNavList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_navigating) return;
        if (ToolNavList.SelectedItem is ListBoxItem { Tag: string tag })
        {
            NavList.SelectedItem = null;
            Navigate(tag);
        }
    }

    public void OpenTerminal(HostProfile host)
    {
        Navigate("terminal");
        if (_pages.TryGetValue("terminal", out var page) && page is TerminalPage terminal)
            terminal.OpenSession(host);
    }

    public void OpenFiles(HostProfile host)
    {
        Navigate("files");
        if (_pages.TryGetValue("files", out var page) && page is FilesPage files)
            files.ConnectToHost(host);
    }

    public void OpenNewHostDialog()
    {
        Navigate("hosts");
        if (_pages.TryGetValue("hosts", out var page) && page is HostsPage hosts)
            hosts.CreateHost();
    }

    public void SendTerminalInput(string text)
    {
        if (_pages.TryGetValue("terminal", out var page) && page is TerminalPage terminal)
            terminal.SendToActive(text);
    }

    public async Task RunCommandForCaptureAsync(string hostName, string command)
    {
        Navigate("commands");
        if (_pages.TryGetValue("commands", out var page) && page is CommandsPage commands)
            await commands.RunForCaptureAsync(hostName, command);
    }

    private void NewHost_Click(object sender, RoutedEventArgs e) => OpenNewHostDialog();

    private void ToggleTheme_Click(object sender, RoutedEventArgs e)
    {
        AppServices.Settings.Theme = ThemeService.IsDark ? "Light" : "Dark";
        ThemeService.Apply(AppServices.Settings.Theme);
        AppServices.Store.Save();
        UpdateThemeButton();
        RefreshVisiblePage();
    }

    public void RefreshThemeUi() => UpdateThemeButton();

    private void UpdateThemeButton()
    {
        ThemeGlyph.Text = ThemeService.IsDark ? "\uE706" : "\uE708";
        ThemeButton.ToolTip = ThemeService.IsDark ? "切换到浅色模式" : "切换到深色模式";
    }

    private void GitHub_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "https://github.com/lcyyun/FluentSSH",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            System.Windows.MessageBox.Show(ex.Message, "无法打开 GitHub", System.Windows.MessageBoxButton.OK, System.Windows.MessageBoxImage.Warning);
        }
    }

    private void Settings_Click(object sender, RoutedEventArgs e) => Navigate("settings");

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.Modifiers != ModifierKeys.Control) return;
        switch (e.Key)
        {
            case Key.N:
                OpenNewHostDialog();
                e.Handled = true;
                break;
            case Key.D1:
                Navigate("hosts");
                e.Handled = true;
                break;
            case Key.D2:
                Navigate("terminal");
                e.Handled = true;
                break;
            case Key.D3:
                Navigate("files");
                e.Handled = true;
                break;
            case Key.D4:
                Navigate("tunnels");
                e.Handled = true;
                break;
            case Key.D5:
                Navigate("commands");
                e.Handled = true;
                break;
            case Key.D6:
                Navigate("security");
                e.Handled = true;
                break;
            case Key.D7:
                Navigate("logs");
                e.Handled = true;
                break;
            case Key.OemComma:
                Navigate("settings");
                e.Handled = true;
                break;
        }
    }
}
