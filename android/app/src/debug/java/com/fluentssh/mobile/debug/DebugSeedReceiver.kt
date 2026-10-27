package com.fluentssh.mobile.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.fluentssh.mobile.FluentSshApp
import com.fluentssh.mobile.data.AppSettings
import com.fluentssh.mobile.data.AuditLevel
import com.fluentssh.mobile.data.CommandRecord
import com.fluentssh.mobile.data.HostGroup
import com.fluentssh.mobile.data.HostProfile
import com.fluentssh.mobile.data.KnownHostRecord
import com.fluentssh.mobile.data.Snippet
import com.fluentssh.mobile.data.SshKeyRecord
import com.fluentssh.mobile.data.TunnelConfig
import com.fluentssh.mobile.data.TunnelKind
import com.fluentssh.mobile.data.newId
import com.fluentssh.mobile.ssh.KeyService

/**
 * Debug-only QA seed. Never present in release builds.
 * `adb shell am broadcast -a com.fluentssh.mobile.DEBUG_SEED -n com.fluentssh.mobile/.debug.DebugSeedReceiver`
 */
class DebugSeedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as FluentSshApp
        val store = app.container.store
        val action = intent.getStringExtra("seed") ?: "demo"
        val clear = intent.getBooleanExtra("clear", false)
        val pending = goAsync()
        Thread {
            try {
                var guard = 0
                while (!store.loaded.value && guard < 100) {
                    Thread.sleep(100)
                    guard++
                }
                if (clear) {
                    clearData(store)
                    Thread.sleep(800)
                    return@Thread
                }
                when (action) {
                    "demo" -> seed(store)
                    "extra" -> addDirectHost(store)
                }
                Thread.sleep(1500)
                Log.i(TAG, "debug seed finished: $action")
            } catch (error: Exception) {
                Log.e(TAG, "debug seed failed", error)
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun addDirectHost(store: com.fluentssh.mobile.data.AppStore) {
        val existing = store.data.value.hosts.firstOrNull { it.name == "直连 Mock SSH" }
        if (existing != null) return
        val host = HostProfile(
            id = newId(),
            name = "直连 Mock SSH",
            hostname = "10.0.2.2",
            port = 53652,
            username = "demo",
            tagsText = "直连,调试",
            startupCommand = "uname -a",
        )
        store.upsertHost(host, password = "demo123", passphrase = null)
        store.trustKnownHost(
            hostname = "10.0.2.2",
            port = 53652,
            keyType = "ssh-ed25519",
            fingerprint = "SHA256:sBcmBa7Be2NDR1I5wXJ8Acs3YXZyETx5cy7QuuwrHZA",
        )
    }

    private fun clearData(store: com.fluentssh.mobile.data.AppStore) {
        store.data.value.hosts.forEach { store.deleteHost(it.id) }
        store.data.value.groups.forEach { store.deleteGroup(it.id) }
        store.data.value.keys.forEach { store.deleteKey(it.id) }
        store.data.value.tunnels.forEach { store.deleteTunnel(it.id) }
        store.data.value.snippets.forEach { store.deleteSnippet(it.id) }
        store.data.value.knownHosts.forEach { store.removeKnownHost(it.id) }
        store.clearCommandHistory()
        store.clearAudit()
    }

    private fun seed(store: com.fluentssh.mobile.data.AppStore) {
        val data = store.data.value
        if (data.hosts.isNotEmpty()) return

        val prodGroup = HostGroup(id = newId(), name = "生产环境")
        val testGroup = HostGroup(id = newId(), name = "测试环境")
        store.upsertGroup(prodGroup)
        store.upsertGroup(testGroup)

        val terminalHost = HostProfile(
            id = newId(),
            name = "生产 Web 服务器",
            hostname = "10.0.2.2",
            port = 53652,
            username = "demo",
            groupId = prodGroup.id,
            favorite = true,
            tagsText = "生产,nginx",
            startupCommand = "uname -a",
            lastConnectedAt = System.currentTimeMillis() - 12 * 60_000L,
            connectCount = 27,
            notes = "演示用 mock SSH 服务器",
        )
        store.upsertHost(terminalHost, password = "demo123", passphrase = null)

        val sftpHost = HostProfile(
            id = newId(),
            name = "Mock SFTP 文件服务",
            hostname = "10.0.2.2",
            port = 53654,
            username = "demo",
            groupId = testGroup.id,
            tagsText = "测试,文件",
            defaultPath = "/",
            lastConnectedAt = System.currentTimeMillis() - 3 * 60 * 60_000L,
            connectCount = 8,
        )
        store.upsertHost(sftpHost, password = "demo123", passphrase = null)

        val stagingHost = HostProfile(
            id = newId(),
            name = "跳板机 · Staging",
            hostname = "10.0.2.2",
            port = 53652,
            username = "demo",
            groupId = testGroup.id,
            tagsText = "预发,跳板",
            authKind = com.fluentssh.mobile.data.AuthKind.PASSWORD,
            lastConnectedAt = System.currentTimeMillis() - 2 * 86_400_000L,
            connectCount = 3,
        )
        store.upsertHost(stagingHost, password = "demo123", passphrase = null)

        runCatching {
            val generated = KeyService.generateRsa(
                bits = 3072,
                comment = "工作笔记本",
                passphrase = null,
            )
            store.addKey(
                SshKeyRecord(
                    id = newId(),
                    name = "工作笔记本",
                    algorithm = "RSA",
                    bits = generated.bits,
                    publicKey = generated.publicKeyOpenSsh,
                    fingerprint = generated.fingerprint,
                    generatedByApp = true,
                ),
                materialPem = generated.privateKeyPem,
                passphrase = null,
            )
        }

        store.upsertTunnel(
            TunnelConfig(
                id = newId(),
                name = "内网 HTTP 预览",
                hostId = terminalHost.id,
                kind = TunnelKind.LOCAL,
                bindHost = "127.0.0.1",
                bindPort = 18080,
                targetHost = "127.0.0.1",
                targetPort = 53655,
                autoStart = true,
            ),
        )
        store.upsertTunnel(
            TunnelConfig(
                id = newId(),
                name = "MySQL 只读实例",
                hostId = terminalHost.id,
                kind = TunnelKind.LOCAL,
                bindHost = "127.0.0.1",
                bindPort = 13306,
                targetHost = "127.0.0.1",
                targetPort = 3306,
                autoStart = false,
            ),
        )
        store.upsertTunnel(
            TunnelConfig(
                id = newId(),
                name = "内网代理",
                hostId = stagingHost.id,
                kind = TunnelKind.DYNAMIC,
                bindHost = "127.0.0.1",
                bindPort = 1080,
                targetHost = "127.0.0.1",
                targetPort = 0,
                autoStart = false,
            ),
        )

        store.upsertSnippet(
            Snippet(id = newId(), name = "系统信息", command = "uname -a", description = "查看系统版本与内核"),
        )
        store.upsertSnippet(
            Snippet(id = newId(), name = "磁盘占用", command = "df -h", description = "查看磁盘空间"),
        )
        store.upsertSnippet(
            Snippet(id = newId(), name = "当前用户", command = "whoami", description = "确认登录身份"),
        )

        store.addCommandRecord(
            CommandRecord(
                id = newId(),
                hostId = terminalHost.id,
                hostLabel = terminalHost.name,
                command = "uname -a",
                output = "Linux mock 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux\n",
                exitCode = 0,
                startedAt = System.currentTimeMillis() - 15 * 60_000L,
                durationMs = 312,
            ),
        )
        store.addCommandRecord(
            CommandRecord(
                id = newId(),
                hostId = stagingHost.id,
                hostLabel = stagingHost.name,
                command = "df -h",
                output = "Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda1        80G   31G   45G  41% /\n",
                exitCode = 0,
                startedAt = System.currentTimeMillis() - 2 * 3_600_000L,
                durationMs = 188,
            ),
        )

        store.audit(category = "connection", message = "已连接 生产 Web 服务器", hostLabel = terminalHost.name)
        store.audit(category = "sftp", message = "上传 /var/www/release.tar.gz", hostLabel = terminalHost.name)
        store.audit(category = "security", level = AuditLevel.WARNING, message = "已拒绝 10.0.0.8:22 的主机密钥", hostLabel = "旧测试机")
        store.audit(category = "tunnel", message = "隧道已启动 内网 HTTP 预览，127.0.0.1:18080 → 127.0.0.1:53655", hostLabel = terminalHost.name)
        store.audit(category = "command", message = "在 生产 Web 服务器 执行命令，退出码 0", hostLabel = terminalHost.name, detail = "uname -a")

        store.upsertKnownHost(
            KnownHostRecord(
                hostname = "10.0.2.2",
                port = 53652,
                keyType = "ssh-ed25519",
                fingerprint = "SHA256:sBcmBa7Be2NDR1I5wXJ8Acs3YXZyETx5cy7QuuwrHZA",
            ),
        )
        store.upsertKnownHost(
            KnownHostRecord(
                hostname = "10.0.2.2",
                port = 53654,
                keyType = "ssh-ed25519",
                fingerprint = "SHA256:fPwNpqAtkamnIFs8L9XjFu+UtrQ/2XZnyUe69e2LRmU",
            ),
        )

        store.updateSettings(
            AppSettings(
                theme = "system",
                terminalFontSize = 14,
                defaultUsername = "demo",
                defaultPort = 22,
                keepAliveSeconds = 30,
                strictHostKeys = true,
                recordSessions = true,
                showHiddenFiles = false,
            ),
        )
    }

    private fun com.fluentssh.mobile.data.AppStore.upsertKnownHost(record: KnownHostRecord) {
        trustKnownHost(record.hostname, record.port, record.keyType, record.fingerprint)
    }

    companion object {
        private const val TAG = "DebugSeed"
    }
}

