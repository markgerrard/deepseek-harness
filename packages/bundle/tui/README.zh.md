# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

dsh 的 Crush 风格终端 UI 组合包。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](../base/README.md) 之上：提供编码 persona 和工具模式、禁用 HMR（热模块替换）、将 Code Mode worker 作为核心执行能力挂载，并插入本包的 `tui-runner` 插件。它不挂载任何 Host、HTTP server、Web runtime 或浏览器插件。

Loader 结算后，runner 读取共享的 [`ctx.agentDefaultModel`](../../core/agent-default-model/README.md)，通过 `ctx.agents` 创建或恢复一个持久化 Agent（智能体），并挂载 Crush 风格的 Ink 界面。提示词、斜杠命令、模型切换、会话切换、审批和向用户提问都走官方 DSH 服务。

普通 `tui-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`，解析可选的恢复会话 id、可选的开场提示词，以及本应用的帮助信息，然后提供 `tuiStartup`。

## 从源码启动

在仓库根目录完成 workspace 安装后，运行 dsh 启动器的 tui 别名。随附的 tui 模板会在首次使用时自动初始化（dsh-base 加上本组合包）。

## 模型体验

无影响，因为 TUI 把提示词作为普通用户消息提交；提示词与工具由 base 和 tui 组合包中的相应条目提供。

#### KV Cache 影响

无；TUI 不向请求前缀添加任何内容。

## 已知限制与暂缓事项

- Crush 文件附件、提及和图片：编辑器只接受文本。
- Bang 模式 shell、MCP/LSP 侧栏和 todo 胶囊不纳入本 MVP。
- 完整 glamour Markdown、鼠标展开、复制/高亮、自定义主题尚未移植。
- 仅提供首次引导；TUI 不会创建凭证存储。
- ctx.appExit 由启动器持有：在 dsh 启动器之外启动 tui profile 会在激活时明确报错，直到宿主提供该退出请求。
