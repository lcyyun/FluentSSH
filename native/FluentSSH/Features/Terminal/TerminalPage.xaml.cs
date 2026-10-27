using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using FluentSSH.Core;
using FluentSSH.Dialogs;

namespace FluentSSH.Features;

public partial class TerminalPage : UserControl, IActivatablePage
{
    public ObservableCollection<TerminalSession> Sessions { get; } = new();
    private readonly Dictionary<TerminalSession, Grid> _wrappers = new();

    public TerminalPage()
    {
        InitializeComponent();
        SessionTabs.ItemsSource = Sessions;
        Sessions.CollectionChanged += (_, _) => UpdateVisibility();
        AppServices.HostsChanged += () => Dispatcher.BeginInvoke(RefreshFromHosts);
        UpdateVisibility();
    }

    public void OnActivated() => UpdateVisibility();

    private void RefreshFromHosts()
    {
        // Host names or state may have changed while the page was cached.
        foreach (var session in Sessions) session.Host.GroupName = AppServices.Store.HostGroupName(session.Host);
    }

    public async void OpenSession(HostProfile host)
    {
        var session = new TerminalSession(host);
        session.StateChanged += OnSessionStateChanged;
        Sessions.Add(session);
        SessionTabs.SelectedItem = session;
        UpdateVisibility();
        await session.StartAsync(string.IsNullOrWhiteSpace(host.StartupCommand) ? null : host.StartupCommand);
        UpdateStatus(session);
    }

    private void OnSessionStateChanged(TerminalSession session)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => OnSessionStateChanged(session));
            return;
        }
        UpdateStatus(session);
        UpdateTabs();
    }

    private void UpdateTabs()
    {
        // Refreshing the ItemsSource keeps status dots in sync without losing selection.
        var selected = SessionTabs.SelectedItem;
        SessionTabs.Items.Refresh();
        SessionTabs.SelectedItem = selected;
    }

    private void UpdateVisibility()
    {
        var hasSessions = Sessions.Count > 0;
        WorkspacePanel.Visibility = hasSessions ? Visibility.Visible : Visibility.Collapsed;
        EmptyState.Visibility = hasSessions ? Visibility.Collapsed : Visibility.Visible;
        SessionCountText.Text = hasSessions ? $"{Sessions.Count} 个会话" : string.Empty;
        if (!hasSessions)
        {
            TerminalHost.Children.Clear();
            WorkspaceTitle.Text = "终端";
            WorkspaceAddress.Text = string.Empty;
            StatusText.Text = "未连接";
            StatusDetail.Text = string.Empty;
            SizeText.Text = string.Empty;
        }
    }

    private void SessionTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
        => ShowSession(SessionTabs.SelectedItem as TerminalSession);

    private void ShowSession(TerminalSession? session)
    {
        if (session is null)
        {
            TerminalHost.Children.Clear();
            WorkspaceTitle.Text = "终端";
            WorkspaceAddress.Text = string.Empty;
            StatusText.Text = "未连接";
            StatusDetail.Text = string.Empty;
            SizeText.Text = string.Empty;
            return;
        }
        if (!_wrappers.TryGetValue(session, out var wrapper))
        {
            wrapper = new Grid();
            wrapper.Children.Add(session.View);
            session.View.SizeChanged += (_, _) => ResizeSession(session);
            session.View.Loaded += (_, _) =>
            {
                session.View.Focus();
                ResizeSession(session);
            };
            _wrappers[session] = wrapper;
        }
        TerminalHost.Children.Clear();
        TerminalHost.Children.Add(wrapper);
        WorkspaceTitle.Text = session.Host.Name;
        WorkspaceAddress.Text = $"{session.Host.Username}@{session.Host.Hostname}:{session.Host.Port}";
        UpdateStatus(session);
        Dispatcher.BeginInvoke(() => session.View.Focus());
    }

    private async void ResizeSession(TerminalSession session)
    {
        if (!session.View.IsLoaded) return;
        var cols = session.View.Columns;
        var rows = session.View.Rows;
        if (cols > 0 && rows > 0) await session.ResizeAsync(cols, rows);
        SizeText.Text = cols > 0 ? $"{cols} × {rows}" : string.Empty;
    }

    private void UpdateStatus(TerminalSession session)
    {
        if (SessionTabs.SelectedItem != session) return;
        StatusText.Text = session.StateLabel;
        StatusDetail.Text = session.Detail;
        SizeText.Text = $"{session.Terminal.Columns} × {session.Terminal.Rows}";
    }

    public void SendToActive(string text)
    {
        if (SessionTabs.SelectedItem is TerminalSession session) session.SendText(text);
    }

    private void NewSession_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SessionPickerDialog { Owner = AppServices.MainWindow };
        if (dialog.ShowDialog() == true && dialog.SelectedHost is not null)
            OpenSession(dialog.SelectedHost);
    }

    private void OpenHosts_Click(object sender, RoutedEventArgs e) => AppServices.MainWindow?.Navigate("hosts");

    private void CloseTab_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is TerminalSession session) CloseSession(session);
    }

    private void CloseSession_Click(object sender, RoutedEventArgs e)
    {
        if (SessionTabs.SelectedItem is TerminalSession session) CloseSession(session);
    }

    private void CloseSession(TerminalSession session)
    {
        var index = Sessions.IndexOf(session);
        Sessions.Remove(session);
        _wrappers.Remove(session);
        session.StateChanged -= OnSessionStateChanged;
        session.Dispose();
        if (Sessions.Count > 0)
        {
            SessionTabs.SelectedIndex = Math.Clamp(index, 0, Sessions.Count - 1);
            ShowSession(SessionTabs.SelectedItem as TerminalSession);
        }
        UpdateVisibility();
    }

    private async void Copy_Click(object sender, RoutedEventArgs e)
    {
        if (SessionTabs.SelectedItem is TerminalSession session)
        {
            try { await session.View.CopySelectionAsync(); } catch { /* ignore */ }
        }
    }

    private async void Paste_Click(object sender, RoutedEventArgs e)
    {
        if (SessionTabs.SelectedItem is TerminalSession session)
        {
            try { await session.View.PasteAsync(); } catch { /* ignore */ }
        }
    }

    private async void Clear_Click(object sender, RoutedEventArgs e)
    {
        if (SessionTabs.SelectedItem is TerminalSession session)
        {
            try { await session.Terminal.ClearAsync(); } catch { /* ignore */ }
            session.View.Focus();
        }
    }

    private async void Reconnect_Click(object sender, RoutedEventArgs e)
    {
        if (SessionTabs.SelectedItem is not TerminalSession session) return;
        await session.ReconnectAsync();
        UpdateStatus(session);
    }
}
