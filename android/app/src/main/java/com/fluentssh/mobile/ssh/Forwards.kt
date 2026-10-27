package com.fluentssh.mobile.ssh

import com.jcraft.jsch.ChannelDirectTCPIP
import com.jcraft.jsch.Session
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * 本地转发 / SOCKS5 动态转发的监听器实现。
 *
 * 每条本地连接对应一个 `direct-tcpip` 通道：JSch 内部负责通道与本地 socket 之间的数据泵送，
 * 本类只负责 accept、通道建立、连接计数与资源回收。
 */
internal class SocketForwardHandle(
    private val session: Session,
    private val serverSocket: ServerSocket,
    private val connectTimeoutMs: Int,
    private val socks: Boolean,
    private val targetHost: String,
    private val targetPort: Int,
) : ForwardHandle {

    private val running = AtomicBoolean(true)
    private val connections = AtomicInteger(0)
    private val active = ConcurrentHashMap.newKeySet<TunnelConnection>()

    override val boundPort: Int = serverSocket.localPort

    override val connectionCount: Int
        get() = connections.get()

    private val acceptThread: Thread = Thread({ acceptLoop() }, "fluentssh-forward-accept").apply {
        isDaemon = true
        start()
    }

    private fun acceptLoop() {
        while (running.get()) {
            val socket = try {
                serverSocket.accept()
            } catch (_: Throwable) {
                break
            }
            if (!running.get()) {
                runCatching { socket.close() }
                break
            }
            connections.incrementAndGet()
            val connection = TunnelConnection(socket)
            active.add(connection)
            Thread({ serve(connection) }, "fluentssh-forward-conn").apply {
                isDaemon = true
                start()
            }
        }
    }

    private fun serve(connection: TunnelConnection) {
        try {
            if (socks) {
                serveSocks(connection)
            } else {
                serveLocal(connection)
            }
        } catch (_: Throwable) {
            // 单条连接失败不影响监听；资源在 finally 中统一回收。
        } finally {
            connection.close()
            active.remove(connection)
            connections.decrementAndGet()
        }
    }

    private fun serveLocal(connection: TunnelConnection) {
        val channel = openDirectTcpIp(
            session = session,
            socket = connection.socket,
            targetHost = targetHost,
            targetPort = targetPort,
            connectTimeoutMs = connectTimeoutMs,
        )
        connection.channel = channel
        while (running.get() && channel.isConnected && !connection.socket.isClosed) {
            Thread.sleep(50)
        }
    }

    private fun serveSocks(connection: TunnelConnection) {
        val socket = connection.socket
        val input = socket.getInputStream()
        val output = socket.getOutputStream()

        // ---- 阶段 1：方法协商 ----
        val version = input.read()
        if (version < 0 || version != SOCKS_VERSION) return
        val methodCount = input.read()
        if (methodCount <= 0) return
        val methods = SshSupport.readFully(input, methodCount)
        if (methods.none { (it.toInt() and 0xFF) == SOCKS_AUTH_NONE }) {
            writeSocksReply(output, SOCKS_REP_NOT_ACCEPTABLE)
            return
        }
        output.write(byteArrayOf(SOCKS_VERSION.toByte(), SOCKS_AUTH_NONE.toByte()))
        output.flush()

        // ---- 阶段 2：CONNECT 请求 ----
        val requestVersion = input.read()
        if (requestVersion < 0 || requestVersion != SOCKS_VERSION) return
        val command = input.read()
        input.read() // RSV
        val addressType = input.read()
        if (command != SOCKS_CMD_CONNECT) {
            writeSocksReply(output, SOCKS_REP_COMMAND_NOT_SUPPORTED)
            return
        }
        val host = when (addressType) {
            SOCKS_ATYP_IPV4 -> {
                val raw = SshSupport.readFully(input, 4)
                "${raw[0].toInt() and 0xFF}.${raw[1].toInt() and 0xFF}." +
                    "${raw[2].toInt() and 0xFF}.${raw[3].toInt() and 0xFF}"
            }

            SOCKS_ATYP_DOMAIN -> {
                val length = input.read()
                if (length <= 0) {
                    writeSocksReply(output, SOCKS_REP_ADDRESS_NOT_SUPPORTED)
                    return
                }
                String(SshSupport.readFully(input, length), Charsets.UTF_8)
            }

            SOCKS_ATYP_IPV6 -> {
                val raw = SshSupport.readFully(input, 16)
                try {
                    InetAddress.getByAddress(raw).hostAddress
                } catch (_: Throwable) {
                    writeSocksReply(output, SOCKS_REP_ADDRESS_NOT_SUPPORTED)
                    return
                }
            }

            else -> {
                writeSocksReply(output, SOCKS_REP_ADDRESS_NOT_SUPPORTED)
                return
            }
        }
        val portHigh = input.read()
        val portLow = input.read()
        if (portHigh < 0 || portLow < 0) return
        val port = (portHigh shl 8) or portLow

        // ---- 阶段 3：建立 SSH 通道并回复 ----
        // 目标可能在通道打开后立即推送数据，必须先把 SOCKS5 成功应答写给客户端，
        // 因此这里用延迟输出流缓冲远端数据，等应答写完后再放行。
        val deferredOutput = DeferredOutputStream(output)
        val channel = try {
            openDirectTcpIp(
                session = session,
                socket = socket,
                targetHost = host,
                targetPort = port,
                connectTimeoutMs = connectTimeoutMs,
                clientOutput = deferredOutput,
            )
        } catch (error: Throwable) {
            writeSocksReply(output, socksFailureCode(error))
            return
        }
        connection.channel = channel
        writeSocksReply(output, SOCKS_REP_SUCCESS)
        output.flush()
        deferredOutput.release()
        while (running.get() && channel.isConnected && !socket.isClosed) {
            Thread.sleep(50)
        }
    }

    override fun close() {
        if (!running.compareAndSet(true, false)) return
        runCatching { serverSocket.close() }
        for (connection in active) {
            connection.close()
        }
        active.clear()
        runCatching { acceptThread.join(500) }
    }

    private companion object {
        const val SOCKS_VERSION = 5
        const val SOCKS_AUTH_NONE = 0x00
        const val SOCKS_CMD_CONNECT = 0x01
        const val SOCKS_ATYP_IPV4 = 0x01
        const val SOCKS_ATYP_DOMAIN = 0x03
        const val SOCKS_ATYP_IPV6 = 0x04

        const val SOCKS_REP_SUCCESS = 0x00
        const val SOCKS_REP_GENERAL_FAILURE = 0x01
        const val SOCKS_REP_HOST_UNREACHABLE = 0x04
        const val SOCKS_REP_CONNECTION_REFUSED = 0x05
        const val SOCKS_REP_COMMAND_NOT_SUPPORTED = 0x07
        const val SOCKS_REP_ADDRESS_NOT_SUPPORTED = 0x08
        const val SOCKS_REP_NOT_ACCEPTABLE = 0xFF

        fun writeSocksReply(output: OutputStream, code: Int) {
            // VER REP RSV ATYP BND.ADDR BND.PORT
            runCatching {
                output.write(
                    byteArrayOf(
                        SOCKS_VERSION.toByte(),
                        code.toByte(),
                        0x00,
                        SOCKS_ATYP_IPV4.toByte(),
                        0x00,
                        0x00,
                        0x00,
                        0x00,
                        0x00,
                        0x00,
                    ),
                )
                output.flush()
            }
        }

        fun socksFailureCode(error: Throwable): Int {
            val text = generateSequence(error) { it.cause }
                .mapNotNull { it.message }
                .joinToString(" ")
                .lowercase()
            return when {
                text.contains("refused") -> SOCKS_REP_CONNECTION_REFUSED
                text.contains("unreachable") || text.contains("no route") -> SOCKS_REP_HOST_UNREACHABLE
                else -> SOCKS_REP_GENERAL_FAILURE
            }
        }
    }
}

/** 单条转发连接（本地 socket + 可选的 SSH direct-tcpip 通道）。 */
internal class TunnelConnection(val socket: Socket) {
    @Volatile
    var channel: ChannelDirectTCPIP? = null

    fun close() {
        runCatching { channel?.disconnect() }
        runCatching { socket.close() }
    }
}

/**
 * 缓冲远端数据的输出流：在 [release] 之前只缓存不发送，用于 SOCKS5 先应答后转发的场景。
 */
internal class DeferredOutputStream(private val target: OutputStream) : OutputStream() {

    private val pending = ByteArrayOutputStream()
    private var released = false
    private var closed = false

    @Synchronized
    override fun write(b: Int) {
        if (released) {
            target.write(b)
        } else if (!closed) {
            pending.write(b)
        }
    }

    @Synchronized
    override fun write(b: ByteArray, off: Int, len: Int) {
        if (released) {
            target.write(b, off, len)
        } else if (!closed) {
            pending.write(b, off, len)
        }
    }

    @Synchronized
    override fun flush() {
        if (released) target.flush()
    }

    @Synchronized
    fun release() {
        if (released) return
        released = true
        if (pending.size() > 0) {
            target.write(pending.toByteArray())
            pending.reset()
        }
        target.flush()
    }

    @Synchronized
    override fun close() {
        closed = true
        if (released) {
            runCatching { target.close() }
        }
    }
}

/**
 * 打开一条 `direct-tcpip` 通道，把本地 socket 的读写接到该通道上。
 *
 * JSch 在 `setInputStream` 非空时会在内部线程里异步完成通道打开与双向数据泵送，
 * 因此这里需要等待 `isConnected` / `isClosed` 来判定打开结果。
 */
internal fun openDirectTcpIp(
    session: Session,
    socket: Socket,
    targetHost: String,
    targetPort: Int,
    connectTimeoutMs: Int,
    clientOutput: OutputStream = socket.getOutputStream(),
): ChannelDirectTCPIP {
    val channel = try {
        session.openChannel("direct-tcpip") as? ChannelDirectTCPIP
            ?: throw SshException("转发失败：服务器不支持 direct-tcpip 通道")
    } catch (error: SshException) {
        throw error
    } catch (error: Throwable) {
        throw SshException("转发失败：无法打开 direct-tcpip 通道（${error.message ?: "未知错误"}）", error)
    }

    channel.setHost(targetHost)
    channel.setPort(targetPort)
    runCatching { channel.setOrgIPAddress(socket.inetAddress?.hostAddress ?: "127.0.0.1") }
    runCatching { channel.setOrgPort(socket.port) }
    try {
        channel.setInputStream(socket.getInputStream())
        channel.setOutputStream(clientOutput)
    } catch (error: Throwable) {
        throw SshException("转发失败：无法绑定本地连接的数据流（${error.message ?: "未知错误"}）", error)
    }

    try {
        channel.connect(connectTimeoutMs)
    } catch (error: Throwable) {
        runCatching { channel.disconnect() }
        throw SshException(
            "转发失败：SSH 服务器无法连接到 $targetHost:$targetPort（${error.message ?: "通道被拒绝"}）",
            error,
        )
    }

    val deadline = System.currentTimeMillis() + connectTimeoutMs.coerceAtLeast(1_000)
    while (!channel.isConnected && !channel.isClosed) {
        if (!session.isConnected) {
            runCatching { channel.disconnect() }
            throw SshException("转发失败：SSH 会话已断开")
        }
        if (System.currentTimeMillis() > deadline) {
            runCatching { channel.disconnect() }
            throw SshException("转发超时：无法在 ${connectTimeoutMs}ms 内建立到 $targetHost:$targetPort 的通道")
        }
        Thread.sleep(10)
    }
    if (!channel.isConnected) {
        runCatching { channel.disconnect() }
        throw SshException(
            "转发失败：SSH 服务器拒绝连接到 $targetHost:$targetPort（目标主机不可达或服务器禁止转发）",
        )
    }
    return channel
}

/** 创建本地端口转发监听。 */
internal fun createLocalForward(
    session: Session,
    bindHost: String,
    bindPort: Int,
    targetHost: String,
    targetPort: Int,
    connectTimeoutMs: Int,
): ForwardHandle {
    val serverSocket = bindForwardSocket(bindHost, bindPort)
    return SocketForwardHandle(
        session = session,
        serverSocket = serverSocket,
        connectTimeoutMs = connectTimeoutMs,
        socks = false,
        targetHost = targetHost,
        targetPort = targetPort,
    )
}

/** 创建 SOCKS5 动态转发监听。 */
internal fun createSocksForward(
    session: Session,
    bindHost: String,
    bindPort: Int,
    connectTimeoutMs: Int,
): ForwardHandle {
    val serverSocket = bindForwardSocket(bindHost, bindPort)
    return SocketForwardHandle(
        session = session,
        serverSocket = serverSocket,
        connectTimeoutMs = connectTimeoutMs,
        socks = true,
        targetHost = "",
        targetPort = 0,
    )
}

private fun bindForwardSocket(bindHost: String, bindPort: Int): ServerSocket {
    val serverSocket = ServerSocket()
    val host = bindHost.trim().ifEmpty { "127.0.0.1" }
    try {
        serverSocket.reuseAddress = true
        serverSocket.bind(InetSocketAddress(host, bindPort))
        return serverSocket
    } catch (error: Throwable) {
        runCatching { serverSocket.close() }
        throw SshException(
            "转发监听失败：无法在 $host:${if (bindPort == 0) "随机端口" else bindPort.toString()} 上监听（${error.message ?: "端口可能已被占用"}）",
            error,
        )
    }
}

/** 创建远程端口转发（由 SSH 服务器监听，连接转发回本地 targetHost:targetPort）。 */
internal fun createRemoteForward(
    session: Session,
    bindHost: String,
    bindPort: Int,
    targetHost: String,
    targetPort: Int,
): ForwardHandle {
    if (targetHost.contains(':')) {
        throw SshException("远程转发失败：暂不支持 IPv6 目标地址（$targetHost）")
    }
    val bindAddress = when {
        bindHost.isBlank() -> "127.0.0.1"
        bindHost == "localhost" -> "127.0.0.1"
        bindHost == "*" -> "0.0.0.0"
        else -> bindHost
    }
    val configuration = "$bindAddress:$bindPort:$targetHost:$targetPort"
    val allocated = try {
        session.setPortForwardingR(configuration)
    } catch (error: Throwable) {
        throw SshException(
            "远程转发失败：服务器无法在 $bindAddress:${if (bindPort == 0) "随机端口" else bindPort.toString()} 上监听（${error.message ?: "请求被拒绝"}）",
            error,
        )
    }
    val boundPort = if (allocated > 0) allocated else bindPort
    val closed = AtomicBoolean(false)
    return object : ForwardHandle {
        override val boundPort: Int = boundPort

        // JSch 的 ChannelForwardedTCPIP 没有暴露活跃连接计数，远程转发统一返回 0。
        override val connectionCount: Int = 0

        override fun close() {
            if (!closed.compareAndSet(false, true)) return
            runCatching { session.delPortForwardingR(bindAddress, boundPort) }
        }
    }
}
