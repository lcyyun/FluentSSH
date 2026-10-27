package com.fluentssh.mobile.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.data.formatUptime
import com.fluentssh.mobile.ssh.SessionState
import com.fluentssh.mobile.ssh.TerminalSession
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import kotlinx.coroutines.delay

@Composable
fun SessionsScreen(
    vm: AppViewModel,
    onOpenSession: (String) -> Unit,
    onGoConnect: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val sessions by vm.sessions.collectAsStateWithLifecycle()

    // Refresh "last line" / uptime periodically without depending on output flow.
    var tick by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(2000)
            tick++
        }
    }

    Column(Modifier.fillMaxSize().background(colors.background)) {
        Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("终端", style = MaterialTheme.typography.headlineMedium, color = colors.textPrimary)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        if (sessions.isEmpty()) "打开一个 SSH 会话" else "共 ${sessions.size} 个会话",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                    )
                }
                IconCircle(Icons.Outlined.Add, contentDescription = "新建会话", onClick = onGoConnect)
            }
        }
        if (sessions.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.Terminal,
                title = "暂无会话",
                description = "从主机列表选择一台服务器，即可建立交互式 SSH 终端。",
                actionLabel = "去连接",
                onAction = onGoConnect,
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(sessions, key = { it.id }) { session ->
                    SessionCard(
                        session = session,
                        open = { onOpenSession(session.id) },
                        close = { vm.closeSession(session.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SessionCard(
    session: TerminalSession,
    open: () -> Unit,
    close: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val state by session.state.collectAsStateWithLifecycle()
    val error by session.error.collectAsStateWithLifecycle()
    val snapshot = remember(state) { session.snapshot() }
    val lastLine = remember(snapshot) {
        snapshot.screen.asReversed().firstOrNull { line -> line.text.isNotBlank() }?.text?.trim().orEmpty()
    }
    val (label, color, container) = when (state) {
        SessionState.CONNECTING -> Triple("连接中", colors.warning, colors.warningContainer)
        SessionState.CONNECTED -> Triple("已连接", colors.success, colors.successContainer)
        SessionState.ERROR -> Triple("错误", colors.error, colors.errorContainer)
        SessionState.DISCONNECTED -> Triple("已断开", colors.textTertiary, colors.surfaceContainer)
    }
    AppCard(onClick = open, contentPadding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            AvatarTile(session.host.initials)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        session.host.name,
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(8.dp))
                    StatusPill(label, color, container)
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    session.host.address,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (state == SessionState.CONNECTED && lastLine.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        lastLine,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = colors.textSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (state == SessionState.ERROR && !error.isNullOrBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        error.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.error,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    "已运行 ${formatUptime(session.startedAt)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.textTertiary,
                )
            }
            Box(
                Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .clickable(onClick = close),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = "关闭会话",
                    tint = colors.textTertiary,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}
