package com.fluentssh.mobile.ssh

import com.fluentssh.mobile.data.AppStore
import com.fluentssh.mobile.data.AuditLevel
import com.fluentssh.mobile.data.TunnelConfig
import com.fluentssh.mobile.data.TunnelKind
import com.fluentssh.mobile.data.TunnelState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class TunnelRuntimeState(
    val state: TunnelState = TunnelState.STOPPED,
    val error: String? = null,
    val connections: Int = 0,
)

class TunnelManager(
    private val scope: CoroutineScope,
    private val store: AppStore,
    private val interaction: InteractionBridge,
    private val knownHosts: KnownHostStore,
    private val onActiveChanged: () -> Unit = {},
) {
    private data class LiveTunnel(
        val connection: SshConnection,
        val forward: ForwardHandle,
        val pollJob: Job,
    )

    private val _runtime = MutableStateFlow<Map<String, TunnelRuntimeState>>(emptyMap())
    val runtime: StateFlow<Map<String, TunnelRuntimeState>> = _runtime.asStateFlow()

    private val live = mutableMapOf<String, LiveTunnel>()
    private val lock = Any()

    fun start(tunnelId: String) {
        val tunnel = store.data.value.tunnels.firstOrNull { it.id == tunnelId } ?: return
        synchronized(lock) {
            if (live.containsKey(tunnelId)) return
            _runtime.value = _runtime.value + (tunnelId to TunnelRuntimeState(state = TunnelState.STARTING))
        }
        scope.launch {
            try {
                val host = store.findHost(tunnel.hostId)
                    ?: throw SshException("隧道绑定的主机已不存在。")
                val settings = store.data.value.settings
                val connection = SshConnection(
                    target = SshTargets.fromHost(store, host),
                    interaction = interaction,
                    knownHosts = knownHosts,
                    scope = scope,
                    strictHostKeys = settings.strictHostKeys,
                )
                withContext(Dispatchers.IO) { connection.connect() }
                val forward = withContext(Dispatchers.IO) {
                    when (tunnel.kind) {
                        TunnelKind.LOCAL -> connection.startLocalForward(
                            tunnel.bindHost.ifBlank { "127.0.0.1" },
                            tunnel.bindPort,
                            tunnel.targetHost.ifBlank { "127.0.0.1" },
                            tunnel.targetPort,
                        )
                        TunnelKind.DYNAMIC -> connection.startSocksForward(
                            tunnel.bindHost.ifBlank { "127.0.0.1" },
                            tunnel.bindPort,
                        )
                        TunnelKind.REMOTE -> connection.startRemoteForward(
                            tunnel.bindHost.ifBlank { "127.0.0.1" },
                            tunnel.bindPort,
                            tunnel.targetHost.ifBlank { "127.0.0.1" },
                            tunnel.targetPort,
                        )
                    }
                }
                synchronized(lock) {
                    if (!live.containsKey(tunnelId)) {
                        live[tunnelId] = LiveTunnel(connection, forward, pollConnections(tunnelId, forward))
                        _runtime.value = _runtime.value + (tunnelId to TunnelRuntimeState(TunnelState.RUNNING))
                    }
                }
                onActiveChanged()
                store.audit(
                    category = "tunnel",
                    message = "隧道已启动 ${tunnel.name}，${tunnel.routeLabel}",
                    hostLabel = host.name,
                )
            } catch (e: Exception) {
                runCatching { _runtime.value = _runtime.value + (tunnelId to TunnelRuntimeState(TunnelState.ERROR, e.message)) }
                onActiveChanged()
                store.audit(
                    category = "tunnel",
                    level = AuditLevel.ERROR,
                    message = "隧道启动失败 ${tunnel.name}：${e.message}",
                )
            }
        }
    }

    private fun pollConnections(tunnelId: String, forward: ForwardHandle): Job = scope.launch {
        while (true) {
            delay(1500)
            val current = _runtime.value[tunnelId] ?: break
            _runtime.value = _runtime.value + (tunnelId to current.copy(connections = forward.connectionCount))
        }
    }

    fun stop(tunnelId: String) {
        val tunnel = store.data.value.tunnels.firstOrNull { it.id == tunnelId }
        val removed = synchronized(lock) { live.remove(tunnelId) }
        removed?.let {
            it.pollJob.cancel()
            runCatching { it.forward.close() }
            runCatching { it.connection.close() }
        }
        _runtime.value = _runtime.value + (tunnelId to TunnelRuntimeState(TunnelState.STOPPED))
        onActiveChanged()
        if (tunnel != null) {
            store.audit(category = "tunnel", message = "隧道已停止 ${tunnel.name}")
        }
    }

    fun toggle(tunnelId: String) {
        val state = _runtime.value[tunnelId]?.state
        if (state == TunnelState.RUNNING || state == TunnelState.STARTING) {
            stop(tunnelId)
        } else {
            start(tunnelId)
        }
    }

    fun startAutoStart() {
        scope.launch {
            delay(1000)
            store.data.value.tunnels.filter { it.autoStart }.forEach { tunnel ->
                start(tunnel.id)
                delay(250)
            }
        }
    }

    fun stopAll() {
        synchronized(lock) { live.keys.toList() }.forEach { stop(it) }
    }

    fun runningCount(): Int = synchronized(lock) { live.size }

    fun stateOf(tunnelId: String): TunnelRuntimeState =
        _runtime.value[tunnelId] ?: TunnelRuntimeState()
}
