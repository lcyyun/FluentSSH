using System.Windows;
using System.Windows.Input;

namespace FluentSSH.Dialogs;

public partial class RemoteEditorDialog : Window
{
    private bool _dirty;

    public string EditorContent => EditorBox.Text;

    public RemoteEditorDialog(string path, string content)
    {
        InitializeComponent();
        Title = "编辑远程文件";
        PathText.Text = path;
        EditorBox.Text = content;
        EditorBox.CaretIndex = 0;
        Loaded += (_, _) => EditorBox.Focus();
    }

    private void EditorBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
    {
        if (!IsLoaded) return;
        _dirty = true;
        DirtyText.Text = "未保存";
    }

    private void EditorBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.S && Keyboard.Modifiers == ModifierKeys.Control)
        {
            Save_Click(sender, e);
            e.Handled = true;
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (_dirty && MessageBox.Show("放弃未保存的修改？", "编辑远程文件", MessageBoxButton.YesNo,
                MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        DialogResult = false;
        Close();
    }
}
