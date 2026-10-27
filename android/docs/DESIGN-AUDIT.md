# FluentSSH Android — 移动端设计规范走查

依据 [`mobile-design-system-skill`](https://github.com/Ludi-Herry/mobile-design-system-skill) 的六大工作流与 16 项交付门禁逐项自查。

## 1. 物理视口与安全区

- 采用 Edge-to-Edge（`enableEdgeToEdge()`），系统栏透明。
- 顶部：`AppTopBar`、各 Tab 头部、终端顶栏均使用 `statusBarsPadding()`。
- 底部：底部导航 `navigationBarsPadding()`；抽屉底部、终端扩展键栏同样避让手势条。
- 终端屏幕：`imePadding()` 让扩展键栏始终位于软键盘上沿，不被遮挡。
- 实现位置：`ui/components/Components.kt`、`ui/components/BottomBar.kt`、`ui/terminal/TerminalScreen.kt`。

## 2. 触控热区与间距

- 图标按钮统一 48×48dp（`IconCircle`、`IconButton`）。
- 列表行最小高度 56dp；分段控件 44dp 高、外触点 48dp；底部导航每槽位等分且高度 64dp + 手势区。
- 相邻可点击项间距 ≥ 8dp（`Arrangement.spacedBy(8.dp)`）。
- 小图标（16–20dp）均放入 48dp 容器，不做裸图标点击。

## 3. 软键盘防遮挡

- 所有表单字段接入 `Modifier.centerOnFocus()`：聚焦后延迟 320ms（等 IME 动画）执行 `BringIntoViewRequester.bringIntoView()`，将输入框带入视口中央。
- 表单抽屉内容可滚动，底部 CTA 位于 `imePadding()` 内，键盘弹起时整体上移。
- 文本输入使用正确的键盘类型：端口/数值 `KeyboardType.Number`、密码 `KeyboardType.Password`、搜索 `ImeAction.Search`。
- 命令页、文件编辑器、终端屏幕均使用 `imePadding()`。

## 4. 浮层系统

- 底部抽屉统一封装 `AppBottomSheet`：36×4dp 拖拽指示条、30%/60%/80% 高度档位、圆角 24dp。
- **表单类抽屉 `dismissible=false`**：主机表单、隧道表单、密钥表单、主机密钥确认、键盘交互认证、密码输入、SSH Config 粘贴，均禁止点击遮罩或返回键静默关闭，必须点“取消/保存”。
- 危险操作使用 `ConfirmDialog`（删除主机 / 隧道 / 密钥 / 录制 / 清空日志），遮罩点击不关闭，提供明确取消出口。
- 抽屉使用独立窗口，底层页面滚动被系统隔离，无滚动穿透。

## 5. 导航架构

- 5 槽位底部导航（主机 / 终端 / 文件 / 隧道 / 更多），符合 3–5 槽硬门禁。
- 二级页面（终端、文件浏览、编辑器、设置、密钥、审计等）自动隐藏底部 TabBar。
- 栈式导航使用 Navigation Compose，水平滑动 + 淡入转场；支持系统预测性返回。
- 会话标签为终端屏内横向可滑 Tab（>4 项时自动滚动），当前选中项高亮。

## 6. 信息流与空态

- 主机、隧道、密钥、审计、命令历史均为单列卡片列表，无桌面表格横向溢出。
- 列表使用 `LazyColumn` 虚拟化。
- 每个空列表都有图标 + 原因说明 + 主行动出口（新建/去连接/上传）。
- 错误态提供 `ErrorNotice` 与重试按钮，不会出现无反馈白屏。

## 7. 视觉令牌

- 中性分层 Surface（背景 / 卡片 / 容器 / 高容器），无装饰性阴影、无左侧彩条。
- 0.5dp 发丝边框（`Hairline`、`BorderStroke(0.5.dp)`）。
- 同心圆角：外层 16dp，内层 12dp，内外差 ≈ 4dp padding。
- 字号阶梯：28 / 24 / 20 / 17 / 15 / 14 / 13 / 12sp，正文不小于 12sp。
- 每个屏幕最多一个全宽主按钮；次要操作为描边按钮或文本按钮。
- 品牌色 `#0F6CBD`（浅色）/ `#6CB8F5`（深色），语义色独立定义。

## 8. 16 项交付门禁对照

| # | 门禁 | 结果 |
| --- | --- | --- |
| 01 | 底部安全区 | ✅ |
| 02 | 顶部安全区 | ✅ |
| 03 | 最小触控热区 | ✅ |
| 04 | 相邻按键间距 | ✅ |
| 05 | 键盘防遮挡 | ✅ |
| 06 | 键盘类型精准 | ✅ |
| 07 | 手势冲突保护 | ✅ 无横滑轮播 |
| 08 | 滚动穿透锁死 | ✅ 抽屉独立窗口 |
| 09 | 浮层防误触丢失 | ✅ 表单/确认禁止遮罩关闭 |
| 10 | 0.5dp 精细边框 | ✅ |
| 11 | 同心圆角 | ✅ |
| 12 | 主行动点唯一 | ✅ |
| 13 | 全屏无多余横滚 | ✅ |
| 14 | 图片比例秩序 | ➖ 无内容图片 |
| 15 | 弱网与空态出口 | ✅ 错误态 + 重试 + 空态 CTA |
| 16 | 复用成熟组件 | ✅ Compose / Material 3 / JSch / Navigation |
