package com.fluentssh.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Neutral, layered surfaces with hairline borders. No decorative shadows,
 * no colored edge bars: depth comes from surface tone and 0.5dp outlines,
 * following the mobile design-system rules.
 */
data class FluentColors(
    val isDark: Boolean,
    val background: Color,
    val surface: Color,
    val surfaceContainer: Color,
    val surfaceContainerHigh: Color,
    val surfaceSunken: Color,
    val outline: Color,
    val outlineStrong: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val brand: Color,
    val brandPressed: Color,
    val brandContainer: Color,
    val onBrandContainer: Color,
    val onBrand: Color,
    val success: Color,
    val successContainer: Color,
    val warning: Color,
    val warningContainer: Color,
    val error: Color,
    val errorContainer: Color,
    val scrim: Color,
    val terminalBackground: Color,
    val terminalForeground: Color,
    val terminalCursor: Color,
    val terminalSelection: Color,
) {
    val hairline: Color get() = outline
    val isLight: Boolean get() = !isDark
}

val LightFluentColors = FluentColors(
    isDark = false,
    background = Color(0xFFF6F7F9),
    surface = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF1F3F6),
    surfaceContainerHigh = Color(0xFFFFFFFF),
    surfaceSunken = Color(0xFFEDEFF3),
    outline = Color(0xFFE4E7EC),
    outlineStrong = Color(0xFFD0D5DD),
    textPrimary = Color(0xFF101828),
    textSecondary = Color(0xFF475467),
    textTertiary = Color(0xFF667085),
    brand = Color(0xFF0F6CBD),
    brandPressed = Color(0xFF0C5AA0),
    brandContainer = Color(0xFFE7F1FB),
    onBrandContainer = Color(0xFF0B4F8A),
    onBrand = Color(0xFFFFFFFF),
    success = Color(0xFF067647),
    successContainer = Color(0xFFDCFAE6),
    warning = Color(0xFFB54708),
    warningContainer = Color(0xFFFEF0C7),
    error = Color(0xFFD92D20),
    errorContainer = Color(0xFFFEE4E2),
    scrim = Color(0x66000000),
    terminalBackground = Color(0xFF0B0F14),
    terminalForeground = Color(0xFFD7E2EE),
    terminalCursor = Color(0xFF6CB8F5),
    terminalSelection = Color(0x336CB8F5),
)

val DarkFluentColors = FluentColors(
    isDark = true,
    background = Color(0xFF0C1015),
    surface = Color(0xFF12171D),
    surfaceContainer = Color(0xFF171D25),
    surfaceContainerHigh = Color(0xFF1D242D),
    surfaceSunken = Color(0xFF0A0E13),
    outline = Color(0xFF262E38),
    outlineStrong = Color(0xFF34404D),
    textPrimary = Color(0xFFEAF0F6),
    textSecondary = Color(0xFF9AA7B4),
    textTertiary = Color(0xFF6F7D8B),
    brand = Color(0xFF6CB8F5),
    brandPressed = Color(0xFF8CC9F8),
    brandContainer = Color(0xFF13324D),
    onBrandContainer = Color(0xFFA8D4FA),
    onBrand = Color(0xFF04121F),
    success = Color(0xFF47CD89),
    successContainer = Color(0xFF10291D),
    warning = Color(0xFFFDB022),
    warningContainer = Color(0xFF3A2A12),
    error = Color(0xFFF97066),
    errorContainer = Color(0xFF3B1A18),
    scrim = Color(0x99000000),
    terminalBackground = Color(0xFF070A0E),
    terminalForeground = Color(0xFFD7E2EE),
    terminalCursor = Color(0xFF6CB8F5),
    terminalSelection = Color(0x336CB8F5),
)

val LocalFluentColors = staticCompositionLocalOf { LightFluentColors }

enum class ThemeMode { SYSTEM, LIGHT, DARK }

@Composable
fun FluentTheme(
    mode: ThemeMode = ThemeMode.SYSTEM,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val colors = if (dark) DarkFluentColors else LightFluentColors
    val scheme = if (dark) {
        darkColorScheme(
            primary = colors.brand,
            onPrimary = colors.onBrand,
            primaryContainer = colors.brandContainer,
            onPrimaryContainer = colors.onBrandContainer,
            background = colors.background,
            onBackground = colors.textPrimary,
            surface = colors.surface,
            onSurface = colors.textPrimary,
            surfaceVariant = colors.surfaceContainer,
            onSurfaceVariant = colors.textSecondary,
            outline = colors.outlineStrong,
            outlineVariant = colors.outline,
            error = colors.error,
            errorContainer = colors.errorContainer,
            scrim = colors.scrim,
        )
    } else {
        lightColorScheme(
            primary = colors.brand,
            onPrimary = colors.onBrand,
            primaryContainer = colors.brandContainer,
            onPrimaryContainer = colors.onBrandContainer,
            background = colors.background,
            onBackground = colors.textPrimary,
            surface = colors.surface,
            onSurface = colors.textPrimary,
            surfaceVariant = colors.surfaceContainer,
            onSurfaceVariant = colors.textSecondary,
            outline = colors.outlineStrong,
            outlineVariant = colors.outline,
            error = colors.error,
            errorContainer = colors.errorContainer,
            scrim = colors.scrim,
        )
    }

    CompositionLocalProvider(LocalFluentColors provides colors) {
        MaterialTheme(
            colorScheme = scheme,
            typography = FluentTypography,
            shapes = FluentShapes,
            content = content,
        )
    }
}

val FluentTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        lineHeight = 34.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 17.sp,
        lineHeight = 24.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 15.sp,
        lineHeight = 21.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 15.sp,
        lineHeight = 20.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 13.sp,
        lineHeight = 18.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
    ),
)

val FluentShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

object Motion {
    const val Short = 160
    const val Medium = 240
    const val Long = 320
}
