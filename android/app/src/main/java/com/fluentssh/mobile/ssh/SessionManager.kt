package com.fluentssh.mobile.ssh

import com.fluentssh.mobile.data.AppStore
import com.fluentssh.mobile.data.AuditLevel
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.data.newId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Owns every live terminal session; sessions survive activity recreation. */
class SessionManager(
    private val scope: CoroutineScope,
    private val store: AppStore,
    private val interaction: InteractionBridge,
    private val knownHosts: KnownHostStore,
    private val onActiveChanged: () -> Unit = {},
) {
    private val _sessions = MutableStateFlow<List<TerminalSession>>(emptyList())
    val sessions: StateFlow<List<TerminalSession>> = _sessions.asStateFlow()

    fun startSession(host: HostProfile): TerminalSession {
        val settings = store.data.value.settings
        val session = TerminalSession(
            host = host,
            store = store,
            scope = scope,
            interaction = interaction,
            knownHosts = knownHosts,
            strictHostKeys = settings.strictHostKeys,
            recordSessions = settings.recordSessions,
            id = newId(),
        )
        _sessions.value = _sessions.value + session
        onActiveChanged()
        session.start()
        return session
    }

    fun closeSession(id: String) {
        val session = _sessions.value.firstOrNull { it.id == id } ?: return
        session.close()
        _sessions.value = _sessions.value.filterNot { it.id == id }
        onActiveChanged()
    }

    fun closeAll() {
        _sessions.value.forEach { it.close() }
        _sessions.value = emptyList()
        onActiveChanged()
    }

    fun session(id: String?): TerminalSession? = _sessions.value.firstOrNull { it.id == id }

    fun activeCount(): Int = _sessions.value.count {
        it.state.value == SessionState.CONNECTED || it.state.value == SessionState.CONNECTING
    }
}
