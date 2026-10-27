package com.fluentssh.mobile.ssh

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.ChannelShell
import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.JSch
import com.jcraft.jsch.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock

/**
 * 一条 SSH 连接及其 Shell / Exec / SFTP / 端口转发能力。
 *
 * - 纯 Kotlin/JVM 实现，可在 Android 与 JVM 单元测试中运行；
 * - 主机密钥校验完全通过 [KnownHostStore] + [SshInteraction.confirmHostKey] 完成，不依赖 Android UI；
 * - [connect] 是阻塞调用，失败时抛出带中文提示的 [SshException]；
 * - 所有资源在 [close] 中统一回收。
 */
class SshConnection(
    val target: SshTarget,
    private val interaction: SshInteraction,
    private val knownHosts: KnownHostStore,
    private val scope: CoroutineScope,
    private val strictHostKeys: Boolean = true,
) : Closeable {

    private val lock = Any()

    /**
     * 串行化 connect()，但 close() 不获取该锁：
     * 主机密钥确认可能阻塞在 UI 上，若 close() 需要等 connect() 结束会造成 UI 死锁。
     */
    private val connectLock = ReentrantLock()

    @Volatile
    private var activeSession: Session? = null

    /** 正在连接中的 Session；close() 可直接断开它以中断阻塞中的握手。 */
    @Volatile
    private var pendingSession: Session? = null

    @Volatile
    private var closed: Boolean = false

    private val shells: MutableSet<ShellHandle> =
        Collections.newSetFromMap(ConcurrentHashMap<ShellHandle, Boolean>())

    private val sftpClients: MutableSet<RemoteFileClient> =
        Collections.newSetFromMap(ConcurrentHashMap<RemoteFileClient, Boolean>())

    private val forwards: MutableSet<ForwardHandle> =
        Collections.newSetFromMap(ConcurrentHashMap<ForwardHandle, Boolean>())

    /** 当前是否处于已连接状态。 */
    val isConnected: Boolean
        get() {
            if (closed) return false
            return activeSession?.isConnected == true
        }

    /**
     * 阻塞式建立 SSH 连接（含主机密钥校验与认证）。
     *
     * 已连接时直接返回；连接失败抛出带中文提示的 [SshException]，message 可直接展示给用户。
     */
    fun connect() {
        connectLock.lock()
        try {
            synchronized(lock) {
                if (closed) throw SshException("SSH 连接已关闭，无法重新连接")
                val existing = activeSession
                if (existing != null) {
                    if (existing.isConnected) return
                    runCatching { existing.disconnect() }
                    activeSession = null
                }
            }

            val jsch = JSch()
            val repository = StoreHostKeyRepository(
                target = target,
                interaction = interaction,
                knownHosts = knownHosts,
                strictHostKeys = strictHostKeys,
            )
            val userInfo = InteractionUserInfo(target, interaction)
            val session = try {
                jsch.getSession(target.username, target.hostname, target.port)
            } catch (error: Throwable) {
                throw SshSupport.sshFailure(error, target)
            }
            session.setConfig("StrictHostKeyChecking", "ask")
            session.setHostKeyRepository(repository)
            session.setUserInfo(userInfo)
            if (target.keepAliveSeconds > 0) {
                runCatching {
                    session.setServerAliveInterval(target.keepAliveSeconds * 1000)
                    session.setServerAliveCountMax(3)
                }
            }
            configureAuthentication(jsch, session)

            pendingSession = session
            try {
                session.connect(target.connectTimeoutMs)
            } catch (error: Throwable) {
                runCatching { session.disconnect() }
                if (repository.rejected) {
                    throw hostKeyRejectionException(repository.lastChallenge, error)
                }
                throw SshSupport.sshFailure(error, target)
            } finally {
                pendingSession = null
            }
            // 极端情况下 check() 已拒绝但 JSch 未抛异常：这里再兜底一次。
            if (repository.rejected) {
                runCatching { session.disconnect() }
                throw hostKeyRejectionException(repository.lastChallenge, null)
            }

            synchronized(lock) {
                if (closed) {
                    runCatching { session.disconnect() }
                    throw SshException("SSH 连接已关闭，本次连接已取消")
                }
                activeSession = session
            }
        } finally {
            connectLock.unlock()
        }
    }

    private fun hostKeyRejectionException(
        challenge: HostKeyChallenge?,
        cause: Throwable?,
    ): SshException {
        val previous = challenge?.previousFingerprint
        val detail = if (previous != null) {
            "（已记录的指纹：${previous}，本次指纹：${challenge.fingerprint}）"
        } else {
            "（本次指纹：${challenge?.fingerprint ?: "未知"}）"
        }
        return SshException(
            "主机密钥校验失败：${target.hostname}:${target.port} 的主机密钥未通过验证${detail}，连接已中止。",
            cause,
        )
    }

    private fun configureAuthentication(jsch: JSch, session: Session) {
        when (val auth = target.auth) {
            is SshAuth.Password -> {
                session.setPassword(auth.password)
                session.setConfig("PreferredAuthentications", "password,keyboard-interactive")
            }

            is SshAuth.KeyboardInteractive -> {
                session.setConfig("PreferredAuthentications", "keyboard-interactive")
            }

            is SshAuth.PrivateKey -> {
                session.setConfig("PreferredAuthentications", "publickey")
                val passphrase = auth.passphrase
                    ?.takeIf { it.isNotEmpty() }
                    ?.toByteArray(Charsets.UTF_8)
                try {
                    jsch.addIdentity(
                        "fluentssh",
                        auth.privateKeyPem.toByteArray(Charsets.UTF_8),
                        null,
                        passphrase,
                    )
                } catch (error: Throwable) {
                    throw SshException(
                        "私钥读取失败：${error.message ?: "私钥格式无法识别或口令错误"}",
                        error,
                    )
                }
            }
        }
    }

    private fun requireSession(): Session {
        if (closed) throw SshException("SSH 连接已关闭")
        val session = activeSession
        if (session == null || !session.isConnected) {
            throw SshException("SSH 连接尚未建立或已断开，请先调用 connect()")
        }
        return session
    }

    // ---------------------------------------------------------------------------------------------
    // 交互式 Shell
    // ---------------------------------------------------------------------------------------------

    /**
     * 打开交互式 Shell（xterm-256color + PTY）。
     *
     * [onData] 在 IO 线程回调远端输出；[onClosed] 在通道关闭时回调且只回调一次（正常关闭为 null）。
     */
    fun openShell(
        cols: Int,
        rows: Int,
        onData: (ByteArray) -> Unit,
        onClosed: (String?) -> Unit,
    ): ShellHandle {
        val session = requireSession()
        val safeCols = cols.coerceAtLeast(20)
        val safeRows = rows.coerceAtLeast(5)
        val channel = try {
            session.openChannel("shell") as? ChannelShell
                ?: throw SshException("打开 Shell 失败：服务器不支持 shell 通道")
        } catch (error: SshException) {
            throw error
        } catch (error: Throwable) {
            throw SshSupport.sshFailure(error, target, "打开 Shell 通道失败")
        }

        channel.setPtyType("xterm-256color", safeCols, safeRows, safeCols * 8, safeRows * 17)
        val remoteOutput: InputStream
        val remoteInput: OutputStream
        try {
            remoteOutput = channel.inputStream
            remoteInput = channel.outputStream
        } catch (error: Throwable) {
            runCatching { channel.disconnect() }
            throw SshException(
                "打开 Shell 失败：无法初始化数据流（${error.message ?: "未知错误"}）",
                error,
            )
        }
        try {
            channel.connect(target.connectTimeoutMs)
        } catch (error: Throwable) {
            runCatching { channel.disconnect() }
            throw SshSupport.sshFailure(error, target, "打开 Shell 通道失败")
        }

        val handle = ShellHandleImpl(channel, remoteInput, remoteOutput, onData, onClosed)
        shells.add(handle)
        return handle
    }

    private inner class ShellHandleImpl(
        private val channel: ChannelShell,
        private val remoteInput: OutputStream,
        private val remoteOutput: InputStream,
        private val onData: (ByteArray) -> Unit,
        private val onClosed: (String?) -> Unit,
    ) : ShellHandle {

        private val writeLock = Any()
        private val closing = AtomicBoolean(false)
        private val closedNotified = AtomicBoolean(false)
        private val job: Job = scope.launch(Dispatchers.IO) { readLoop() }

        private fun readLoop() {
            val buffer = ByteArray(8192)
            var reason: String? = null
            try {
                while (!closing.get()) {
                    val read = remoteOutput.read(buffer)
                    if (read < 0) break
                    if (read == 0) continue
                    val chunk = buffer.copyOf(read)
                    try {
                        onData(chunk)
                    } catch (error: Throwable) {
                        reason = "终端数据处理异常：${error.message ?: error.javaClass.simpleName}"
                        break
                    }
                }
            } catch (error: Throwable) {
                if (!closing.get()) {
                    reason = "Shell 通道读取中断：${error.message ?: error.javaClass.simpleName}"
                }
            } finally {
                closing.set(true)
                runCatching { channel.disconnect() }
                shells.remove(this)
                notifyClosed(reason)
            }
        }

        override val isOpen: Boolean
            get() = !closing.get() && channel.isConnected

        override fun write(bytes: ByteArray) {
            if (bytes.isEmpty() || closing.get()) return
            synchronized(writeLock) {
                if (closing.get()) return
                try {
                    remoteInput.write(bytes)
                    remoteInput.flush()
                } catch (_: Throwable) {
                    closing.set(true)
                }
            }
        }

        override fun resize(cols: Int, rows: Int) {
            if (closing.get() || cols <= 0 || rows <= 0) return
            runCatching { channel.setPtySize(cols, rows, cols * 8, rows * 17) }
        }

        override fun close() {
            if (!closing.compareAndSet(false, true)) return
            runCatching { job.cancel() }
            runCatching { channel.disconnect() }
            shells.remove(this)
            notifyClosed(null)
        }

        private fun notifyClosed(reason: String?) {
            if (closedNotified.compareAndSet(false, true)) {
                runCatching { onClosed(reason) }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 命令执行
    // ---------------------------------------------------------------------------------------------

    /**
     * 在独立的 exec 通道执行命令，自行处理超时与通道关闭。
     *
     * 超时会断开通道并抛出 [SshException]；正常完成返回 [ExecResult]。
     */
    suspend fun exec(command: String, timeoutMs: Long = 120_000): ExecResult =
        withContext(Dispatchers.IO) {
            if (timeoutMs <= 0) throw SshException("命令执行超时时间必须大于 0")
            val session = requireSession()
            val startTime = System.currentTimeMillis()
            val channel = try {
                session.openChannel("exec") as? ChannelExec
                    ?: throw SshException("命令执行失败：服务器不支持 exec 通道")
            } catch (error: SshException) {
                throw error
            } catch (error: Throwable) {
                throw SshSupport.sshFailure(error, target, "命令执行失败")
            }

            channel.setCommand(command)
            val stdout: InputStream
            val stderr: InputStream
            try {
                stdout = channel.inputStream
                stderr = channel.errStream
            } catch (error: Throwable) {
                runCatching { channel.disconnect() }
                throw SshException(
                    "命令执行失败：无法初始化输出流（${error.message ?: "未知错误"}）",
                    error,
                )
            }
            try {
                channel.connect(target.connectTimeoutMs)
            } catch (error: Throwable) {
                runCatching { channel.disconnect() }
                throw SshSupport.sshFailure(error, target, "命令执行失败")
            }

            val outBuffer = ByteArrayOutputStream()
            val errBuffer = ByteArrayOutputStream()
            val outPump = startPump("fluentssh-exec-out", stdout, outBuffer)
            val errPump = startPump("fluentssh-exec-err", stderr, errBuffer)
            val deadline = startTime + timeoutMs
            var timedOut = false
            try {
                while (!channel.isClosed) {
                    if (System.currentTimeMillis() > deadline) {
                        timedOut = true
                        break
                    }
                    delay(5)
                }
            } finally {
                if (timedOut || !channel.isClosed) {
                    runCatching { channel.disconnect() }
                }
            }
            if (timedOut) {
                outPump.join(1_000)
                errPump.join(1_000)
                throw SshException(
                    "命令执行超时：超过 ${timeoutMs}ms 仍未完成（命令：${command.take(120)}）",
                )
            }
            outPump.join(2_000)
            errPump.join(2_000)
            val exitStatus = channel.exitStatus
            ExecResult(
                output = outBuffer.toString(Charsets.UTF_8.name()),
                error = errBuffer.toString(Charsets.UTF_8.name()),
                exitCode = if (exitStatus >= 0) exitStatus else null,
                durationMs = System.currentTimeMillis() - startTime,
            )
        }

    private fun startPump(
        name: String,
        input: InputStream,
        output: ByteArrayOutputStream,
    ): Thread {
        val thread = Thread({
            try {
                val buffer = ByteArray(8192)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                }
            } catch (_: Throwable) {
                // 通道关闭时管道会被关闭，读取异常属于正常收尾。
            }
        }, name)
        thread.isDaemon = true
        thread.start()
        return thread
    }

    // ---------------------------------------------------------------------------------------------
    // SFTP
    // ---------------------------------------------------------------------------------------------

    /** 在现有 session 上打开 SFTP 子系统。 */
    fun openSftp(): RemoteFileClient {
        val session = requireSession()
        val channel = try {
            session.openChannel("sftp") as? ChannelSftp
                ?: throw SshException("打开 SFTP 失败：服务器未启用 SFTP 子系统")
        } catch (error: SshException) {
            throw error
        } catch (error: Throwable) {
            throw SshSupport.sshFailure(error, target, "打开 SFTP 失败")
        }
        try {
            channel.connect(target.connectTimeoutMs)
        } catch (error: Throwable) {
            runCatching { channel.disconnect() }
            throw SshSupport.sshFailure(error, target, "打开 SFTP 子系统失败")
        }
        val client = RemoteFileClient(channel)
        sftpClients.add(client)
        return client
    }

    // ---------------------------------------------------------------------------------------------
    // 端口转发
    // ---------------------------------------------------------------------------------------------

    /** 本地端口转发：监听 [bindHost]:[bindPort]，经 SSH 转发到远端可见的 [targetHost]:[targetPort]。 */
    fun startLocalForward(
        bindHost: String,
        bindPort: Int,
        targetHost: String,
        targetPort: Int,
    ): ForwardHandle {
        validateBindPort(bindPort)
        validateTarget(targetHost, targetPort)
        val session = requireSession()
        val handle = createLocalForward(
            session = session,
            bindHost = bindHost,
            bindPort = bindPort,
            targetHost = targetHost,
            targetPort = targetPort,
            connectTimeoutMs = target.connectTimeoutMs,
        )
        forwards.add(handle)
        return handle
    }

    /** SOCKS5 动态转发：监听 [bindHost]:[bindPort]，每条连接按 SOCKS5 请求动态转发。 */
    fun startSocksForward(bindHost: String, bindPort: Int): ForwardHandle {
        validateBindPort(bindPort)
        val session = requireSession()
        val handle = createSocksForward(
            session = session,
            bindHost = bindHost,
            bindPort = bindPort,
            connectTimeoutMs = target.connectTimeoutMs,
        )
        forwards.add(handle)
        return handle
    }

    /** 远程端口转发：由 SSH 服务器监听 [bindHost]:[bindPort]，连接转发回本地 [targetHost]:[targetPort]。 */
    fun startRemoteForward(
        bindHost: String,
        bindPort: Int,
        targetHost: String,
        targetPort: Int,
    ): ForwardHandle {
        validateBindPort(bindPort)
        validateTarget(targetHost, targetPort)
        val session = requireSession()
        val handle = createRemoteForward(
            session = session,
            bindHost = bindHost,
            bindPort = bindPort,
            targetHost = targetHost,
            targetPort = targetPort,
        )
        forwards.add(handle)
        return handle
    }

    private fun validateBindPort(port: Int) {
        if (port !in 0..65535) throw SshException("端口转发失败：监听端口 $port 不合法")
    }

    private fun validateTarget(host: String, port: Int) {
        if (host.isBlank()) throw SshException("端口转发失败：目标主机不能为空")
        if (port !in 1..65535) throw SshException("端口转发失败：目标端口 $port 不合法")
    }

    // ---------------------------------------------------------------------------------------------
    // 关闭
    // ---------------------------------------------------------------------------------------------

    /** 关闭所有 Shell / SFTP / 转发并断开 SSH 会话；可重复调用。 */
    override fun close() {
        synchronized(lock) {
            if (closed) return
            closed = true
        }
        // 中断可能仍在进行中的 connect()（例如用户关闭了主机密钥确认对话框）。
        runCatching { pendingSession?.disconnect() }
        for (shell in shells.toList()) {
            runCatching { shell.close() }
        }
        shells.clear()
        for (client in sftpClients.toList()) {
            runCatching { client.close() }
        }
        sftpClients.clear()
        for (forward in forwards.toList()) {
            runCatching { forward.close() }
        }
        forwards.clear()
        val session = activeSession
        activeSession = null
        runCatching { session?.disconnect() }
    }
}
