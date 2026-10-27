using System.Windows;
using System.Windows.Controls;
using FluentSSH.Core;

namespace FluentSSH.Dialogs;

public partial class TunnelDialog : Window
{
    private readonly TunnelConfig? _editing;

    public TunnelDialog(TunnelConfig? editing)
    {
        _editing = editing;
        InitializeComponent();
        Title = editing is null ? "新建隧道" : "编辑隧道";
        DialogTitle.Text = Title;
        HostBox.ItemsSource = AppServices.Data.Hosts.OrderBy(h => h.Name, StringComparer.CurrentCulture).ToList();
        BindHostBox.Text = "127.0.0.1";
        BindPortBox.Text = "8080";
        TargetHostBox.Text = "127.0.0.1";
        TargetPortBox.Text = "80";
        KindBox.SelectedIndex = 0;

        if (editing is not null)
        {
            NameBox.Text = editing.Name;
            HostBox.SelectedItem = HostBox.Items.OfType<HostProfile>().FirstOrDefault(h => h.Id == editing.HostId);
            KindBox.SelectedIndex = editing.Kind switch
            {
                TunnelKind.Remote => 1,
                TunnelKind.Dynamic => 2,
                _ => 0
            };
            BindHostBox.Text = editing.BindHost;
            BindPortBox.Text = editing.BindPort.ToString();
            TargetHostBox.Text = editing.TargetHost;
            TargetPortBox.Text = editing.TargetPort.ToString();
            AutoStartCheck.IsChecked = editing.AutoStart;
        }
        else if (HostBox.Items.Count > 0)
        {
            HostBox.SelectedIndex = 0;
        }
        UpdateTargetPanel();
    }

    private void KindBox_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateTargetPanel();

    private void UpdateTargetPanel()
    {
        if (TargetPanel is null) return;
        var kind = (KindBox.SelectedItem as ComboBoxItem)?.Tag as string;
        TargetPanel.Visibility = kind == "Dynamic" ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(NameBox.Text))
        {
            MessageBox.Show("请输入隧道名称。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (HostBox.SelectedItem is not HostProfile host)
        {
            MessageBox.Show("请选择关联主机。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (!int.TryParse(BindPortBox.Text.Trim(), out var bindPort) || bindPort is < 1 or > 65535)
        {
            MessageBox.Show("监听端口必须在 1 到 65535 之间。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        var kind = (KindBox.SelectedItem as ComboBoxItem)?.Tag as string ?? "Local";
        var targetHost = TargetHostBox.Text.Trim();
        var targetPortText = TargetPortBox.Text.Trim();
        if (kind != "Dynamic")
        {
            if (!int.TryParse(targetPortText, out var targetPort) || targetPort is < 1 or > 65535)
            {
                MessageBox.Show("目标端口必须在 1 到 65535 之间。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            if (string.IsNullOrWhiteSpace(targetHost))
            {
                MessageBox.Show("请输入目标地址。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
        }

        var tunnel = _editing ?? new TunnelConfig();
        tunnel.Name = NameBox.Text.Trim();
        tunnel.HostId = host.Id;
        tunnel.Kind = kind switch
        {
            "Remote" => TunnelKind.Remote,
            "Dynamic" => TunnelKind.Dynamic,
            _ => TunnelKind.Local
        };
        tunnel.BindHost = BindHostBox.Text.Trim();
        tunnel.BindPort = bindPort;
        tunnel.TargetHost = kind == "Dynamic" ? "127.0.0.1" : targetHost;
        tunnel.TargetPort = kind == "Dynamic" ? 0 : int.Parse(targetPortText);
        tunnel.AutoStart = AutoStartCheck.IsChecked == true;
        tunnel.HostName = host.Name;

        if (_editing is null) AppServices.Data.Tunnels.Add(tunnel);
        AppServices.Audit.Record("tunnel", $"保存隧道 {tunnel.Name}", AuditLevel.Info, host);
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => Close();
}
