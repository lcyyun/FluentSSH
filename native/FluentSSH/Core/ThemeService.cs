using System.Windows;
using Microsoft.Win32;
using Wpf.Ui.Appearance;

namespace FluentSSH.Core;

/// <summary>Bridges the application theme preference to WPF-UI and our brush dictionaries.</summary>
public static class ThemeService
{
    public static bool IsDark { get; private set; }

    public static void Apply(string theme)
    {
        var dark = theme.Equals("Dark", StringComparison.OrdinalIgnoreCase) ||
                   (theme.Equals("System", StringComparison.OrdinalIgnoreCase) && IsSystemDark());
        IsDark = dark;
        try
        {
            ApplicationThemeManager.Apply(dark ? ApplicationTheme.Dark : ApplicationTheme.Light);
        }
        catch (Exception ex)
        {
            AppServices.LogError("应用 WPF-UI 主题失败", ex);
        }

        var app = Application.Current;
        if (app is null) return;
        var dictionaries = app.Resources.MergedDictionaries;
        var old = dictionaries.FirstOrDefault(d =>
            d.Source?.OriginalString.Contains("Themes/Light.xaml", StringComparison.OrdinalIgnoreCase) == true ||
            d.Source?.OriginalString.Contains("Themes/Dark.xaml", StringComparison.OrdinalIgnoreCase) == true);
        var next = new ResourceDictionary
        {
            Source = new Uri(dark ? "/Themes/Dark.xaml" : "/Themes/Light.xaml", UriKind.Relative)
        };
        if (old is not null)
        {
            var index = dictionaries.IndexOf(old);
            dictionaries[index] = next;
        }
        else
        {
            dictionaries.Add(next);
        }
    }

    public static bool IsSystemDark()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int value && value == 0;
        }
        catch
        {
            return false;
        }
    }
}
