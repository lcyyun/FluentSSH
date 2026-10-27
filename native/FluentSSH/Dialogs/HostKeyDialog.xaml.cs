using System.Windows;
using Renci.SshNet.Common;
using FluentSSH.Core;

namespace FluentSSH.Dialogs;

public partial class HostKeyDialog : Window
{
    public HostKeyDialog(HostProfile host, HostKeyEventArgs args, KnownHostRecord? existing)
    {
        InitializeComponent();
        var fingerprint = $"SHA256:{args.FingerPrintSHA256}";
        HostText.Text = $"{host.Hostname}:{host.Port}";
        KeyTypeText.Text = args.HostKeyName;
        FingerprintText.Text = fingerprint;
        if (existing is not null && existing.Fingerprint != fingerprint)
        {
            WarningText.Text = "主机密钥与已保存的指纹不一致。这可能意味着服务器被重装，也可能存在中间人攻击风险。请通过可信渠道核对指纹后再继续。";
            ExpectedText.Text = existing.Fingerprint;
        }
        else if (existing is not null)
        {
            WarningText.Text = "已保存的主机密钥与服务器匹配。";
            ExpectedText.Text = existing.Fingerprint;
        }
        else
        {
            WarningText.Text = "这是首次连接该主机。请确认下面的指纹与服务端管理员提供的一致，再信任它。";
            ExpectedText.Text = "（尚无已保存指纹）";
        }
    }

    private void Trust_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
