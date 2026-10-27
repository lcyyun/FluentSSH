package com.fluentssh.mobile.ui.security

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.data.AuditLevel
import com.fluentssh.mobile.data.KnownHostRecord
import com.fluentssh.mobile.data.SshKeyRecord
import com.fluentssh.mobile.data.newId
import com.fluentssh.mobile.ssh.KeyService
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// --------------------------------------------------------------------- keys

@Composable
fun KeysScreen(vm: AppViewModel, onBack: () -> Unit) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current
    var showCreate by remember { mutableStateOf(false) }
    var actionKey by remember { mutableStateOf<SshKeyRecord?>(null) }
    var deleteKey by remember { mutableStateOf<SshKeyRecord?>(null) }

    Column(Modifier.fillMaxSize().background(colors.background)) {
        AppTopBar(
            title = "密钥",
            subtitle = "${data.keys.size} 个密钥",
            onBack = onBack,
            actions = {
                IconCircle(Icons.Outlined.Add, contentDescription = "添加密钥", onClick = { showCreate = true })
            },
        )
        if (data.keys.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.VpnKey,
                title = "还没有密钥",
                description = "生成 RSA 3072 密钥，或导入已有的 OpenSSH 私钥用于主机认证。",
                actionLabel = "添加密钥",
                onAction = { showCreate = true },
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(data.keys, key = { it.id }) { key ->
                    AppCard(onClick = { actionKey = key }, contentPadding = PaddingValues(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier
                                    .size(40.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(colors.brandContainer),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Outlined.VpnKey, contentDescription = null, tint = colors.onBrandContainer, modifier = Modifier.size(20.dp))
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(key.name, style = MaterialTheme.typography.titleSmall, color = colors.textPrimary)
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    "${key.algorithm} ${key.bits} · ${key.createdLabel}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textTertiary,
                                )
                                Spacer(Modifier.height(6.dp))
                                Text(
                                    key.fingerprint,
                                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                                    color = colors.textSecondary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            if (key.generatedByApp) Tag("应用生成")
                        }
                    }
                }
            }
        }
    }

    actionKey?.let { key ->
        AppBottomSheet(
            title = key.name,
            subtitle = key.fingerprint,
            heightFraction = 0.45f,
            dismissible = true,
            onDismissRequest = { actionKey = null },
        ) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                SecurityAction(Icons.Outlined.ContentCopy, "复制公钥") {
                    clipboard.setText(AnnotatedString(key.publicKey))
                    vm.toast("公钥已复制")
                    actionKey = null
                }
                SecurityAction(Icons.Outlined.Fingerprint, "复制指纹") {
                    clipboard.setText(AnnotatedString(key.fingerprint))
                    vm.toast("指纹已复制")
                    actionKey = null
                }
                SecurityAction(Icons.Outlined.Delete, "删除密钥", destructive = true, showDivider = false) {
                    actionKey = null
                    deleteKey = key
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }

    deleteKey?.let { key ->
        ConfirmDialog(
            title = "删除密钥",
            message = "将删除「${key.name}」。使用该密钥的主机会被改为密码认证，需要重新配置。",
            confirmLabel = "删除",
            destructive = true,
            onConfirm = {
                vm.deleteKey(key)
                deleteKey = null
            },
            onDismiss = { deleteKey = null },
        )
    }

    if (showCreate) {
        KeyFormSheet(vm, onDismiss = { showCreate = false })
    }
}

@Composable
private fun KeyFormSheet(vm: AppViewModel, onDismiss: () -> Unit) {
    val colors = LocalFluentColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var mode by remember { mutableIntStateOf(0) } // 0 generate, 1 import
    var name by remember { mutableStateOf("") }
    var bits by remember { mutableIntStateOf(3072) }
    var passphrase by remember { mutableStateOf("") }
    var passphraseVisible by remember { mutableStateOf(false) }
    var pem by remember { mutableStateOf("") }
    var importPassphrase by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val pemLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        val text = runCatching {
            context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
        }.getOrNull()
        if (text.isNullOrBlank()) {
            error = "无法读取私钥文件"
        } else {
            pem = text
            if (name.isBlank()) name = uri.lastPathSegment?.substringAfterLast('/')?.substringBeforeLast('.') ?: "导入的密钥"
        }
    }

    AppBottomSheet(
        title = "添加密钥",
        subtitle = if (mode == 0) "在本机生成 RSA 密钥对" else "导入 OpenSSH / PEM 私钥",
        heightFraction = 0.8f,
        dismissible = false,
        onDismissRequest = onDismiss,
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { SecondaryButton("取消", onDismiss) }
                Box(Modifier.weight(1f)) {
                    PrimaryButton(
                        text = if (mode == 0) "生成" else "导入",
                        onClick = {
                            val finalName = name.ifBlank { if (mode == 0) "RSA ${bits}" else "导入的密钥" }
                            working = true
                            error = null
                            scope.launch {
                                try {
                                    val generated = withContext(Dispatchers.IO) {
                                        if (mode == 0) {
                                            KeyService.generateRsa(
                                                bits = bits,
                                                comment = finalName,
                                                passphrase = passphrase.ifBlank { null },
                                            )
                                        } else {
                                            KeyService.importPrivateKey(pem, importPassphrase.ifBlank { null })
                                        }
                                    }
                                    vm.addKey(
                                        SshKeyRecord(
                                            id = newId(),
                                            name = finalName,
                                            algorithm = "RSA",
                                            bits = generated.bits,
                                            publicKey = generated.publicKeyOpenSsh,
                                            fingerprint = generated.fingerprint,
                                            generatedByApp = mode == 0,
                                        ),
                                        materialPem = generated.privateKeyPem,
                                        passphrase = (if (mode == 0) passphrase else importPassphrase).ifBlank { null },
                                    )
                                    working = false
                                    onDismiss()
                                } catch (e: Exception) {
                                    working = false
                                    error = e.message ?: "操作失败"
                                }
                            }
                        },
                        loading = working,
                        enabled = !working && (mode == 0 || pem.isNotBlank()),
                    )
                }
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
            error?.let {
                InlineNotice(it, tone = NoticeTone.ERROR)
                Spacer(Modifier.height(10.dp))
            }
            SegmentedControl(listOf("生成新密钥", "导入私钥"), mode, onSelect = { mode = it })
            Spacer(Modifier.height(14.dp))
            FieldLabel("名称", required = true)
            Spacer(Modifier.height(6.dp))
            AppTextField(
                value = name,
                onValueChange = { name = it },
                placeholder = if (mode == 0) "例如：工作笔记本" else "密钥名称",
                modifier = Modifier.centerOnFocus(),
            )
            Spacer(Modifier.height(14.dp))
            if (mode == 0) {
                FieldLabel("密钥长度")
                Spacer(Modifier.height(6.dp))
                SegmentedControl(listOf("2048", "3072", "4096"), when (bits) {
                    2048 -> 0
                    4096 -> 2
                    else -> 1
                }, onSelect = {
                    bits = when (it) {
                        0 -> 2048
                        2 -> 4096
                        else -> 3072
                    }
                })
                Spacer(Modifier.height(14.dp))
                FieldLabel("私钥口令")
                Spacer(Modifier.height(6.dp))
                PasswordField(
                    value = passphrase,
                    onValueChange = { passphrase = it },
                    visible = passphraseVisible,
                    onToggleVisible = { passphraseVisible = !passphraseVisible },
                    placeholder = "可选，建议设置",
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "生成过程在本机完成；私钥使用 Android Keystore 加密后在应用私有目录保存。",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    SecondaryButton("选择私钥文件", { pemLauncher.launch(arrayOf("*/*")) }, Modifier.weight(1f))
                }
                Spacer(Modifier.height(12.dp))
                FieldLabel("私钥内容", required = true)
                Spacer(Modifier.height(6.dp))
                AppTextField(
                    value = pem,
                    onValueChange = { pem = it },
                    placeholder = "-----BEGIN OPENSSH PRIVATE KEY-----",
                    singleLine = false,
                    minLines = 6,
                    maxLines = 10,
                    modifier = Modifier.centerOnFocus(),
                )
                Spacer(Modifier.height(14.dp))
                FieldLabel("私钥口令")
                Spacer(Modifier.height(6.dp))
                PasswordField(
                    value = importPassphrase,
                    onValueChange = { importPassphrase = it },
                    visible = passphraseVisible,
                    onToggleVisible = { passphraseVisible = !passphraseVisible },
                    placeholder = "如果私钥没有口令可留空",
                    modifier = Modifier.centerOnFocus(),
                )
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
private fun SecurityAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    destructive: Boolean = false,
    showDivider: Boolean = true,
    onClick: () -> Unit,
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

// -------------------------------------------------------------- known hosts

@Composable
fun KnownHostsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    var removeFor by remember { mutableStateOf<KnownHostRecord?>(null) }
    Column(Modifier.fillMaxSize().background(colors.background)) {
        AppTopBar(title = "已知主机", subtitle = "${data.knownHosts.size} 条指纹", onBack = onBack)
        if (data.knownHosts.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.VerifiedUser,
                title = "还没有已知主机",
                description = "首次连接服务器并确认主机密钥后，指纹会记录在这里。",
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(data.knownHosts, key = { it.id }) { record ->
                    AppCard(contentPadding = PaddingValues(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        record.displayAddress,
                                        style = MaterialTheme.typography.titleSmall,
                                        color = colors.textPrimary,
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Tag(record.keyType)
                                }
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    record.fingerprint,
                                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                                    color = colors.textSecondary,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Spacer(Modifier.height(4.dp))
                                Text("记录于 ${record.addedLabel}", style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                            }
                            IconCircle(
                                Icons.Outlined.Delete,
                                contentDescription = "移除",
                                onClick = { removeFor = record },
                                tint = colors.error,
                            )
                        }
                    }
                }
            }
        }
    }
    removeFor?.let { record ->
        ConfirmDialog(
            title = "移除已知主机",
            message = "移除后，下次连接 ${record.hostname}:${record.port} 会重新要求确认主机密钥。",
            confirmLabel = "移除",
            destructive = true,
            onConfirm = {
                vm.removeKnownHost(record.id)
                removeFor = null
            },
            onDismiss = { removeFor = null },
        )
    }
}

// -------------------------------------------------------------------- audit

@Composable
fun AuditScreen(vm: AppViewModel, onBack: () -> Unit) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    var filter by remember { mutableIntStateOf(0) }
    var showClear by remember { mutableStateOf(false) }
    val events = data.audit.filter {
        when (filter) {
            1 -> it.level == AuditLevel.WARNING
            2 -> it.level == AuditLevel.ERROR
            else -> true
        }
    }
    Column(Modifier.fillMaxSize().background(colors.background)) {
        AppTopBar(
            title = "审计日志",
            subtitle = "${data.audit.size} 条事件",
            onBack = onBack,
            actions = {
                IconCircle(Icons.Outlined.DeleteSweep, contentDescription = "清空日志", onClick = { showClear = true })
            },
        )
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            SegmentedControl(listOf("全部", "警告", "错误"), filter, { filter = it })
        }
        if (events.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.ReceiptLong,
                title = "暂无事件",
                description = "连接、文件传输、隧道和命令操作都会记录在这里。",
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(events, key = { it.id }) { event ->
                    val (color, container) = when (event.level) {
                        AuditLevel.ERROR -> colors.error to colors.errorContainer
                        AuditLevel.WARNING -> colors.warning to colors.warningContainer
                        AuditLevel.INFO -> colors.textSecondary to colors.surfaceContainer
                    }
                    AppCard(contentPadding = PaddingValues(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StatusPill(event.levelLabel, color, container)
                            Spacer(Modifier.width(8.dp))
                            Tag(event.categoryLabel)
                            Spacer(Modifier.weight(1f))
                            Text(event.timeLabel, style = MaterialTheme.typography.labelSmall, color = colors.textTertiary)
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(event.message, style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary)
                        if (!event.hostLabel.isNullOrBlank()) {
                            Spacer(Modifier.height(2.dp))
                            Text(event.hostLabel.orEmpty(), style = MaterialTheme.typography.bodySmall, color = colors.textTertiary)
                        }
                        if (!event.detail.isNullOrBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                event.detail.orEmpty(),
                                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                                color = colors.textTertiary,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
    if (showClear) {
        ConfirmDialog(
            title = "清空审计日志",
            message = "将删除全部审计事件，此操作不可撤销。",
            confirmLabel = "清空",
            destructive = true,
            onConfirm = {
                vm.clearAudit()
                showClear = false
            },
            onDismiss = { showClear = false },
        )
    }
}

// --------------------------------------------------------------- recordings

@Composable
fun RecordingsScreen(vm: AppViewModel, onBack: () -> Unit) {
    val colors = LocalFluentColors.current
    val data by vm.data.collectAsStateWithLifecycle()
    var preview by remember { mutableStateOf<com.fluentssh.mobile.data.Recording?>(null) }
    var deleteFor by remember { mutableStateOf<com.fluentssh.mobile.data.Recording?>(null) }
    LaunchedEffect(Unit) { vm.refreshRecordings() }

    Column(Modifier.fillMaxSize().background(colors.background)) {
        AppTopBar(title = "会话录制", subtitle = "${data.recordings.size} 个文件", onBack = onBack)
        if (data.recordings.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.FiberManualRecord,
                title = "暂无录制",
                description = "在设置中开启「录制终端会话」后，新建连接会生成原始输出日志。",
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(data.recordings, key = { it.fileName }) { recording ->
                    AppCard(
                        onClick = { preview = recording },
                        contentPadding = PaddingValues(14.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                Modifier
                                    .size(40.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(colors.surfaceContainer),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Outlined.Description, contentDescription = null, tint = colors.textSecondary, modifier = Modifier.size(19.dp))
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(recording.fileName, style = MaterialTheme.typography.bodyMedium, color = colors.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    "${recording.timeLabel} · ${recording.sizeLabel}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textTertiary,
                                )
                            }
                            IconCircle(Icons.Outlined.Delete, contentDescription = "删除", onClick = { deleteFor = recording }, tint = colors.error)
                        }
                    }
                }
            }
        }
    }

    preview?.let { recording ->
        val content = remember(recording.fileName) {
            runCatching {
                val file = java.io.File(vm.store.logsDir, recording.fileName)
                if (file.length() > 128 * 1024) {
                    file.inputStream().use { input ->
                        ByteArray(128 * 1024).let { buffer ->
                            val read = input.read(buffer)
                            String(buffer, 0, read)
                        }
                    } + "\n…（已截断）"
                } else {
                    file.readText()
                }
            }.getOrElse { "无法读取录制文件：${it.message}" }
        }
        AppBottomSheet(
            title = recording.fileName,
            subtitle = "原始终端输出 · ${recording.sizeLabel}",
            heightFraction = 0.8f,
            dismissible = true,
            onDismissRequest = { preview = null },
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                Text(
                    content,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    color = colors.textPrimary,
                )
            }
        }
    }

    deleteFor?.let { recording ->
        ConfirmDialog(
            title = "删除录制",
            message = "将删除 ${recording.fileName}。",
            confirmLabel = "删除",
            destructive = true,
            onConfirm = {
                vm.deleteRecording(recording.fileName)
                deleteFor = null
            },
            onDismiss = { deleteFor = null },
        )
    }
}
