using System.Windows;
using System.Windows.Controls;
using FluentSSH.Core;

namespace FluentSSH.Dialogs;

public partial class GroupManagerDialog : Window
{
    public GroupManagerDialog()
    {
        InitializeComponent();
        Refresh();
    }

    private void Refresh()
    {
        GroupList.ItemsSource = null;
        GroupList.ItemsSource = AppServices.Data.Groups;
    }

    private void AddGroup_Click(object sender, RoutedEventArgs e)
    {
        var name = GroupNameBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(name)) return;
        if (AppServices.Data.Groups.Any(g => g.Name.Equals(name, StringComparison.CurrentCultureIgnoreCase))) return;
        AppServices.Data.Groups.Add(new HostGroup { Name = name });
        GroupNameBox.Text = string.Empty;
        AppServices.NotifyHostsChanged();
        Refresh();
    }

    private void DeleteGroup_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is not HostGroup group) return;
        foreach (var host in AppServices.Data.Hosts.Where(h => h.GroupId == group.Id))
            host.GroupId = null;
        AppServices.Data.Groups.Remove(group);
        AppServices.NotifyHostsChanged();
        Refresh();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
