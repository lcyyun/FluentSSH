package com.fluentssh.mobile.ssh

import com.jcraft.jsch.JSch
import com.jcraft.jsch.JSchException
import com.jcraft.jsch.KeyPair
import java.io.ByteArrayOutputStream
import java.util.Base64

/**
 * 密钥生成 / 导入服务。
 *
 * 纯 JVM 实现（JSch + JCE），不依赖 Android API；生成的私钥为 PEM 文本，可直接写入文件或数据库。
 */
object KeyService {

    private const val DEFAULT_COMMENT = "fluentssh@android"

    /**
     * 生成 RSA 密钥对。
     *
     * @param bits 密钥长度，默认 3072 位（建议不低于 2048）。
     * @param comment 公钥行尾注释。
     * @param passphrase 私钥口令；null 或空串表示不加密。
     */
    fun generateRsa(
        bits: Int = 3072,
        comment: String = DEFAULT_COMMENT,
        passphrase: String? = null,
    ): GeneratedKey {
        require(bits >= 2048) { "RSA 密钥长度至少为 2048 位" }
        val jsch = JSch()
        var keyPair: KeyPair? = null
        try {
            keyPair = KeyPair.genKeyPair(jsch, KeyPair.RSA, bits)
            val output = ByteArrayOutputStream()
            keyPair.writePrivateKey(output, passphraseBytes(passphrase))
            val pem = output.toString(Charsets.UTF_8.name())
            val blob = keyPair.publicKeyBlob
                ?: throw SshException("生成 RSA 密钥失败：无法获取公钥数据")
            val keyType = keyPair.keyTypeString
            val publicKeyLine = buildPublicKeyLine(keyType, blob, comment)
            return GeneratedKey(
                privateKeyPem = pem.trim(),
                publicKeyOpenSsh = publicKeyLine,
                fingerprint = SshSupport.sha256Fingerprint(blob),
                bits = rsaBits(blob).takeIf { it > 0 } ?: bits,
            )
        } catch (error: SshException) {
            throw error
        } catch (error: Throwable) {
            throw SshException("生成 RSA 密钥失败：${error.message ?: error.javaClass.simpleName}", error)
        } finally {
            runCatching { keyPair?.dispose() }
        }
    }

    /**
     * 导入 PEM / OpenSSH 私钥并验证可用性。
     *
     * @param pem 私钥文本（PKCS#1、PKCS#8、OpenSSH 新格式均可）。
     * @param passphrase 私钥口令；加密私钥必须提供正确口令。
     * @throws SshException 格式无法识别、口令缺失或口令错误时抛出，message 以“读取私钥失败：”开头。
     */
    fun importPrivateKey(pem: String, passphrase: String? = null): GeneratedKey {
        if (pem.isBlank()) throw SshException("读取私钥失败：私钥内容为空")
        val jsch = JSch()
        var keyPair: KeyPair? = null
        try {
            keyPair = KeyPair.load(jsch, pem.toByteArray(Charsets.UTF_8), null)
            if (keyPair.isEncrypted) {
                val bytes = passphraseBytes(passphrase)
                    ?: throw SshException("读取私钥失败：私钥已加密，请输入口令")
                val decrypted = try {
                    keyPair.decrypt(bytes)
                } catch (error: Throwable) {
                    throw SshException("读取私钥失败：口令错误，无法解密私钥", error)
                }
                if (!decrypted) {
                    throw SshException("读取私钥失败：口令错误，无法解密私钥")
                }
            }
            val blob = keyPair.publicKeyBlob
                ?: throw SshException("读取私钥失败：无法从私钥中提取公钥数据")
            val keyType = keyPair.keyTypeString
            val bits = keyBits(keyType, blob)
            return GeneratedKey(
                privateKeyPem = pem.trim(),
                publicKeyOpenSsh = buildPublicKeyLine(keyType, blob, DEFAULT_COMMENT),
                fingerprint = SshSupport.sha256Fingerprint(blob),
                bits = bits,
            )
        } catch (error: SshException) {
            throw error
        } catch (error: JSchException) {
            throw SshException("读取私钥失败：${error.message ?: "私钥格式无法识别"}", error)
        } catch (error: Throwable) {
            throw SshException("读取私钥失败：${error.message ?: error.javaClass.simpleName}", error)
        } finally {
            runCatching { keyPair?.dispose() }
        }
    }

    /** OpenSSH 风格 SHA-256 指纹：`SHA256:` + 无填充 Base64。 */
    fun sha256Fingerprint(publicKeyBlob: ByteArray): String =
        SshSupport.sha256Fingerprint(publicKeyBlob)

    private fun passphraseBytes(passphrase: String?): ByteArray? =
        passphrase?.takeIf { it.isNotEmpty() }?.toByteArray(Charsets.UTF_8)

    private fun buildPublicKeyLine(keyType: String, blob: ByteArray, comment: String): String {
        val encoded = Base64.getEncoder().encodeToString(blob)
        return if (comment.isBlank()) "$keyType $encoded" else "$keyType $encoded $comment"
    }

    /** 从 SSH 公钥 blob 推断密钥位数（RSA 取模数位长；ECDSA 取曲线位数）。 */
    private fun keyBits(keyType: String, blob: ByteArray): Int = when {
        keyType == "ssh-rsa" -> rsaBits(blob)
        keyType == "ssh-ed25519" -> 256
        keyType == "ssh-ed448" -> 456
        keyType == "ecdsa-sha2-nistp256" -> 256
        keyType == "ecdsa-sha2-nistp384" -> 384
        keyType == "ecdsa-sha2-nistp521" -> 521
        else -> 0
    }

    /**
     * 解析 SSH wire format：`string "ssh-rsa", mpint e, mpint n`，返回 n 的位长。
     */
    private fun rsaBits(blob: ByteArray): Int {
        var offset = 0
        fun readString(): ByteArray? {
            if (offset + 4 > blob.size) return null
            val length = SshSupport.readUInt32(blob, offset)
            offset += 4
            if (length < 0 || offset + length > blob.size) return null
            val value = blob.copyOfRange(offset, offset + length)
            offset += length
            return value
        }
        readString() ?: return 0 // key type
        readString() ?: return 0 // public exponent
        val modulus = readString() ?: return 0
        var index = 0
        while (index < modulus.size && modulus[index].toInt() == 0) index++
        if (index >= modulus.size) return 0
        val firstByte = modulus[index].toInt() and 0xFF
        return (modulus.size - index - 1) * 8 + (Integer.SIZE - Integer.numberOfLeadingZeros(firstByte))
    }
}
