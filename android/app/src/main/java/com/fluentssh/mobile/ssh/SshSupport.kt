package com.fluentssh.mobile.ssh

import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.SftpException
import com.jcraft.jsch.SftpProgressMonitor
import com.jcraft.jsch.UIKeyboardInteractive
import com.jcraft.jsch.UserInfo
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.Base64

/**
 * 引擎内部工具：指纹计算、SSH 公钥 blob 解析、路径处理、错误中文化。
 */
internal object SshSupport {

    const val KNOWN_HOSTS_REPOSITORY_ID = "fluentssh"

    /** OpenSSH 风格 SHA-256 指纹：`SHA256:` + Base64(SHA-256(公钥 blob))，去掉尾部 `=`。 */
    fun sha256Fingerprint(publicKeyBlob: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(publicKeyBlob)
        return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(digest)
    }

    /** 从 SSH 公钥 blob 中解析密钥类型，如 `ssh-rsa`、`ssh-ed25519`、`ecdsa-sha2-nistp256`。 */
    fun keyTypeOf(publicKeyBlob: ByteArray): String {
        if (publicKeyBlob.size < 5) return "unknown"
        val length = readUInt32(publicKeyBlob, 0)
        if (length <= 0 || length > publicKeyBlob.size - 4) return "unknown"
        return String(publicKeyBlob, 4, length, Charsets.US_ASCII)
    }

    fun base64NoPadding(bytes: ByteArray): String =
        Base64.getEncoder().withoutPadding().encodeToString(bytes)

    fun base64WithPadding(bytes: ByteArray): String =
        Base64.getEncoder().encodeToString(bytes)

    fun decodeBase64OrNull(text: String): ByteArray? = try {
        Base64.getDecoder().decode(text)
    } catch (_: Throwable) {
        null
    }

    /** 拼接 SFTP 路径，正确处理根目录与尾部斜杠。 */
    fun joinPath(parent: String, name: String): String = when {
        parent.isEmpty() -> name
        parent.endsWith("/") -> parent + name
        else -> "$parent/$name"
    }

    fun readUInt32(bytes: ByteArray, offset: Int): Int {
        if (offset < 0 || offset + 4 > bytes.size) return -1
        return ((bytes[offset].toInt() and 0xFF) shl 24) or
            ((bytes[offset + 1].toInt() and 0xFF) shl 16) or
            ((bytes[offset + 2].toInt() and 0xFF) shl 8) or
            (bytes[offset + 3].toInt() and 0xFF)
    }

    /** 从字节流中读取指定长度，读到 EOF 抛 [EOFException]。 */
    @Throws(IOException::class)
    fun readFully(input: InputStream, length: Int): ByteArray {
        if (length < 0) throw EOFException("负的读取长度")
        val data = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = input.read(data, offset, length - offset)
            if (read < 0) throw EOFException("连接在读取 $length 字节前结束")
            offset += read
        }
        return data
    }

    /** 将 [input] 全部拷贝到 [output]，返回拷贝字节数；不关闭任何流。 */
    @Throws(IOException::class)
    fun copy(input: InputStream, output: OutputStream, bufferSize: Int = 16 * 1024): Long {
        val buffer = ByteArray(bufferSize)
        var total = 0L
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            total += read
        }
        output.flush()
        return total
    }

    /** 把任意异常转换成带中文提示的 [SshException]。 */
    fun sshFailure(error: Throwable, target: SshTarget?, action: String = "SSH 连接失败"): SshException {
        if (error is SshException) return error
        val where = target?.let { "${it.hostname}:${it.port}" } ?: ""
        val messages = causeMessages(error)
        val lower = messages.lowercase()

        return when {
            // 主机密钥校验失败（用户拒绝 / 密钥变化 / 被吊销）
            lower.contains("reject hostkey") ||
                lower.contains("unknownhostkey") ||
                lower.contains("hostkey has been changed") ||
                lower.contains("revoked hostkey") ||
                lower.contains("主机密钥") ->
                SshException(
                    "主机密钥校验失败：${where.ifEmpty { "目标主机" }} 的主机密钥未受信任或已发生变化，连接已中止。" +
                        "请确认服务器身份后重新信任该主机密钥。",
                    error,
                )

            // 认证失败
            lower.contains("auth fail") ||
                lower.contains("auth cancel") ||
                lower.contains("auth rejected") ||
                lower.contains("userauth fail") ||
                lower.contains("partialauth") ||
                lower.contains("authentication failed") ||
                lower.contains("invalid password") ||
                lower.contains("invalid username") ->
                SshException(
                    "认证失败：用户名或认证凭据不正确，或服务器不允许使用当前认证方式。",
                    error,
                )

            // 算法协商失败
            (lower.contains("algorithm negotiation") ||
                lower.contains("no matching") ||
                lower.contains("no common") ||
                lower.contains("invalid kex") ||
                lower.contains("not any available") ||
                lower.contains("no available")) &&
                (lower.contains("algorithm") || lower.contains("kex") ||
                    lower.contains("cipher") || lower.contains("mac") ||
                    lower.contains("sig")) ->
                SshException(
                    "SSH 算法协商失败：客户端与服务器之间没有共同支持的加密、MAC 或密钥交换算法。",
                    error,
                )

            // 超时
            lower.contains("timeout") || lower.contains("timed out") || lower.contains("timedout") ->
                SshException(
                    "连接超时：无法在 ${target?.connectTimeoutMs ?: 0}ms 内完成与 ${where.ifEmpty { "目标主机" }} 的 SSH 握手。",
                    error,
                )

            // 连接被拒绝
            lower.contains("connection refused") || lower.contains("econnrefused") ->
                SshException(
                    "无法连接到 ${where.ifEmpty { "目标主机" }}：连接被拒绝，请检查主机地址、端口以及网络是否可达。",
                    error,
                )

            // 主机不可达 / DNS 解析失败
            lower.contains("unknownhost") ||
                lower.contains("nodename nor servname") ||
                lower.contains("network is unreachable") ||
                lower.contains("no route to host") ||
                lower.contains("host is unreachable") ->
                SshException(
                    "无法连接到 ${where.ifEmpty { "目标主机" }}：主机名无法解析或网络不可达。",
                    error,
                )

            // 通道打开失败
            lower.contains("channel is not opened") ||
                lower.contains("channel open failure") ||
                lower.contains("channel not opened") ||
                lower.contains("administratively prohibited") ||
                lower.contains("open failed") ->
                SshException("通道打开失败：服务器拒绝了本次通道请求（${messages}）。", error)

            // 会话断开
            lower.contains("session is down") ||
                lower.contains("session is not connected") ||
                lower.contains("connection is closed") ||
                lower.contains("broken pipe") ||
                lower.contains("socket closed") ||
                lower.contains("connection reset") ->
                SshException("SSH 会话已断开，请重新连接。", error)

            // 私钥格式 / 口令
            lower.contains("invalid privatekey") ||
                lower.contains("privatekey:") ||
                lower.contains("passphrase") ->
                SshException("私钥读取失败：${messages.ifBlank { "私钥格式无法识别或口令错误" }}", error)

            messages.isNotBlank() -> SshException("${action}：$messages", error)
            else -> SshException("${action}：${error.javaClass.simpleName}", error)
        }
    }

    /** 把 SFTP 异常转换成带中文提示的 [SshException]。 */
    fun sftpFailure(error: Throwable, action: String, path: String? = null): SshException {
        if (error is SshException) return error
        val suffix = path?.takeIf { it.isNotBlank() }?.let { "（$it）" } ?: ""
        if (error is SftpException) {
            return when (error.id) {
                ChannelSftp.SSH_FX_NO_SUCH_FILE ->
                    SshException("文件或目录不存在$suffix", error)

                ChannelSftp.SSH_FX_PERMISSION_DENIED ->
                    SshException("SFTP 权限不足${suffix}：服务器拒绝访问，请检查文件权限。", error)

                ChannelSftp.SSH_FX_NO_CONNECTION, ChannelSftp.SSH_FX_CONNECTION_LOST ->
                    SshException("SFTP 连接已断开，请重新连接后重试。", error)

                ChannelSftp.SSH_FX_OP_UNSUPPORTED ->
                    SshException("服务器不支持该 SFTP 操作${suffix}。", error)

                ChannelSftp.SSH_FX_FAILURE ->
                    SshException("SFTP ${action}失败${suffix}：${error.message?.takeIf { it.isNotBlank() } ?: "服务器返回失败"}", error)

                else ->
                    SshException("SFTP ${action}失败${suffix}：${error.message?.takeIf { it.isNotBlank() } ?: "未知错误"}", error)
            }
        }
        if (error is IOException) {
            return SshException("SFTP ${action}失败${suffix}：网络读写错误（${error.message ?: error.javaClass.simpleName}）", error)
        }
        return SshException("SFTP ${action}失败${suffix}：${error.message ?: error.javaClass.simpleName}", error)
    }

    private fun causeMessages(error: Throwable): String {
        val builder = StringBuilder()
        var current: Throwable? = error
        var guard = 0
        while (current != null && guard < 8) {
            val message = current.message
            if (!message.isNullOrBlank() && !builder.contains(message)) {
                if (builder.isNotEmpty()) builder.append(" | ")
                builder.append(message)
            }
            current = current.cause
            guard++
        }
        if (builder.isEmpty()) builder.append(error.javaClass.simpleName)
        return builder.toString()
    }
}

/**
 * 基于 [KnownHostStore] 的 JSch 主机密钥仓库。
 *
 * JSch 在 `StrictHostKeyChecking=ask` 时会先调用 [check]：
 * - 返回 [HostKeyRepository.OK] 表示信任，JSch 不再弹出它自己的确认框；
 * - 返回 NOT_INCLUDED / CHANGED 时 JSch 会调用 [UserInfo.promptYesNo]，
 *   而 [InteractionUserInfo.promptYesNo] 一律返回 false，因此连接会以主机密钥异常中止。
 *
 * 由于确认逻辑已经在这里完成，不会出现重复弹窗。
 */
internal class StoreHostKeyRepository(
    private val target: SshTarget,
    private val interaction: SshInteraction,
    private val knownHosts: KnownHostStore,
    private val strictHostKeys: Boolean,
) : HostKeyRepository {

    @Volatile
    var rejected: Boolean = false
        private set

    @Volatile
    var lastChallenge: HostKeyChallenge? = null
        private set

    override fun check(host: String, key: ByteArray): Int {
        if (key.isEmpty()) return HostKeyRepository.NOT_INCLUDED
        val fingerprint = SshSupport.sha256Fingerprint(key)
        val keyType = SshSupport.keyTypeOf(key)
        val hostname = target.hostname
        val port = target.port
        val known = runCatching { knownHosts.fingerprint(hostname, port) }.getOrNull()

        // 已知且一致：直接信任并刷新记录。
        if (known != null && known.equals(fingerprint, ignoreCase = true)) {
            runCatching { knownHosts.touch(hostname, port) }
            return HostKeyRepository.OK
        }

        // 非严格模式：不打扰用户，直接接受（首次记录或覆盖变化后的密钥）。
        if (!strictHostKeys) {
            runCatching { knownHosts.trust(hostname, port, keyType, fingerprint) }
            return HostKeyRepository.OK
        }

        val challenge = HostKeyChallenge(
            hostname = hostname,
            port = port,
            keyType = keyType,
            fingerprint = fingerprint,
            previousFingerprint = known,
        )
        lastChallenge = challenge
        val accepted = try {
            interaction.confirmHostKey(challenge)
        } catch (_: Throwable) {
            false
        }
        if (accepted) {
            runCatching { knownHosts.trust(hostname, port, keyType, fingerprint) }
            return HostKeyRepository.OK
        }
        rejected = true
        return if (known == null) HostKeyRepository.NOT_INCLUDED else HostKeyRepository.CHANGED
    }

    override fun add(hostkey: HostKey?, ui: UserInfo?) {
        val hk = hostkey ?: return
        val raw = SshSupport.decodeBase64OrNull(hk.key) ?: return
        val fingerprint = SshSupport.sha256Fingerprint(raw)
        val keyType = hk.type?.takeIf { it.isNotBlank() && it != "UNKNOWN" }
            ?: SshSupport.keyTypeOf(raw)
        runCatching { knownHosts.trust(target.hostname, target.port, keyType, fingerprint) }
    }

    override fun remove(host: String?, type: String?) {
        // KnownHostStore 不提供删除能力；AppStore 的“删除已知主机”通过自己的 UI 完成。
    }

    override fun remove(host: String?, type: String?, key: ByteArray?) {
        // 同上。
    }

    override fun getKnownHostsRepositoryID(): String = SshSupport.KNOWN_HOSTS_REPOSITORY_ID

    override fun getHostKey(): Array<HostKey> = emptyArray()

    override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()
}

/**
 * 把 JSch 的 [UserInfo] / [UIKeyboardInteractive] 回调转发给 [SshInteraction]。
 *
 * 注意 [promptYesNo] 固定返回 false：主机密钥确认已在 [StoreHostKeyRepository.check] 中完成，
 * 这里返回 false 可以让 JSch 在用户拒绝后正确地中止连接，而不是再弹一次确认。
 */
internal class InteractionUserInfo(
    private val target: SshTarget,
    private val interaction: SshInteraction,
) : UserInfo, UIKeyboardInteractive {

    @Volatile
    private var promptedPassword: String? = null

    @Volatile
    private var promptedPassphrase: String? = null

    override fun getPassphrase(): String? =
        (target.auth as? SshAuth.PrivateKey)?.passphrase ?: promptedPassphrase

    override fun getPassword(): String? =
        (target.auth as? SshAuth.Password)?.password ?: promptedPassword

    override fun promptPassword(message: String?): Boolean {
        val value = try {
            interaction.requestPassword(
                message ?: "请输入 ${target.username}@${target.hostname} 的登录密码",
            )
        } catch (_: Throwable) {
            null
        } ?: return false
        promptedPassword = value
        return true
    }

    override fun promptPassphrase(message: String?): Boolean {
        val value = try {
            interaction.requestPassword(message ?: "请输入私钥口令")
        } catch (_: Throwable) {
            null
        } ?: return false
        promptedPassphrase = value
        return true
    }

    override fun promptYesNo(message: String?): Boolean = false

    override fun showMessage(message: String?) {
        if (message.isNullOrBlank()) return
        runCatching { interaction.showMessage(message) }
    }

    override fun promptKeyboardInteractive(
        destination: String?,
        name: String?,
        instruction: String?,
        prompt: Array<out String>?,
        echo: BooleanArray?,
    ): Array<String>? {
        val texts = prompt ?: emptyArray()
        val prompts = texts.mapIndexed { index, text ->
            KeyboardPrompt(text = text, echo = echo?.getOrNull(index) ?: false)
        }
        val answers = try {
            interaction.respondToKeyboardInteractive(
                destination = destination ?: "",
                name = name ?: "",
                instruction = instruction ?: "",
                prompts = prompts,
            )
        } catch (_: Throwable) {
            null
        } ?: return null
        return answers.toTypedArray()
    }
}

/** SFTP 传输进度回调适配器。 */
internal class ProgressReporter(
    private var total: Long,
    private val onProgress: (Long, Long) -> Unit,
) : SftpProgressMonitor {

    private var done: Long = 0L

    override fun init(op: Int, src: String?, dest: String?, max: Long) {
        if (max > 0) total = max
        report(0L, total)
    }

    override fun count(count: Long): Boolean {
        done += count
        report(done, total)
        return true
    }

    override fun end() {
        report(done, total)
    }

    private fun report(current: Long, max: Long) {
        runCatching { onProgress(current, max) }
    }
}
