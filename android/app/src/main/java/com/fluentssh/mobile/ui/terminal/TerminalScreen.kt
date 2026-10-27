package com.fluentssh.mobile.ui.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.fluentssh.mobile.ssh.SessionState
import com.fluentssh.mobile.ssh.TerminalKey
import com.fluentssh.mobile.ui.AppViewModel
import com.fluentssh.mobile.ui.components.*
import com.fluentssh.mobile.ui.theme.LocalFluentColors
import kotlinx.coroutines.delay

// Terminal chrome intentionally stays dark in both app themes.
private val ChromeBackground = Color(0xFF0B1016)
private val ChromeSurface = Color(0xFF141B23)
private val ChromeBorder = Color(0xFF232C37)
private val ChromeText = Color(0xFFE6EDF5)
private val ChromeSecondary = Color(0xFF8C99A8)

@Composable
fun TerminalScreen(
    vm: AppViewModel,
    sessionId: String,
    onBack: () -> Unit,
    onOpenFiles: (com.fluentssh.mobile.ssh.TerminalSession) -> Unit,
    onSwitchSession: (String) -> Unit,
    onNewSession: () -> Unit,
) {
    val sessions by vm.sessions.collectAsStateWithLifecycle()
    val session = remember(sessions, sessionId) { sessions.firstOrNull { it.id == sessionId } }
    val settings by vm.data.collectAsStateWithLifecycle()
    val colors = LocalFluentColors.current

    if (session == null) {
        Column(Modifier.fillMaxSize().background(colors.background)) {
            AppTopBar(title = "终端", onBack = onBack)
            EmptyState(
                icon = Icons.Outlined.Terminal,
                title = "会话已结束",
                description = "这个 SSH 会话已关闭，可以返回主机列表重新连接。",
                actionLabel = "返回",
                onAction = onBack,
            )
        }
        return
    }

    val state by session.state.collectAsStateWithLifecycle()
    val error by session.error.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }
    var inputValue by remember { mutableStateOf(TextFieldValue("")) }
    var menuOpen by remember { mutableStateOf(false) }
    var showDisconnectConfirm by remember { mutableStateOf(false) }

    fun send(bytes: ByteArray) = session.write(bytes)
    fun sendKey(key: TerminalKey) = send(key.bytes)
    fun sendText(text: String) = session.sendText(text)

    fun handleKeyEvent(event: KeyEvent): Boolean {
        if (event.type != KeyEventType.KeyDown) return false
        val ctrl = event.isCtrlPressed
        if (ctrl) {
            val code = when (event.key) {
                Key.A -> 1
                Key.C -> 3
                Key.D -> 4
                Key.E -> 5
                Key.K -> 11
                Key.L -> 12
                Key.R -> 18
                Key.U -> 21
                Key.W -> 23
                Key.Z -> 26
                else -> 0
            }
            if (code != 0) {
                send(byteArrayOf(code.toByte()))
                return true
            }
        }
        val sequence = when (event.key) {
            Key.Backspace -> byteArrayOf(0x7f)
            Key.Enter, Key.NumPadEnter -> byteArrayOf(0x0d)
            Key.Escape -> byteArrayOf(0x1b)
            Key.Tab -> byteArrayOf(0x09)
            Key.Delete -> byteArrayOf(0x1b, '['.code.toByte(), '3'.code.toByte(), '~'.code.toByte())
            Key.DirectionUp -> TerminalKey.UP.bytes
            Key.DirectionDown -> TerminalKey.DOWN.bytes
            Key.DirectionLeft -> TerminalKey.LEFT.bytes
            Key.DirectionRight -> TerminalKey.RIGHT.bytes
            Key.MoveHome -> TerminalKey.HOME.bytes
            Key.MoveEnd -> TerminalKey.END.bytes
            else -> null
        }
        if (sequence != null) {
            send(sequence)
            return true
        }
        return false
    }

    fun focusTerminalInput() {
        runCatching { focusRequester.requestFocus() }
        keyboard?.show()
    }

    LaunchedEffect(Unit) {
        delay(250)
        focusTerminalInput()
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(ChromeBackground)
            .imePadding()
            .onPreviewKeyEvent { handleKeyEvent(it) },
    ) {
        TerminalTopBar(
            title = session.host.name,
            subtitle = when (state) {
                SessionState.CONNECTING -> "正在连接…"
                SessionState.CONNECTED -> "${session.host.username}@${session.host.hostname}:${session.host.port}"
                SessionState.ERROR -> "连接失败"
                SessionState.DISCONNECTED -> "会话已断开"
            },
            state = state,
            onBack = onBack,
            onOpenFiles = { onOpenFiles(session) },
            onMenu = { menuOpen = true },
        )
        Box {
            DropdownMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
            ) {
                DropdownMenuItem(
                    text = { Text("复制屏幕文本", color = ChromeText) },
                    leadingIcon = { Icon(Icons.Outlined.ContentCopy, null, tint = ChromeSecondary) },
                    onClick = {
                        menuOpen = false
                        val text = session.snapshot().screen.joinToString("\n") { it.text.trimEnd() }.trimEnd()
                        clipboard.setText(AnnotatedString(text))
                        vm.toast("已复制终端内容")
                    },
                )
                DropdownMenuItem(
                    text = { Text("粘贴", color = ChromeText) },
                    leadingIcon = { Icon(Icons.Outlined.ContentPaste, null, tint = ChromeSecondary) },
                    onClick = {
                        menuOpen = false
                        clipboard.getText()?.text?.let { sendText(it) }
                    },
                )
                DropdownMenuItem(
                    text = { Text("清屏", color = ChromeText) },
                    leadingIcon = { Icon(Icons.Outlined.CleaningServices, null, tint = ChromeSecondary) },
                    onClick = {
                        menuOpen = false
                        session.clearScreen()
                    },
                )
                DropdownMenuItem(
                    text = { Text("重新连接", color = ChromeText) },
                    leadingIcon = { Icon(Icons.Outlined.Refresh, null, tint = ChromeSecondary) },
                    onClick = {
                        menuOpen = false
                        session.reconnect()
                    },
                )
                DropdownMenuItem(
                    text = { Text("断开连接", color = colors.error) },
                    leadingIcon = { Icon(Icons.Outlined.PowerSettingsNew, null, tint = colors.error) },
                    onClick = {
                        menuOpen = false
                        showDisconnectConfirm = true
                    },
                )
            }
        }

        if (sessions.size > 1) {
            SessionTabs(
                sessions = sessions,
                selectedId = session.id,
                onSelect = onSwitchSession,
                onNew = onNewSession,
            )
        }

        if (state == SessionState.DISCONNECTED) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF2A2113))
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Outlined.LinkOff, contentDescription = null, tint = Color(0xFFFDB022), modifier = Modifier.size(18.dp))
                Text(
                    "会话已断开",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFFFDB022),
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "重新连接",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color(0xFFFDB022),
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { session.reconnect() }
                        .padding(horizontal = 8.dp, vertical = 10.dp),
                )
            }
        }

        if (state == SessionState.ERROR && !error.isNullOrBlank()) {
            val terminalError = Color(0xFFF97066)
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF3B1A18))
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = terminalError, modifier = Modifier.size(18.dp))
                Text(
                    error.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = terminalError,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "重试",
                    style = MaterialTheme.typography.labelMedium,
                    color = terminalError,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { session.reconnect() }
                        .padding(horizontal = 8.dp, vertical = 10.dp),
                )
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            TerminalCanvas(
                session = session,
                fontSizeSp = settings.settings.terminalFontSize.coerceIn(10, 22),
                modifier = Modifier.fillMaxSize(),
                showCursor = state == SessionState.CONNECTED,
                onTap = { focusTerminalInput() },
                onSizeChanged = { cols, rows -> session.resize(cols, rows) },
            )
        }

        ExtraKeysBar(
            onKey = { sendKey(it) },
            onPaste = { clipboard.getText()?.text?.let { sendText(it) } },
            onKeyboard = { focusTerminalInput() },
        )

        // Off-screen IME capture: committed text is streamed to the SSH channel.
        Box(Modifier.size(1.dp).alpha(0f)) {
            BasicTextField(
                value = inputValue,
                onValueChange = { value ->
                    if (value.composition != null) {
                        inputValue = value
                    } else {
                        val committed = value.text
                        if (committed.isNotEmpty()) sendText(committed)
                        inputValue = TextFieldValue("")
                    }
                },
                textStyle = TextStyle(color = Color.Transparent, fontSize = 1.sp),
                singleLine = true,
                modifier = Modifier
                    .size(1.dp)
                    .focusRequester(focusRequester),
            )
        }
    }

    if (showDisconnectConfirm) {
        ConfirmDialog(
            title = "断开连接",
            message = "将结束与 ${session.host.name} 的终端会话，正在运行的任务可能会被终止。",
            confirmLabel = "断开",
            destructive = true,
            onConfirm = {
                showDisconnectConfirm = false
                vm.closeSession(session.id)
                onBack()
            },
            onDismiss = { showDisconnectConfirm = false },
        )
    }
}

/** Click without a Material state layer: terminal chrome should never show a
 * persistent keyboard-focus bubble over the back arrow. */
private fun Modifier.clickableQuiet(onClick: () -> Unit): Modifier = composed {
    clickable(
        interactionSource = remember { MutableInteractionSource() },
        indication = null,
        onClick = onClick,
    )
}

@Composable
private fun TerminalTopBar(
    title: String,
    subtitle: String,
    state: SessionState,
    onBack: () -> Unit,
    onOpenFiles: () -> Unit,
    onMenu: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(ChromeSurface).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().height(54.dp).padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(48.dp).clip(CircleShape).clickableQuiet(onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "返回", tint = ChromeText, modifier = Modifier.size(20.dp))
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(
                                when (state) {
                                    SessionState.CONNECTED -> Color(0xFF47CD89)
                                    SessionState.CONNECTING -> Color(0xFFFDB022)
                                    SessionState.ERROR -> Color(0xFFF97066)
                                    SessionState.DISCONNECTED -> ChromeSecondary
                                },
                            ),
                    )
                    Spacer(Modifier.width(7.dp))
                    Text(
                        title,
                        style = MaterialTheme.typography.titleSmall,
                        color = ChromeText,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    subtitle,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                    color = ChromeSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(
                Modifier.size(48.dp).clip(CircleShape).clickableQuiet(onOpenFiles),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.FolderOpen, contentDescription = "SFTP 文件", tint = ChromeSecondary, modifier = Modifier.size(21.dp))
            }
            Box(
                Modifier.size(48.dp).clip(CircleShape).clickableQuiet(onMenu),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "更多操作", tint = ChromeSecondary, modifier = Modifier.size(21.dp))
            }
        }
    }
}

@Composable
private fun SessionTabs(
    sessions: List<com.fluentssh.mobile.ssh.TerminalSession>,
    selectedId: String,
    onSelect: (String) -> Unit,
    onNew: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(ChromeBackground)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        sessions.forEach { session ->
            val selected = session.id == selectedId
            Box(
                Modifier
                    .height(48.dp)
                    .padding(vertical = 6.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(if (selected) Color(0xFF1E2A38) else Color.Transparent)
                    .clickableQuiet { onSelect(session.id) }
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    session.host.name,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (selected) ChromeText else ChromeSecondary,
                    maxLines = 1,
                )
            }
        }
        Box(
            Modifier.size(48.dp).clip(CircleShape).clickableQuiet(onNew),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Add, contentDescription = "新建会话", tint = ChromeSecondary, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
private fun ExtraKeysBar(
    onKey: (TerminalKey) -> Unit,
    onPaste: () -> Unit,
    onKeyboard: () -> Unit,
) {
    val keys = listOf(
        TerminalKey.ESC,
        TerminalKey.TAB,
        TerminalKey.CTRL_C,
        TerminalKey.CTRL_D,
        TerminalKey.CTRL_L,
        TerminalKey.UP,
        TerminalKey.DOWN,
        TerminalKey.LEFT,
        TerminalKey.RIGHT,
        TerminalKey.HOME,
        TerminalKey.END,
        TerminalKey.PIPE,
        TerminalKey.DASH,
        TerminalKey.SLASH,
    )
    Column(Modifier.fillMaxWidth().background(ChromeSurface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 6.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            keys.forEach { key ->
                Box(
                    Modifier
                        .height(44.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF1B232D))
                        .clickableQuiet { onKey(key) }
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        key.label,
                        style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                        color = ChromeText,
                    )
                }
            }
            Box(
                Modifier
                    .height(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF1B232D))
                    .clickableQuiet(onPaste)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("粘贴", style = MaterialTheme.typography.labelMedium, color = ChromeText)
            }
            Box(
                Modifier
                    .height(44.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0xFF1B232D))
                    .clickableQuiet(onKeyboard)
                    .padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Keyboard, contentDescription = "键盘", tint = ChromeText, modifier = Modifier.size(18.dp))
            }
        }
    }
}
