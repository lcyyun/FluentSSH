package com.fluentssh.mobile.ssh

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.apache.sshd.common.file.virtualfs.VirtualFileSystemFactory
import org.apache.sshd.server.Environment
import org.apache.sshd.server.ExitCallback
import org.apache.sshd.server.SshServer
import org.apache.sshd.server.auth.keyboard.InteractiveChallenge
import org.apache.sshd.server.auth.keyboard.KeyboardInteractiveAuthenticator
import org.apache.sshd.server.auth.password.PasswordAuthenticator
import org.apache.sshd.server.auth.pubkey.PublickeyAuthenticator
import org.apache.sshd.server.channel.ChannelSession
import org.apache.sshd.server.command.Command
import org.apache.sshd.server.command.CommandFactory
import org.apache.sshd.server.forward.AcceptAllForwardingFilter
import org.apache.sshd.server.keyprovider.SimpleGeneratorHostKeyProvider
import org.apache.sshd.server.session.ServerSession
import org.apache.sshd.server.shell.ShellFactory
import org.apache.sshd.sftp.server.SftpSubsystemFactory
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * SSH / SFTP / 端口转发引擎的端到端测试。
 *
 * 测试使用 Apache MINA sshd 2.13.2 在 JVM 内启动真实的 SSH 服务器，
 * 覆盖密码 / 私钥 / 键盘交互认证、主机密钥校验与变化检测、exec、SFTP、本地转发、SOCKS5 与远程转发。
 */
class SshEngineTest {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @After
    fun tearDown() {
        scope.cancel()
    }

    // ---------------------------------------------------------------------------------------------
    // 1. 密码认证 + 主机密钥确认
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 120_000)
    fun passwordAuthWithHostKeyConfirmation() {
        val server = TestSshServer(password = "secret").start()
        try {
            val knownHosts = InMemoryKnownHosts()
            val interaction = RecordingInteraction(acceptHostKey = true)

            val connection = newConnection(server.port, SshAuth.Password("secret"), interaction, knownHosts)
            try {
                connection.connect()
                assertTrue(connection.isConnected)

                assertEquals("首次连接应弹出一次主机密钥确认", 1, interaction.challenges.size)
                val challenge = interaction.challenges.first()
                assertEquals("127.0.0.1", challenge.hostname)
                assertEquals(server.port, challenge.port)
                assertTrue("指纹应以 SHA256: 开头", challenge.fingerprint.startsWith("SHA256:"))
                assertFalse("OpenSSH 风格指纹不带填充 =", challenge.fingerprint.endsWith("="))
                assertEquals("SHA-256 指纹总长度应为 50", 50, challenge.fingerprint.length)
                assertTrue("RSA 主机密钥类型", challenge.keyType.contains("rsa", ignoreCase = true))
                assertNull("首次连接没有旧指纹", challenge.previousFingerprint)

                assertEquals(
                    "信任后应记录相同指纹",
                    challenge.fingerprint,
                    knownHosts.fingerprint("127.0.0.1", server.port),
                )
                assertEquals(challenge.keyType, knownHosts.keyType("127.0.0.1", server.port))
            } finally {
                connection.close()
            }

            // 再次连接：已知主机，不再询问，但会刷新 touch。
            val secondInteraction = RecordingInteraction(acceptHostKey = true)
            val second = newConnection(server.port, SshAuth.Password("secret"), secondInteraction, knownHosts)
            try {
                second.connect()
                assertTrue(second.isConnected)
                assertTrue("已知主机不应再次询问", secondInteraction.challenges.isEmpty())
                assertTrue("已知主机应刷新 lastSeen", knownHosts.touches.get() >= 1)
            } finally {
                second.close()
            }

            // 用户拒绝主机密钥：连接失败，不留下信任记录。
            val rejectingKnownHosts = InMemoryKnownHosts()
            val rejecting = RecordingInteraction(acceptHostKey = false)
            val rejectedConnection = newConnection(
                server.port,
                SshAuth.Password("secret"),
                rejecting,
                rejectingKnownHosts,
            )
            try {
                val error = assertThrows(SshException::class.java) { rejectedConnection.connect() }
                assertTrue(
                    "错误信息应说明主机密钥校验失败，实际：${error.message}",
                    error.message.orEmpty().contains("主机密钥"),
                )
                assertFalse(rejectedConnection.isConnected)
                assertNull(
                    "用户拒绝后不应记录信任",
                    rejectingKnownHosts.fingerprint("127.0.0.1", server.port),
                )
            } finally {
                rejectedConnection.close()
            }
        } finally {
            server.stop()
        }
    }

    @Test(timeout = 60_000)
    fun closeDuringHostKeyPromptAbortsConnectWithoutDeadlock() {
        val server = TestSshServer(password = "secret").start()
        try {
            val promptShown = CountDownLatch(1)
            val slowInteraction = object : SshInteraction {
                override fun confirmHostKey(challenge: HostKeyChallenge): Boolean {
                    promptShown.countDown()
                    // 模拟用户尚未处理主机密钥对话框时关闭会话。
                    Thread.sleep(3_000)
                    return true
                }

                override fun respondToKeyboardInteractive(
                    destination: String,
                    name: String,
                    instruction: String,
                    prompts: List<KeyboardPrompt>,
                ): List<String>? = null

                override fun requestPassword(message: String): String? = "secret"

                override fun showMessage(message: String) = Unit
            }
            val connection = newConnection(
                server.port,
                SshAuth.Password("secret"),
                slowInteraction,
                InMemoryKnownHosts(),
            )
            val connectThread = Thread({ runCatching { connection.connect() } }, "connect-under-close")
            connectThread.start()
            assertTrue("主机密钥确认应被触发", promptShown.await(15, TimeUnit.SECONDS))

            val closeStarted = System.currentTimeMillis()
            connection.close()
            val closeCost = System.currentTimeMillis() - closeStarted
            assertTrue("close() 不应被 connect() 阻塞，实际耗时 ${closeCost}ms", closeCost < 3_000)

            connectThread.join(15_000)
            assertFalse("connect() 应已返回", connectThread.isAlive)
            assertFalse(connection.isConnected)
        } finally {
            server.stop()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 2. 已知主机指纹变化
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 120_000)
    fun hostKeyChangeReportsPreviousFingerprint() {
        val serverA = TestSshServer(password = "secret").start()
        val serverB = TestSshServer(password = "secret").start()
        try {
            val knownHosts = InMemoryKnownHosts()
            val first = newConnection(serverA.port, SshAuth.Password("secret"), RecordingInteraction(), knownHosts)
            try {
                first.connect()
            } finally {
                first.close()
            }
            val trustedFingerprint = knownHosts.fingerprint("127.0.0.1", serverA.port)
            assertNotNull("服务器 A 的指纹应被记录", trustedFingerprint)

            // 把 A 的指纹记录到 B 的地址上：模拟“已知主机密钥发生了变化”。
            knownHosts.trust("127.0.0.1", serverB.port, "ssh-rsa", trustedFingerprint!!)

            val interaction = RecordingInteraction(acceptHostKey = true)
            val second = newConnection(serverB.port, SshAuth.Password("secret"), interaction, knownHosts)
            try {
                second.connect()
                assertTrue(second.isConnected)
                assertEquals("密钥变化应触发一次确认", 1, interaction.challenges.size)
                val challenge = interaction.challenges.first()
                assertEquals("应带回旧指纹", trustedFingerprint, challenge.previousFingerprint)
                assertNotEquals("新指纹必须与旧指纹不同", trustedFingerprint, challenge.fingerprint)
                assertTrue(challenge.fingerprint.startsWith("SHA256:"))
                assertEquals(
                    "确认后应更新为新指纹",
                    challenge.fingerprint,
                    knownHosts.fingerprint("127.0.0.1", serverB.port),
                )
            } finally {
                second.close()
            }
        } finally {
            serverA.stop()
            serverB.stop()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 3. exec
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 120_000)
    fun execReturnsOutputErrorAndExitCode() {
        val commandFactory = CommandFactory { _, _ ->
            FixedOutputCommand(stdout = "你好 FluentSSH\n", stderr = "warn: 测试\n", exitCode = 7)
        }
        val server = TestSshServer(password = "secret", commandFactory = commandFactory).start()
        try {
            val connection = newConnection(server.port, SshAuth.Password("secret"))
            try {
                connection.connect()
                val result = runBlocking { connection.exec("echo hello") }
                assertEquals("你好 FluentSSH\n", result.output)
                assertEquals("warn: 测试\n", result.error)
                assertEquals(7, result.exitCode)
                assertTrue(result.durationMs >= 0L)
            } finally {
                connection.close()
            }
        } finally {
            server.stop()
        }
    }

    @Test(timeout = 120_000)
    fun execTimesOutHungCommand() {
        val commandFactory = CommandFactory { _, _ -> HangingCommand() }
        val server = TestSshServer(password = "secret", commandFactory = commandFactory).start()
        try {
            val connection = newConnection(server.port, SshAuth.Password("secret"))
            try {
                connection.connect()
                val started = System.currentTimeMillis()
                val error = assertThrows(SshException::class.java) {
                    runBlocking { connection.exec("sleep forever", timeoutMs = 800) }
                }
                assertTrue(
                    "超时错误应带中文提示，实际：${error.message}",
                    error.message.orEmpty().contains("超时"),
                )
                assertTrue("应在超时后尽快返回", System.currentTimeMillis() - started < 15_000)
            } finally {
                connection.close()
            }
        } finally {
            server.stop()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 4. SFTP
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 180_000)
    fun sftpFileOperationsWithChineseNames() {
        val root = Files.createTempDirectory("fluentssh-sftp-root-")
        val server = TestSshServer(password = "secret", sftpRoot = root).start()
        try {
            val connection = newConnection(server.port, SshAuth.Password("secret"))
            try {
                connection.connect()
                val client = connection.openSftp()
                try {
                    runBlocking {
                        val home = client.homePath()
                        assertTrue("主目录不应为空", home.isNotEmpty())

                        val dir = joinPath(home, "测试目录")
                        client.mkdir(dir)

                        val file = joinPath(dir, "中文文件.txt")
                        val content = "你好，FluentSSH！\n第二行：中文内容。"
                        client.writeText(file, content)
                        assertEquals(content, client.readText(file))

                        val listing = client.list(dir)
                        assertEquals(1, listing.size)
                        assertEquals("中文文件.txt", listing[0].name)
                        assertEquals(file, listing[0].path)
                        assertFalse(listing[0].isDirectory)
                        assertEquals(
                            content.toByteArray(Charsets.UTF_8).size.toLong(),
                            listing[0].size,
                        )
                        assertTrue(listing[0].modifiedAt > 0L)

                        // 隐藏文件过滤
                        client.writeText(joinPath(dir, ".hidden"), "hidden")
                        assertEquals("默认不显示隐藏文件", 1, client.list(dir).size)
                        assertEquals("showHidden=true 时显示", 2, client.list(dir, showHidden = true).size)
                        client.delete(joinPath(dir, ".hidden"))

                        // 重命名
                        val renamed = joinPath(dir, "改名后.txt")
                        client.rename(file, renamed)
                        assertEquals(content, client.readText(renamed))

                        // 下载（带进度）
                        val downloaded = ByteArrayOutputStream()
                        val downloadProgress = CopyOnWriteArrayList<Pair<Long, Long>>()
                        client.download(renamed, downloaded) { done, total ->
                            downloadProgress.add(done to total)
                        }
                        assertEquals(content, downloaded.toString(Charsets.UTF_8.name()))
                        assertTrue("下载应有进度回调", downloadProgress.isNotEmpty())
                        val expectedSize = content.toByteArray(Charsets.UTF_8).size.toLong()
                        assertEquals(expectedSize, downloadProgress.last().first)
                        assertEquals(expectedSize, downloadProgress.last().second)

                        // 上传
                        val uploadPath = joinPath(home, "上传文件.txt")
                        val uploadBytes = "上传内容 with ASCII".toByteArray(Charsets.UTF_8)
                        val uploadProgress = CopyOnWriteArrayList<Pair<Long, Long>>()
                        client.upload(
                            ByteArrayInputStream(uploadBytes),
                            uploadPath,
                            uploadBytes.size.toLong(),
                        ) { done, total -> uploadProgress.add(done to total) }
                        assertEquals("上传内容 with ASCII", client.readText(uploadPath))
                        assertEquals(uploadBytes.size.toLong(), uploadProgress.last().first)

                        // 递归删除
                        val nested = joinPath(dir, "嵌套")
                        client.mkdir(nested)
                        client.writeText(joinPath(nested, "a.txt"), "a")
                        client.mkdir(joinPath(nested, "更深"))
                        client.writeText(joinPath(joinPath(nested, "更深"), "b.txt"), "b")
                        client.deleteRecursive(dir)
                        assertTrue("递归删除后目录应消失", client.list(home).none { it.name == "测试目录" })

                        client.delete(uploadPath)
                        assertTrue("普通删除后文件应消失", client.list(home).none { it.name == "上传文件.txt" })
                    }

                    // 在真实磁盘上确认虚拟根目录映射。
                    assertFalse("磁盘上测试目录应被删除", Files.exists(root.resolve("测试目录")))
                } finally {
                    client.close()
                }
            } finally {
                connection.close()
            }
        } finally {
            server.stop()
            root.toFile().deleteRecursively()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 5. 本地端口转发
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 120_000)
    fun localForwardRelaysDataAndClosesPort() {
        val echo = EchoServer()
        val server = TestSshServer(password = "secret").start()
        try {
            val connection = newConnection(server.port, SshAuth.Password("secret"))
            try {
                connection.connect()
                val forward = connection.startLocalForward("127.0.0.1", 0, "127.0.0.1", echo.port)
                val boundPort = forward.boundPort
                try {
                    assertTrue("应分配有效端口", boundPort > 0)

                    Socket("127.0.0.1", boundPort).use { socket ->
                        socket.soTimeout = 15_000
                        val payload = "hello-local-forward".toByteArray(Charsets.UTF_8)
                        socket.getOutputStream().write(payload)
                        socket.getOutputStream().flush()
                        assertArrayEquals(payload, readExactly(socket.getInputStream(), payload.size))
                    }

                    // 保持一条连接打开，验证 connectionCount 大于 0。
                    Socket("127.0.0.1", boundPort).use { socket ->
                        socket.soTimeout = 15_000
                        socket.getOutputStream().write(byteArrayOf(42))
                        socket.getOutputStream().flush()
                        assertArrayEquals(byteArrayOf(42), readExactly(socket.getInputStream(), 1))
                        val deadline = System.currentTimeMillis() + 10_000
                        while (forward.connectionCount <= 0 && System.currentTimeMillis() < deadline) {
                            Thread.sleep(20)
                        }
                        assertTrue(
                            "活跃连接数应大于 0，实际 ${forward.connectionCount}",
                            forward.connectionCount > 0,
                        )
                    }
                } finally {
                    forward.close()
                }

                Thread.sleep(100)
                val refused = try {
                    Socket().use { it.connect(InetSocketAddress("127.0.0.1", boundPort), 1_000) }
                    false
                } catch (_: IOException) {
                    true
                }
                assertTrue("close() 后监听端口应不可连接", refused)
            } finally {
                connection.close()
            }
        } finally {
            server.stop()
            echo.close()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 6. SOCKS5 动态转发
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 120_000)
    fun socks5DynamicForwardRelaysData() {
        val echo = EchoServer()
        val server = TestSshServer(password = "secret").start()
        try {
            val connection = newConnection(server.port, SshAuth.Password("secret"))
            try {
                connection.connect()
                val forward = connection.startSocksForward("127.0.0.1", 0)
                try {
                    assertTrue(forward.boundPort > 0)

                    // IPv4 地址形式
                    socksRoundTrip(forward.boundPort, "127.0.0.1", echo.port, "socks-ipv4")

                    // 域名形式
                    socksRoundTrip(forward.boundPort, "localhost", echo.port, "socks-domain")
                } finally {
                    forward.close()
                }
            } finally {
                connection.close()
            }
        } finally {
            server.stop()
            echo.close()
        }
    }

    private fun socksRoundTrip(socksPort: Int, host: String, port: Int, payload: String) {
        Socket("127.0.0.1", socksPort).use { socket ->
            socket.soTimeout = 15_000
            val input = socket.getInputStream()
            val output = socket.getOutputStream()

            // 方法协商：仅提供 no-auth
            output.write(byteArrayOf(5, 1, 0))
            output.flush()
            assertEquals(5, input.read())
            assertEquals(0, input.read())

            // CONNECT 请求
            val hostBytes = host.toByteArray(Charsets.UTF_8)
            val request = ByteArrayOutputStream()
            request.write(byteArrayOf(5, 1, 0))
            if (isIpv4Literal(host)) {
                request.write(1)
                request.write(host.split('.').map { it.toInt().toByte() }.toByteArray())
            } else {
                request.write(3)
                request.write(hostBytes.size)
                request.write(hostBytes)
            }
            request.write(port shr 8)
            request.write(port and 0xFF)
            output.write(request.toByteArray())
            output.flush()

            assertEquals(5, input.read())
            assertEquals("SOCKS5 CONNECT 应成功", 0, input.read())
            assertEquals(0, input.read()) // RSV
            val addressType = input.read()
            when (addressType) {
                1 -> readExactly(input, 4)
                4 -> readExactly(input, 16)
                3 -> readExactly(input, input.read())
                else -> fail("未知 SOCKS5 地址类型：$addressType")
            }
            readExactly(input, 2) // BND.PORT

            // 数据往返
            val bytes = payload.toByteArray(Charsets.UTF_8)
            output.write(bytes)
            output.flush()
            assertArrayEquals(bytes, readExactly(input, bytes.size))
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 7. 私钥认证
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 180_000)
    fun privateKeyAuthentication() {
        val generated = KeyService.generateRsa(bits = 2048, comment = "test@fluentssh")
        val encrypted = KeyService.generateRsa(
            bits = 2048,
            comment = "test@fluentssh",
            passphrase = "key-passphrase",
        )
        val server = TestSshServer(acceptAnyPublicKey = true).start()
        try {
            val plainConnection = newConnection(
                server.port,
                SshAuth.PrivateKey(generated.privateKeyPem, null),
            )
            try {
                plainConnection.connect()
                assertTrue("无口令私钥应认证成功", plainConnection.isConnected)
            } finally {
                plainConnection.close()
            }

            val encryptedConnection = newConnection(
                server.port,
                SshAuth.PrivateKey(encrypted.privateKeyPem, "key-passphrase"),
            )
            try {
                encryptedConnection.connect()
                assertTrue("带口令私钥应认证成功", encryptedConnection.isConnected)
            } finally {
                encryptedConnection.close()
            }

            // 错误口令应失败并给出中文提示。
            val wrongPass = newConnection(
                server.port,
                SshAuth.PrivateKey(encrypted.privateKeyPem, "wrong-passphrase"),
            )
            try {
                val error = assertThrows(SshException::class.java) { wrongPass.connect() }
                assertTrue(
                    "错误口令应失败，实际：${error.message}",
                    error.message.orEmpty().contains("私钥") ||
                        error.message.orEmpty().contains("认证失败"),
                )
            } finally {
                wrongPass.close()
            }
        } finally {
            server.stop()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 9. 键盘交互认证
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 120_000)
    fun keyboardInteractiveAuthentication() {
        val server = TestSshServer(keyboardInteractivePassword = "kbi-secret").start()
        try {
            val interaction = RecordingInteraction(
                acceptHostKey = true,
                keyboardAnswers = listOf("kbi-secret"),
            )
            val connection = newConnection(
                server.port,
                SshAuth.KeyboardInteractive,
                interaction,
            )
            try {
                connection.connect()
                assertTrue("键盘交互认证应成功", connection.isConnected)
                assertTrue("应收到键盘交互提示", interaction.keyboardRequests.isNotEmpty())
                val prompts = interaction.keyboardRequests.first()
                assertEquals(1, prompts.size)
                assertFalse("密码提示不应回显", prompts.first().echo)
                assertTrue(
                    "提示内容应包含 Password，实际：${prompts.first().text}",
                    prompts.first().text.contains("password", ignoreCase = true),
                )
            } finally {
                connection.close()
            }

            // 应答错误 → 认证失败
            val wrongInteraction = RecordingInteraction(
                acceptHostKey = true,
                keyboardAnswers = listOf("wrong-answer"),
            )
            val wrongConnection = newConnection(
                server.port,
                SshAuth.KeyboardInteractive,
                wrongInteraction,
            )
            try {
                val error = assertThrows(SshException::class.java) { wrongConnection.connect() }
                assertTrue(
                    "错误键盘交互应答应认证失败，实际：${error.message}",
                    error.message.orEmpty().contains("认证失败"),
                )
            } finally {
                wrongConnection.close()
            }
        } finally {
            server.stop()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 附加：交互式 Shell
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 120_000)
    fun shellEchoesDataAndNotifiesClosedOnce() {
        val server = TestSshServer(password = "secret", shellFactory = EchoShellFactory()).start()
        try {
            val connection = newConnection(server.port, SshAuth.Password("secret"))
            try {
                connection.connect()
                val received = ByteArrayOutputStream()
                val closedLatch = CountDownLatch(1)
                val closedCount = AtomicInteger(0)
                val shell = connection.openShell(
                    cols = 100,
                    rows = 40,
                    onData = { bytes ->
                        synchronized(received) { received.write(bytes) }
                    },
                    onClosed = {
                        closedCount.incrementAndGet()
                        closedLatch.countDown()
                    },
                )
                try {
                    assertTrue(shell.isOpen)
                    val payload = "shell-hello\n".toByteArray(Charsets.UTF_8)
                    shell.write(payload)
                    val deadline = System.currentTimeMillis() + 10_000
                    while (System.currentTimeMillis() < deadline) {
                        val text = synchronized(received) { received.toString(Charsets.UTF_8.name()) }
                        if (text.contains("shell-hello")) break
                        Thread.sleep(20)
                    }
                    val text = synchronized(received) { received.toString(Charsets.UTF_8.name()) }
                    assertTrue("Shell 应回显输入，实际收到：$text", text.contains("shell-hello"))
                    shell.resize(120, 50)
                } finally {
                    shell.close()
                }
                assertTrue("onClosed 应被回调", closedLatch.await(10, TimeUnit.SECONDS))
                Thread.sleep(200)
                assertEquals("onClosed 只应回调一次", 1, closedCount.get())
            } finally {
                connection.close()
            }
        } finally {
            server.stop()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 附加：远程端口转发
    // ---------------------------------------------------------------------------------------------

    @Test(timeout = 120_000)
    fun remoteForwardRelaysData() {
        val echo = EchoServer()
        val server = TestSshServer(password = "secret").start()
        try {
            val connection = newConnection(server.port, SshAuth.Password("secret"))
            try {
                connection.connect()
                val forward = connection.startRemoteForward("127.0.0.1", 0, "127.0.0.1", echo.port)
                try {
                    assertTrue("远程转发应分配端口，实际 ${forward.boundPort}", forward.boundPort > 0)
                    Socket("127.0.0.1", forward.boundPort).use { socket ->
                        socket.soTimeout = 15_000
                        val payload = "remote-forward".toByteArray(Charsets.UTF_8)
                        socket.getOutputStream().write(payload)
                        socket.getOutputStream().flush()
                        assertArrayEquals(payload, readExactly(socket.getInputStream(), payload.size))
                    }
                } finally {
                    forward.close()
                }
            } finally {
                connection.close()
            }
        } finally {
            server.stop()
            echo.close()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // 辅助方法
    // ---------------------------------------------------------------------------------------------

    private fun newConnection(
        port: Int,
        auth: SshAuth,
        interaction: SshInteraction = RecordingInteraction(),
        knownHosts: KnownHostStore = InMemoryKnownHosts(),
    ): SshConnection = SshConnection(
        target = SshTarget(
            hostname = "127.0.0.1",
            port = port,
            username = "tester",
            auth = auth,
            keepAliveSeconds = 30,
            connectTimeoutMs = 15_000,
        ),
        interaction = interaction,
        knownHosts = knownHosts,
        scope = scope,
    )

    private fun fail(message: String): Nothing = throw AssertionError(message)

    private fun isIpv4Literal(host: String): Boolean =
        host.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$"))

    private fun joinPath(parent: String, name: String): String = when {
        parent.isEmpty() -> name
        parent.endsWith("/") -> parent + name
        else -> "$parent/$name"
    }

    private fun readExactly(input: InputStream, length: Int): ByteArray {
        val data = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = input.read(data, offset, length - offset)
            if (read < 0) throw EOFException("预期读取 $length 字节，实际只读到 $offset 字节")
            offset += read
        }
        return data
    }
}

// -------------------------------------------------------------------------------------------------
// 测试替身
// -------------------------------------------------------------------------------------------------

private class InMemoryKnownHosts : KnownHostStore {
    private val entries = ConcurrentHashMap<String, Pair<String, String>>()
    val touches = AtomicInteger(0)

    private fun key(hostname: String, port: Int) = "$hostname:$port"

    override fun fingerprint(hostname: String, port: Int): String? = entries[key(hostname, port)]?.second

    override fun touch(hostname: String, port: Int) {
        touches.incrementAndGet()
    }

    override fun trust(hostname: String, port: Int, keyType: String, fingerprint: String) {
        entries[key(hostname, port)] = keyType to fingerprint
    }

    fun keyType(hostname: String, port: Int): String? = entries[key(hostname, port)]?.first
}

private class RecordingInteraction(
    private val acceptHostKey: Boolean = true,
    private val password: String? = null,
    private val keyboardAnswers: List<String>? = null,
) : SshInteraction {

    val challenges = CopyOnWriteArrayList<HostKeyChallenge>()
    val messages = CopyOnWriteArrayList<String>()
    val passwordRequests = CopyOnWriteArrayList<String>()
    val keyboardRequests = CopyOnWriteArrayList<List<KeyboardPrompt>>()

    override fun confirmHostKey(challenge: HostKeyChallenge): Boolean {
        challenges.add(challenge)
        return acceptHostKey
    }

    override fun respondToKeyboardInteractive(
        destination: String,
        name: String,
        instruction: String,
        prompts: List<KeyboardPrompt>,
    ): List<String>? {
        keyboardRequests.add(prompts)
        return keyboardAnswers
    }

    override fun requestPassword(message: String): String? {
        passwordRequests.add(message)
        return password
    }

    override fun showMessage(message: String) {
        messages.add(message)
    }
}

/**
 * 内嵌 MINA SSH 服务器。端口使用 0 自动分配；主机密钥为临时 RSA 2048 密钥。
 */
private class TestSshServer(
    private val password: String? = null,
    private val acceptAnyPublicKey: Boolean = false,
    private val keyboardInteractivePassword: String? = null,
    private val commandFactory: CommandFactory? = null,
    private val sftpRoot: Path? = null,
    private val shellFactory: ShellFactory? = null,
) {
    private val keyDir: Path = Files.createTempDirectory("fluentssh-host-key-")
    private lateinit var server: SshServer

    var port: Int = 0
        private set

    fun start(): TestSshServer {
        val sshd = SshServer.setUpDefaultServer()
        sshd.host = "127.0.0.1"
        sshd.port = 0
        val keyProvider = SimpleGeneratorHostKeyProvider(keyDir.resolve("host_key.ser"))
        keyProvider.setAlgorithm("RSA")
        keyProvider.setKeySize(2048)
        sshd.keyPairProvider = keyProvider

        if (password != null) {
            sshd.passwordAuthenticator = PasswordAuthenticator { username, candidate, _ ->
                username == "tester" && candidate == password
            }
        }
        if (acceptAnyPublicKey) {
            sshd.publickeyAuthenticator = PublickeyAuthenticator { _, _, _ -> true }
        }
        if (keyboardInteractivePassword != null) {
            sshd.keyboardInteractiveAuthenticator =
                TestKeyboardInteractiveAuthenticator(keyboardInteractivePassword)
        }
        if (commandFactory != null) {
            sshd.commandFactory = commandFactory
        }
        if (shellFactory != null) {
            sshd.shellFactory = shellFactory
        }
        if (sftpRoot != null) {
            sshd.subsystemFactories = listOf(SftpSubsystemFactory())
            sshd.fileSystemFactory = VirtualFileSystemFactory(sftpRoot)
        }
        sshd.forwardingFilter = AcceptAllForwardingFilter.INSTANCE

        sshd.start()
        server = sshd
        port = sshd.port
        return this
    }

    fun stop() {
        runCatching { server.stop(true) }
        runCatching { keyDir.toFile().deleteRecursively() }
    }
}

private class TestKeyboardInteractiveAuthenticator(
    private val expectedResponse: String,
) : KeyboardInteractiveAuthenticator {

    override fun generateChallenge(
        session: ServerSession,
        username: String,
        lang: String,
        subMethods: String,
    ): InteractiveChallenge {
        val challenge = InteractiveChallenge()
        challenge.interactionName = "FluentSSH 测试"
        challenge.interactionInstruction = "请输入测试口令"
        challenge.languageTag = ""
        challenge.addPrompt("Password: ", false)
        return challenge
    }

    override fun authenticate(
        session: ServerSession,
        username: String,
        responses: List<String>,
    ): Boolean = responses.size == 1 && responses[0] == expectedResponse
}

/** exec 通道：固定输出 / 错误 / 退出码。 */
private class FixedOutputCommand(
    private val stdout: String,
    private val stderr: String,
    private val exitCode: Int,
) : Command {

    private var input: InputStream? = null
    private var output: OutputStream? = null
    private var error: OutputStream? = null
    private var exitCallback: ExitCallback? = null

    override fun setInputStream(input: InputStream) {
        this.input = input
    }

    override fun setOutputStream(output: OutputStream) {
        this.output = output
    }

    override fun setErrorStream(error: OutputStream) {
        this.error = error
    }

    override fun setExitCallback(callback: ExitCallback) {
        this.exitCallback = callback
    }

    override fun start(channel: ChannelSession, env: Environment) {
        Thread({
            try {
                output?.write(stdout.toByteArray(Charsets.UTF_8))
                output?.flush()
                error?.write(stderr.toByteArray(Charsets.UTF_8))
                error?.flush()
            } catch (_: Throwable) {
                // 忽略写失败
            } finally {
                exitCallback?.onExit(exitCode)
            }
        }, "fixed-output-command").apply { isDaemon = true }.start()
    }

    override fun destroy(channel: ChannelSession) {
        // 无需清理
    }
}

/** exec 通道：永不结束，用于验证超时处理。 */
private class HangingCommand : Command {

    private var exitCallback: ExitCallback? = null

    override fun setInputStream(input: InputStream) = Unit

    override fun setOutputStream(output: OutputStream) = Unit

    override fun setErrorStream(error: OutputStream) = Unit

    override fun setExitCallback(callback: ExitCallback) {
        exitCallback = callback
    }

    override fun start(channel: ChannelSession, env: Environment) {
        // 故意不调用 exitCallback.onExit，模拟挂死命令。
    }

    override fun destroy(channel: ChannelSession) {
        exitCallback?.onExit(1)
    }
}

/** shell 通道：原样回显输入。 */
private class EchoShellFactory : ShellFactory {
    override fun createShell(channel: ChannelSession): Command = EchoShellCommand()
}

private class EchoShellCommand : Command {

    private var input: InputStream? = null
    private var output: OutputStream? = null
    private var exitCallback: ExitCallback? = null

    override fun setInputStream(input: InputStream) {
        this.input = input
    }

    override fun setOutputStream(output: OutputStream) {
        this.output = output
    }

    override fun setErrorStream(error: OutputStream) = Unit

    override fun setExitCallback(callback: ExitCallback) {
        exitCallback = callback
    }

    override fun start(channel: ChannelSession, env: Environment) {
        Thread({
            try {
                val buffer = ByteArray(1024)
                while (true) {
                    val read = input?.read(buffer) ?: break
                    if (read < 0) break
                    output?.write(buffer, 0, read)
                    output?.flush()
                }
            } catch (_: Throwable) {
                // 通道关闭
            } finally {
                exitCallback?.onExit(0)
            }
        }, "echo-shell").apply { isDaemon = true }.start()
    }

    override fun destroy(channel: ChannelSession) {
        // 关闭时输入流会 EOF，线程自然退出。
    }
}

/** 简单的 TCP 回显服务器，用作端口转发的目标。 */
private class EchoServer {

    private val serverSocket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    private val running = AtomicBoolean(true)

    val port: Int = serverSocket.localPort

    init {
        Thread({
            while (running.get()) {
                val socket = try {
                    serverSocket.accept()
                } catch (_: Throwable) {
                    break
                }
                Thread({ echo(socket) }, "echo-server-conn").apply { isDaemon = true }.start()
            }
        }, "echo-server-accept").apply { isDaemon = true }.start()
    }

    private fun echo(socket: Socket) {
        try {
            socket.use { client ->
                val input = client.getInputStream()
                val output = client.getOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    output.flush()
                }
            }
        } catch (_: Throwable) {
            // 连接结束
        }
    }

    fun close() {
        running.set(false)
        runCatching { serverSocket.close() }
    }
}
