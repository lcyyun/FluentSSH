# FluentSSH Android — 验证记录

## 1. 构建

- JDK 21.0.5（Zulu）、Android SDK Platform 34 / Build-Tools 34.0.0、Gradle 8.6、AGP 8.4.2、Kotlin 2.0.21
- `:app:assembleDebug`：通过
- `:app:assembleRelease`：通过（当前沿用 debug 签名，便于侧载）
- `:app:lintVitalRelease`：通过

产物：

| 文件 | 大小 |
| --- | --- |
| `dist/android/FluentSSH-android-v1.0.0.apk` | 13.4 MB |
| `android/app/build/outputs/apk/debug/app-debug.apk` | 19.4 MB |

## 2. JVM 单元测试（70/70）

```text
TerminalEmulatorTest   53 tests   0 failures   0 errors   0 skipped
SshEngineTest          12 tests   0 failures   0 errors   0 skipped
KeyServiceTest          5 tests   0 failures   0 errors   0 skipped
```

- 终端：CSI/OSC/SGR、备用屏、滚动区域、deferred wrap、UTF-8 分片、CJK 宽字符、scrollback、resize、DSR/DA。
- SSH：内嵌 Apache MINA SSHD，覆盖密码 / 私钥 / 键盘交互认证、主机密钥确认、拒绝与指纹变化、exec 输出与退出码、超时、SFTP 中文路径、本地转发、SOCKS5 IPv4/域名、远程转发、KeyService 生成/导入。

复跑命令：

```powershell
cd D:\ssh\android
$env:JAVA_HOME='<jdk>'; $env:ANDROID_HOME='<sdk>'
& '<gradle>/bin/gradle.bat' --console=plain :app:testDebugUnitTest
```

## 3. Android 14 模拟器端到端验收

环境：Pixel 5 AVD（Android 14 / x86_64 / WHPX 加速），真实 APK 安装；本地 mock SSH/SFTP/HTTP 服务器。

| 验收项 | 结果 |
| --- | --- |
| 主机列表 / 分组 / 收藏 / 搜索 / 最近连接 | 通过（3 台演示主机） |
| 主机密钥确认弹层（SHA256 指纹 + 风险提示） | 通过；信任后写入 Known Hosts |
| SSH 终端连接（ed25519 主机密钥 + 密码认证） | 通过（BouncyCastle Ed25519 路径） |
| 终端输出 / `uname -a` / 光标 / 扩展按键 | 通过 |
| 多会话标签 / 会话列表 / 重连 | 通过 |
| SFTP 连接、目录浏览（logs / projects / README.md 等） | 通过 |
| SFTP 新建/重命名/删除/上传/下载流程 | 通过（代码路径 + 交互走查） |
| SSH 本地隧道自动启动 | 通过（127.0.0.1:18080 → 127.0.0.1:53655） |
| 通过隧道访问 HTTP 服务 | 通过，返回真实 JSON：`{"service":"fluent-ssh-tunnel-target","method":"GET","path":"/"}` |
| 远程命令执行 | 通过，退出码 0，输出与耗时展示 |
| RSA 3072 密钥生成 / 公钥格式 / 指纹 | 通过（设备端生成，Keystore 加密保存） |
| Known Hosts / 审计日志 / 会话录制 | 通过 |
| 浅色 / 深色 / 跟随系统主题 | 通过 |
| Release 包安装启动、数据持久化、凭据解密 | 通过 |

## 4. 设计规范走查

见 [`DESIGN-AUDIT.md`](DESIGN-AUDIT.md)，16 项门禁全部满足；截图证据在 [`screenshots/`](screenshots)。

## 5. 已知限制

- 模拟器端到端测试使用本地 mock 服务；真实服务器上的算法协商、PTY 行为与网络环境仍需用户自测。
- 远程转发连接计数固定为 0（JSch 不暴露该计数）。
- SOCKS5 仅支持 CONNECT，不支持 BIND / UDP ASSOCIATE。
- 终端为 xterm 常用子集，不含 sixel / 图片协议；scrollback 不做 reflow。
- Release 包使用 debug 签名，正式上架前需替换 release keystore。
