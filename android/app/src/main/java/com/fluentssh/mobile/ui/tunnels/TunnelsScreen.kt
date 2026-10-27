package com.fluentssh.mobile.ui.tunnels

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.data.TunnelConfig
import com.fluentssh.mobile.data.TunnelKind
import com.fluentssh.mobile.data.TunnelState
import com.fluentssh.mobile.data.newId
import com.fluentssh.mobile.ssh.TunnelRuntimeState
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors

@Composable
fun TunnelsScreen(vm: AppViewModel, onGoHosts: () -> Unit) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    val runtime by vm.tunnelRuntime.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<TunnelConfig?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    var deleteFor by remember { mutableStateOf<TunnelConfig?>(null) }

    val tunnels = data.tunnels.sortedBy { it.createdAt }
    val runningCount = tunnels.count { runtime[it.id]?.state == TunnelState.RUNNING }

    Box(Modifier.fillMaxSize().background(colors.background)) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp)) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("隧道", style = MaterialTheme.typography.headlineMedium, color = colors.textPrimary)
                        Spacer(Modifier.height(2.dp))
                        Text(
                            when {
                                tunnels.isEmpty() -> "本地、远程与 SOCKS5 转发"
                                runningCount > 0 -> "$runningCount 条运行中 · 共 ${tunnels.size} 条"
                                else -> "共 ${tunnels.size} 条 · 均未运行"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                    }
                }
            }

            if (tunnels.isEmpty()) {
                EmptyState(
                    icon = Icons.Outlined.Route,
                    title = "还没有隧道",
                    description = "把远程端口映射到本机，或建立 SOCKS5 代理访问内网服务。",
                    actionLabel = if (data.hosts.isEmpty()) null else "新建隧道",
                    onAction = { showCreate = true },
                )
                if (data.hosts.isEmpty()) {
                    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                        SecondaryButton("先添加一台主机", onGoHosts, leadingIcon = Icons.Outlined.Add)
                    }
                }
            } else {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(tunnels, key = { it.id }) { tunnel ->
                        TunnelCard(
                            tunnel = tunnel,
                            hostName = vm.store.findHost(tunnel.hostId)?.name ?: "主机已删除",
                            runtime = runtime[tunnel.id] ?: TunnelRuntimeState(),
                            onToggle = { vm.toggleTunnel(tunnel) },
                            onClick = { editing = tunnel },
                        )
                    }
                }
            }
        }

        if (tunnels.isNotEmpty()) {
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 16.dp, bottom = 16.dp)
                    .size(56.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(if (data.hosts.isEmpty()) colors.surfaceContainer else colors.brand)
                    .clickable(enabled = data.hosts.isNotEmpty()) { showCreate = true },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Add,
                    contentDescription = "新建隧道",
                    tint = if (data.hosts.isEmpty()) colors.textTertiary else colors.onBrand,
                    modifier = Modifier.size(26.dp),
                )
            }
        }
    }

    if (showCreate || editing != null) {
        TunnelFormSheet(
            vm = vm,
            tunnel = editing,
            onDismiss = {
                showCreate = false
                editing = null
            },
            onDelete = editing?.let { tunnel ->
                {
                    editing = null
                    deleteFor = tunnel
                }
            },
        )
    }

    deleteFor?.let { tunnel ->
        ConfirmDialog(
            title = "删除隧道",
            message = "将删除「${tunnel.name.ifBlank { tunnel.routeLabel }}」的配置，并停止正在运行的转发。",
            confirmLabel = "删除",
            destructive = true,
            onConfirm = {
                vm.deleteTunnel(tunnel)
                deleteFor = null
            },
            onDismiss = { deleteFor = null },
        )
    }
}

@Composable
private fun TunnelCard(
    tunnel: TunnelConfig,
    hostName: String,
    runtime: TunnelRuntimeState,
    onToggle: () -> Unit,
    onClick: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val (label, color, container) = when (runtime.state) {
        TunnelState.RUNNING -> Triple("运行中", colors.success, colors.successContainer)
        TunnelState.STARTING -> Triple("启动中", colors.warning, colors.warningContainer)
        TunnelState.ERROR -> Triple("异常", colors.error, colors.errorContainer)
        TunnelState.STOPPED -> Triple("已停止", colors.textTertiary, colors.surfaceContainer)
    }
    AppCard(onClick = onClick, contentPadding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (runtime.state == TunnelState.RUNNING) colors.successContainer else colors.surfaceContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.SwapHoriz,
                    contentDescription = null,
                    tint = if (runtime.state == TunnelState.RUNNING) colors.success else colors.textSecondary,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        tunnel.name.ifBlank { tunnel.kindLabel },
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(8.dp))
                    StatusPill(label, color, container)
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    hostName,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(8.dp))
            Switch(
                checked = runtime.state == TunnelState.RUNNING || runtime.state == TunnelState.STARTING,
                onCheckedChange = { onToggle() },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = colors.onBrand,
                    checkedTrackColor = colors.brand,
                ),
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(
            tunnel.routeLabel,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = colors.textSecondary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tag(tunnel.kindLabel)
            Tag(
                if (runtime.state == TunnelState.RUNNING) "${runtime.connections} 个活跃连接" else "未启用",
            )
            if (tunnel.autoStart) Tag("自动启动")
        }
        if (runtime.state == TunnelState.ERROR && !runtime.error.isNullOrBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(
                runtime.error.orEmpty(),
                style = MaterialTheme.typography.bodySmall,
                color = colors.error,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun TunnelFormSheet(
    vm: AppViewModel,
    tunnel: TunnelConfig?,
    onDismiss: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    val isNew = tunnel == null
    var draft by remember(tunnel?.id) {
        mutableStateOf(
            tunnel ?: TunnelConfig(
                id = newId(),
                name = "",
                hostId = data.hosts.firstOrNull()?.id.orEmpty(),
                kind = TunnelKind.LOCAL,
                bindHost = "127.0.0.1",
                bindPort = 0,
                targetHost = "127.0.0.1",
                targetPort = 80,
            ),
        )
    }
    var error by remember { mutableStateOf<String?>(null) }
    var hostExpanded by remember { mutableStateOf(false) }
    val selectedHost = data.hosts.firstOrNull { it.id == draft.hostId }
    val dynamic = draft.kind == TunnelKind.DYNAMIC

    fun save() {
        val message = when {
            data.hosts.isEmpty() -> "请先添加主机"
            draft.hostId.isBlank() -> "请选择绑定的主机"
            draft.bindPort !in 0..65535 -> "绑定端口需在 0-65535 之间"
            !dynamic && draft.targetHost.isBlank() -> "请输入目标地址"
            !dynamic && draft.targetPort !in 1..65535 -> "目标端口需在 1-65535 之间"
            else -> null
        }
        if (message != null) {
            error = message
            return
        }
        val finalName = draft.name.ifBlank {
            when (draft.kind) {
                TunnelKind.DYNAMIC -> "SOCKS5 ${draft.bindPort}"
                TunnelKind.LOCAL -> "本地 ${draft.bindPort} → ${draft.targetPort}"
                TunnelKind.REMOTE -> "远程 ${draft.bindPort} → ${draft.targetPort}"
            }
        }
        vm.saveTunnel(draft.copy(name = finalName))
        onDismiss()
    }

    AppBottomSheet(
        title = if (isNew) "新建隧道" else "编辑隧道",
        subtitle = "保存后在列表中启用",
        heightFraction = 0.8f,
        dismissible = false,
        onDismissRequest = onDismiss,
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { SecondaryButton("取消", onDismiss) }
                Box(Modifier.weight(1f)) { PrimaryButton(if (isNew) "创建" else "保存", { save() }) }
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            error?.let {
                InlineNotice(it, tone = NoticeTone.ERROR)
                Spacer(Modifier.height(10.dp))
            }
            FieldLabel("名称")
            Spacer(Modifier.height(6.dp))
            AppTextField(
                value = draft.name,
                onValueChange = { draft = draft.copy(name = it) },
                placeholder = "可选，例如：数据库代理",
                modifier = Modifier.centerOnFocus(),
            )
            Spacer(Modifier.height(14.dp))
            FieldLabel("绑定主机", required = true)
            Spacer(Modifier.height(6.dp))
            SelectorRowTunnel(
                value = selectedHost?.let { "${it.name} · ${it.address}" } ?: "选择主机",
                expanded = hostExpanded,
                onClick = { hostExpanded = !hostExpanded },
            )
            if (hostExpanded) {
                data.hosts.forEach { host ->
                    TunnelSelectorOption(
                        title = host.name,
                        subtitle = host.address,
                        selected = draft.hostId == host.id,
                    ) {
                        draft = draft.copy(hostId = host.id)
                        hostExpanded = false
                        error = null
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            FieldLabel("转发类型")
            Spacer(Modifier.height(6.dp))
            SegmentedControl(
                options = listOf("本地", "远程", "SOCKS5"),
                selectedIndex = when (draft.kind) {
                    TunnelKind.LOCAL -> 0
                    TunnelKind.REMOTE -> 1
                    TunnelKind.DYNAMIC -> 2
                },
                onSelect = {
                    draft = draft.copy(
                        kind = when (it) {
                            0 -> TunnelKind.LOCAL
                            1 -> TunnelKind.REMOTE
                            else -> TunnelKind.DYNAMIC
                        },
                    )
                },
            )
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Column(Modifier.weight(1f)) {
                    FieldLabel(if (draft.kind == TunnelKind.REMOTE) "远程监听地址" else "本地监听地址")
                    Spacer(Modifier.height(6.dp))
                    AppTextField(
                        value = draft.bindHost,
                        onValueChange = { draft = draft.copy(bindHost = it) },
                        placeholder = "127.0.0.1",
                        modifier = Modifier.centerOnFocus(),
                    )
                }
                Column(Modifier.width(112.dp)) {
                    FieldLabel("端口", required = true)
                    Spacer(Modifier.height(6.dp))
                    AppTextField(
                        value = draft.bindPort.toString(),
                        onValueChange = { value ->
                            if (value.length <= 5 && value.all { it.isDigit() }) {
                                draft = draft.copy(bindPort = value.toIntOrNull() ?: 0)
                                error = null
                            }
                        },
                        keyboardType = KeyboardType.Number,
                        imeAction = ImeAction.Done,
                        modifier = Modifier.centerOnFocus(),
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                if (draft.bindPort == 0) "端口填 0 时由系统自动分配（仅本地转发）。" else " ",
                style = MaterialTheme.typography.bodySmall,
                color = colors.textTertiary,
            )
            if (!dynamic) {
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        FieldLabel("目标地址", required = true)
                        Spacer(Modifier.height(6.dp))
                        AppTextField(
                            value = draft.targetHost,
                            onValueChange = { draft = draft.copy(targetHost = it) },
                            placeholder = "127.0.0.1",
                            modifier = Modifier.centerOnFocus(),
                        )
                    }
                    Column(Modifier.width(112.dp)) {
                        FieldLabel("目标端口", required = true)
                        Spacer(Modifier.height(6.dp))
                        AppTextField(
                            value = draft.targetPort.toString(),
                            onValueChange = { value ->
                                if (value.length <= 5 && value.all { it.isDigit() }) {
                                    draft = draft.copy(targetPort = value.toIntOrNull() ?: 0)
                                    error = null
                                }
                            },
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Done,
                            modifier = Modifier.centerOnFocus(),
                        )
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clickable { draft = draft.copy(autoStart = !draft.autoStart) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("应用启动时自动运行", style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
                    Text("需要保持前台服务运行", style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                }
                Switch(checked = draft.autoStart, onCheckedChange = { draft = draft.copy(autoStart = it) })
            }
            if (!isNew && onDelete != null) {
                Spacer(Modifier.height(16.dp))
                SecondaryButton("删除隧道", onDelete, leadingIcon = Icons.Outlined.Delete)
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun SelectorRowTunnel(value: String, expanded: Boolean, onClick: () -> Unit) {
    val colors = LocalFluentColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.surface)
            .then(
                Modifier.padding(horizontal = 14.dp),
            )
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge,
            color = colors.textPrimary,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Icon(
            if (expanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
            contentDescription = null,
            tint = colors.textTertiary,
        )
    }
}

@Composable
private fun TunnelSelectorOption(title: String, subtitle: String, selected: Boolean, onClick: () -> Unit) {
    val colors = LocalFluentColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
        }
        if (selected) {
            Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.brand, modifier = Modifier.size(20.dp))
        }
    }
}
