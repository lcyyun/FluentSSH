package com.fluentssh.mobile.ssh

import com.fluentssh.mobile.data.AppStore
import com.fluentssh.mobile.data.AuthKind
import com.fluentssh.mobile.data.HostProfile

object SshTargets {
    fun fromHost(store: AppStore, host: HostProfile): SshTarget {
        val auth = when (host.authKind) {
            AuthKind.PASSWORD -> SshAuth.Password(store.hostPassword(host.id).orEmpty())
            AuthKind.PRIVATE_KEY -> {
                val key = store.findKey(host.keyId)
                    ?: throw SshException("该主机未选择有效的私钥，请编辑主机重新选择密钥。")
                val material = store.keyMaterial(key.id)
                    ?: throw SshException("私钥文件缺失，请重新导入密钥。")
                SshAuth.PrivateKey(material, store.keyPassphrase(key.id))
            }
            AuthKind.KEYBOARD_INTERACTIVE -> SshAuth.KeyboardInteractive
        }
        return SshTarget(
            hostname = host.hostname,
            port = host.port,
            username = host.username,
            auth = auth,
            keepAliveSeconds = if (host.keepAlive) store.data.value.settings.keepAliveSeconds else 0,
        )
    }
}

class StoreKnownHosts(private val store: AppStore) : KnownHostStore {
    override fun fingerprint(hostname: String, port: Int): String? =
        store.findKnownHost(hostname, port)?.fingerprint

    override fun touch(hostname: String, port: Int) {
        store.findKnownHost(hostname, port)?.let { store.touchKnownHost(it) }
    }

    override fun trust(hostname: String, port: Int, keyType: String, fingerprint: String) {
        store.trustKnownHost(hostname, port, keyType, fingerprint)
    }
}
