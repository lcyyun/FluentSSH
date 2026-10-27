using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FluentSSH.Core;
using FluentSSH.Dialogs;

namespace FluentSSH.Features;

public partial class HostsPage : UserControl, IActivatablePage
{
    public ObservableCollection<HostProfile> VisibleHosts { get; } = new();
    private bool _initialized;

    public HostsPage()
    {
        InitializeComponent();
        DataContext = this;
        Loaded += (_, _) => OnActivated();
        AppServices.HostsChanged += () => Dispatcher.BeginInvoke(RebuildFilters);
    }

    public void OnActivated()
    {
        if (!_initialized)
        {
            _initialized = true;
            RebuildGroupFilter();
        }
        RefreshHostList();
    }

    private void RebuildGroupFilter()
    {
        var selectedTag = (GroupFilter.SelectedItem as ComboBoxItem)?.Tag as string;
        GroupFilter.Items.Clear();
        GroupFilter.Items.Add(new ComboBoxItem { Content = "全部主机", Tag = "all" });
        GroupFilter.Items.Add(new ComboBoxItem { Content = "收藏", Tag = "favorites" });
        foreach (var group in AppServices.Data.Groups)
            GroupFilter.Items.Add(new ComboBoxItem { Content = group.Name, Tag = group.Id });
        var selected = GroupFilter.Items.OfType<ComboBoxItem>()
            .FirstOrDefault(item => string.Equals(item.Tag as string, selectedTag, StringComparison.Ordinal));
        GroupFilter.SelectedItem = selected ?? GroupFilter.Items[0];
    }

    private void RebuildFilters()
    {
        RebuildGroupFilter();
        RefreshHostList();
    }

    private void RefreshHostList()
    {
        if (!IsLoaded) return;
        IEnumerable<HostProfile> query = AppServices.Data.Hosts;
        var tag = (GroupFilter.SelectedItem as ComboBoxItem)?.Tag as string;
        if (tag == "favorites") query = query.Where(h => h.Favorite);
        else if (!string.IsNullOrEmpty(tag) && tag != "all") query = query.Where(h => h.GroupId == tag);

        var search = SearchBox?.Text?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            query = query.Where(h =>
                h.Name.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                h.Hostname.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                h.Username.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                h.TagsText.Contains(search, StringComparison.OrdinalIgnoreCase));
        }

        var sorted = query.OrderByDescending(h => h.Favorite).ThenBy(h => h.Name, StringComparer.CurrentCulture).ToList();
        foreach (var host in sorted)
            host.GroupName = AppServices.Store.HostGroupName(host);
        VisibleHosts.Clear();
        foreach (var host in sorted) VisibleHosts.Add(host);

        HostList.ItemsSource = VisibleHosts;
        HostCountText.Text = $"{sorted.Count} 台";
        EmptyState.Visibility = sorted.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        HostPanel.Visibility = sorted.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
        SearchHint.Visibility = string.IsNullOrEmpty(SearchBox?.Text) ? Visibility.Visible : Visibility.Collapsed;
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => RefreshHostList();
    private void GroupFilter_SelectionChanged(object sender, SelectionChangedEventArgs e) => RefreshHostList();

    public void CreateHost() => ShowHostDialog(null);
    private void NewHost_Click(object sender, RoutedEventArgs e) => CreateHost();

    private void ShowHostDialog(HostProfile? host)
    {
        var dialog = new HostDialog(AppServices.Data.Groups, AppServices.Data.Keys, host)
        {
            Owner = AppServices.MainWindow
        };
        if (dialog.ShowDialog() != true) return;
        AppServices.NotifyHostsChanged();
        RebuildFilters();
        if (dialog.ConnectAfterSave && dialog.SavedHost is not null)
            AppServices.MainWindow?.OpenTerminal(dialog.SavedHost);
    }

    private void ConnectHost_Click(object sender, RoutedEventArgs e)
    {
        if (ButtonHost(sender) is { } host) AppServices.MainWindow?.OpenTerminal(host);
    }

    private void FilesHost_Click(object sender, RoutedEventArgs e)
    {
        if (ButtonHost(sender) is { } host) AppServices.MainWindow?.OpenFiles(host);
    }

    private void EditHost_Click(object sender, RoutedEventArgs e)
    {
        if (ButtonHost(sender) is { } host) ShowHostDialog(host);
    }

    private void DeleteHost_Click(object sender, RoutedEventArgs e)
    {
        if (ButtonHost(sender) is not { } host) return;
        if (AppServices.Settings.ConfirmDelete &&
            MessageBox.Show($"删除主机「{host.Name}」及其保存的凭据？", "删除主机",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        AppServices.Data.Hosts.Remove(host);
        AppServices.Audit.Record("system", $"删除主机 {host.Name}", AuditLevel.Warning, host);
        AppServices.NotifyHostsChanged();
        RebuildFilters();
    }

    private void ImportSshConfig_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "选择 SSH Config 文件",
            Filter = "SSH config|config;*.sshconfig;*.txt|所有文件|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog() != true) return;
        try
        {
            var imported = SshConfigService.ImportFromFile(dialog.FileName);
            AppServices.NotifyHostsChanged();
            RebuildGroupFilter();
            RebuildFilters();
            MessageBox.Show($"已导入 {imported} 台主机。请检查认证方式与密钥配置。", "导入完成",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "导入失败", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void HostRow_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2 && sender is FrameworkElement { DataContext: HostProfile host })
        {
            AppServices.MainWindow?.OpenTerminal(host);
        }
    }

    private void ManageGroups_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new GroupManagerDialog { Owner = AppServices.MainWindow };
        dialog.ShowDialog();
        RebuildGroupFilter();
        RefreshHostList();
    }

    private static HostProfile? ButtonHost(object sender)
    {
        return (sender as Button)?.Tag as HostProfile;
    }
}
