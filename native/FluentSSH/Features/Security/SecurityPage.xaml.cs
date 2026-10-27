using System.Windows;
using System.Windows.Controls;
using FluentSSH.Core;
using FluentSSH.Dialogs;

namespace FluentSSH.Features;

public partial class SecurityPage : UserControl, IActivatablePage
{
    public SecurityPage()
    {
        InitializeComponent();
        Loaded += (_, _) => OnActivated();
        AppServices.HostsChanged += () => Dispatcher.BeginInvoke(Refresh);
    }

    public void OnActivated()
    {
        if (SectionTabs.SelectedIndex < 0) SectionTabs.SelectedIndex = 0;
        Refresh();
    }

    private void Refresh()
    {
        KeyList.ItemsSource = null;
        KeyList.ItemsSource = AppServices.Data.Keys.OrderByDescending(k => k.CreatedAt).ToList();
        KnownHostList.ItemsSource = null;
        KnownHostList.ItemsSource = AppServices.Data.KnownHosts.OrderBy(k => k.Hostname).ThenBy(k => k.Port).ToList();
        EmptyKeysText.Visibility = AppServices.Data.Keys.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        EmptyKnownHostsText.Visibility = AppServices.Data.KnownHosts.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        CountText.Text = $"{AppServices.Data.Keys.Count} 个密钥";
        UpdateSelectionState();
    }

    private void SectionTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (KeysView is null) return;
        var keys = SectionTabs.SelectedIndex == 0;
        KeysView.Visibility = keys ? Visibility.Visible : Visibility.Collapsed;
        KnownHostsView.Visibility = keys ? Visibility.Collapsed : Visibility.Visible;
        CountText.Text = keys
            ? $"{AppServices.Data.Keys.Count} 个密钥"
            : $"{AppServices.Data.KnownHosts.Count} 台主机";
        StatusText.Text = string.Empty;
    }

    private void UpdateSelectionState()
    {
        CopyKeyButton.IsEnabled = KeyList.SelectedItem is SshKeyRecord;
        DeleteKeyButton.IsEnabled = KeyList.SelectedItem is SshKeyRecord;
        DeleteKnownHostButton.IsEnabled = KnownHostList.SelectedItem is KnownHostRecord;
    }

    private void KeyList_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateSelectionState();
    private void KnownHostList_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateSelectionState();

    private void ImportKey_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "导入私钥",
            Filter = "私钥文件|id_*;*.pem;*.key;*.ppk|所有文件|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog() != true) return;
        try
        {
            var key = KeyService.Import(dialog.FileName);
            AppServices.Data.Keys.Add(key);
            AppServices.Store.Save();
            AppServices.Audit.Record("security", $"导入密钥 {key.Name}", AuditLevel.Info, detail: key.PrivateKeyPath);
            StatusText.Text = "密钥已导入";
            Refresh();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "导入密钥失败", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void GenerateKey_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new TextInputDialog("生成 RSA 密钥", "密钥名称", "fluent-key") { Owner = AppServices.MainWindow };
        if (dialog.ShowDialog() != true) return;
        try
        {
            var key = KeyService.GenerateRsa(dialog.Value.Trim());
            AppServices.Data.Keys.Add(key);
            AppServices.Store.Save();
            AppServices.Audit.Record("security", $"生成密钥 {key.Name}", AuditLevel.Info, detail: key.Fingerprint);
            StatusText.Text = "密钥已生成";
            Refresh();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "生成密钥失败", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void CopyKey_Click(object sender, RoutedEventArgs e)
    {
        if (KeyList.SelectedItem is not SshKeyRecord key) return;
        var publicKey = KeyService.TryReadPublicKey(key);
        if (string.IsNullOrWhiteSpace(publicKey))
        {
            StatusText.Text = "该密钥没有公钥文件";
            return;
        }
        Clipboard.SetText(publicKey);
        StatusText.Text = "公钥已复制";
    }

    private void DeleteKey_Click(object sender, RoutedEventArgs e)
    {
        if (KeyList.SelectedItem is not SshKeyRecord key) return;
        if (AppServices.Settings.ConfirmDelete &&
            MessageBox.Show($"删除密钥「{key.Name}」？引用它的主机会失去认证方式。", "删除密钥",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        foreach (var host in AppServices.Data.Hosts.Where(h => h.KeyId == key.Id))
        {
            host.KeyId = null;
            if (host.AuthKind == AuthKind.PrivateKey) host.AuthKind = AuthKind.Password;
        }
        AppServices.Data.Keys.Remove(key);
        AppServices.Store.Save();
        AppServices.Audit.Record("security", $"删除密钥 {key.Name}", AuditLevel.Warning);
        StatusText.Text = "密钥已删除";
        Refresh();
    }

    private void DeleteKnownHost_Click(object sender, RoutedEventArgs e)
    {
        if (KnownHostList.SelectedItem is not KnownHostRecord known) return;
        if (AppServices.Settings.ConfirmDelete &&
            MessageBox.Show($"移除对 {known.DisplayAddress} 的信任？", "Known Hosts",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        AppServices.Data.KnownHosts.Remove(known);
        AppServices.Store.Save();
        AppServices.Audit.Record("security", $"移除主机密钥 {known.DisplayAddress}", AuditLevel.Warning);
        StatusText.Text = "已移除";
        Refresh();
    }
}
