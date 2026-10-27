using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using FluentSSH.Core;

namespace FluentSSH.Features;

public partial class SettingsPage : UserControl, IActivatablePage
{
    public SettingsPage()
    {
        InitializeComponent();
        Loaded += (_, _) => OnActivated();
    }

    public void OnActivated()
    {
        var settings = AppServices.Settings;
        ThemeBox.SelectedIndex = settings.Theme switch
        {
            "Dark" => 1,
            "System" => 2,
            _ => 0
        };
        FontFamilyBox.Text = settings.FontFamily;
        FontSizeBox.Text = settings.FontSize.ToString("0.#");
        UsernameBox.Text = settings.DefaultUsername;
        PortBox.Text = settings.DefaultPort.ToString();
        KeepAliveBox.Text = settings.KeepAliveSeconds.ToString();
        RecordSessionsCheck.IsChecked = settings.RecordSessions;
        ConfirmDeleteCheck.IsChecked = settings.ConfirmDelete;
        StrictHostKeysCheck.IsChecked = settings.StrictHostKeys;
        DataPathText.Text = AppServices.Paths.Root;
        StatusText.Text = string.Empty;
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse(PortBox.Text.Trim(), out var port) || port is < 1 or > 65535)
        {
            MessageBox.Show("默认端口必须在 1 到 65535 之间。", "设置", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (!int.TryParse(KeepAliveBox.Text.Trim(), out var keepAlive) || keepAlive is < 10 or > 600)
        {
            MessageBox.Show("保活间隔必须在 10 到 600 秒之间。", "设置", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (!double.TryParse(FontSizeBox.Text.Trim(), out var fontSize) || fontSize is < 12 or > 24)
        {
            MessageBox.Show("终端字号必须在 12 到 24 之间。", "设置", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var settings = AppServices.Settings;
        settings.Theme = (ThemeBox.SelectedItem as ComboBoxItem)?.Tag as string ?? "Light";
        settings.FontFamily = string.IsNullOrWhiteSpace(FontFamilyBox.Text) ? "Cascadia Mono" : FontFamilyBox.Text.Trim();
        settings.FontSize = fontSize;
        settings.DefaultUsername = UsernameBox.Text.Trim();
        settings.DefaultPort = port;
        settings.KeepAliveSeconds = keepAlive;
        settings.RecordSessions = RecordSessionsCheck.IsChecked == true;
        settings.ConfirmDelete = ConfirmDeleteCheck.IsChecked == true;
        settings.StrictHostKeys = StrictHostKeysCheck.IsChecked == true;
        ThemeService.Apply(settings.Theme);
        AppServices.Store.Save();
        AppServices.MainWindow?.RefreshThemeUi();
        StatusText.Text = "已保存";
    }

    private void OpenData_Click(object sender, RoutedEventArgs e) => OpenFolder(AppServices.Paths.Root);
    private void OpenLogs_Click(object sender, RoutedEventArgs e) => OpenFolder(AppServices.Paths.LogsDirectory);

    private static void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo { FileName = "explorer.exe", Arguments = path, UseShellExecute = true });
    }
}
