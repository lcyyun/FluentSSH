using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using FluentSSH.Core;

namespace FluentSSH.Dialogs;

public partial class HostDialog : Window
{
    private readonly HostProfile? _editing;
    private readonly ObservableCollection<HostGroup> _groups;
    private readonly ObservableCollection<SshKeyRecord> _keys;

    public HostProfile? SavedHost { get; private set; }
    public bool ConnectAfterSave { get; private set; }

    public HostDialog(ObservableCollection<HostGroup> groups, ObservableCollection<SshKeyRecord> keys, HostProfile? editing)
    {
        _groups = groups;
        _keys = keys;
        _editing = editing;
        InitializeComponent();
        Title = editing is null ? "新建主机" : "编辑主机";
        DialogTitle.Text = Title;

        GroupBox.Items.Add(new ComboBoxItem { Content = "未分组", Tag = (string?)null });
        foreach (var group in groups) GroupBox.Items.Add(new ComboBoxItem { Content = group.Name, Tag = group.Id });
        GroupBox.SelectedIndex = 0;

        KeyBox.Items.Add(new ComboBoxItem { Content = "选择私钥", Tag = (string?)null });
        foreach (var key in keys) KeyBox.Items.Add(new ComboBoxItem { Content = $"{key.Name} ({key.Algorithm})", Tag = key.Id });
        KeyBox.SelectedIndex = 0;

        var defaults = AppServices.Settings;
        UsernameBox.Text = defaults.DefaultUsername;
        PortBox.Text = defaults.DefaultPort.ToString();
        AuthBox.SelectedIndex = 0;

        if (editing is not null)
        {
            NameBox.Text = editing.Name;
            HostnameBox.Text = editing.Hostname;
            PortBox.Text = editing.Port.ToString();
            UsernameBox.Text = editing.Username;
            TagsBox.Text = editing.TagsText;
            StartupBox.Text = editing.StartupCommand;
            DefaultPathBox.Text = editing.DefaultPath;
            NotesBox.Text = editing.Notes;
            FavoriteCheck.IsChecked = editing.Favorite;
            KeepAliveCheck.IsChecked = editing.KeepAlive;
            LastConnectedText.Text = editing.LastConnectedLabel;
            TagsBox.Text = editing.TagsText;
            GroupBox.SelectedItem = GroupBox.Items.OfType<ComboBoxItem>()
                .FirstOrDefault(item => string.Equals(item.Tag as string, editing.GroupId, StringComparison.Ordinal)) ?? GroupBox.Items[0];
            KeyBox.SelectedItem = KeyBox.Items.OfType<ComboBoxItem>()
                .FirstOrDefault(item => string.Equals(item.Tag as string, editing.KeyId, StringComparison.Ordinal)) ?? KeyBox.Items[0];
            AuthBox.SelectedIndex = editing.AuthKind switch
            {
                AuthKind.PrivateKey => 1,
                AuthKind.KeyboardInteractive => 2,
                _ => 0
            };
            if (!string.IsNullOrEmpty(editing.Password))
            {
                PasswordLabel.Text = "密码（已保存，留空则保持不变）";
            }
            if (!string.IsNullOrEmpty(editing.Passphrase))
            {
                KeyPassphraseLabel.Text = "私钥口令（已保存，留空则保持不变）";
            }
        }
        else
        {
            LastConnectedText.Text = "尚未连接";
            NameBox.Focus();
        }
    }

    private void AuthBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (PasswordPanel is null) return;
        var tag = (AuthBox.SelectedItem as ComboBoxItem)?.Tag as string;
        PasswordPanel.Visibility = tag == "Password" ? Visibility.Visible : Visibility.Collapsed;
        KeyPanel.Visibility = tag == "PrivateKey" ? Visibility.Visible : Visibility.Collapsed;
        KeyboardPanel.Visibility = tag == "KeyboardInteractive" ? Visibility.Visible : Visibility.Collapsed;
    }

    private bool Validate(out string error)
    {
        if (string.IsNullOrWhiteSpace(NameBox.Text)) { error = "请输入名称。"; return false; }
        if (string.IsNullOrWhiteSpace(HostnameBox.Text)) { error = "请输入地址。"; return false; }
        if (!int.TryParse(PortBox.Text.Trim(), out var port) || port < 1 || port > 65535)
        { error = "端口必须在 1 到 65535 之间。"; return false; }
        if (string.IsNullOrWhiteSpace(UsernameBox.Text)) { error = "请输入用户名。"; return false; }

        var auth = (AuthBox.SelectedItem as ComboBoxItem)?.Tag as string ?? "Password";
        if (auth == "Password" && string.IsNullOrEmpty(PasswordBoxControl.Password) &&
            string.IsNullOrEmpty(_editing?.Password))
        { error = "请输入密码，或改用其他认证方式。"; return false; }
        if (auth == "PrivateKey")
        {
            var keyId = (KeyBox.SelectedItem as ComboBoxItem)?.Tag as string;
            if (string.IsNullOrEmpty(keyId)) { error = "请选择私钥。"; return false; }
        }
        error = string.Empty;
        return true;
    }

    private void Save_Click(object sender, RoutedEventArgs e) => Save(connect: false);
    private void SaveAndConnect_Click(object sender, RoutedEventArgs e) => Save(connect: true);
    private void Cancel_Click(object sender, RoutedEventArgs e) => Close();

    private void Save(bool connect)
    {
        if (!Validate(out var error))
        {
            ValidationText.Text = error;
            ValidationText.Visibility = Visibility.Visible;
            return;
        }
        ValidationText.Visibility = Visibility.Collapsed;

        var host = _editing ?? new HostProfile();
        host.Name = NameBox.Text.Trim();
        host.Hostname = HostnameBox.Text.Trim();
        host.Port = int.Parse(PortBox.Text.Trim());
        host.Username = UsernameBox.Text.Trim();
        host.GroupId = (GroupBox.SelectedItem as ComboBoxItem)?.Tag as string;
        host.TagsText = TagsBox.Text.Trim();
        host.StartupCommand = StartupBox.Text.Trim();
        host.DefaultPath = DefaultPathBox.Text.Trim();
        host.Notes = NotesBox.Text.Trim();
        host.Favorite = FavoriteCheck.IsChecked == true;
        host.KeepAlive = KeepAliveCheck.IsChecked == true;

        var auth = (AuthBox.SelectedItem as ComboBoxItem)?.Tag as string;
        host.AuthKind = auth switch
        {
            "PrivateKey" => AuthKind.PrivateKey,
            "KeyboardInteractive" => AuthKind.KeyboardInteractive,
            _ => AuthKind.Password
        };
        host.KeyId = (KeyBox.SelectedItem as ComboBoxItem)?.Tag as string;

        if (!string.IsNullOrEmpty(PasswordBoxControl.Password))
            host.Password = PasswordBoxControl.Password;
        if (!string.IsNullOrEmpty(PassphraseBox.Password))
            host.Passphrase = PassphraseBox.Password;

        if (_editing is null)
        {
            AppServices.Data.Hosts.Add(host);
            AppServices.Audit.Record("system", $"新建主机 {host.Name}", AuditLevel.Info, host);
        }
        else
        {
            AppServices.Audit.Record("system", $"更新主机 {host.Name}", AuditLevel.Info, host);
        }

        AppServices.Store.Save();
        SavedHost = host;
        ConnectAfterSave = connect;
        DialogResult = true;
        Close();
    }
}
