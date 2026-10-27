using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using FluentSSH.Core;

namespace FluentSSH.Dialogs;

public partial class SessionPickerDialog : Window
{
    public HostProfile? SelectedHost { get; private set; }

    public SessionPickerDialog()
    {
        InitializeComponent();
        foreach (var host in AppServices.Data.Hosts) host.GroupName = AppServices.Store.HostGroupName(host);
        HostList.ItemsSource = AppServices.Data.Hosts
            .OrderByDescending(h => h.Favorite)
            .ThenBy(h => h.Name, StringComparer.CurrentCulture)
            .ToList();
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        var search = SearchBox.Text.Trim();
        var query = AppServices.Data.Hosts.AsEnumerable();
        if (!string.IsNullOrEmpty(search))
        {
            query = query.Where(h =>
                h.Name.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                h.Hostname.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                h.Username.Contains(search, StringComparison.OrdinalIgnoreCase));
        }
        HostList.ItemsSource = query.OrderByDescending(h => h.Favorite).ThenBy(h => h.Name, StringComparer.CurrentCulture).ToList();
    }

    private void HostList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        => SelectedHost = HostList.SelectedItem as HostProfile;

    private void HostList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (HostList.SelectedItem is HostProfile host)
        {
            SelectedHost = host;
            DialogResult = true;
            Close();
        }
    }

    private void Connect_Click(object sender, RoutedEventArgs e)
    {
        if (HostList.SelectedItem is not HostProfile host)
        {
            MessageBox.Show("请选择主机。", "选择主机", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        SelectedHost = host;
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => Close();
}
