package com.fluentssh.mobile.core

import android.content.Context
import com.fluentssh.mobile.data.AppStore
import com.fluentssh.mobile.service.SshForegroundService
import com.fluentssh.mobile.ssh.CommandRunner
import com.fluentssh.mobile.ssh.InteractionBridge
import com.fluentssh.mobile.ssh.KnownHostStore
import com.fluentssh.mobile.ssh.SessionManager
import com.fluentssh.mobile.ssh.StoreKnownHosts
import com.fluentssh.mobile.ssh.TunnelManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Manual dependency container: one store, one SSH interaction bridge, one
 * session/tunnel runtime for the whole application process.
 */
class AppContainer(val context: Context) {

    val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val store = AppStore(context, applicationScope)
    val interaction = InteractionBridge()
    val knownHosts: KnownHostStore = StoreKnownHosts(store)

    private fun refreshForegroundState() {
        SshForegroundService.update(
            context = context,
            sessions = sessions.sessions.value.size,
            tunnels = tunnels.runningCount(),
        )
    }

    val sessions = SessionManager(applicationScope, store, interaction, knownHosts) {
        refreshForegroundState()
    }

    val tunnels = TunnelManager(applicationScope, store, interaction, knownHosts) {
        refreshForegroundState()
    }

    val commands = CommandRunner(applicationScope, store, interaction, knownHosts)

    init {
        installSshCrypto()
        applicationScope.launch {
            store.loaded.first { it }
            delay(700)
            tunnels.startAutoStart()
        }
    }

    /**
     * JSch ships Ed25519 signature support in two flavours: a JCE variant that
     * requires Java 15+ APIs (not present on Android) and a BouncyCastle
     * lightweight variant. Point JSch at the BC implementation so modern
     * OpenSSH servers (ed25519 host keys are the default) work on Android.
     */
    private fun installSshCrypto() {
        if (com.fluentssh.mobile.BuildConfig.DEBUG) {
            runCatching {
                com.jcraft.jsch.JSch.setLogger(object : com.jcraft.jsch.Logger {
                    override fun isEnabled(level: Int): Boolean = level <= 1
                    override fun log(level: Int, message: String) {
                        if (level == 0) android.util.Log.d("JSch", message)
                        else android.util.Log.v("JSch", message)
                    }
                })
            }
        }
        runCatching {
            Class.forName("org.bouncycastle.crypto.signers.Ed25519Signer")
            com.jcraft.jsch.JSch.setConfig("ssh-ed25519", "com.jcraft.jsch.bc.SignatureEd25519")
            runCatching {
                Class.forName("org.bouncycastle.crypto.signers.Ed448Signer")
                com.jcraft.jsch.JSch.setConfig("ssh-ed448", "com.jcraft.jsch.bc.SignatureEd448")
            }
        }
    }
}
