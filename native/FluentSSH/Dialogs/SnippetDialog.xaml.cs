using System.Windows;
using FluentSSH.Core;

namespace FluentSSH.Dialogs;

public partial class SnippetDialog : Window
{
    private readonly Snippet? _editing;

    public Snippet? SavedSnippet { get; private set; }

    public SnippetDialog(Snippet? editing)
    {
        _editing = editing;
        InitializeComponent();
        Title = editing is null ? "新建片段" : "编辑片段";
        DialogTitle.Text = Title;
        if (editing is not null)
        {
            NameBox.Text = editing.Name;
            CommandBox.Text = editing.Command;
            DescriptionBox.Text = editing.Description;
        }
        Loaded += (_, _) => NameBox.Focus();
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(NameBox.Text) || string.IsNullOrWhiteSpace(CommandBox.Text))
        {
            MessageBox.Show("名称和命令不能为空。", "无法保存", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        var snippet = _editing ?? new Snippet();
        snippet.Name = NameBox.Text.Trim();
        snippet.Command = CommandBox.Text.Trim();
        snippet.Description = DescriptionBox.Text.Trim();
        SavedSnippet = snippet;
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => Close();
}
