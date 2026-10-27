package com.fluentssh.mobile.ssh

import com.fluentssh.mobile.data.AppStore
import com.fluentssh.mobile.data.AuditLevel
import com.fluentssh.mobile.data.CommandRecord
import com.fluentssh.mobile.data.HostProfile
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Runs one-off remote commands on a short-lived connection. */
class CommandRunner(
    private val scope: CoroutineScope,
    private val store: AppStore,
    private val interaction: InteractionBridge,
    private val knownHosts: KnownHostStore,
) {
    suspend fun run(host: HostProfile, command: String, timeoutMs: Long = 120_000): CommandRecord {
        val started = System.currentTimeMillis()
        val settings = store.data.value.settings
        val record = try {
            withContext(Dispatchers.IO) {
                val connection = SshConnection(
                    target = SshTargets.fromHost(store, host),
                    interaction = interaction,
                    knownHosts = knownHosts,
                    scope = scope,
                    strictHostKeys = settings.strictHostKeys,
                )
                try {
                    connection.connect()
                    val result = connection.exec(command, timeoutMs)
                    CommandRecord(
                        hostId = host.id,
                        hostLabel = host.name,
                        command = command,
                        output = result.output,
                        error = result.error,
                        exitCode = result.exitCode,
                        startedAt = started,
                        durationMs = result.durationMs,
                    )
                } finally {
                    connection.close()
                }
            }
        } catch (e: Exception) {
            CommandRecord(
                hostId = host.id,
                hostLabel = host.name,
                command = command,
                error = e.message ?: "命令执行失败",
                startedAt = started,
                durationMs = System.currentTimeMillis() - started,
            )
        }
        store.addCommandRecord(record)
        store.audit(
            category = "command",
            level = if (record.exitCode == 0) AuditLevel.INFO else AuditLevel.WARNING,
            message = "在 ${host.name} 执行命令，退出码 ${record.exitCode ?: "—"}",
            hostLabel = host.name,
            detail = command.take(160),
        )
        return record
    }
}
