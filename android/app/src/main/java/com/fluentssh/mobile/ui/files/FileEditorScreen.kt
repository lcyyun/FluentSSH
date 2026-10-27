package com.fluentssh.mobile.ui.files

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors

@Composable
fun FileEditorScreen(
    vm: AppViewModel,
    hostId: String,
    path: String,
    onBack: () -> Unit,
) {
    val colors = LocalFluentColors.current
    val host = remember(hostId) { vm.store.findHost(hostId) }
    val editorVm: FileEditorViewModel = viewModel(
        key = "editor-$hostId-$path",
        factory = FileEditorViewModel.factory(vm.container, hostId, path),
    )
    val state by editorVm.state.collectAsStateWithLifecycle()
    var showDiscard by remember { mutableStateOf(false) }
    val fileLabel = path.substringAfterLast('/').ifBlank { path }

    fun attemptBack() {
        if (state.dirty) showDiscard = true else onBack()
    }

    Column(Modifier.fillMaxSize().background(colors.background).imePadding()) {
        AppTopBar(
            title = fileLabel,
            subtitle = host?.name ?: "远程文件",
            onBack = { attemptBack() },
            actions = {
                TextButton(
                    onClick = {
                        editorVm.save {
                            vm.toast("文件已保存")
                        }
                    },
                    enabled = state.dirty && !state.saving,
                    modifier = Modifier.height(48.dp),
                ) {
                    if (state.saving) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Text("保存", color = if (state.dirty) colors.brand else colors.textTertiary)
                    }
                }
            },
        )

        when {
            state.loading -> FullScreenLoading("正在读取文件…")
            state.error != null && !state.loaded -> {
                Column(Modifier.padding(16.dp)) {
                    ErrorNotice(state.error.orEmpty())
                    Spacer(Modifier.height(12.dp))
                    SecondaryButton("返回", { onBack() })
                }
            }
            else -> {
                if (state.error != null) {
                    Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        ErrorNotice(state.error.orEmpty())
                    }
                }
                OutlinedTextField(
                    value = state.text,
                    onValueChange = editorVm::update,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 13.sp,
                        lineHeight = 20.sp,
                    ),
                    placeholder = { Text("空文件", color = colors.textTertiary) },
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = colors.outlineStrong,
                        unfocusedBorderColor = colors.outline,
                        focusedContainerColor = colors.surface,
                        unfocusedContainerColor = colors.surface,
                        cursorColor = colors.brand,
                    ),
                )
                Hairline()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Code, contentDescription = null, tint = colors.textTertiary, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "UTF-8 · ${state.text.length} 字符 · ${state.text.count { it == '\n' } + 1} 行",
                        style = MaterialTheme.typography.labelSmall,
                        color = colors.textTertiary,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (state.dirty) {
                        Text("未保存", style = MaterialTheme.typography.labelSmall, color = colors.warning)
                    }
                }
            }
        }
    }

    if (showDiscard) {
        ConfirmDialog(
            title = "放弃修改？",
            message = "文件有未保存的修改，返回后将丢失这些内容。",
            confirmLabel = "放弃",
            destructive = true,
            onConfirm = {
                showDiscard = false
                onBack()
            },
            onDismiss = { showDiscard = false },
        )
    }
}
