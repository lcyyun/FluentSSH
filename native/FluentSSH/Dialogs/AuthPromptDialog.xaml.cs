using System.Windows;
using System.Windows.Controls;
using Renci.SshNet.Common;
using FluentSSH.Core;

namespace FluentSSH.Dialogs;

public partial class AuthPromptDialog : Window
{
    private readonly List<Control> _inputs = new();

    public AuthPromptDialog(HostProfile host, AuthenticationPromptEventArgs args)
    {
        InitializeComponent();
        HostText.Text = $"{host.Username}@{host.Hostname}:{host.Port}";
        InstructionText.Text = string.IsNullOrWhiteSpace(args.Instruction)
            ? "服务器请求额外验证信息。"
            : args.Instruction;
        foreach (var prompt in args.Prompts)
        {
            var label = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(prompt.Request) ? "验证码 / 密码" : prompt.Request,
                Margin = new Thickness(0, 0, 0, 5),
                Foreground = (System.Windows.Media.Brush)FindResource("AppTextSecondaryBrush")
            };
            Control input = prompt.IsEchoed
                ? new TextBox { Height = 32 }
                : new PasswordBox { Height = 32 };
            _inputs.Add(input);
            PromptsPanel.Children.Add(label);
            PromptsPanel.Children.Add(input);
        }
    }

    private void Continue_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    public string[] GetResponses()
    {
        return _inputs.Select(input => input switch
        {
            PasswordBox password => password.Password,
            TextBox text => text.Text,
            _ => string.Empty
        }).ToArray();
    }
}
