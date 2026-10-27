using System.Windows;
using System.Windows.Controls;
using FluentSSH.Core;
using FluentSSH.Dialogs;

namespace FluentSSH.Features;

public partial class TunnelsPage : UserControl, IActivatablePage
{
    public TunnelsPage()
    {
        InitializeComponent();
        Loaded += (_, _) => OnActivated();
    }

    public void OnActivated() => Refresh();

    private void Refresh()
    {
        foreach (var tunnel in AppServices.Data.Tunnels)
            tunnel.HostName = AppServices.Store.FindHost(tunnel.HostId)?.Name ?? "主机缺失";
        TunnelList.ItemsSource = null;
        TunnelList.ItemsSource = AppServices.Data.Tunnels;
        var count = AppServices.Data.Tunnels.Count;
        TunnelCountText.Text = count > 0 ? $"{count} 条" : string.Empty;
        EmptyState.Visibility = count == 0 ? Visibility.Visible : Visibility.Collapsed;
        TunnelPanel.Visibility = count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void NewTunnel_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new TunnelDialog(null) { Owner = AppServices.MainWindow };
        if (dialog.ShowDialog() != true) return;
        AppServices.Store.Save();
        Refresh();
    }

    private void EditTunnel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not TunnelConfig tunnel) return;
        var dialog = new TunnelDialog(tunnel) { Owner = AppServices.MainWindow };
        if (dialog.ShowDialog() != true) return;
        AppServices.Store.Save();
        Refresh();
    }

    private async void StartTunnel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not TunnelConfig tunnel) return;
        var host = AppServices.Store.FindHost(tunnel.HostId);
        if (host is null)
        {
            MessageBox.Show("隧道关联的主机不存在。", "无法启动", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        var started = await AppServices.Tunnels.StartAsync(tunnel, host);
        if (!started)
            MessageBox.Show(tunnel.LastError, "隧道启动失败", MessageBoxButton.OK, MessageBoxImage.Error);
        Refresh();
    }

    private void StopTunnel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not TunnelConfig tunnel) return;
        AppServices.Tunnels.Stop(tunnel);
        Refresh();
    }

    private void DeleteTunnel_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not TunnelConfig tunnel) return;
        if (AppServices.Settings.ConfirmDelete &&
            MessageBox.Show($"删除隧道「{tunnel.Name}」？", "删除隧道", MessageBoxButton.YesNo,
                MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        AppServices.Tunnels.Stop(tunnel);
        AppServices.Data.Tunnels.Remove(tunnel);
        AppServices.Store.Save();
        Refresh();
    }
}
