package com.fluentssh.mobile.ssh

/**
 * FluentSSH SSH/SFTP/端口转发引擎的公开类型定义。
 *
 * 本包是纯 Kotlin/JVM 实现：不依赖 Android API，也不依赖 Compose，可直接在 JVM 单元测试中运行。
 */

/** SSH 认证方式。 */
sealed interface SshAuth {
    /** 密码认证。 */
    data class Password(val password: String) : SshAuth

    /**
     * 私钥认证。[privateKeyPem] 支持 PEM（PKCS#1 / PKCS#8 / OpenSSH 传统格式）
     * 以及 `-----BEGIN OPENSSH PRIVATE KEY-----` 新格式；[passphrase] 为空表示私钥未加密。
     */
    data class PrivateKey(val privateKeyPem: String, val passphrase: String?) : SshAuth

    /** 键盘交互认证（服务器逐条下发提示，由 [SshInteraction] 应答）。 */
    data object KeyboardInteractive : SshAuth
}

/** SSH 连接目标。 */
data class SshTarget(
    val hostname: String,
    val port: Int = 22,
    val username: String,
    val auth: SshAuth,
    val keepAliveSeconds: Int = 30,
    val connectTimeoutMs: Int = 20_000,
)

/**
 * 首次连接 / 主机密钥发生变化时交给 [SshInteraction.confirmHostKey] 的挑战信息。
 *
 * [previousFingerprint] 非空表示该主机在已知主机库中已有记录，但本次服务器出示的密钥不同
 * （可能是服务器更换了主机密钥，也可能是中间人攻击）。
 */
data class HostKeyChallenge(
    val hostname: String,
    val port: Int,
    val keyType: String,
    val fingerprint: String,
    val previousFingerprint: String?,
)

/** 键盘交互认证中的单条提示。 */
data class KeyboardPrompt(val text: String, val echo: Boolean)

/**
 * SSH 交互回调。
 *
 * 注意：这些方法会被 JSch 的 IO 线程同步调用，实现方允许使用 `runBlocking` 阻塞等待 UI 结果。
 * 引擎本身不会弹出任何 Android UI。
 */
interface SshInteraction {
    /** 阻塞式确认主机密钥；返回 true 表示信任并继续连接。 */
    fun confirmHostKey(challenge: HostKeyChallenge): Boolean

    /** 键盘交互认证；返回与 [prompts] 一一对应的应答，返回 null 表示取消认证。 */
    fun respondToKeyboardInteractive(
        destination: String,
        name: String,
        instruction: String,
        prompts: List<KeyboardPrompt>,
    ): List<String>?

    /** 请求用户输入密码 / 私钥口令；返回 null 表示取消。 */
    fun requestPassword(message: String): String?

    /** 展示服务器消息（banner 等）。 */
    fun showMessage(message: String)
}

/** 已知主机指纹仓库（由 AppStore 实现）。 */
interface KnownHostStore {
    /** 返回已知指纹（形如 `SHA256:xxxx`），没有记录时返回 null。 */
    fun fingerprint(hostname: String, port: Int): String?

    /** 连接成功且主机密钥匹配后刷新最近使用时间。 */
    fun touch(hostname: String, port: Int)

    /** 记录信任的主机密钥。 */
    fun trust(hostname: String, port: Int, keyType: String, fingerprint: String)
}

/** 引擎统一异常；[message] 是可以直接展示给用户的中文提示。 */
class SshException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** 单次命令执行结果。 */
data class ExecResult(
    val output: String,
    val error: String,
    val exitCode: Int?,
    val durationMs: Long,
)

/** 交互式 Shell 句柄。 */
interface ShellHandle {
    val isOpen: Boolean

    /** 向远端终端写入数据（按键输入）。 */
    fun write(bytes: ByteArray)

    /** 调整远端 PTY 尺寸。 */
    fun resize(cols: Int, rows: Int)

    fun close()
}

/** 远端文件 / 目录条目。 */
data class RemoteFile(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Long,
    val modifiedAt: Long,
)

/** 端口转发句柄。 */
interface ForwardHandle {
    /** 实际监听端口（bindPort 传 0 时为系统分配的端口）。 */
    val boundPort: Int

    /** 当前活跃连接数（远程转发由于 JSch 内部实现无法统计，返回 0）。 */
    val connectionCount: Int

    fun close()
}

/** KeyService 生成 / 导入的密钥信息。 */
data class GeneratedKey(
    val privateKeyPem: String,
    val publicKeyOpenSsh: String,
    val fingerprint: String,
    val bits: Int,
)
