package com.fluentssh.mobile.ui.hosts

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.data.AuthKind
import com.fluentssh.mobile.data.HostGroup
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.data.SshKeyRecord
import com.fluentssh.mobile.data.newId
import com.fluentssh.mobile.ssh.SessionState
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors

@Composable
fun HostsScreen(
    vm: AppViewModel,
    onConnect: (HostProfile) -> Unit,
    onBrowseFiles: (HostProfile) -> Unit,
    onOpenTunnels: () -> Unit,
    onOpenCommands: (HostProfile) -> Unit,
) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    val sessions by vm.sessions.collectAsStateWithLifecycle()
    val hosts = data.hosts
    val groups = data.groups

    var search by rememberSaveable { mutableStateOf("") }
    var filterIndex by rememberSaveable { mutableIntStateOf(0) }
    var groupFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var editingHost by remember { mutableStateOf<HostProfile?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    var actionsFor by remember { mutableStateOf<HostProfile?>(null) }
    var deleteFor by remember { mutableStateOf<HostProfile?>(null) }
    var showGroups by remember { mutableStateOf(false) }

    val activeHostIds = remember(sessions) {
        sessions.filter { it.state.value == SessionState.CONNECTED || it.state.value == SessionState.CONNECTING }
            .map { it.host.id }
            .toSet()
    }

    val filtered = remember(hosts, search, filterIndex, groupFilter) {
        hosts
            .filter { groupFilter == null || it.groupId == groupFilter }
            .filter {
                when (filterIndex) {
                    1 -> it.favorite
                    2 -> it.lastConnectedAt > 0
                    else -> true
                }
            }
            .filter { host ->
                search.isBlank() ||
                    host.name.contains(search, ignoreCase = true) ||
                    host.hostname.contains(search, ignoreCase = true) ||
                    host.username.contains(search, ignoreCase = true) ||
                    host.tagsText.contains(search, ignoreCase = true)
            }
            .sortedWith(compareByDescending<HostProfile> { it.favorite }.thenByDescending { it.lastConnectedAt })
    }

    Box(Modifier.fillMaxSize().background(colors.background)) {
        Column(Modifier.fillMaxSize()) {
            HostsHeader(
                hostCount = hosts.size,
                groups = groups,
                selectedGroup = groupFilter,
                onSelectGroup = { groupFilter = it },
                onManageGroups = { showGroups = true },
                search = search,
                onSearchChange = { search = it },
                filterIndex = filterIndex,
                onFilterChange = { filterIndex = it },
            )
            if (filtered.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                    EmptyState(
                        icon = if (hosts.isEmpty()) Icons.Outlined.Dns else Icons.Outlined.Search,
                        title = if (hosts.isEmpty()) "还没有主机" else "没有匹配的主机",
                        description = if (hosts.isEmpty()) {
                            "添加一台服务器，即可打开终端、浏览文件和建立隧道。"
                        } else {
                            "换个关键词，或清除筛选条件后再试。"
                        },
                        actionLabel = if (hosts.isEmpty()) "新建主机" else null,
                        onAction = { showCreate = true },
                    )
                }
            } else {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(filtered, key = { it.id }) { host ->
                        HostCard(
                            host = host,
                            groupName = vm.groupLabel(host.groupId),
                            connected = activeHostIds.contains(host.id),
                            onClick = { actionsFor = host },
                            onToggleFavorite = { vm.toggleFavorite(host) },
                        )
                    }
                }
            }
        }

        // Single primary FAB, bottom-right natural thumb zone.
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 16.dp, bottom = 16.dp)
                .size(56.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(colors.brand)
                .clickable { showCreate = true },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Add, contentDescription = "新建主机", tint = colors.onBrand, modifier = Modifier.size(26.dp))
        }
    }

    if (showCreate || editingHost != null) {
        HostFormSheet(
            vm = vm,
            host = editingHost,
            onDismiss = {
                showCreate = false
                editingHost = null
            },
        )
    }

    actionsFor?.let { host ->
        HostActionsSheet(
            vm = vm,
            host = host,
            onDismiss = { actionsFor = null },
            onConnect = {
                actionsFor = null
                onConnect(host)
            },
            onBrowseFiles = {
                actionsFor = null
                onBrowseFiles(host)
            },
            onRunCommand = {
                actionsFor = null
                onOpenCommands(host)
            },
            onOpenTunnels = {
                actionsFor = null
                onOpenTunnels()
            },
            onEdit = {
                actionsFor = null
                editingHost = host
            },
            onDelete = {
                actionsFor = null
                deleteFor = host
            },
        )
    }

    deleteFor?.let { host ->
        ConfirmDialog(
            title = "删除主机",
            message = "将删除「${host.name}」及其凭据、关联隧道与命令历史。已知主机指纹不会被删除。",
            confirmLabel = "删除",
            destructive = true,
            onConfirm = {
                vm.deleteHost(host)
                deleteFor = null
            },
            onDismiss = { deleteFor = null },
        )
    }

    if (showGroups) {
        GroupManagerSheet(
            vm = vm,
            onDismiss = { showGroups = false },
        )
    }
}

@Composable
private fun HostsHeader(
    hostCount: Int,
    groups: List<HostGroup>,
    selectedGroup: String?,
    onSelectGroup: (String?) -> Unit,
    onManageGroups: () -> Unit,
    search: String,
    onSearchChange: (String) -> Unit,
    filterIndex: Int,
    onFilterChange: (Int) -> Unit,
) {
    val colors = LocalFluentColors.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.background)
            .statusBarsPadding()
            .padding(horizontal = 16.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("主机", style = MaterialTheme.typography.headlineMedium, color = colors.textPrimary)
                Spacer(Modifier.height(2.dp))
                Text(
                    text = if (hostCount == 0) "添加第一台服务器" else "共 $hostCount 台主机",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
            }
            IconCircle(Icons.Outlined.Folder, contentDescription = "分组管理", onClick = onManageGroups)
        }
        SearchField(search, onSearchChange, "搜索主机、地址或标签")
        Spacer(Modifier.height(10.dp))
        SegmentedControl(listOf("全部", "收藏", "最近"), filterIndex, onFilterChange)
        if (groups.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                contentPadding = PaddingValues(horizontal = 2.dp),
            ) {
                item {
                    GroupChip("未分组", selectedGroup == null, onClick = { onSelectGroup(null) })
                }
                items(groups, key = { it.id }) { group ->
                    GroupChip(group.name, selectedGroup == group.id, onClick = { onSelectGroup(group.id) })
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun GroupChip(label: String, selected: Boolean, onClick: () -> Unit) {
    val colors = LocalFluentColors.current
    Box(
        Modifier
            .height(48.dp)
            .padding(vertical = 8.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(if (selected) colors.brandContainer else colors.surfaceContainer)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) colors.onBrandContainer else colors.textSecondary,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
        )
    }
}

@Composable
private fun HostCard(
    host: HostProfile,
    groupName: String,
    connected: Boolean,
    onClick: () -> Unit,
    onToggleFavorite: () -> Unit,
) {
    val colors = LocalFluentColors.current
    AppCard(onClick = onClick, contentPadding = PaddingValues(14.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            AvatarTile(host.initials)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        host.name,
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.textPrimary,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (connected) {
                        Spacer(Modifier.width(8.dp))
                        StatusPill("在线", colors.success, colors.successContainer)
                    }
                }
                Spacer(Modifier.height(3.dp))
                Text(
                    host.address,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (host.tags.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        host.tags.take(3).forEach { Tag(it) }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Tag(groupName)
                    Text(
                        host.lastConnectedLabel(),
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textTertiary,
                    )
                }
            }
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onToggleFavorite),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (host.favorite) Icons.Filled.Star else Icons.Outlined.StarOutline,
                    contentDescription = if (host.favorite) "取消收藏" else "收藏",
                    tint = if (host.favorite) colors.warning else colors.textTertiary,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

@Composable
private fun HostActionsSheet(
    vm: AppViewModel,
    host: HostProfile,
    onDismiss: () -> Unit,
    onConnect: () -> Unit,
    onBrowseFiles: () -> Unit,
    onRunCommand: () -> Unit,
    onOpenTunnels: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val sessions by vm.sessions.collectAsStateWithLifecycle()
    val active = sessions.firstOrNull {
        it.host.id == host.id && (it.state.value == SessionState.CONNECTED || it.state.value == SessionState.CONNECTING)
    }
    AppBottomSheet(
        title = "",
        heightFraction = 0.62f,
        dismissible = true,
        onDismissRequest = onDismiss,
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AvatarTile(host.initials, size = 48)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(host.name, style = MaterialTheme.typography.titleLarge, color = colors.textPrimary)
                    Spacer(Modifier.height(2.dp))
                    Text(host.address, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                }
                if (active != null) StatusPill("在线", colors.success, colors.successContainer)
            }
            Spacer(Modifier.height(14.dp))
            PrimaryButton("打开终端", onConnect, leadingIcon = Icons.Outlined.Terminal)
            Spacer(Modifier.height(8.dp))
            SheetAction(Icons.Outlined.FolderOpen, "浏览 SFTP 文件", onBrowseFiles)
            SheetAction(Icons.Outlined.Code, "执行远程命令", onRunCommand)
            SheetAction(Icons.Outlined.Route, "管理 SSH 隧道", onOpenTunnels)
            SheetAction(Icons.Outlined.Edit, "编辑主机", onEdit)
            SheetAction(
                if (host.favorite) Icons.Filled.Star else Icons.Outlined.StarOutline,
                if (host.favorite) "取消收藏" else "收藏主机",
                { vm.toggleFavorite(host) },
            )
            Hairline()
            SheetAction(Icons.Outlined.Delete, "删除主机", onDelete, destructive = true, showDivider = false)
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun SheetAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
    destructive: Boolean = false,
    showDivider: Boolean = true,
) {
    val colors = LocalFluentColors.current
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clickable(onClick = onClick)
                .padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (destructive) colors.errorContainer else colors.surfaceContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = if (destructive) colors.error else colors.textSecondary,
                    modifier = Modifier.size(19.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge,
                color = if (destructive) colors.error else colors.textPrimary,
            )
        }
        if (showDivider) Hairline(Modifier.padding(start = 48.dp))
    }
}

@Composable
private fun GroupManagerSheet(vm: AppViewModel, onDismiss: () -> Unit) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    var newName by remember { mutableStateOf("") }
    AppBottomSheet(
        title = "主机分组",
        subtitle = "按环境或项目整理主机",
        heightFraction = 0.6f,
        dismissible = true,
        onDismissRequest = onDismiss,
        footer = {
            PrimaryButton(
                "新建分组",
                onClick = {
                    val name = newName.trim()
                    if (name.isNotEmpty()) {
                        vm.upsertGroup(HostGroup(id = newId(), name = name))
                        newName = ""
                        vm.toast("分组已创建")
                    }
                },
                enabled = newName.isNotBlank(),
            )
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            AppTextField(
                value = newName,
                onValueChange = { newName = it },
                placeholder = "分组名称",
                imeAction = ImeAction.Done,
                modifier = Modifier.centerOnFocus(),
            )
            Spacer(Modifier.height(12.dp))
            if (data.groups.isEmpty()) {
                Text("还没有分组。", style = MaterialTheme.typography.bodyMedium, color = colors.textTertiary)
            }
            data.groups.forEach { group ->
                val count = data.hosts.count { it.groupId == group.id }
                ListRow(
                    title = group.name,
                    subtitle = "$count 台主机",
                    leading = {
                        Box(
                            Modifier
                                .size(36.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(colors.surfaceContainer),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Outlined.Folder, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(18.dp))
                        }
                    },
                    trailing = {
                        IconCircle(
                            Icons.Outlined.Delete,
                            contentDescription = "删除分组",
                            onClick = {
                                vm.deleteGroup(group)
                                vm.toast("分组已删除")
                            },
                            tint = colors.error,
                        )
                    },
                )
            }
        }
    }
}

// --------------------------------------------------------------------------
// Host editor: two-step compact form (basic info / auth & preferences).
// --------------------------------------------------------------------------

@Composable
private fun HostFormSheet(
    vm: AppViewModel,
    host: HostProfile?,
    onDismiss: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    val isNew = host == null
    var draft by remember(host?.id) { mutableStateOf(host ?: vm.createHostTemplate()) }
    var password by remember(host?.id) { mutableStateOf("") }
    var passphrase by remember(host?.id) { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var passphraseVisible by remember { mutableStateOf(false) }
    var step by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var groupExpanded by remember { mutableStateOf(false) }
    var keyExpanded by remember { mutableStateOf(false) }
    var newGroupName by remember { mutableStateOf("") }
    val existingPassword = host != null && vm.store.hostPassword(host.id) != null
    val selectedKey = data.keys.firstOrNull { it.id == draft.keyId }

    fun validateStep0(): Boolean {
        val message = when {
            draft.name.isBlank() -> "请输入主机名称"
            draft.hostname.isBlank() -> "请输入主机地址"
            draft.username.isBlank() -> "请输入用户名"
            draft.port !in 1..65535 -> "端口需在 1-65535 之间"
            else -> null
        }
        error = message
        return message == null
    }

    fun validateAndSave() {
        val message = when {
            draft.authKind == AuthKind.PASSWORD && password.isEmpty() && !existingPassword -> "请输入登录密码"
            draft.authKind == AuthKind.PRIVATE_KEY && draft.keyId == null -> "请选择用于认证的私钥"
            else -> null
        }
        if (message != null) {
            error = message
            return
        }
        vm.saveHost(
            host = draft.copy(
                name = draft.name.trim(),
                hostname = draft.hostname.trim(),
                username = draft.username.trim(),
                tagsText = draft.tagsText.trim(),
            ),
            password = password.takeIf { it.isNotEmpty() },
            passphrase = passphrase.takeIf { it.isNotEmpty() },
            isNew = isNew,
        )
        onDismiss()
    }

    AppBottomSheet(
        title = if (isNew) "新建主机" else "编辑主机",
        subtitle = if (step == 0) "第 1 步 · 连接信息" else "第 2 步 · 认证与偏好",
        heightFraction = if (step == 0) 0.8f else 0.8f,
        dismissible = false,
        onDismissRequest = onDismiss,
        footer = {
            if (step == 0) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) { SecondaryButton("取消", onDismiss) }
                    Box(Modifier.weight(1f)) {
                        PrimaryButton("下一步", {
                            if (validateStep0()) {
                                error = null
                                step = 1
                            }
                        })
                    }
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) { SecondaryButton("上一步", { step = 0 }) }
                    Box(Modifier.weight(1f)) { PrimaryButton("保存", { validateAndSave() }) }
                }
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            error?.let {
                InlineNotice(it, tone = NoticeTone.ERROR)
                Spacer(Modifier.height(10.dp))
            }
            if (step == 0) {
                FieldLabel("名称", required = true)
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = draft.name,
                    onValueChange = { draft = draft.copy(name = it); error = null },
                    placeholder = "例如：生产 Web 服务器",
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(14.dp))
                FieldLabel("主机地址", required = true)
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = draft.hostname,
                    onValueChange = { draft = draft.copy(hostname = it); error = null },
                    placeholder = "IP 或域名",
                    keyboardType = KeyboardType.Uri,
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f)) {
                        FieldLabel("用户名", required = true)
                        Spacer(Modifier.height(6.dp))
                        AppTextField(
                            value = draft.username,
                            onValueChange = { draft = draft.copy(username = it); error = null },
                            placeholder = "root",
                            modifier = Modifier.centerOnFocus(),
                        )
                    }
                    Column(Modifier.width(112.dp)) {
                        FieldLabel("端口", required = true)
                        Spacer(Modifier.height(6.dp))
                        AppTextField(
                            value = draft.port.toString(),
                            onValueChange = { value ->
                                if (value.length <= 5 && value.all { it.isDigit() }) {
                                    draft = draft.copy(port = value.toIntOrNull() ?: 0)
                                    error = null
                                }
                            },
                            keyboardType = KeyboardType.Number,
                            imeAction = ImeAction.Done,
                            modifier = Modifier.centerOnFocus(),
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                FieldLabel("分组")
                Spacer(Modifier.height(6.dp))
                SelectorRow(
                    value = vm.groupLabel(draft.groupId),
                    expanded = groupExpanded,
                    onClick = { groupExpanded = !groupExpanded; keyExpanded = false },
                )
                if (groupExpanded) {
                    Column(Modifier.fillMaxWidth()) {
                        SelectorOption("未分组", draft.groupId == null) {
                            draft = draft.copy(groupId = null)
                            groupExpanded = false
                        }
                        data.groups.forEach { group ->
                            SelectorOption(group.name, draft.groupId == group.id) {
                                draft = draft.copy(groupId = group.id)
                                groupExpanded = false
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f)) {
                                AppTextField(
                                    value = newGroupName,
                                    onValueChange = { newGroupName = it },
                                    placeholder = "新分组名称",
                                    modifier = Modifier.centerOnFocus(),
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            Box(Modifier.width(96.dp)) {
                                PrimaryButton(
                                    "添加",
                                    {
                                        val name = newGroupName.trim()
                                        if (name.isNotEmpty()) {
                                            val group = HostGroup(id = newId(), name = name)
                                            vm.upsertGroup(group)
                                            draft = draft.copy(groupId = group.id)
                                            newGroupName = ""
                                            groupExpanded = false
                                        }
                                    },
                                    enabled = newGroupName.isNotBlank(),
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(20.dp))
            } else {
                FieldLabel("认证方式")
                Spacer(Modifier.height(6.dp))
                SegmentedControl(
                    options = listOf("密码", "密钥", "交互式"),
                    selectedIndex = when (draft.authKind) {
                        AuthKind.PASSWORD -> 0
                        AuthKind.PRIVATE_KEY -> 1
                        AuthKind.KEYBOARD_INTERACTIVE -> 2
                    },
                    onSelect = {
                        draft = draft.copy(
                            authKind = when (it) {
                                0 -> AuthKind.PASSWORD
                                1 -> AuthKind.PRIVATE_KEY
                                else -> AuthKind.KEYBOARD_INTERACTIVE
                            },
                        )
                        error = null
                    },
                )
                Spacer(Modifier.height(14.dp))
                when (draft.authKind) {
                    AuthKind.PASSWORD -> {
                        FieldLabel("登录密码", required = !existingPassword)
                        Spacer(Modifier.height(6.dp))
                        PasswordField(
                            value = password,
                            onValueChange = { password = it; error = null },
                            visible = passwordVisible,
                            onToggleVisible = { passwordVisible = !passwordVisible },
                            placeholder = if (existingPassword) "已保存，留空保持不变" else "密码",
                            modifier = Modifier.centerOnFocus(),
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "凭据使用 Android Keystore 加密，仅保存在本机。",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                    }
                    AuthKind.PRIVATE_KEY -> {
                        FieldLabel("私钥", required = true)
                        Spacer(Modifier.height(6.dp))
                        SelectorRow(
                            value = selectedKey?.name ?: "选择私钥",
                            expanded = keyExpanded,
                            onClick = { keyExpanded = !keyExpanded; groupExpanded = false },
                        )
                        if (keyExpanded) {
                            if (data.keys.isEmpty()) {
                                InlineNotice("还没有可用密钥。请先在「更多 · 密钥管理」中生成或导入。", tone = NoticeTone.WARN)
                            } else {
                                data.keys.forEach { key ->
                                    SelectorOption(key.name, draft.keyId == key.id, subtitle = key.algorithm + " " + key.bits) {
                                        draft = draft.copy(keyId = key.id)
                                        keyExpanded = false
                                        error = null
                                    }
                                }
                            }
                        }
                        if (selectedKey != null) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                "指纹 ${selectedKey.fingerprint}",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textTertiary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Spacer(Modifier.height(14.dp))
                        FieldLabel("私钥口令")
                        Spacer(Modifier.height(6.dp))
                        PasswordField(
                            value = passphrase,
                            onValueChange = { passphrase = it },
                            visible = passphraseVisible,
                            onToggleVisible = { passphraseVisible = !passphraseVisible },
                            placeholder = "没有口令可留空",
                            modifier = Modifier.centerOnFocus(),
                        )
                    }
                    AuthKind.KEYBOARD_INTERACTIVE -> {
                        InlineNotice(
                            "连接时由服务器发起挑战，应用会弹出输入面板，凭据不会被保存。",
                            tone = NoticeTone.INFO,
                        )
                    }
                }
                Spacer(Modifier.height(18.dp))
                Hairline()
                Spacer(Modifier.height(14.dp))
                FieldLabel("启动命令")
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = draft.startupCommand,
                    onValueChange = { draft = draft.copy(startupCommand = it) },
                    placeholder = "可选，例如 cd /var/www",
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(14.dp))
                FieldLabel("默认目录")
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = draft.defaultPath,
                    onValueChange = { draft = draft.copy(defaultPath = it) },
                    placeholder = "可选，SFTP 打开路径，例如 /var/www",
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(14.dp))
                FieldLabel("标签")
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = draft.tagsText,
                    onValueChange = { draft = draft.copy(tagsText = it) },
                    placeholder = "用逗号分隔，例如：生产,nginx",
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(14.dp))
                FieldLabel("备注")
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = draft.notes,
                    onValueChange = { draft = draft.copy(notes = it) },
                    placeholder = "可选",
                    singleLine = false,
                    minLines = 2,
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(14.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clickable { draft = draft.copy(keepAlive = !draft.keepAlive) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("保持连接", style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
                        Text(
                            "定期发送保活包，减少弱网断连",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textTertiary,
                        )
                    }
                    Switch(
                        checked = draft.keepAlive,
                        onCheckedChange = { draft = draft.copy(keepAlive = it) },
                    )
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun SelectorRow(
    value: String,
    expanded: Boolean,
    onClick: () -> Unit,
) {
    val colors = LocalFluentColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(colors.surface)
            .border(0.5.dp, colors.outlineStrong, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp),
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
private fun SelectorOption(
    label: String,
    selected: Boolean,
    subtitle: String? = null,
    onClick: () -> Unit,
) {
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
            Text(label, style = MaterialTheme.typography.bodyLarge, color = colors.textPrimary)
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
            }
        }
        if (selected) {
            Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.brand, modifier = Modifier.size(20.dp))
        }
    }
}
