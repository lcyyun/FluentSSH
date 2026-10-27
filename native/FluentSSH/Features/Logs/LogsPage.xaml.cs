using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using FluentSSH.Core;

namespace FluentSSH.Features;

public sealed class RecordingFile
{
    public required string FullPath { get; init; }
    public string Name => Path.GetFileName(FullPath);
    public string SizeLabel => new FileInfo(FullPath).Length is var size
        ? size < 1024 ? $"{size} B" : $"{size / 1024.0:0.#} KB"
        : string.Empty;
    public string ModifiedLabel => File.GetLastWriteTime(FullPath).ToString("yyyy-MM-dd HH:mm");
}

public partial class LogsPage : UserControl, IActivatablePage
{
    public LogsPage()
    {
        InitializeComponent();
        Loaded += (_, _) => OnActivated();
        AppServices.Audit.Recorded += _ => Dispatcher.BeginInvoke(RefreshAudit);
    }

    public void OnActivated()
    {
        if (SectionTabs.SelectedIndex < 0) SectionTabs.SelectedIndex = 0;
        RefreshAudit();
        RefreshRecordings();
    }

    private void RefreshAudit()
    {
        AuditList.ItemsSource = null;
        AuditList.ItemsSource = AppServices.Data.Audit;
        EmptyAuditText.Visibility = AppServices.Data.Audit.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (SectionTabs.SelectedIndex == 0)
            CountText.Text = $"{AppServices.Data.Audit.Count} 条事件";
    }

    private void RefreshRecordings()
    {
        var dir = AppServices.Paths.LogsDirectory;
        var files = Directory.Exists(dir)
            ? Directory.GetFiles(dir, "*.log").Select(path => new RecordingFile { FullPath = path })
                .OrderByDescending(file => File.GetLastWriteTime(file.FullPath)).ToList()
            : new List<RecordingFile>();
        RecordingList.ItemsSource = files;
        EmptyRecordingsText.Visibility = files.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        if (SectionTabs.SelectedIndex == 1)
            CountText.Text = $"{files.Count} 个录制";
    }

    private void SectionTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (AuditView is null) return;
        var audit = SectionTabs.SelectedIndex == 0;
        AuditView.Visibility = audit ? Visibility.Visible : Visibility.Collapsed;
        RecordingsView.Visibility = audit ? Visibility.Collapsed : Visibility.Visible;
        ClearButton.Visibility = audit ? Visibility.Visible : Visibility.Collapsed;
        CountText.Text = audit
            ? $"{AppServices.Data.Audit.Count} 条事件"
            : $"{RecordingList.Items.Count} 个录制";
        if (!audit) RefreshRecordings();
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(AppServices.Paths.LogsDirectory);
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = AppServices.Paths.LogsDirectory,
            UseShellExecute = true
        });
    }

    private void Clear_Click(object sender, RoutedEventArgs e)
    {
        if (AppServices.Data.Audit.Count == 0) return;
        if (MessageBox.Show("清空审计日志？此操作不可撤销。", "清空审计", MessageBoxButton.YesNo,
                MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        AppServices.Audit.Clear();
        RefreshAudit();
    }

    private void RecordingList_SelectionChanged(object sender, SelectionChangedEventArgs e) { }

    private void OpenRecording_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not RecordingFile file) return;
        try
        {
            Process.Start(new ProcessStartInfo { FileName = file.FullPath, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "无法打开录制", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void DeleteRecording_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not RecordingFile file) return;
        if (AppServices.Settings.ConfirmDelete &&
            MessageBox.Show($"删除录制「{file.Name}」？", "删除录制", MessageBoxButton.YesNo,
                MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        try
        {
            File.Delete(file.FullPath);
            RefreshRecordings();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "无法删除录制", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
}
