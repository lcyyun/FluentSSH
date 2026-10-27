using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;

namespace FluentSSH.Converters;

public sealed class StringToBrushConverter : IValueConverter
{
    private static readonly Dictionary<string, Brush> Cache = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var text = value as string;
        if (string.IsNullOrWhiteSpace(text)) text = "#0f6cbd";
        if (Cache.TryGetValue(text, out var cached)) return cached;
        try
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(text));
            brush.Freeze();
            Cache[text] = brush;
            return brush;
        }
        catch
        {
            var fallback = new SolidColorBrush(Color.FromRgb(15, 108, 189));
            fallback.Freeze();
            return fallback;
        }
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}

public sealed class BoolToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is true ? System.Windows.Visibility.Visible : System.Windows.Visibility.Collapsed;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is System.Windows.Visibility.Visible;
}

public sealed class InverseBoolToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value is true ? System.Windows.Visibility.Collapsed : System.Windows.Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotSupportedException();
}
