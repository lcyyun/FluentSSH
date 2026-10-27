package com.fluentssh.mobile.ssh

import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.SftpException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream

/**
 * 基于 JSch `ChannelSftp` 的远端文件客户端。
 *
 * SFTP 协议在单个通道上只能串行请求，因此所有操作都通过 [Mutex] 串行化，并在 [Dispatchers.IO] 上执行。
 * 所有异常都会转换成带中文提示的 [SshException]。
 */
class RemoteFileClient internal constructor(
    private val sftp: ChannelSftp,
) : Closeable {

    private val mutex = Mutex()

    private suspend fun <T> runSftp(
        action: String,
        path: String? = null,
        block: () -> T,
    ): T = withContext(Dispatchers.IO) {
        mutex.withLock {
            try {
                block()
            } catch (error: Throwable) {
                throw SshSupport.sftpFailure(error, action, path)
            }
        }
    }

    /** 远端用户主目录（绝对路径）。 */
    suspend fun homePath(): String = runSftp("获取主目录") {
        try {
            sftp.getHome()
        } catch (_: Throwable) {
            sftp.realpath(".")
        }
    }

    /** 列出目录内容；默认不显示以 `.` 开头的隐藏项。目录在前、文件在后，按名称排序。 */
    suspend fun list(path: String, showHidden: Boolean = false): List<RemoteFile> =
        runSftp("列目录", path) {
            val entries = sftp.ls(path)
            val result = ArrayList<RemoteFile>(entries.size)
            for (entry in entries) {
                val name = entry.filename ?: continue
                if (name == "." || name == "..") continue
                if (!showHidden && name.startsWith(".")) continue
                val attrs = entry.attrs
                result.add(
                    RemoteFile(
                        name = name,
                        path = SshSupport.joinPath(path, name),
                        isDirectory = attrs.isDir,
                        size = attrs.size,
                        modifiedAt = attrs.mTime.toLong() * 1000L,
                    ),
                )
            }
            result.sortWith(compareBy<RemoteFile> { !it.isDirectory }.thenBy { it.name.lowercase() })
            result
        }

    suspend fun mkdir(path: String) = runSftp("创建目录", path) {
        sftp.mkdir(path)
    }

    suspend fun rename(oldPath: String, newPath: String) = runSftp("重命名", oldPath) {
        sftp.rename(oldPath, newPath)
    }

    /** 删除文件或空目录。 */
    suspend fun delete(path: String) = runSftp("删除", path) {
        val attrs = sftp.lstat(path)
        if (attrs.isDir && !attrs.isLink) {
            sftp.rmdir(path)
        } else {
            sftp.rm(path)
        }
    }

    /** 递归删除文件或目录（不跟随符号链接）。 */
    suspend fun deleteRecursive(path: String) = runSftp("递归删除", path) {
        deleteRecursiveLocked(path)
    }

    private fun deleteRecursiveLocked(path: String) {
        val attrs = try {
            sftp.lstat(path)
        } catch (error: SftpException) {
            if (error.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) return
            throw error
        }
        if (attrs.isDir && !attrs.isLink) {
            val entries = sftp.ls(path)
            for (entry in entries) {
                val name = entry.filename ?: continue
                if (name == "." || name == "..") continue
                deleteRecursiveLocked(SshSupport.joinPath(path, name))
            }
            sftp.rmdir(path)
        } else {
            sftp.rm(path)
        }
    }

    /** 下载远端文件到 [output]，[onProgress] 参数为（已传输字节, 总字节）。 */
    suspend fun download(
        remotePath: String,
        output: OutputStream,
        onProgress: (Long, Long) -> Unit = { _, _ -> },
    ) = runSftp("下载", remotePath) {
        val total = try {
            sftp.lstat(remotePath).size
        } catch (_: Throwable) {
            0L
        }
        onProgress(0L, total)
        sftp.get(remotePath, output, ProgressReporter(total, onProgress))
        output.flush()
    }

    /** 上传 [input] 到 [remotePath]（覆盖写），[onProgress] 参数为（已传输字节, 总字节）。 */
    suspend fun upload(
        input: InputStream,
        remotePath: String,
        totalBytes: Long,
        onProgress: (Long, Long) -> Unit = { _, _ -> },
    ) = runSftp("上传", remotePath) {
        onProgress(0L, totalBytes)
        sftp.put(input, remotePath, ProgressReporter(totalBytes, onProgress), ChannelSftp.OVERWRITE)
    }

    /** 读取文本文件（UTF-8），默认最多读取 4 MiB，超出直接报错而不是截断。 */
    suspend fun readText(remotePath: String, maxBytes: Long = 4L * 1024 * 1024): String =
        runSftp("读取文件", remotePath) {
            val knownSize = try {
                sftp.lstat(remotePath).size
            } catch (_: Throwable) {
                -1L
            }
            if (knownSize > maxBytes) {
                throw SshException("文件过大：$remotePath 大小 $knownSize 字节，超过读取上限 $maxBytes 字节")
            }
            val buffer = ByteArrayOutputStream()
            val remoteInput = sftp.get(remotePath)
            try {
                val chunk = ByteArray(16 * 1024)
                var total = 0L
                while (true) {
                    val read = remoteInput.read(chunk)
                    if (read < 0) break
                    total += read
                    if (total > maxBytes) {
                        throw SshException("文件过大：$remotePath 超过读取上限 $maxBytes 字节")
                    }
                    buffer.write(chunk, 0, read)
                }
            } finally {
                runCatching { remoteInput.close() }
            }
            buffer.toString(Charsets.UTF_8.name())
        }

    /** 以 UTF-8 覆盖写入文本文件。 */
    suspend fun writeText(remotePath: String, text: String) = runSftp("写入文件", remotePath) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        ByteArrayInputStream(bytes).use { input ->
            sftp.put(input, remotePath, ChannelSftp.OVERWRITE)
        }
    }

    override fun close() {
        runCatching { sftp.disconnect() }
    }
}
