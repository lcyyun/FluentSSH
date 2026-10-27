package com.fluentssh.mobile.ssh

import com.fluentssh.mobile.data.AppStore
import com.fluentssh.mobile.data.AuditLevel
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.data.newId
import com.fluentssh.mobile.terminal.TerminalEmulator
import com.fluentssh.mobile.terminal.TerminalSnapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

enum class SessionState { CONNECTING, CONNECTED, DISCONNECTED, ERROR }

private const val TAG = "TerminalSession"

/** One live interactive SSH shell plus its terminal buffer and optional recorder. */
class TerminalSession(
    val host: HostProfile,
    private val store: AppStore,
    private val scope: CoroutineScope,
    private val interaction: SshInteraction,
    private val knownHosts: KnownHostStore,
    private val strictHostKeys: Boolean,
    private val recordSessions: Boolean,
    val id: String = newId(),
) {
    val emulator = TerminalEmulator()
    val startedAt: Long = System.currentTimeMillis()

    private val _state = MutableStateFlow(SessionState.CONNECTING)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _version = MutableStateFlow(0L)
    val version: StateFlow<Long> = _version.asStateFlow()

    private var connection: SshConnection? = null
    private var shell: ShellHandle? = null
    private var recorder: FileOutputStream? = null
    private var recordingFile: File? = null
    private var cols = 80
    private var rows = 24

    val title: String get() = host.name

    fun start() {
        scope.launch(Dispatchers.IO) {
            try {
                _state.value = SessionState.CONNECTING
                val target = buildTarget()
                val conn = SshConnection(
                    target = target,
                    interaction = interaction,
                    knownHosts = knownHosts,
                    scope = scope,
                    strictHostKeys = strictHostKeys,
                )
                connection = conn
                conn.connect()
                shell = conn.openShell(
                    cols = cols,
                    rows = rows,
                    onData = { bytes -> onShellData(bytes) },
                    onClosed = { reason -> onShellClosed(reason) },
                )
                _state.value = SessionState.CONNECTED
                store.touchConnected(host.id)
                store.audit(
                    category = "connection",
                    message = "已连接 ${host.name}",
                    hostLabel = host.name,
                )
                openRecorderIfNeeded()
                startResponsePump()
                if (host.startupCommand.isNotBlank()) {
                    shell?.write((host.startupCommand + "\r").toByteArray(Charsets.UTF_8))
                }
            } catch (e: Exception) {
                android.util.Log.e(TAG, "terminal connect failed host=${host.name}", e)
                _error.value = e.message ?: "连接失败"
                _state.value = SessionState.ERROR
                store.audit(
                    category = "connection",
                    level = AuditLevel.ERROR,
                    message = "连接失败 ${host.name}：${e.message}",
                    hostLabel = host.name,
                )
                close()
            }
        }
    }

    private fun buildTarget(): SshTarget {
        val auth = when (host.authKind) {
            com.fluentssh.mobile.data.AuthKind.PASSWORD -> {
                val password = store.hostPassword(host.id) ?: ""
                SshAuth.Password(password)
            }
            com.fluentssh.mobile.data.AuthKind.PRIVATE_KEY -> {
                val key = store.findKey(host.keyId)
                val material = key?.let { store.keyMaterial(it.id) }
                    ?: throw SshException("该主机未选择有效的私钥，请编辑主机重新选择密钥。")
                SshAuth.PrivateKey(material, store.keyPassphrase(key.id))
            }
            com.fluentssh.mobile.data.AuthKind.KEYBOARD_INTERACTIVE -> SshAuth.KeyboardInteractive
        }
        return SshTarget(
            hostname = host.hostname,
            port = host.port,
            username = host.username,
            auth = auth,
            keepAliveSeconds = store.data.value.settings.keepAliveSeconds.takeIf { host.keepAlive } ?: 0,
        )
    }

    private var bytesReceived: Long = 0
    private var bytesWritten: Long = 0

    private fun onShellData(bytes: ByteArray) {
        bytesReceived += bytes.size
        emulator.feed(bytes)
        _version.value = emulator.version
        runCatching { recorder?.write(bytes) }
    }

    private fun onShellClosed(reason: String?) {
        if (_state.value == SessionState.DISCONNECTED) return
        android.util.Log.w(
            TAG,
            "shell closed host=${host.name} reason=${reason ?: "EOF"} " +
                "sessionConnected=${connection?.isConnected} shellOpen=${shell?.isOpen} " +
                "bytesOut=${bytesWritten} bytesIn=${bytesReceived}",
        )
        _state.value = SessionState.DISCONNECTED
        if (!reason.isNullOrBlank()) _error.value = reason
        finishRecorder()
        store.audit(
            category = "connection",
            message = "已断开 ${host.name}",
            hostLabel = host.name,
            detail = reason,
        )
    }

    private fun startResponsePump() {
        scope.launch(Dispatchers.IO) {
            while (true) {
                val responses = emulator.drainResponses()
                if (responses.isEmpty()) {
                    kotlinx.coroutines.delay(120)
                } else {
                    responses.forEach { runCatching { shell?.write(it) } }
                }
            }
        }
    }

    private fun openRecorderIfNeeded() {
        if (!recordSessions) return
        runCatching {
            val file = store.newRecordingFile(host.name)
            recordingFile = file
            recorder = FileOutputStream(file, true)
        }
    }

    private fun finishRecorder() {
        runCatching { recorder?.flush(); recorder?.close() }
        recorder = null
        if (recordingFile != null) store.refreshRecordings()
    }

    fun write(bytes: ByteArray) {
        val handle = shell ?: return
        bytesWritten += bytes.size
        runCatching { handle.write(bytes) }
    }

    fun sendText(text: String) = write(text.toByteArray(Charsets.UTF_8))

    fun sendKey(key: TerminalKey) = write(key.bytes)

    fun resize(newCols: Int, newRows: Int) {
        if (newCols == cols && newRows == rows) return
        cols = newCols.coerceIn(20, 300)
        rows = newRows.coerceIn(6, 200)
        emulator.resize(cols, rows)
        _version.value = emulator.version
        runCatching { shell?.resize(cols, rows) }
    }

    fun reconnect() {
        close()
        emulator.reset()
        _version.value = emulator.version
        _error.value = null
        start()
    }

    fun clearScreen() {
        emulator.clear()
        _version.value = emulator.version
    }

    fun snapshot(): TerminalSnapshot = emulator.snapshot()

    fun close() {
        android.util.Log.i(TAG, "closing session host=${host.name}")
        runCatching { shell?.close() }
        shell = null
        runCatching { connection?.close() }
        connection = null
        finishRecorder()
        if (_state.value != SessionState.ERROR) _state.value = SessionState.DISCONNECTED
    }
}

/** Common keys the terminal extra-keys bar sends, matching xterm conventions. */
enum class TerminalKey(val bytes: ByteArray, val label: String) {
    ESC(byteArrayOf(0x1b), "Esc"),
    TAB(byteArrayOf(0x09), "Tab"),
    CTRL_C(byteArrayOf(0x03), "Ctrl+C"),
    CTRL_D(byteArrayOf(0x04), "Ctrl+D"),
    CTRL_L(byteArrayOf(0x0c), "Ctrl+L"),
    CTRL_Z(byteArrayOf(0x1a), "Ctrl+Z"),
    UP(byteArrayOf(0x1b, '['.code.toByte(), 'A'.code.toByte()), "↑"),
    DOWN(byteArrayOf(0x1b, '['.code.toByte(), 'B'.code.toByte()), "↓"),
    RIGHT(byteArrayOf(0x1b, '['.code.toByte(), 'C'.code.toByte()), "→"),
    LEFT(byteArrayOf(0x1b, '['.code.toByte(), 'D'.code.toByte()), "←"),
    HOME(byteArrayOf(0x1b, '['.code.toByte(), 'H'.code.toByte()), "Home"),
    END(byteArrayOf(0x1b, '['.code.toByte(), 'F'.code.toByte()), "End"),
    PIPE(byteArrayOf('|'.code.toByte()), "|"),
    DASH(byteArrayOf('-'.code.toByte()), "-"),
    SLASH(byteArrayOf('/'.code.toByte()), "/"),
}
