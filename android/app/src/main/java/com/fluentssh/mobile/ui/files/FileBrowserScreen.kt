package com.fluentssh.mobile.ui.files

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fluentssh.mobile.data.formatDate
import com.fluentssh.mobile.data.formatSize
import com.fluentssh.mobile.ssh.RemoteFile
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors

@Composable
fun FileBrowserScreen(
    vm: AppViewModel,
    hostId: String,
    onBack: () -> Unit,
    onEditFile: (String) -> Unit,
) {
    val colors = LocalFluentColors.current
    val context = LocalContext.current
    val host = remember(hostId) { vm.store.findHost(hostId) }
    val filesVm: FilesViewModel = viewModel(
        key = "files-$hostId",
        factory = FilesViewModel.factory(vm.container, hostId),
    )
    val state by filesVm.state.collectAsStateWithLifecycle()

    LaunchedEffect(filesVm) {
        filesVm.toastMessages.collect { vm.toast(it) }
    }

    var actionEntry by remember { mutableStateOf<RemoteFile?>(null) }
    var renameEntry by remember { mutableStateOf<RemoteFile?>(null) }
    var deleteEntry by remember { mutableStateOf<RemoteFile?>(null) }
    var showCreateFolder by remember { mutableStateOf(false) }
    var showUploadSheet by remember { mutableStateOf(false) }
    val pendingDownload = remember { mutableStateOf<RemoteFile?>(null) }

    val uploadLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        val meta = queryFileMeta(context, uri)
        filesVm.upload(uri, meta.first, meta.second)
    }
    val downloadLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val entry = pendingDownload.value
        pendingDownload.value = null
        if (uri != null && entry != null) filesVm.download(entry, uri)
    }

    Column(Modifier.fillMaxSize().background(colors.background)) {
        AppTopBar(
            title = "文件",
            subtitle = host?.let { "${it.name} · ${it.address}" } ?: "SFTP",
            onBack = onBack,
            actions = {
                IconCircle(
                    Icons.Outlined.Refresh,
                    contentDescription = "刷新",
                    onClick = { filesVm.refresh() },
                    enabled = !state.loading,
                )
            },
        )

        // Path bar
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(onClick = { filesVm.navigateUp() }),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.ArrowUpward, contentDescription = "上级目录", tint = colors.textSecondary, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(6.dp))
            Text(
                text = state.path.ifBlank { "正在连接…" },
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = colors.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }

        if (state.busyText != null) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.progress == null) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = colors.brand)
                    } else {
                        LinearProgressIndicator(
                            progress = state.progress ?: 0f,
                            modifier = Modifier.width(80.dp),
                            color = colors.brand,
                            trackColor = colors.surfaceContainer,
                        )
                    }
                    Text(
                        state.busyText.orEmpty(),
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.textTertiary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(4.dp))
            }
        }

        when {
            state.loading && state.entries.isEmpty() -> {
                LoadingRow("正在读取远程目录…")
            }
            state.error != null && state.entries.isEmpty() -> {
                Column(Modifier.padding(16.dp)) {
                    ErrorNotice(state.error.orEmpty(), onRetry = { filesVm.retry() })
                }
            }
            state.entries.isEmpty() -> {
                EmptyState(
                    icon = Icons.Outlined.FolderOff,
                    title = "空目录",
                    description = "这个目录还没有文件，可以上传文件或新建文件夹。",
                    actionLabel = "上传文件",
                    onAction = { uploadLauncher.launch("*/*") },
                )
            }
            else -> {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                    items(state.entries, key = { it.path }) { entry ->
                        FileRow(
                            entry = entry,
                            onClick = {
                                if (entry.isDirectory) {
                                    filesVm.open(entry)
                                } else if (isTextFile(entry.name)) {
                                    onEditFile(entry.path)
                                } else {
                                    actionEntry = entry
                                }
                            },
                            onMore = { actionEntry = entry },
                        )
                    }
                }
            }
        }
    }

    // Single floating action: upload / new folder sheet.
    Box(Modifier.fillMaxSize()) {
        if (state.entries.isNotEmpty() || state.path.isNotBlank()) {
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 16.dp, bottom = 16.dp)
                    .size(56.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(colors.brand)
                    .clickable { showUploadSheet = true },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Add, contentDescription = "新建或上传", tint = colors.onBrand, modifier = Modifier.size(26.dp))
            }
        }
    }

    actionEntry?.let { entry ->
        AppBottomSheet(
            title = entry.name,
            subtitle = if (entry.isDirectory) "文件夹" else formatSize(entry.size),
            heightFraction = 0.5f,
            dismissible = true,
            onDismissRequest = { actionEntry = null },
        ) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                if (isTextFile(entry.name)) {
                    FileSheetAction(Icons.Outlined.EditNote, "用文本编辑器打开") {
                        actionEntry = null
                        onEditFile(entry.path)
                    }
                }
                if (!entry.isDirectory) {
                    FileSheetAction(Icons.Outlined.Download, "下载到本机") {
                        actionEntry = null
                        pendingDownload.value = entry
                        downloadLauncher.launch(entry.name)
                    }
                }
                FileSheetAction(Icons.Outlined.DriveFileRenameOutline, "重命名") {
                    actionEntry = null
                    renameEntry = entry
                }
                FileSheetAction(Icons.Outlined.Delete, "删除", destructive = true, showDivider = false) {
                    actionEntry = null
                    deleteEntry = entry
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }

    if (showUploadSheet) {
        AppBottomSheet(
            title = "添加文件",
            subtitle = "上传到 ${state.path.ifBlank { "/" }}",
            heightFraction = 0.35f,
            dismissible = true,
            onDismissRequest = { showUploadSheet = false },
        ) {
            Column(Modifier.fillMaxWidth()) {
                FileSheetAction(Icons.Outlined.UploadFile, "从本机上传文件") {
                    showUploadSheet = false
                    uploadLauncher.launch("*/*")
                }
                FileSheetAction(Icons.Outlined.CreateNewFolder, "新建文件夹") {
                    showUploadSheet = false
                    showCreateFolder = true
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }

    if (showCreateFolder) {
        TextPromptSheet(
            title = "新建文件夹",
            label = "文件夹名称",
            placeholder = "例如：deploy",
            confirmLabel = "创建",
            onDismiss = { showCreateFolder = false },
            onConfirm = { name ->
                showCreateFolder = false
                filesVm.createFolder(name)
            },
        )
    }

    renameEntry?.let { entry ->
        TextPromptSheet(
            title = "重命名",
            label = "新的名称",
            placeholder = entry.name,
            initialValue = entry.name,
            confirmLabel = "保存",
            onDismiss = { renameEntry = null },
            onConfirm = { name ->
                renameEntry = null
                filesVm.rename(entry, name)
            },
        )
    }

    deleteEntry?.let { entry ->
        ConfirmDialog(
            title = "删除${if (entry.isDirectory) "文件夹" else "文件"}",
            message = if (entry.isDirectory) {
                "将递归删除「${entry.name}」及其中的全部内容。此操作不可撤销。"
            } else {
                "将删除「${entry.name}」。此操作不可撤销。"
            },
            confirmLabel = "删除",
            destructive = true,
            onConfirm = {
                deleteEntry = null
                filesVm.delete(entry)
            },
            onDismiss = { deleteEntry = null },
        )
    }
}

@Composable
private fun FileRow(entry: RemoteFile, onClick: () -> Unit, onMore: () -> Unit) {
    val colors = LocalFluentColors.current
    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clickable(onClick = onClick)
                .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(if (entry.isDirectory) colors.brandContainer else colors.surfaceContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (entry.isDirectory) Icons.Outlined.Folder else fileIcon(entry.name),
                    contentDescription = null,
                    tint = if (entry.isDirectory) colors.onBrandContainer else colors.textSecondary,
                    modifier = Modifier.size(19.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    entry.name,
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    if (entry.isDirectory) "文件夹" else "${formatSize(entry.size)} · ${formatDate(entry.modifiedAt, "yyyy-MM-dd HH:mm")}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textTertiary,
                )
            }
            Box(
                Modifier.size(48.dp).clip(RoundedCornerShape(999.dp)).clickable(onClick = onMore),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "更多", tint = colors.textTertiary, modifier = Modifier.size(20.dp))
            }
        }
        Hairline(Modifier.padding(start = 66.dp))
    }
}

@Composable
private fun FileSheetAction(
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

@Composable
fun TextPromptSheet(
    title: String,
    label: String,
    placeholder: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
    confirmLabel: String = "确定",
    initialValue: String = "",
) {
    var value by remember { mutableStateOf(initialValue) }
    AppBottomSheet(
        title = title,
        heightFraction = 0.42f,
        dismissible = false,
        onDismissRequest = onDismiss,
        footer = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { SecondaryButton("取消", onDismiss) }
                Box(Modifier.weight(1f)) {
                    PrimaryButton(confirmLabel, { if (value.isNotBlank()) onConfirm(value.trim()) }, enabled = value.isNotBlank())
                }
            }
        },
    ) {
        Column(Modifier.fillMaxWidth()) {
            FieldLabel(label, required = true)
            Spacer(Modifier.height(6.dp))
            AppTextField(
                value = value,
                onValueChange = { value = it },
                placeholder = placeholder,
                modifier = Modifier.centerOnFocus(),
            )
            Spacer(Modifier.height(12.dp))
        }
    }
}

private fun fileIcon(name: String) = when (name.substringAfterLast('.', "").lowercase()) {
    "png", "jpg", "jpeg", "gif", "webp", "svg" -> Icons.Outlined.Image
    "zip", "gz", "tar", "7z", "rar", "xz" -> Icons.Outlined.Archive
    "md", "txt", "log", "conf" -> Icons.Outlined.Description
    else -> Icons.Outlined.InsertDriveFile
}

private fun isTextFile(name: String): Boolean =
    name.substringAfterLast('.', "").lowercase() in setOf(
        "txt", "md", "log", "conf", "cfg", "ini", "json", "yaml", "yml", "sh", "bash", "zsh",
        "py", "js", "mjs", "ts", "tsx", "jsx", "java", "kt", "kts", "go", "rs", "c", "h", "cpp",
        "html", "css", "xml", "toml", "properties", "service", "env", "gitignore", "sql", "rb",
        "php", "pl", "lua", "dockerfile", "makefile", "csv",
    ) || !name.contains('.')

private fun queryFileMeta(context: Context, uri: Uri): Pair<String, Long> {
    var name = "upload.bin"
    var size = 0L
    runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0) size = cursor.getLong(sizeIndex)
            }
        }
    }
    return name to size
}
