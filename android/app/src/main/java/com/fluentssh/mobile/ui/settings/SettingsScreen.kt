package com.fluentssh.mobile.ui.settings

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.data.AppSettings
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val colors = LocalFluentColors.current
    val context = LocalContext.current
    val data by vm.data.collectAsStateWithLifecycle()
    val current = data.settings
    var draft by remember(current) { mutableStateOf(current) }
    val scope = rememberCoroutineScope()
    var showPasteConfig by remember { mutableStateOf(false) }

    val configLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                }.getOrNull()
            }
            if (text.isNullOrBlank()) {
                vm.toast("无法读取配置文件")
            } else {
                vm.importSshConfig(text)
            }
        }
    }

    Column(Modifier.fillMaxSize().background(colors.background)) {
        AppTopBar(
            title = "设置",
            onBack = onBack,
            actions = {
                TextButton(
                    onClick = {
                        vm.updateSettings(draft)
                        vm.toast("设置已保存")
                    },
                    enabled = draft != current,
                    modifier = Modifier.height(48.dp),
                ) {
                    Text("保存", color = if (draft != current) colors.brand else colors.textTertiary)
                }
            },
        )
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            SectionLabel("外观")
            AppCard {
                Text("主题", style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
                Spacer(Modifier.height(8.dp))
                SegmentedControl(
                    options = listOf("跟随系统", "浅色", "深色"),
                    selectedIndex = when (draft.theme) {
                        "light" -> 1
                        "dark" -> 2
                        else -> 0
                    },
                    onSelect = {
                        val theme = when (it) {
                            1 -> "light"
                            2 -> "dark"
                            else -> "system"
                        }
                        draft = draft.copy(theme = theme)
                        vm.updateSettings(draft.copy(theme = theme))
                    },
                )
            }

            SectionLabel("终端")
            AppCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("终端字号", style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
                        Text("${draft.terminalFontSize}sp · 实时预览", style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                    }
                    StepButton(Icons.Outlined.Remove, enabled = draft.terminalFontSize > 10) {
                        draft = draft.copy(terminalFontSize = (draft.terminalFontSize - 1).coerceAtLeast(10))
                    }
                    Text(
                        "${draft.terminalFontSize}",
                        style = MaterialTheme.typography.titleMedium,
                        color = colors.textPrimary,
                        modifier = Modifier.width(36.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                    StepButton(Icons.Outlined.Add, enabled = draft.terminalFontSize < 22) {
                        draft = draft.copy(terminalFontSize = (draft.terminalFontSize + 1).coerceAtMost(22))
                    }
                }
                Spacer(Modifier.height(10.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(colors.terminalBackground)
                        .padding(12.dp),
                ) {
                    Text(
                        "root@srv:~$ ls -la",
                        style = MaterialTheme.typography.bodyMedium.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = draft.terminalFontSize.sp,
                        ),
                        color = colors.terminalForeground,
                    )
                }
            }

            SectionLabel("连接默认值")
            AppCard {
                FieldLabel("默认用户名")
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = draft.defaultUsername,
                    onValueChange = { draft = draft.copy(defaultUsername = it) },
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        FieldLabel("默认端口")
                        Spacer(Modifier.height(6.dp))
                        AppTextField(
                            value = draft.defaultPort.toString(),
                            onValueChange = { value ->
                                if (value.length <= 5 && value.all { it.isDigit() }) {
                                    draft = draft.copy(defaultPort = (value.toIntOrNull() ?: 22).coerceIn(1, 65535))
                                }
                            },
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Next,
                            modifier = Modifier.centerOnFocus(),
                        )
                    }
                    Column(Modifier.weight(1f)) {
                        FieldLabel("保活间隔（秒）")
                        Spacer(Modifier.height(6.dp))
                        AppTextField(
                            value = draft.keepAliveSeconds.toString(),
                            onValueChange = { value ->
                                if (value.length <= 3 && value.all { it.isDigit() }) {
                                    draft = draft.copy(keepAliveSeconds = (value.toIntOrNull() ?: 30).coerceIn(10, 600))
                                }
                            },
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Done,
                            modifier = Modifier.centerOnFocus(),
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                SwitchRow(
                    title = "严格主机密钥校验",
                    subtitle = "未知或变化的指纹必须手动确认",
                    checked = draft.strictHostKeys,
                    onCheckedChange = { draft = draft.copy(strictHostKeys = it) },
                )
                SwitchRow(
                    title = "录制终端会话",
                    subtitle = "原始输出写入应用私有日志目录",
                    checked = draft.recordSessions,
                    onCheckedChange = { draft = draft.copy(recordSessions = it) },
                )
                SwitchRow(
                    title = "显示隐藏文件",
                    subtitle = "SFTP 列表中显示 . 开头的文件",
                    checked = draft.showHiddenFiles,
                    onCheckedChange = { draft = draft.copy(showHiddenFiles = it) },
                )
            }

            SectionLabel("数据")
            AppCard {
                ListRow(
                    title = "从文件导入 SSH Config",
                    subtitle = "支持 Host / HostName / User / Port",
                    onClick = { configLauncher.launch(arrayOf("*/*")) },
                    leading = {
                        Box(
                            Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(colors.surfaceContainer),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Outlined.FileOpen, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(19.dp))
                        }
                    },
                )
                ListRow(
                    title = "粘贴 SSH Config",
                    subtitle = "直接粘贴配置文本导入主机",
                    onClick = { showPasteConfig = true },
                    showDivider = false,
                    leading = {
                        Box(
                            Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(colors.surfaceContainer),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Outlined.ContentPaste, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(19.dp))
                        }
                    },
                )
            }

            Text(
                "修改默认值只影响之后新建的主机；已有主机保持自己的参数。",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 12.dp),
            )
            Spacer(Modifier.height(32.dp))
        }
    }

    if (showPasteConfig) {
        var configText by remember { mutableStateOf("") }
        AppBottomSheet(
            title = "导入 SSH Config",
            subtitle = "粘贴 ~/.ssh/config 的内容",
            heightFraction = 0.8f,
            dismissible = false,
            onDismissRequest = { showPasteConfig = false },
            footer = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) { SecondaryButton("取消", { showPasteConfig = false }) }
                    Box(Modifier.weight(1f)) {
                        PrimaryButton(
                            "导入",
                            {
                                vm.importSshConfig(configText)
                                showPasteConfig = false
                            },
                            enabled = configText.isNotBlank(),
                        )
                    }
                }
            },
        ) {
            Column(Modifier.fillMaxWidth()) {
                AppTextField(
                    value = configText,
                    onValueChange = { configText = it },
                    placeholder = "Host prod\n  HostName 10.0.0.10\n  User root\n  Port 22",
                    singleLine = false,
                    minLines = 8,
                    maxLines = 14,
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "导入的主机将归入「SSH Config」分组，私钥需在密钥管理中单独导入。",
                    style = MaterialTheme.typography.bodySmall,
                    color = LocalFluentColors.current.textTertiary,
                )
            }
        }
    }
}

@Composable
private fun SwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    val colors = LocalFluentColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
        }
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun StepButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val colors = LocalFluentColors.current
    Box(
        Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (enabled) colors.textPrimary else colors.textTertiary,
            modifier = Modifier.size(20.dp),
        )
    }
}
