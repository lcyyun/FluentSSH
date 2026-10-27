package com.fluentssh.mobile.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import kotlinx.coroutines.launch

// ---------------------------------------------------------------- foundations

/** 0.5dp hairline, the mobile equivalent of a 0.5px Retina border. */
@Composable
fun Hairline(
    modifier: Modifier = Modifier,
    color: Color = LocalFluentColors.current.outline,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(0.5.dp)
            .background(color),
    )
}

@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(16.dp),
    containerColor: Color = LocalFluentColors.current.surface,
    borderColor: Color = LocalFluentColors.current.outline,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(containerColor)
            .border(BorderStroke(0.5.dp, borderColor), shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(contentPadding),
        content = content,
    )
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = LocalFluentColors.current.textTertiary,
        modifier = modifier.padding(horizontal = 4.dp, vertical = 8.dp),
    )
}

@Composable
fun AvatarTile(
    initials: String,
    modifier: Modifier = Modifier,
    size: Int = 44,
    containerColor: Color = LocalFluentColors.current.brandContainer,
    contentColor: Color = LocalFluentColors.current.onBrandContainer,
) {
    Box(
        modifier
            .size(size.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(containerColor),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initials,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = contentColor,
        )
    }
}

@Composable
fun Tag(
    text: String,
    modifier: Modifier = Modifier,
    containerColor: Color = LocalFluentColors.current.surfaceContainer,
    contentColor: Color = LocalFluentColors.current.textSecondary,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(6.dp))
            .background(containerColor)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = contentColor)
    }
}

@Composable
fun StatusPill(
    text: String,
    color: Color,
    containerColor: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(containerColor)
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(color))
        Text(text, style = MaterialTheme.typography.labelSmall, color = color)
    }
}

@Composable
fun InlineNotice(
    text: String,
    modifier: Modifier = Modifier,
    tone: NoticeTone = NoticeTone.INFO,
) {
    val colors = LocalFluentColors.current
    val (container, content, icon) = when (tone) {
        NoticeTone.INFO -> Triple(colors.brandContainer, colors.onBrandContainer, Icons.Outlined.Info)
        NoticeTone.WARN -> Triple(colors.warningContainer, colors.warning, Icons.Outlined.ErrorOutline)
        NoticeTone.ERROR -> Triple(colors.errorContainer, colors.error, Icons.Outlined.ErrorOutline)
        NoticeTone.SUCCESS -> Triple(colors.successContainer, colors.success, Icons.Outlined.CheckCircle)
    }
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(container)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(18.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, color = content)
    }
}

enum class NoticeTone { INFO, WARN, ERROR, SUCCESS }

// ------------------------------------------------------------------ controls

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    destructive: Boolean = false,
    leadingIcon: ImageVector? = null,
) {
    val colors = LocalFluentColors.current
    val bg = when {
        !enabled -> colors.surfaceContainer
        destructive -> colors.error
        else -> colors.brand
    }
    val fg = when {
        !enabled -> colors.textTertiary
        else -> if (destructive) Color.White else colors.onBrand
    }
    Row(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .clickable(enabled = enabled && !loading, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
                color = fg,
            )
            Spacer(Modifier.width(8.dp))
        } else if (leadingIcon != null) {
            Icon(leadingIcon, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, color = fg)
    }
}

@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leadingIcon: ImageVector? = null,
) {
    val colors = LocalFluentColors.current
    Row(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.surface)
            .border(BorderStroke(0.5.dp, colors.outlineStrong), RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leadingIcon != null) {
            Icon(leadingIcon, contentDescription = null, tint = colors.textPrimary, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge, color = colors.textPrimary)
    }
}

@Composable
fun IconCircle(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = LocalFluentColors.current.textSecondary,
    enabled: Boolean = true,
) {
    Box(
        modifier
            .size(48.dp)
            .clip(CircleShape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(22.dp))
    }
}

@Composable
fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    onSearch: (() -> Unit)? = null,
) {
    val colors = LocalFluentColors.current
    Row(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.surfaceContainer)
            .padding(start = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = colors.textTertiary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) {
                Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = colors.textTertiary)
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.textPrimary),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(colors.brand),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) {
            IconButton(onClick = { onValueChange("") }, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Outlined.Cancel, contentDescription = "清除搜索", tint = colors.textTertiary, modifier = Modifier.size(18.dp))
            }
        } else {
            Spacer(Modifier.width(12.dp))
        }
    }
}

@Composable
fun SegmentedControl(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalFluentColors.current
    Row(
        modifier
            .fillMaxWidth()
            .height(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.surfaceContainer)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        options.forEachIndexed { index, option ->
            val selected = index == selectedIndex
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(9.dp))
                    .then(if (selected) Modifier.background(colors.surface).border(BorderStroke(0.5.dp, colors.outline), RoundedCornerShape(9.dp)) else Modifier)
                    .clickable { onSelect(index) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = option,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (selected) colors.textPrimary else colors.textSecondary,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                )
            }
        }
    }
}

// ------------------------------------------------------------------- top bar

@Composable
fun AppTopBar(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    containerColor: Color = LocalFluentColors.current.background,
) {
    val colors = LocalFluentColors.current
    Column(modifier.fillMaxWidth().background(containerColor).statusBarsPadding()) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(56.dp)
                .padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                    Icon(
                        Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = "返回",
                        tint = colors.textPrimary,
                        modifier = Modifier.size(19.dp),
                    )
                }
            } else {
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            actions()
        }
        Hairline(color = colors.outline)
    }
}

// -------------------------------------------------------------------- sheets

/**
 * Bottom sheet with the 30/60/80% height ladder, a 32x4 drag handle and a
 * locked scrim for form sheets (never silently discards typed input).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppBottomSheet(
    title: String,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    heightFraction: Float = 0.6f,
    dismissible: Boolean = true,
    footer: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalFluentColors.current
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { target -> target != SheetValue.Hidden || dismissible },
    )
    ModalBottomSheet(
        onDismissRequest = {
            if (dismissible) onDismissRequest()
        },
        sheetState = sheetState,
        containerColor = colors.surface,
        scrimColor = colors.scrim,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
        dragHandle = {
            Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 8.dp), contentAlignment = Alignment.Center) {
                Box(
                    Modifier
                        .size(width = 36.dp, height = 4.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(colors.outlineStrong),
                )
            }
        },
        modifier = modifier,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(heightFraction)
                .imePadding(),
        ) {
            Column(Modifier.padding(horizontal = 20.dp)) {
                Text(title, style = MaterialTheme.typography.headlineSmall, color = colors.textPrimary)
                if (subtitle != null) {
                    Spacer(Modifier.height(4.dp))
                    Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                }
            }
            Spacer(Modifier.height(12.dp))
            Hairline(color = colors.outline)
            Column(
                Modifier
                    .weight(1f)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
            ) {
                content()
            }
            if (footer != null) {
                Hairline(color = colors.outline)
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 12.dp)
                        .navigationBarsPadding(),
                ) { footer() }
            } else {
                Spacer(Modifier.navigationBarsPadding().height(12.dp))
            }
        }
    }
}

// -------------------------------------------------------------------- inputs

@Composable
fun FieldLabel(text: String, modifier: Modifier = Modifier, required: Boolean = false) {
    val colors = LocalFluentColors.current
    Text(
        buildAnnotatedString {
            append(text)
            if (required) {
                withStyle(SpanStyle(color = colors.error)) { append(" *") }
            }
        },
        style = MaterialTheme.typography.labelMedium,
        color = colors.textSecondary,
        modifier = modifier,
    )
}

@Composable
fun AppTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    singleLine: Boolean = true,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    leadingIcon: ImageVector? = null,
    trailingIcon: ImageVector? = null,
    onTrailingIconClick: (() -> Unit)? = null,
    isError: Boolean = false,
    enabled: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 6,
    suffix: String? = null,
) {
    val colors = LocalFluentColors.current
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = placeholder?.let { { Text(it, color = colors.textTertiary, style = MaterialTheme.typography.bodyLarge) } },
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        enabled = enabled,
        isError = isError,
        textStyle = MaterialTheme.typography.bodyLarge,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
        visualTransformation = visualTransformation,
        leadingIcon = leadingIcon?.let {
            { Icon(it, contentDescription = null, tint = colors.textTertiary, modifier = Modifier.size(20.dp)) }
        },
        trailingIcon = trailingIcon?.let {
            {
                IconButton(onClick = { onTrailingIconClick?.invoke() }, modifier = Modifier.size(48.dp)) {
                    Icon(it, contentDescription = null, tint = colors.textTertiary, modifier = Modifier.size(20.dp))
                }
            }
        },
        suffix = suffix?.let { { Text(it, color = colors.textTertiary, style = MaterialTheme.typography.bodyMedium) } },
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = colors.surface,
            unfocusedContainerColor = colors.surface,
            disabledContainerColor = colors.surfaceContainer,
            focusedBorderColor = colors.brand,
            unfocusedBorderColor = colors.outlineStrong,
            errorBorderColor = colors.error,
            focusedTextColor = colors.textPrimary,
            unfocusedTextColor = colors.textPrimary,
            cursorColor = colors.brand,
        ),
    )
}

@Composable
fun PasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "密码",
    visible: Boolean,
    onToggleVisible: () -> Unit,
    imeAction: ImeAction = ImeAction.Done,
    leadingIcon: ImageVector? = null,
) {
    AppTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        placeholder = placeholder,
        keyboardType = KeyboardType.Password,
        imeAction = imeAction,
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        leadingIcon = leadingIcon,
        trailingIcon = if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
        onTrailingIconClick = onToggleVisible,
    )
}

// -------------------------------------------------------------------- list

@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    showDivider: Boolean = true,
) {
    val colors = LocalFluentColors.current
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            leading?.invoke()
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (subtitle != null) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (trailing != null) {
                Row(verticalAlignment = Alignment.CenterVertically, content = trailing)
            }
        }
        if (showDivider) Hairline(Modifier.padding(start = if (leading != null) 68.dp else 16.dp))
    }
}

@Composable
fun KeyValueRow(key: String, value: String, modifier: Modifier = Modifier) {
    val colors = LocalFluentColors.current
    Row(
        modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(key, style = MaterialTheme.typography.bodyMedium, color = colors.textTertiary)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary)
    }
}

// -------------------------------------------------------------------- states

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val colors = LocalFluentColors.current
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(colors.surfaceContainer),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = colors.textPrimary, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(
            description,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textTertiary,
            textAlign = TextAlign.Center,
        )
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(20.dp))
            Box(Modifier.widthIn(min = 180.dp)) {
                PrimaryButton(actionLabel, onAction)
            }
        }
    }
}

@Composable
fun LoadingRow(text: String, modifier: Modifier = Modifier) {
    val colors = LocalFluentColors.current
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = colors.brand)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = colors.textTertiary)
    }
}

@Composable
fun ErrorNotice(text: String, modifier: Modifier = Modifier, onRetry: (() -> Unit)? = null) {
    val colors = LocalFluentColors.current
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(colors.errorContainer)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = colors.error, modifier = Modifier.size(18.dp))
            Text(text, style = MaterialTheme.typography.bodySmall, color = colors.error)
        }
        if (onRetry != null) {
            TextButton(onClick = onRetry, modifier = Modifier.height(48.dp)) {
                Text("重试", color = colors.error)
            }
        }
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    dismissOnOutsideClick: Boolean = false,
) {
    val colors = LocalFluentColors.current
    AlertDialog(
        onDismissRequest = { if (dismissOnOutsideClick) onDismiss() },
        containerColor = colors.surface,
        shape = RoundedCornerShape(20.dp),
        titleContentColor = colors.textPrimary,
        textContentColor = colors.textSecondary,
        icon = if (destructive) {
            {
                Icon(
                    Icons.Outlined.ErrorOutline,
                    contentDescription = null,
                    tint = colors.error,
                    modifier = Modifier.size(24.dp),
                )
            }
        } else {
            null
        },
        title = { Text(title, style = MaterialTheme.typography.titleLarge) },
        text = { Text(message, style = MaterialTheme.typography.bodyMedium) },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.height(48.dp)) {
                Text(confirmLabel, color = if (destructive) colors.error else colors.brand, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.height(48.dp)) {
                Text("取消", color = colors.textSecondary)
            }
        },
    )
}

@Composable
fun FullScreenLoading(text: String = "正在连接…") {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = LocalFluentColors.current.brand)
            Spacer(Modifier.height(12.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium, color = LocalFluentColors.current.textTertiary)
        }
    }
}

/**
 * Keyboard-safe form fields: when a field gains focus, wait for the IME
 * animation and then scroll the field into the center of the viewport.
 */
fun Modifier.centerOnFocus(): Modifier = composed {
    val requester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    this
        .onFocusChanged { state ->
            if (state.isFocused) {
                scope.launch {
                    kotlinx.coroutines.delay(320)
                    runCatching { requester.bringIntoView() }
                }
            }
        }
        .bringIntoViewRequester(requester)
}

@Composable
fun MonospaceText(
    text: String,
    modifier: Modifier = Modifier,
    fontSize: Int = 13,
    color: Color = LocalFluentColors.current.textPrimary,
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodyMedium.copy(
            fontFamily = FontFamily.Monospace,
            fontSize = fontSize.sp,
        ),
        color = color,
    )
}

@Composable
fun ProvideContentColor(color: Color, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalContentColor provides color, content = content)
}
