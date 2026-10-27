package com.fluentssh.mobile.ui.files

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.fluentssh.mobile.core.AppContainer
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.ssh.RemoteFile
import com.fluentssh.mobile.ssh.RemoteFileClient
import com.fluentssh.mobile.ssh.SshConnection
import com.fluentssh.mobile.ssh.SshTargets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class FilesUiState(
    val loading: Boolean = true,
    val path: String = "",
    val entries: List<RemoteFile> = emptyList(),
    val error: String? = null,
    val busyText: String? = null,
    val progress: Float? = null,
    val connected: Boolean = false,
)

class FilesViewModel(
    private val container: AppContainer,
    private val hostId: String,
) : ViewModel() {

    val host: HostProfile? = container.store.findHost(hostId)

    private var connection: SshConnection? = null
    private var remote: RemoteFileClient? = null

    private val _state = MutableStateFlow(FilesUiState())
    val state: StateFlow<FilesUiState> = _state.asStateFlow()

    init {
        connect()
    }

    private fun connect() {
        val host = host ?: run {
            _state.value = FilesUiState(loading = false, error = "主机不存在")
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                withContext(Dispatchers.IO) {
                    val settings = container.store.data.value.settings
                    val conn = SshConnection(
                        target = SshTargets.fromHost(container.store, host),
                        interaction = container.interaction,
                        knownHosts = container.knownHosts,
                        scope = viewModelScope,
                        strictHostKeys = settings.strictHostKeys,
                    )
                    conn.connect()
                    connection = conn
                    remote = conn.openSftp()
                }
                container.store.audit(category = "sftp", message = "SFTP 已连接 ${host.name}", hostLabel = host.name)
                val startPath = host.defaultPath.trim().ifBlank {
                    withContext(Dispatchers.IO) { remote?.homePath() ?: "/" }
                }
                load(startPath)
            } catch (e: Exception) {
                _state.value = FilesUiState(loading = false, connected = false, error = e.message ?: "SFTP 连接失败")
                container.store.audit(
                    category = "sftp",
                    level = com.fluentssh.mobile.data.AuditLevel.ERROR,
                    message = "SFTP 连接失败 ${host.name}：${e.message}",
                    hostLabel = host.name,
                )
            }
        }
    }

    fun retry() = connect()

    fun load(path: String) {
        val client = remote ?: run {
            connect()
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                val entries = withContext(Dispatchers.IO) { client.list(path) }
                _state.value = _state.value.copy(
                    loading = false,
                    connected = true,
                    path = path,
                    entries = entries,
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.message ?: "读取目录失败")
            }
        }
    }

    fun refresh() {
        val path = _state.value.path
        if (path.isNotBlank()) load(path)
    }

    fun open(entry: RemoteFile) {
        if (entry.isDirectory) load(entry.path)
    }

    fun navigateUp() {
        val path = _state.value.path.trimEnd('/')
        if (path.isEmpty() || path == "/") return
        load(path.substringBeforeLast('/', "").ifBlank { "/" })
    }

    fun navigateTo(path: String) {
        if (path.isNotBlank()) load(path)
    }

    fun createFolder(name: String) {
        val client = remote ?: return
        val parent = _state.value.path
        viewModelScope.launch {
            _state.value = _state.value.copy(busyText = "正在创建文件夹…")
            try {
                val target = joinPath(parent, name)
                withContext(Dispatchers.IO) { client.mkdir(target) }
                container.store.audit(category = "sftp", message = "新建目录 $target", hostLabel = host?.name)
                toast("文件夹已创建")
                load(parent)
            } catch (e: Exception) {
                toast("创建失败：${e.message}")
            } finally {
                _state.value = _state.value.copy(busyText = null)
            }
        }
    }

    fun rename(entry: RemoteFile, newName: String) {
        val client = remote ?: return
        val parent = _state.value.path
        viewModelScope.launch {
            _state.value = _state.value.copy(busyText = "正在重命名…")
            try {
                withContext(Dispatchers.IO) { client.rename(entry.path, joinPath(parent, newName)) }
                toast("已重命名")
                load(parent)
            } catch (e: Exception) {
                toast("重命名失败：${e.message}")
            } finally {
                _state.value = _state.value.copy(busyText = null)
            }
        }
    }

    fun delete(entry: RemoteFile) {
        val client = remote ?: return
        val parent = _state.value.path
        viewModelScope.launch {
            _state.value = _state.value.copy(busyText = "正在删除…")
            try {
                withContext(Dispatchers.IO) {
                    if (entry.isDirectory) client.deleteRecursive(entry.path) else client.delete(entry.path)
                }
                container.store.audit(category = "sftp", message = "删除 ${entry.path}", hostLabel = host?.name)
                toast("已删除 ${entry.name}")
                load(parent)
            } catch (e: Exception) {
                toast("删除失败：${e.message}")
            } finally {
                _state.value = _state.value.copy(busyText = null)
            }
        }
    }

    fun upload(uri: Uri, displayName: String, size: Long) {
        val client = remote ?: return
        val target = joinPath(_state.value.path, displayName)
        val resolver = container.context.contentResolver
        viewModelScope.launch {
            _state.value = _state.value.copy(busyText = "正在上传 $displayName", progress = 0f)
            try {
                withContext(Dispatchers.IO) {
                    resolver.openInputStream(uri)?.use { input ->
                        client.upload(input, target, size) { sent, total ->
                            val fraction = if (total > 0) sent.toFloat() / total else null
                            _state.value = _state.value.copy(progress = fraction)
                        }
                    } ?: throw IllegalStateException("无法读取所选文件")
                }
                container.store.audit(category = "sftp", message = "上传 $target", hostLabel = host?.name)
                toast("上传完成")
                load(_state.value.path)
            } catch (e: Exception) {
                toast("上传失败：${e.message}")
            } finally {
                _state.value = _state.value.copy(busyText = null, progress = null)
            }
        }
    }

    fun download(entry: RemoteFile, uri: Uri) {
        val client = remote ?: return
        val resolver = container.context.contentResolver
        viewModelScope.launch {
            _state.value = _state.value.copy(busyText = "正在下载 ${entry.name}", progress = 0f)
            try {
                withContext(Dispatchers.IO) {
                    resolver.openOutputStream(uri)?.use { output ->
                        client.download(entry.path, output) { received, total ->
                            val fraction = if (total > 0) received.toFloat() / total else null
                            _state.value = _state.value.copy(progress = fraction)
                        }
                    } ?: throw IllegalStateException("无法写入所选位置")
                }
                toast("下载完成")
            } catch (e: Exception) {
                toast("下载失败：${e.message}")
            } finally {
                _state.value = _state.value.copy(busyText = null, progress = null)
            }
        }
    }

    private fun toast(message: String) {
        _state.value = _state.value.copy(error = _state.value.error)
        messages.tryEmit(message)
    }

    private val messages = kotlinx.coroutines.flow.MutableSharedFlow<String>(extraBufferCapacity = 8)
    val toastMessages: kotlinx.coroutines.flow.SharedFlow<String> = messages

    override fun onCleared() {
        runCatching { remote?.close() }
        runCatching { connection?.close() }
        remote = null
        connection = null
        super.onCleared()
    }

    companion object {
        fun factory(container: AppContainer, hostId: String) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = FilesViewModel(container, hostId) as T
        }
    }
}

fun joinPath(parent: String, name: String): String {
    if (name.isEmpty()) return parent
    if (name.startsWith("/")) return name
    return if (parent.endsWith("/")) parent + name else "$parent/$name"
}

data class EditorUiState(
    val loading: Boolean = true,
    val text: String = "",
    val originalText: String = "",
    val saving: Boolean = false,
    val error: String? = null,
    val loaded: Boolean = false,
) {
    val dirty: Boolean get() = loaded && text != originalText
}

class FileEditorViewModel(
    private val container: AppContainer,
    private val hostId: String,
    val path: String,
) : ViewModel() {
    private var connection: SshConnection? = null
    private var remote: RemoteFileClient? = null

    private val _state = MutableStateFlow(EditorUiState())
    val state: StateFlow<EditorUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val host = container.store.findHost(hostId)
            if (host == null) {
                _state.value = EditorUiState(loading = false, error = "主机不存在")
                return@launch
            }
            try {
                val content = withContext(Dispatchers.IO) {
                    val settings = container.store.data.value.settings
                    val conn = SshConnection(
                        target = SshTargets.fromHost(container.store, host),
                        interaction = container.interaction,
                        knownHosts = container.knownHosts,
                        scope = viewModelScope,
                        strictHostKeys = settings.strictHostKeys,
                    )
                    conn.connect()
                    connection = conn
                    val client = conn.openSftp()
                    remote = client
                    client.readText(path)
                }
                _state.value = EditorUiState(loading = false, text = content, originalText = content, loaded = true)
            } catch (e: Exception) {
                _state.value = EditorUiState(loading = false, error = e.message ?: "读取文件失败")
            }
        }
    }

    fun update(text: String) {
        _state.value = _state.value.copy(text = text)
    }

    fun save(onSaved: () -> Unit) {
        val client = remote ?: return
        val current = _state.value
        if (current.saving) return
        viewModelScope.launch {
            _state.value = _state.value.copy(saving = true, error = null)
            try {
                withContext(Dispatchers.IO) { client.writeText(path, current.text) }
                _state.value = _state.value.copy(saving = false, originalText = current.text)
                container.store.audit(category = "sftp", message = "保存远程文件 $path")
                onSaved()
            } catch (e: Exception) {
                _state.value = _state.value.copy(saving = false, error = e.message ?: "保存失败")
            }
        }
    }

    override fun onCleared() {
        runCatching { remote?.close() }
        runCatching { connection?.close() }
        super.onCleared()
    }

    companion object {
        fun factory(container: AppContainer, hostId: String, path: String) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = FileEditorViewModel(container, hostId, path) as T
        }
    }
}
