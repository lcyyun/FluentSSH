package com.fluentssh.mobile.ui.commands

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.data.CommandRecord
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.data.Snippet
import com.fluentssh.mobile.data.formatDuration
import com.fluentssh.mobile.data.newId
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors

@Composable
fun CommandsScreen(
    vm: AppViewModel,
    initialHostId: String,
    onBack: () -> Unit,
    onOpenHistory: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    val hosts = data.hosts
    var selectedHostId by remember(initialHostId, hosts) {
        mutableStateOf(
            initialHostId.ifBlank { hosts.firstOrNull()?.id.orEmpty() },
        )
    }
    val selectedHost = hosts.firstOrNull { it.id == selectedHostId }
    var command by remember { mutableStateOf("") }
    var hostExpanded by remember { mutableStateOf(false) }
    var running by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<CommandRecord?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showSaveSnippet by remember { mutableStateOf(false) }

    fun execute() {
        val host = selectedHost ?: return
        if (command.isBlank() || running) return
        running = true
        error = null
        result = null
        vm.runCommand(
            host = host,
            command = command,
            onResult = { record -> result = record },
            onError = { message -> error = message },
            onFinished = { running = false },
        )
    }

    Column(Modifier.fillMaxSize().background(colors.background).imePadding()) {
        AppTopBar(
            title = "命令",
            subtitle = selectedHost?.name ?: "选择主机执行一次性命令",
            onBack = onBack,
            actions = {
                IconCircle(Icons.Outlined.History, contentDescription = "命令历史", onClick = onOpenHistory)
            },
        )
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            SectionLabel("目标主机")
            HostSelector(
                host = selectedHost,
                hosts = hosts,
                expanded = hostExpanded,
                onToggle = { hostExpanded = !hostExpanded },
                onSelect = {
                    selectedHostId = it.id
                    hostExpanded = false
                },
                onGoHosts = onBack,
            )
            Spacer(Modifier.height(14.dp))
            SectionLabel("命令")
            AppTextField(
                value = command,
                onValueChange = { command = it },
                placeholder = "例如：uname -a && df -h",
                singleLine = false,
                minLines = 3,
                maxLines = 6,
                modifier = Modifier.centerOnFocus(),
            )
            Spacer(Modifier.height(10.dp))
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                items(data.snippets, key = { it.id }) { snippet ->
                    Box(
                        Modifier
                            .height(48.dp)
                            .padding(vertical = 8.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(colors.surfaceContainer)
                            .clickable {
                                command = snippet.command
                                if (snippet.command.isNotBlank()) result = null
                            }
                            .padding(horizontal = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            snippet.name.ifBlank { snippet.command.take(18) },
                            style = MaterialTheme.typography.labelMedium,
                            color = colors.textSecondary,
                            maxLines = 1,
                        )
                    }
                }
                if (command.isNotBlank()) {
                    item {
                        Box(
                            Modifier
                                .height(48.dp)
                                .padding(vertical = 8.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(colors.brandContainer)
                                .clickable { showSaveSnippet = true }
                                .padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("保存为片段", style = MaterialTheme.typography.labelMedium, color = colors.onBrandContainer)
                        }
                    }
                }
            }
            if (data.snippets.isEmpty() && command.isBlank()) {
                Text(
                    "常用命令可以保存为片段，之后点一下即可填入。",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
            }

            error?.let {
                Spacer(Modifier.height(12.dp))
                ErrorNotice(it)
            }

            if (running) {
                Spacer(Modifier.height(12.dp))
                LoadingRow("正在执行，最长等待 120 秒…")
            }

            result?.let { record ->
                Spacer(Modifier.height(14.dp))
                SectionLabel("执行结果")
                AppCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val success = record.exitCode == 0
                        StatusPill(
                            if (record.exitCode == null) "无退出码" else "退出码 ${record.exitCode}",
                            if (success) colors.success else colors.error,
                            if (success) colors.successContainer else colors.errorContainer,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            formatDuration(record.durationMs),
                            style = MaterialTheme.typography.labelSmall,
                            color = colors.textTertiary,
                        )
                        Spacer(Modifier.weight(1f))
                        Icon(
                            Icons.Outlined.Schedule,
                            contentDescription = null,
                            tint = colors.textTertiary,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(record.timeLabel, style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                    }
                    if (!record.error.isNullOrBlank()) {
                        Spacer(Modifier.height(10.dp))
                        InlineNotice(record.error.orEmpty(), tone = NoticeTone.ERROR)
                    }
                    Spacer(Modifier.height(10.dp))
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(colors.terminalBackground)
                            .padding(10.dp),
                    ) {
                        Text(
                            record.output.ifBlank { if (record.error.isNullOrBlank()) "（无输出）" else "" }.take(60_000),
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            color = colors.terminalForeground,
                        )
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
        Hairline()
        Box(Modifier.fillMaxWidth().padding(16.dp)) {
            PrimaryButton(
                text = if (running) "执行中…" else "执行命令",
                onClick = { execute() },
                enabled = !running && selectedHost != null && command.isNotBlank(),
                loading = running,
            )
        }
    }

    if (showSaveSnippet) {
        var snippetName by remember { mutableStateOf("") }
        AppBottomSheet(
            title = "保存命令片段",
            heightFraction = 0.5f,
            dismissible = false,
            onDismissRequest = { showSaveSnippet = false },
            footer = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) { SecondaryButton("取消", { showSaveSnippet = false }) }
                    Box(Modifier.weight(1f)) {
                        PrimaryButton(
                            "保存",
                            {
                                vm.saveSnippet(
                                    Snippet(
                                        id = newId(),
                                        name = snippetName.ifBlank { command.take(20) },
                                        command = command,
                                    ),
                                )
                                showSaveSnippet = false
                            },
                            enabled = command.isNotBlank(),
                        )
                    }
                }
            },
        ) {
            Column(Modifier.fillMaxWidth()) {
                FieldLabel("片段名称")
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = snippetName,
                    onValueChange = { snippetName = it },
                    placeholder = "例如：查看磁盘占用",
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    command,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = colors.textSecondary,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun HostSelector(
    host: HostProfile?,
    hosts: List<HostProfile>,
    expanded: Boolean,
    onToggle: () -> Unit,
    onSelect: (HostProfile) -> Unit,
    onGoHosts: () -> Unit,
) {
    val colors = LocalFluentColors.current
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(colors.surface)
                .then(Modifier.padding(horizontal = 14.dp))
                .clickable(onClick = onToggle),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AvatarTile(host?.initials ?: "?", size = 32)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    host?.name ?: "选择主机",
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.textPrimary,
                )
                if (host != null) {
                    Text(host.address, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                }
            }
            Icon(
                if (expanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
                contentDescription = null,
                tint = colors.textTertiary,
            )
        }
        if (expanded) {
            if (hosts.isEmpty()) {
                InlineNotice("还没有主机，请先返回主机列表添加。", tone = NoticeTone.WARN)
            } else {
                Column(Modifier.fillMaxWidth()) {
                    hosts.forEach { candidate ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 52.dp)
                                .clickable { onSelect(candidate) }
                                .padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(candidate.name, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
                                Text(candidate.address, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                            }
                            if (candidate.id == host?.id) {
                                Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.brand, modifier = Modifier.size(20.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------ command history

@Composable
fun HistoryScreen(vm: AppViewModel, onBack: () -> Unit) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<CommandRecord?>(null) }
    var showClear by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(colors.background)) {
        AppTopBar(
            title = "命令历史",
            subtitle = "${data.commandHistory.size} 条记录",
            onBack = onBack,
            actions = {
                IconCircle(Icons.Outlined.DeleteSweep, contentDescription = "清空历史", onClick = { showClear = true })
            },
        )
        if (data.commandHistory.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.History,
                title = "暂无记录",
                description = "在命令页面执行过的远程命令会记录输出、退出码与耗时。",
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(data.commandHistory, key = { it.id }) { record ->
                    AppCard(onClick = { selected = record }, contentPadding = PaddingValues(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                record.hostLabel,
                                style = MaterialTheme.typography.labelMedium,
                                color = colors.textSecondary,
                            )
                            Spacer(Modifier.width(8.dp))
                            StatusPill(
                                "退出码 ${record.exitLabel}",
                                if (record.exitCode == 0) colors.success else colors.error,
                                if (record.exitCode == 0) colors.successContainer else colors.errorContainer,
                            )
                            Spacer(Modifier.weight(1f))
                            Text(record.timeLabel, style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(
                            record.command,
                            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                            color = colors.textPrimary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (record.output.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                record.output.trim(),
                                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                                color = colors.textTertiary,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }

    selected?.let { record ->
        val clipboard = LocalClipboardManager.current
        AppBottomSheet(
            title = record.hostLabel,
            subtitle = "${record.timeLabel} · ${formatDuration(record.durationMs)} · 退出码 ${record.exitLabel}",
            heightFraction = 0.8f,
            dismissible = true,
            onDismissRequest = { selected = null },
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        record.command,
                        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                        color = colors.textPrimary,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(
                        onClick = {
                            clipboard.setText(AnnotatedString(record.output))
                            vm.toast("输出已复制")
                        },
                        modifier = Modifier.height(48.dp),
                    ) {
                        Text("复制输出", color = colors.brand)
                    }
                }
                Spacer(Modifier.height(10.dp))
                if (record.error.isNotBlank()) {
                    InlineNotice(record.error, tone = NoticeTone.ERROR)
                    Spacer(Modifier.height(10.dp))
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(colors.terminalBackground)
                        .padding(10.dp),
                ) {
                    Text(
                        record.output.ifBlank { "（无输出）" }.take(60_000),
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = colors.terminalForeground,
                    )
                }
                Spacer(Modifier.height(12.dp))
            }
        }
    }

    if (showClear) {
        ConfirmDialog(
            title = "清空命令历史",
            message = "将删除全部命令记录，此操作不可撤销。",
            confirmLabel = "清空",
            destructive = true,
            onConfirm = {
                vm.clearCommandHistory()
                showClear = false
            },
            onDismiss = { showClear = false },
        )
    }
}
