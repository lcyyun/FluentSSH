# FluentSSH

现代化 **Fluent UI** 风格的本地 SSH 工作台：主机管理、加密凭据保险库、多标签终端、SFTP 文件管理、SSH 隧道（本地 / 远程 / SOCKS5）、一次性命令执行、密钥与 Known Hosts 管理、审计与会话录像，全部运行在你自己的机器上。

- 前端：React 18 + Fluent UI v9 + xterm.js 5，中文界面，浅色 / 深色主题与多种强调色
- 后端：Node.js + Express + ws + ssh2，前端构建产物由同一进程托管
- 默认地址：<http://127.0.0.1:4317>
- 所有服务器连接都由本机的 Node 服务发起；浏览器只负责界面与终端显示

![主机管理](docs/screenshots/hosts.png)
![终端会话](docs/screenshots/terminal.png)
![SFTP 文件管理](docs/screenshots/files.png)

更多界面截图见 [`docs/screenshots/`](docs/screenshots)：隧道、命令与片段、密钥与 Known Hosts、审计日志、设置、深色主题、命令面板与主机密钥确认。

---

## 功能

### 主机与连接
- 主机分组、收藏、标签、搜索、网格 / 列表视图、最近连接排序
- 密码、私钥、SSH Agent、Keyboard-interactive / OTP 四种认证方式
- 跳板机 ProxyJump（支持多级，最多 4 层）、Keepalive、连接超时、旧算法兼容
- 快速连接（可保存）、批量导入 `~/.ssh/config`、导出 SSH Config
- 主机级启动命令、环境变量、默认远程路径、终端参数
- 首次连接必须确认主机密钥指纹；密钥变化时显著告警（HOST_KEY_UNKNOWN / MISMATCH）
- 双击主机卡片直接连接；一键打开 SFTP 或运行命令

### 凭据保险库
- 密码、私钥、私钥口令使用 **AES-256-GCM** 加密落盘
- 默认使用本机随机主密钥（`data/keyring.json`），可选设置主密码：
  - 主密码经 **scrypt** 派生密钥包裹数据密钥
  - 自动锁定计时器；锁定后已保存凭据不可读取
- API 永不返回密码、口令或私钥；浏览器只能看到 `hasPassword` 标志
- 凭据随主机、保险库状态隔离；锁定状态由服务端强制校验

### 终端
- xterm.js 多标签终端，服务端会话在浏览器刷新后仍保持（输出环形缓冲重放）
- 支持连接状态、断线重连、重连保持同一会话、退出码提示、会话关闭
- 工具栏：搜索（Ctrl+Shift+F，高亮 + 匹配计数）、清屏、复制、重连、关闭、命令面板
- 终端状态栏：传输字节、延迟、连接时长、终端尺寸、SSH 主机密钥指纹
- 可配置字体、字号、行高、光标样式、回滚行数、提示音、选中即复制
- 键盘交互验证（OTP / 2FA）以全局弹窗完成
- 会话输出按设置记录到本地 `data/logs/`，可在日志页下载

### SFTP 文件管理
- 路径面包屑 / 可编辑路径输入、上级 / 主目录、刷新、隐藏文件、列表 / 网格视图
- 远端文件表：名称、大小、修改时间、权限、所有者，文件夹优先，列排序
- 多选（Ctrl / Shift / Ctrl+A）、右键菜单、键盘操作、拖拽上传
- 新建目录、重命名、删除（含递归二次确认）、修改权限（octal + rwx 矩阵）、创建符号链接、文件属性
- 文本编辑器：行号、Ctrl+S 保存、未保存确认、二进制 / 超大文件保护
- 上传 / 下载传输队列：进度、速度、取消、重试、冲突处理（覆盖 / 跳过 / 自动重命名）、并发上限
- 会话断开时显示重连入口；操作全部写入审计日志

### SSH 隧道
- 本地转发（`-L`）、远程转发（`-R`）、动态 SOCKS5（`-D`）
- 启停、编辑、复制 SSH 命令、自动启动、实时状态 / 连接数 / 流量计数 / 运行时长
- 隧道断开自动标记错误；主机密钥不信任时引导信任后重试
- 服务重启后自动启动已启用的隧道（保险库锁定时跳过）

### 命令与片段
- 一次性远程命令执行（SSH exec，独立于交互终端），输出 stdout / stderr / 退出码 / 耗时
- 命令历史（搜索、重跑、清空）与常用命令片段库（标签、搜索、复制、一键运行）
- 命令可直接在终端中打开；命令管道与退出码写入审计

### 密钥、Known Hosts 与审计
- 生成 ed25519 / RSA / ECDSA 密钥、导入私钥（支持口令）、查看 / 复制公钥、指纹（SHA256）、删除保护（被主机引用时 409）
- Known Hosts 列表、手动信任、删除、导入 / 导出现有 `known_hosts` 文本
- 审计时间线：连接、SFTP、隧道、命令、保险库、安全事件，支持分类 / 级别 / 文本筛选、实时追加、清空
- 会话录像：每个终端会话的输出记录，支持下载 / 删除

### 设置与体验
- 浅色 / 深色 / 跟随系统，7 种强调色，减少动画，紧凑模式
- 全局命令面板（Ctrl+K）：搜索主机、跳转页面、执行操作
- 连接状态实时推送（WebSocket），多标签页保持挂载不丢滚动与终端状态
- 数据导入 / 导出（SSH Config），无云端依赖

---

## 快速开始

要求：**Node.js ≥ 20**、pnpm。

```powershell
cd D:\ssh
pnpm install
pnpm build
pnpm start
```

打开 <http://127.0.0.1:4317>。

Windows 下也可以直接双击 `start.cmd`：自动安装依赖、构建界面、启动服务并打开浏览器。

首次启动会在 `D:\ssh\data\` 下自动创建数据目录与本地密钥；界面显示"保险库 · 本地密钥"，可直接使用。建议在 **设置 → 安全** 中设置主密码。

### 开发模式

```powershell
pnpm dev
```

- API + WebSocket：<http://127.0.0.1:4317>
- Vite 开发界面：<http://127.0.0.1:5173>（代理 `/api`、`/ws` 到后端）

### 可选配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FLUENTSSH_PORT` | `4317` | 服务端口 |
| `FLUENTSSH_HOST` | `127.0.0.1` | 监听地址（默认仅本机） |
| `FLUENTSSH_DATA_DIR` | `D:\ssh\data` | 数据目录 |
| `FLUENTSSH_WEB_DIST` | `D:\ssh\web\dist` | 前端构建目录 |

---

## 数据与安全

```
data/
├─ store.json        # 主机、分组、密钥元数据、Known Hosts、设置、审计、隧道配置
├─ vault.json        # 主密码保护元数据（加密数据密钥）
├─ keyring.json      # 未启用主密码时的本地数据密钥（0600）
└─ logs/             # 终端会话录像（明文，可在设置中关闭记录）
```

- 服务仅监听 `127.0.0.1`，使用随机 HttpOnly 本地会话 Cookie 保护 API 与 WebSocket。
- 所有密码 / 私钥 / 口令以 AES-256-GCM 加密；API 中没有读取明文秘密的接口。
- 主密码通过 scrypt 派生 KEK，包裹数据密钥。**忘记主密码将无法恢复已保存凭据。**
- 主机密钥校验使用 Known Hosts；未知密钥需要显式信任，变化时拒绝连接并告警。
- 会话录像为本地明文文件，可能包含敏感命令输出；如不需要可在设置中关闭。
- 本项目是单用户本地应用，不提供多租户、云端同步或远程访问鉴权。

---

## 测试

项目包含三层自动化验证：

```powershell
# 后端 SSH 核心（30 步）：会话、终端 WS、认证、exec、密钥、Known Hosts、录像
pnpm exec tsx tests/ssh-core.test.ts

# 后端 SFTP + 隧道（34 步）：真实 ssh2 mock server，文件操作、上传下载、三种隧道
pnpm exec tsx tests/sftp-tunnels.test.ts

# 前端 UI E2E（13 步，自动启动 mock 环境 + 临时服务器 + Chrome）
pnpm test:ui
```

或一次运行后端两套：

```powershell
pnpm test
```

类型检查与生产构建：

```powershell
pnpm typecheck
pnpm build
```

UI E2E 需要本机安装 Google Chrome（默认路径 `C:\Program Files\Google\Chrome\Application\chrome.exe`）。截图保存在 `tests/.artifacts/`。

### 手工演示环境

```powershell
pnpm mock-lab
```

会启动 mock SSH、SFTP 与 HTTP echo 服务并输出端口、账号（`demo / demo123`）与主机密钥指纹，可用于连接测试。仅用于开发/测试，不是真实服务器。

---

## 目录结构

```
shared/types.ts            前后端共享类型（API / WebSocket 契约）
docs/API.md                REST + WebSocket 接口说明
docs/ARCHITECTURE.md       架构、服务边界与约定
server/src/
  index.ts                 HTTP 服务、路由挂载、静态资源、生命周期
  core/                    数据存储、保险库、事件、审计、Prompt、日志
  ssh/                     ssh2 连接、主机密钥、会话管理、终端 WS、exec、密钥
  sftp/                    SFTP 文件服务
  tunnels/                 本地 / 远程 / SOCKS5 隧道服务
  routes/                  Express 路由
web/src/
  App.tsx, theme.ts, styles.css   应用外壳与 Fluent 主题
  components/              通用 Fluent 组件、命令面板、全局对话框
  features/hosts           主机管理
  features/workspace       终端、标签页、命令面板
  features/files           SFTP 文件管理与传输
  features/tunnels         SSH 隧道
  features/security        密钥与 Known Hosts
  features/logs            审计与会话录像
  features/automation      命令与片段
  features/settings        设置
tests/                     后端 E2E、mock SSH/SFTP、UI E2E
scripts/                   开发与测试启动脚本
```

---

## 技术栈

React 18 · Fluent UI v9 · xterm.js 5 · zustand · Vite 6 · TypeScript 5 · Express 4 · ws · ssh2 · sshpk · zod · Node.js 22

## 已知限制

- 单用户本地应用；无云端同步、协作或远程访问鉴权。
- 不支持 SSH-1、PKCS#11 / 智能卡；Agent 认证依赖系统 ssh-agent / Pageant。
- 浏览器下载使用内存 Blob，超大文件（> 数百 MB）可能受浏览器内存限制；工具栏的 SFTP 下载仍通过流式 HTTP。
- 会话录像为明文本地文件；敏感环境建议关闭记录或加密磁盘。
- 主机密钥不会被自动接受（除显式关闭"严格主机密钥校验"外），首次连接需要人工确认。
