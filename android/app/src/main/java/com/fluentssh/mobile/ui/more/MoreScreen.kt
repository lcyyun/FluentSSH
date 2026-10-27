package com.fluentssh.mobile.ui.more

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.BuildConfig
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors

@Composable
fun MoreScreen(
    vm: AppViewModel,
    onOpenKeys: () -> Unit,
    onOpenKnownHosts: () -> Unit,
    onOpenAudit: () -> Unit,
    onOpenRecordings: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenCommands: () -> Unit,
    onOpenHistory: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val context = LocalContext.current
    val data by vm.data.collectAsStateWithLifecycle()

    Column(
        Modifier
            .fillMaxSize()
            .background(colors.background)
            .verticalScroll(rememberScrollState()),
    ) {
        Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("更多", style = MaterialTheme.typography.headlineMedium, color = colors.textPrimary)
                    Spacer(Modifier.height(2.dp))
                    Text("安全、工具与设置", style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                }
            }
        }

        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(52.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(colors.brandContainer),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Outlined.Terminal, contentDescription = null, tint = colors.onBrandContainer, modifier = Modifier.size(26.dp))
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("FluentSSH", style = MaterialTheme.typography.titleLarge, color = colors.textPrimary)
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "本地 SSH 工作台 · 无云同步 · 无遥测",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatTile("${data.hosts.size}", "主机", Modifier.weight(1f))
                    StatTile("${data.keys.size}", "密钥", Modifier.weight(1f))
                    StatTile("${data.tunnels.size}", "隧道", Modifier.weight(1f))
                }
            }

            SettingsGroup(title = "安全") {
                NavRow(Icons.Outlined.VpnKey, "密钥管理", "${data.keys.size} 个密钥", onOpenKeys)
                NavRow(Icons.Outlined.VerifiedUser, "已知主机", "${data.knownHosts.size} 条指纹", onOpenKnownHosts, showDivider = false)
            }

            SettingsGroup(title = "工具") {
                NavRow(Icons.Outlined.Code, "命令与片段", "一次性执行远程命令", onOpenCommands)
                NavRow(Icons.Outlined.History, "命令历史", "${data.commandHistory.size} 条记录", onOpenHistory)
                NavRow(Icons.Outlined.FiberManualRecord, "会话录制", "${data.recordings.size} 个文件", onOpenRecordings, showDivider = false)
            }

            SettingsGroup(title = "系统") {
                NavRow(Icons.Outlined.ReceiptLong, "审计日志", "${data.audit.size} 条事件", onOpenAudit, showDivider = false)
                NavRow(Icons.Outlined.Settings, "设置", "外观、终端与连接", onOpenSettings, showDivider = false)
            }

            SettingsGroup(title = "关于") {
                NavRow(
                    Icons.Outlined.OpenInNew,
                    "GitHub 仓库",
                    "github.com/lcyyun/FluentSSH",
                    onClick = {
                        runCatching {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/lcyyun/FluentSSH")),
                            )
                        }
                    },
                )
                NavRow(
                    Icons.Outlined.Info,
                    "版本",
                    "FluentSSH for Android ${BuildConfig.VERSION_NAME}",
                    onClick = {},
                    showDivider = false,
                )
            }

            Text(
                "所有主机、凭据与日志仅保存在本机。密码和私钥使用 Android Keystore 加密。",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun StatTile(value: String, label: String, modifier: Modifier = Modifier) {
    val colors = LocalFluentColors.current
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(colors.surfaceContainer)
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, style = MaterialTheme.typography.titleMedium, color = colors.textPrimary)
        Text(label, style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
    }
}

@Composable
private fun SettingsGroup(title: String, content: @Composable ColumnScope.() -> Unit) {
    val colors = LocalFluentColors.current
    Column {
        SectionLabel(title)
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(colors.surface)
                .then(Modifier),
        ) {
            content()
        }
    }
}

@Composable
private fun NavRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    showDivider: Boolean = true,
) {
    val colors = LocalFluentColors.current
    Column {
        ListRow(
            title = title,
            subtitle = subtitle,
            onClick = onClick,
            showDivider = false,
            leading = {
                Box(
                    Modifier
                        .size(36.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.surfaceContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(19.dp))
                }
            },
            trailing = {
                Icon(
                    Icons.Outlined.ChevronRight,
                    contentDescription = null,
                    tint = colors.textTertiary,
                    modifier = Modifier.size(20.dp),
                )
            },
        )
        if (showDivider) Hairline(Modifier.padding(start = 64.dp))
    }
}
