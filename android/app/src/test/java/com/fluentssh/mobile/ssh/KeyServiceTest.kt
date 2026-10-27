package com.fluentssh.mobile.ssh

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * KeyService 单元测试：RSA 生成、OpenSSH 公钥格式、SHA-256 指纹与私钥导入（含口令）。
 */
class KeyServiceTest {

    @Test(timeout = 180_000)
    fun generateRsa3072ProducesValidPublicKeyAndFingerprint() {
        val generated = KeyService.generateRsa()

        assertEquals("默认应为 3072 位 RSA", 3072, generated.bits)
        assertTrue(
            "私钥应为 PEM 文本，实际开头：${generated.privateKeyPem.take(40)}",
            generated.privateKeyPem.contains("PRIVATE KEY"),
        )
        assertTrue(generated.privateKeyPem.contains("-----BEGIN"))
        assertTrue(generated.privateKeyPem.contains("-----END"))

        val parts = generated.publicKeyOpenSsh.trim().split(' ')
        assertEquals("公钥行应有 3 段（类型 / blob / 注释）", 3, parts.size)
        assertEquals("ssh-rsa", parts[0])
        assertEquals("fluentssh@android", parts[2])

        val blob = Base64.getDecoder().decode(parts[1])
        assertEquals(
            "指纹应等于对公钥 blob 的 SHA-256",
            KeyService.sha256Fingerprint(blob),
            generated.fingerprint,
        )
        assertTrue("指纹应以 SHA256: 开头", generated.fingerprint.startsWith("SHA256:"))
        assertEquals("OpenSSH SHA-256 指纹总长度应为 50", 50, generated.fingerprint.length)
        assertFalse("指纹不应带 base64 填充", generated.fingerprint.contains('='))

        // 指纹计算稳定。
        assertEquals(generated.fingerprint, KeyService.sha256Fingerprint(blob))
    }

    @Test(timeout = 180_000)
    fun importGeneratedPrivateKeyWithoutPassphrase() {
        // 导入时无法从 PEM 中恢复注释，因此使用默认注释的密钥做完全一致的比较。
        val generated = KeyService.generateRsa(bits = 2048)
        val imported = KeyService.importPrivateKey(generated.privateKeyPem)

        assertEquals("导入后指纹应一致", generated.fingerprint, imported.fingerprint)
        assertEquals("导入后公钥应一致", generated.publicKeyOpenSsh, imported.publicKeyOpenSsh)
        assertEquals(2048, imported.bits)
        assertTrue(imported.publicKeyOpenSsh.startsWith("ssh-rsa "))
        assertEquals("fluentssh@android", imported.publicKeyOpenSsh.substringAfterLast(' '))
    }

    @Test(timeout = 180_000)
    fun importGeneratedPrivateKeyWithPassphrase() {
        val generated = KeyService.generateRsa(bits = 2048, passphrase = "p@ss-短语")
        assertTrue(
            "加密私钥应带 PEM 加密头",
            generated.privateKeyPem.contains("ENCRYPTED"),
        )

        val imported = KeyService.importPrivateKey(generated.privateKeyPem, "p@ss-短语")
        assertEquals(generated.fingerprint, imported.fingerprint)
        assertEquals(generated.publicKeyOpenSsh, imported.publicKeyOpenSsh)

        // 缺少口令
        val missing = assertThrows(SshException::class.java) {
            KeyService.importPrivateKey(generated.privateKeyPem)
        }
        assertTrue(
            "缺少口令的错误信息应说明读取私钥失败，实际：${missing.message}",
            missing.message.orEmpty().startsWith("读取私钥失败："),
        )

        // 错误口令
        val wrong = assertThrows(SshException::class.java) {
            KeyService.importPrivateKey(generated.privateKeyPem, "wrong-passphrase")
        }
        assertTrue(
            "错误口令的错误信息应说明读取私钥失败，实际：${wrong.message}",
            wrong.message.orEmpty().startsWith("读取私钥失败："),
        )
    }

    @Test(timeout = 60_000)
    fun importInvalidPrivateKeyFailsWithChineseMessage() {
        val error = assertThrows(SshException::class.java) {
            KeyService.importPrivateKey("这不是一个私钥")
        }
        assertTrue(
            "错误信息应以“读取私钥失败：”开头，实际：${error.message}",
            error.message.orEmpty().startsWith("读取私钥失败："),
        )

        val empty = assertThrows(SshException::class.java) {
            KeyService.importPrivateKey("   ")
        }
        assertTrue(empty.message.orEmpty().startsWith("读取私钥失败："))
    }

    @Test(timeout = 120_000)
    fun generateRsaDifferentKeysProduceDifferentFingerprints() {
        val first = KeyService.generateRsa(bits = 2048)
        val second = KeyService.generateRsa(bits = 2048)
        assertNotEquals(first.privateKeyPem, second.privateKeyPem)
        assertNotEquals(first.fingerprint, second.fingerprint)
    }
}
