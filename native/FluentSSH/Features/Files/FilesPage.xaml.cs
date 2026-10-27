using System.Collections.ObjectModel;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FluentSSH.Core;
using FluentSSH.Dialogs;
using Renci.SshNet;
using Renci.SshNet.Sftp;

namespace FluentSSH.Features;

public sealed class SftpEntry
{
    public required string Name { get; init; }
    public required string FullPath { get; init; }
    public bool IsDirectory { get; init; }
    public long Size { get; init; }
    public DateTime Modified { get; init; }
    public string SizeLabel => IsDirectory ? string.Empty : FormatSize(Size);
    public string ModifiedLabel => Modified == default ? string.Empty : Modified.ToString("yyyy-MM-dd HH:mm");
    public string Glyph => IsDirectory ? "\uE8B7" : "\uE8A5";

    private static string FormatSize(long bytes)
    {
        string[] units = { "B", "KB", "MB", "GB", "TB" };
        double size = bytes;
        var unit = 0;
        while (size >= 1024 && unit < units.Length - 1)
        {
            size /= 1024;
            unit++;
        }
        return unit == 0 ? $"{bytes} B" : $"{size:0.#} {units[unit]}";
    }
}

public partial class FilesPage : UserControl, IActivatablePage
{
    private readonly ObservableCollection<SftpEntry> _entries = new();
    private SftpClient? _client;
    private HostProfile? _host;
    private string _path = "/";
    private bool _busy;
    private int _transferVersion;

    public FilesPage()
    {
        InitializeComponent();
        FileList.ItemsSource = _entries;
        Loaded += (_, _) => OnActivated();
        AppServices.HostsChanged += () => Dispatcher.BeginInvoke(RefreshHostPicker);
    }

    public void OnActivated()
    {
        RefreshHostPicker();
        UpdateConnectionUi();
    }

    private void RefreshHostPicker()
    {
        var selectedId = (HostPicker.SelectedItem as HostProfile)?.Id;
        HostPicker.ItemsSource = null;
        HostPicker.ItemsSource = AppServices.Data.Hosts.OrderBy(h => h.Name, StringComparer.CurrentCulture).ToList();
        if (selectedId is not null)
            HostPicker.SelectedItem = HostPicker.Items.OfType<HostProfile>().FirstOrDefault(h => h.Id == selectedId);
        else if (_host is not null)
            HostPicker.SelectedItem = HostPicker.Items.OfType<HostProfile>().FirstOrDefault(h => h.Id == _host.Id);
        else if (HostPicker.Items.Count > 0)
            HostPicker.SelectedIndex = 0;
    }

    public async void ConnectToHost(HostProfile host)
    {
        RefreshHostPicker();
        HostPicker.SelectedItem = HostPicker.Items.OfType<HostProfile>().FirstOrDefault(h => h.Id == host.Id);
        await ConnectAsync(host);
    }

    private async Task ConnectAsync(HostProfile host)
    {
        if (_busy) return;
        Disconnect();
        _host = host;
        _busy = true;
        UpdateConnectionUi();
        StatusText.Text = "正在连接";
        try
        {
            var client = await AppServices.Ssh.ConnectSftpAsync(host);
            _client = client;
            AppServices.MarkHostConnected(host);
            var initial = string.IsNullOrWhiteSpace(host.DefaultPath) ? client.WorkingDirectory : host.DefaultPath;
            if (string.IsNullOrWhiteSpace(initial)) initial = "/";
            await NavigateAsync(initial);
            StatusText.Text = "已连接";
        }
        catch (Exception ex)
        {
            _client?.Dispose();
            _client = null;
            StatusText.Text = SshService.FriendlyError(ex);
            MessageBox.Show(StatusText.Text, "SFTP 连接失败", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _busy = false;
            UpdateConnectionUi();
        }
    }

    private async Task NavigateAsync(string path)
    {
        if (_client is null) return;
        var client = _client;
        _busy = true;
        UpdateConnectionUi();
        StatusText.Text = $"正在读取 {path}";
        try
        {
            var items = await Task.Run(() =>
            {
                var list = client.ListDirectory(path)
                    .Where(entry => entry.Name is not "." and not "..")
                    .Select(entry => new SftpEntry
                    {
                        Name = entry.Name,
                        FullPath = entry.FullName,
                        IsDirectory = entry.IsDirectory,
                        Size = entry.Length,
                        Modified = entry.LastWriteTime
                    })
                    .OrderByDescending(entry => entry.IsDirectory)
                    .ThenBy(entry => entry.Name, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();
                return list;
            });
            _path = path;
            _entries.Clear();
            foreach (var item in items) _entries.Add(item);
            PathBox.Text = _path;
            CurrentPathText.Text = _path;
            FileCountText.Text = $"{_entries.Count} 项";
            EmptyFolderText.Visibility = _entries.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            StatusText.Text = "已连接";
            await RecordAudit("sftp", $"读取目录 {_path}");
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            MessageBox.Show(ex.Message, "无法读取目录", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally
        {
            _busy = false;
            UpdateConnectionUi();
        }
    }

    private async Task RecordAudit(string category, string message)
    {
        AppServices.Audit.Record(category, message, AuditLevel.Info, _host);
        await Task.CompletedTask;
    }

    private void UpdateConnectionUi()
    {
        var connected = _client is { IsConnected: true };
        PathBar.Visibility = connected ? Visibility.Visible : Visibility.Collapsed;
        FilePanel.Visibility = connected ? Visibility.Visible : Visibility.Collapsed;
        EmptyState.Visibility = connected ? Visibility.Collapsed : Visibility.Visible;
        ConnectButton.IsEnabled = !_busy;
        ConnectButton.Content = connected ? "重新连接" : "连接";
        DisconnectButton.Visibility = connected ? Visibility.Visible : Visibility.Collapsed;
        TransferBar.Visibility = _busy ? Visibility.Visible : Visibility.Collapsed;
        PathBar.IsEnabled = !_busy && connected;
        UploadButton.IsEnabled = !_busy && connected;
    }

    private void Disconnect()
    {
        try { _client?.Dispose(); } catch { /* ignore */ }
        _client = null;
        _entries.Clear();
        _path = "/";
        UpdateConnectionUi();
    }

    private void ConnectButton_Click(object sender, RoutedEventArgs e)
    {
        if (HostPicker.SelectedItem is HostProfile host) _ = ConnectAsync(host);
    }

    private void DisconnectButton_Click(object sender, RoutedEventArgs e)
    {
        Disconnect();
        StatusText.Text = "已断开";
    }

    private void Refresh_Click(object sender, RoutedEventArgs e) => _ = NavigateAsync(_path);

    private void Up_Click(object sender, RoutedEventArgs e)
    {
        var parent = GetParentPath(_path);
        if (parent is not null) _ = NavigateAsync(parent);
    }

    private void Go_Click(object sender, RoutedEventArgs e)
    {
        var target = PathBox.Text.Trim();
        if (string.IsNullOrEmpty(target)) return;
        if (!target.StartsWith('/')) target = _path.TrimEnd('/') + "/" + target;
        _ = NavigateAsync(target);
    }

    private void PathBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.Control)
        {
            Go_Click(sender, e);
            e.Handled = true;
        }
    }

    private void FileList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (FileList.SelectedItem is not SftpEntry entry) return;
        if (entry.IsDirectory) _ = NavigateAsync(entry.FullPath);
        else _ = OpenEditorAsync(entry);
    }

    private static string? GetParentPath(string path)
    {
        if (path == "/" || string.IsNullOrEmpty(path)) return null;
        var trimmed = path.TrimEnd('/');
        var index = trimmed.LastIndexOf('/');
        return index <= 0 ? "/" : trimmed[..index];
    }

    private void RefreshToolbarState()
    {
        var selected = FileList.SelectedItem as SftpEntry;
        DownloadButton.IsEnabled = selected is { IsDirectory: false };
        OpenButton.IsEnabled = selected is { IsDirectory: false };
        RenameButton.IsEnabled = selected is not null;
        DeleteButton.IsEnabled = selected is not null;
        UploadButton.IsEnabled = _client is { IsConnected: true };
        NewFolderButton.IsEnabled = _client is { IsConnected: true };
    }

    private void FileList_SelectionChanged(object sender, SelectionChangedEventArgs e) => RefreshToolbarState();

    private async void Upload_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null) return;
        var dialog = new Microsoft.Win32.OpenFileDialog { Title = "上传文件" };
        if (dialog.ShowDialog() != true) return;
        var localPath = dialog.FileName;
        var remotePath = CombineRemote(_path, Path.GetFileName(localPath));
        await RunTransferAsync($"正在上传 {Path.GetFileName(localPath)}", async client =>
        {
            await Task.Run(() =>
            {
                using var stream = File.OpenRead(localPath);
                client.UploadFile(stream, remotePath, true, progress => UpdateTransferProgress(progress, stream.Length));
            });
        });
        await NavigateAsync(_path);
    }

    private async void Download_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null || FileList.SelectedItem is not SftpEntry entry || entry.IsDirectory) return;
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            Title = "下载文件",
            FileName = entry.Name,
            Filter = "所有文件|*.*"
        };
        if (dialog.ShowDialog() != true) return;
        var localPath = dialog.FileName;
        await RunTransferAsync($"正在下载 {entry.Name}", async client =>
        {
            await Task.Run(() =>
            {
                using var stream = File.Create(localPath);
                client.DownloadFile(entry.FullPath, stream, progress => UpdateTransferProgress(progress, entry.Size));
            });
        });
        StatusText.Text = $"已下载到 {localPath}";
    }

    private async Task RunTransferAsync(string label, Func<SftpClient, Task> operation)
    {
        if (_client is null || _busy) return;
        _busy = true;
        UpdateConnectionUi();
        StatusText.Text = label;
        _transferVersion++;
        try
        {
            await operation(_client);
            StatusText.Text = "传输完成";
            AppServices.Audit.Record("sftp", $"{label} 完成", AuditLevel.Info, _host);
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            MessageBox.Show(ex.Message, "传输失败", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _busy = false;
            TransferProgress.Value = 0;
            UpdateConnectionUi();
        }
    }

    private void UpdateTransferProgress(ulong transferred, long total)
    {
        if (total <= 0) return;
        var percent = Math.Clamp(transferred * 100.0 / total, 0, 100);
        Dispatcher.BeginInvoke(() =>
        {
            TransferProgress.Value = percent;
            TransferText.Text = $"{transferred / 1024} KB / {total / 1024} KB";
        });
    }

    private async void NewFolder_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null) return;
        var dialog = new TextInputDialog("新建文件夹", "名称", string.Empty) { Owner = AppServices.MainWindow };
        if (dialog.ShowDialog() != true) return;
        var name = dialog.Value.Trim();
        if (string.IsNullOrEmpty(name)) return;
        try
        {
            var path = CombineRemote(_path, name);
            await Task.Run(() => _client.CreateDirectory(path));
            AppServices.Audit.Record("sftp", $"新建目录 {path}", AuditLevel.Info, _host);
            await NavigateAsync(_path);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "无法新建文件夹", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void Rename_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null || FileList.SelectedItem is not SftpEntry entry) return;
        var dialog = new TextInputDialog("重命名", "名称", entry.Name) { Owner = AppServices.MainWindow };
        if (dialog.ShowDialog() != true) return;
        var newName = dialog.Value.Trim();
        if (string.IsNullOrEmpty(newName) || newName == entry.Name) return;
        try
        {
            var target = CombineRemote(_path, newName);
            await Task.Run(() => _client.RenameFile(entry.FullPath, target));
            AppServices.Audit.Record("sftp", $"重命名 {entry.FullPath} 为 {target}", AuditLevel.Info, _host);
            await NavigateAsync(_path);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "无法重命名", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_client is null || FileList.SelectedItem is not SftpEntry entry) return;
        if (AppServices.Settings.ConfirmDelete)
        {
            var kind = entry.IsDirectory ? "文件夹" : "文件";
            if (MessageBox.Show($"删除{kind}「{entry.Name}」？", "删除", MessageBoxButton.YesNo,
                    MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        }
        try
        {
            await Task.Run(() =>
            {
                if (entry.IsDirectory) DeleteDirectoryRecursive(_client, entry.FullPath);
                else _client.DeleteFile(entry.FullPath);
            });
            AppServices.Audit.Record("sftp", $"删除 {entry.FullPath}", AuditLevel.Warning, _host);
            await NavigateAsync(_path);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "无法删除", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private static void DeleteDirectoryRecursive(SftpClient client, string path)
    {
        foreach (var child in client.ListDirectory(path))
        {
            if (child.Name is "." or "..") continue;
            if (child.IsDirectory) DeleteDirectoryRecursive(client, child.FullName);
            else client.DeleteFile(child.FullName);
        }
        client.DeleteDirectory(path);
    }

    private async Task OpenEditorAsync(SftpEntry entry)
    {
        if (_client is null) return;
        if (entry.Size > 4 * 1024 * 1024)
        {
            MessageBox.Show("文件大于 4 MB，请先下载后在本地编辑。", "文件过大", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        string text;
        try
        {
            text = await Task.Run(() => _client.ReadAllText(entry.FullPath, Encoding.UTF8));
        }
        catch (Exception ex)
        {
            MessageBox.Show($"无法以文本方式读取该文件：{ex.Message}", "打开文件", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        var editor = new RemoteEditorDialog(entry.FullPath, text) { Owner = AppServices.MainWindow };
        if (editor.ShowDialog() != true) return;
        try
        {
            await Task.Run(() => _client.WriteAllText(entry.FullPath, editor.EditorContent, Encoding.UTF8));
            AppServices.Audit.Record("sftp", $"保存远程文件 {entry.FullPath}", AuditLevel.Info, _host);
            StatusText.Text = "文件已保存";
            await NavigateAsync(_path);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "保存失败", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Open_Click(object sender, RoutedEventArgs e)
    {
        if (FileList.SelectedItem is SftpEntry entry) _ = OpenEditorAsync(entry);
    }

    private static string CombineRemote(string directory, string name)
        => directory.TrimEnd('/') + "/" + name.TrimStart('/');
}
