using System.Windows;

namespace FluentSSH.Dialogs;

public partial class TextInputDialog : Window
{
    public string Value => ValueBox.Text;

    public TextInputDialog(string title, string label, string initialValue)
    {
        InitializeComponent();
        Title = title;
        TitleText.Text = title;
        LabelText.Text = label;
        ValueBox.Text = initialValue;
        Loaded += (_, _) =>
        {
            ValueBox.Focus();
            ValueBox.SelectAll();
        };
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => Close();
}
