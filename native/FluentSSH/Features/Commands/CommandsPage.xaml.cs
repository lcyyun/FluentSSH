using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FluentSSH.Core;
using FluentSSH.Dialogs;

namespace FluentSSH.Features;

public partial class CommandsPage : UserControl, IActivatablePage
{
    private bool _running;

    public CommandsPage()
    {
        InitializeComponent();
        Loaded += (_, _) => OnActivated();
        AppServices.HostsChanged += () => Dispatcher.BeginInvoke(RefreshHosts);
        CommandBox.TextChanged += (_, _) => UpdateCommandHint();
    }

    public void OnActivated()
    {
        RefreshHosts();
        RefreshLists();
    }

    private void RefreshHosts()
    {
        var selected = (HostPicker.SelectedItem as HostProfile)?.Id;
        HostPicker.ItemsSource = null;
        HostPicker.ItemsSource = AppServices.Data.Hosts.OrderBy(h => h.Name, StringComparer.CurrentCulture).ToList();
        if (selected is not null)
            HostPicker.SelectedItem = HostPicker.Items.OfType<HostProfile>().FirstOrDefault(h => h.Id == selected);
        if (HostPicker.SelectedItem is null && HostPicker.Items.Count > 0) HostPicker.SelectedIndex = 0;
    }

    private void RefreshLists()
    {
        SnippetList.ItemsSource = null;
        SnippetList.ItemsSource = AppServices.Data.Snippets.OrderBy(s => s.Name, StringComparer.CurrentCulture).ToList();
        HistoryList.ItemsSource = null;
        HistoryList.ItemsSource = AppServices.Data.CommandHistory.OrderByDescending(h => h.StartedAt).Take(60).ToList();
        CommandCountText.Text = $"{AppServices.Data.Snippets.Count} 个片段";
        UpdateCommandHint();
    }

    private void UpdateCommandHint()
    {
        CommandHint.Visibility = string.IsNullOrEmpty(CommandBox.Text) ? Visibility.Visible : Visibility.Collapsed;
        OutputPlaceholder.Visibility = string.IsNullOrEmpty(OutputBox.Text) ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void Run_Click(object sender, RoutedEventArgs e) => await RunAsync();

    private void CommandBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && Keyboard.Modifiers == ModifierKeys.Control)
        {
            // IME composition must never trigger execution.
            if (InputMethod.Current?.ImeState == InputMethodState.On)
            {
                e.Handled = true;
                return;
            }
            e.Handled = true;
            _ = RunAsync();
        }
    }

    private async Task RunAsync()
    {
        if (_running) return;
        if (HostPicker.SelectedItem is not HostProfile host)
        {
            MessageBox.Show("请选择目标主机。", "执行命令", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        var command = CommandBox.Text.Trim();
        if (string.IsNullOrEmpty(command))
        {
            CommandBox.Focus();
            return;
        }

        _running = true;
        RunButton.IsEnabled = false;
        RunStatusText.Text = "执行中";
        ExitCodeText.Text = string.Empty;
        DurationText.Text = string.Empty;
        OutputBox.Text = string.Empty;
        OutputPlaceholder.Visibility = Visibility.Collapsed;
        try
        {
            var result = await AppServices.Ssh.ExecuteAsync(host, command);
            OutputBox.Text = BuildOutput(result);
            RunStatusText.Text = "完成";
            ExitCodeText.Text = result.ExitCode is null ? "退出码 未知" : $"退出码 {result.ExitCode}";
            DurationText.Text = $"{result.DurationMs} ms";
            var record = new CommandHistoryRecord
            {
                HostId = host.Id,
                HostLabel = host.Name,
                Command = command,
                Output = result.Output,
                Error = result.Error,
                ExitCode = result.ExitCode,
                StartedAt = DateTime.Now.AddMilliseconds(-result.DurationMs),
                DurationMs = result.DurationMs
            };
            AppServices.Data.CommandHistory.Insert(0, record);
            while (AppServices.Data.CommandHistory.Count > 200)
                AppServices.Data.CommandHistory.RemoveAt(AppServices.Data.CommandHistory.Count - 1);
            AppServices.Audit.Record("command", $"执行命令 {command}", AuditLevel.Info, host, result.Error);
            AppServices.Store.Save();
            RefreshLists();
        }
        catch (Exception ex)
        {
            OutputBox.Text = ex.Message;
            RunStatusText.Text = "执行失败";
        }
        finally
        {
            _running = false;
            RunButton.IsEnabled = true;
            UpdateCommandHint();
        }
    }

    private static string BuildOutput(CommandResult result)
    {
        var text = result.Output;
        if (!string.IsNullOrEmpty(result.Error))
        {
            if (!string.IsNullOrEmpty(text)) text += Environment.NewLine;
            text += result.Error;
        }
        return string.IsNullOrEmpty(text) ? "（无输出）" : text;
    }

    public async Task RunForCaptureAsync(string hostName, string command)
    {
        OnActivated();
        var host = AppServices.Data.Hosts.FirstOrDefault(h => h.Name.Equals(hostName, StringComparison.OrdinalIgnoreCase));
        if (host is not null)
            HostPicker.SelectedItem = HostPicker.Items.OfType<HostProfile>().FirstOrDefault(h => h.Id == host.Id);
        CommandBox.Text = command;
        await RunAsync();
    }

    private void AddSnippet_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SnippetDialog(null) { Owner = AppServices.MainWindow };
        if (dialog.ShowDialog() != true) return;
        AppServices.Data.Snippets.Add(dialog.SavedSnippet!);
        AppServices.Store.Save();
        RefreshLists();
    }

    private void DeleteSnippet_Click(object sender, RoutedEventArgs e)
    {
        if (SnippetList.SelectedItem is not Snippet snippet) return;
        if (AppServices.Settings.ConfirmDelete &&
            MessageBox.Show($"删除片段「{snippet.Name}」？", "删除片段", MessageBoxButton.YesNo,
                MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        AppServices.Data.Snippets.Remove(snippet);
        AppServices.Store.Save();
        RefreshLists();
    }

    private void SnippetList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (SnippetList.SelectedItem is Snippet snippet) CommandBox.Text = snippet.Command;
    }

    private void HistoryList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (HistoryList.SelectedItem is not CommandHistoryRecord record) return;
        CommandBox.Text = record.Command;
        var host = AppServices.Store.FindHost(record.HostId);
        if (host is not null) HostPicker.SelectedItem = HostPicker.Items.OfType<HostProfile>().FirstOrDefault(h => h.Id == host.Id);
    }

    private void ClearHistory_Click(object sender, RoutedEventArgs e)
    {
        if (AppServices.Data.CommandHistory.Count == 0) return;
        if (MessageBox.Show("清空命令历史？", "清空", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        AppServices.Data.CommandHistory.Clear();
        AppServices.Store.Save();
        RefreshLists();
    }

    private void ClearOutput_Click(object sender, RoutedEventArgs e)
    {
        OutputBox.Text = string.Empty;
        RunStatusText.Text = string.Empty;
        ExitCodeText.Text = string.Empty;
        DurationText.Text = string.Empty;
        UpdateCommandHint();
    }
}
