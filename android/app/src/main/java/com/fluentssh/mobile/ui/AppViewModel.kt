package com.fluentssh.mobile.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.fluentssh.mobile.FluentSshApp
import com.fluentssh.mobile.data.AppSettings
import com.fluentssh.mobile.data.HostGroup
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.data.Snippet
import com.fluentssh.mobile.data.SshKeyRecord
import com.fluentssh.mobile.data.TunnelConfig
import com.fluentssh.mobile.data.TunnelState
import com.fluentssh.mobile.data.newId
import com.fluentssh.mobile.ssh.SshException
import com.fluentssh.mobile.ssh.TerminalSession
import com.fluentssh.mobile.ui.theme.ThemeMode
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch

class AppViewModel(application: Application) : AndroidViewModel(application) {

    val container = (application as FluentSshApp).container
    val store = container.store
    val data = store.data
    val sessions = container.sessions.sessions
    val tunnelRuntime = container.tunnels.runtime
    val interaction = container.interaction

    private val _toasts = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val toasts: SharedFlow<String> = _toasts.asSharedFlow()

    fun toast(message: String) {
        _toasts.tryEmit(message)
    }

    val themeMode: ThemeMode
        get() = when (data.value.settings.theme) {
            "light" -> ThemeMode.LIGHT
            "dark" -> ThemeMode.DARK
            else -> ThemeMode.SYSTEM
        }

    // ------------------------------------------------------------------ hosts

    fun createHostTemplate(): HostProfile {
        val settings = data.value.settings
        return HostProfile(
            id = newId(),
            name = "",
            hostname = "",
            port = settings.defaultPort,
            username = settings.defaultUsername,
        )
    }

    fun saveHost(host: HostProfile, password: String?, passphrase: String?, isNew: Boolean) {
        store.upsertHost(host, password, passphrase)
        store.audit(
            category = "system",
            message = if (isNew) "新增主机 ${host.name}" else "更新主机 ${host.name}",
            hostLabel = host.name,
        )
        toast(if (isNew) "主机已保存" else "主机已更新")
    }

    fun deleteHost(host: HostProfile) {
        sessions.value.filter { it.host.id == host.id }.forEach { container.sessions.closeSession(it.id) }
        store.deleteHost(host.id)
        toast("已删除主机 ${host.name}")
    }

    fun toggleFavorite(host: HostProfile) {
        store.setFavorite(host.id, !host.favorite)
    }

    fun groupLabel(groupId: String?): String = store.groupName(groupId)

    fun upsertGroup(group: HostGroup) {
        store.upsertGroup(group)
    }

    fun deleteGroup(group: HostGroup) {
        store.deleteGroup(group.id)
    }

    // --------------------------------------------------------------- sessions

    fun connect(host: HostProfile): TerminalSession {
        store.audit(category = "connection", message = "正在连接 ${host.name}", hostLabel = host.name)
        return container.sessions.startSession(host)
    }

    fun closeSession(id: String) {
        container.sessions.closeSession(id)
    }

    fun closeAllSessions() {
        container.sessions.closeAll()
    }

    fun session(id: String?): TerminalSession? = container.sessions.session(id)

    // ---------------------------------------------------------------- tunnels

    fun saveTunnel(tunnel: TunnelConfig) {
        store.upsertTunnel(tunnel)
        toast(if (tunnel.name.isBlank()) "隧道已保存" else "隧道「${tunnel.name}」已保存")
    }

    fun deleteTunnel(tunnel: TunnelConfig) {
        container.tunnels.stop(tunnel.id)
        store.deleteTunnel(tunnel.id)
        toast("隧道已删除")
    }

    fun toggleTunnel(tunnel: TunnelConfig) {
        container.tunnels.toggle(tunnel.id)
    }

    fun startTunnel(tunnel: TunnelConfig) = container.tunnels.start(tunnel.id)

    fun stopTunnel(tunnel: TunnelConfig) = container.tunnels.stop(tunnel.id)

    fun tunnelState(id: String): com.fluentssh.mobile.ssh.TunnelRuntimeState =
        container.tunnels.stateOf(id)

    // ------------------------------------------------------------------- keys

    fun addKey(key: SshKeyRecord, materialPem: String?, passphrase: String?) {
        store.addKey(key, materialPem, passphrase)
        store.audit(category = "vault", message = "新增密钥 ${key.name}", detail = key.fingerprint)
        toast("密钥已保存")
    }

    fun deleteKey(key: SshKeyRecord) {
        store.deleteKey(key.id)
        toast("密钥已删除")
    }

    // ------------------------------------------------------------ known hosts

    fun removeKnownHost(id: String) {
        store.removeKnownHost(id)
        toast("已移除已知主机")
    }

    // ----------------------------------------------------------------- settings

    fun updateSettings(settings: AppSettings) {
        store.updateSettings(settings)
    }

    fun importSshConfig(text: String): Int {
        val count = store.importSshConfig(text)
        toast(if (count > 0) "已导入 $count 台主机" else "没有可导入的主机")
        return count
    }

    // ---------------------------------------------------------------- snippets

    fun saveSnippet(snippet: Snippet) {
        store.upsertSnippet(snippet)
        toast("片段已保存")
    }

    fun deleteSnippet(id: String) {
        store.deleteSnippet(id)
    }

    fun clearCommandHistory() {
        store.clearCommandHistory()
        toast("命令历史已清空")
    }

    // ------------------------------------------------------------------ audit

    fun clearAudit() {
        store.clearAudit()
        toast("审计日志已清空")
    }

    fun refreshRecordings() = store.refreshRecordings()

    fun deleteRecording(fileName: String) {
        store.deleteRecording(fileName)
        toast("录制已删除")
    }

    fun dismissKeyboardInteractive(values: List<String>?) = interaction.resolveKeyboardInteractive(values)

    fun dismissPassword(value: String?) = interaction.resolvePassword(value)

    fun dismissHostKey(trust: Boolean) = interaction.resolveHostKey(trust)

    fun runCommand(
        host: HostProfile,
        command: String,
        onResult: (com.fluentssh.mobile.data.CommandRecord) -> Unit,
        onError: (String) -> Unit,
        onFinished: () -> Unit,
    ) {
        viewModelScope.launch {
            try {
                val record = container.commands.run(host, command)
                onResult(record)
            } catch (e: SshException) {
                onError(e.message ?: "命令执行失败")
            } catch (e: Exception) {
                onError(e.message ?: "命令执行失败")
            } finally {
                onFinished()
            }
        }
    }

    companion object {
        fun factory(app: FluentSshApp): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = AppViewModel(app) as T
        }
    }
}
