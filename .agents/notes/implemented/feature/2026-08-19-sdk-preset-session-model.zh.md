# Agent Note: Preset persona 创作与单会话模型选择

Status: implemented

[English](2026-08-19-sdk-preset-session-model.md) | 中文

## 问题

本地创作的 agent preset 允许用户复制随附组装并提供展示元数据，但个性化 agent 的身份指令（persona）此前必须在磁盘上手动编辑 `agent.cordis.yml`。仅复制的 preset 创作（[仅复制 preset 创作 note](../simplification/2026-08-08-copy-only-preset-authoring.md)）刻意移除了任意组装文本的提交能力，以防止注入任意插件行（`!!js` 求值与未经校验的插件导入）。然而，原生客户端和 SDK 使用方（如 Swift Grok Bot）需要在不开放任意组装编辑能力且无需手动操作文件系统的前提下配置自定义 bot persona。

## 决策

我们在 `@deepseek-ai/dsh-agent-presets/authoring` 中引入 `setPersonaText(preset, text)` 以及配套的服务方法 `AgentPresets.setPersona(id, text)`。

- **仅限用户 preset：** `setPersona` 仅对 `user` 信任级别的 preset 生效，对随附分发的 `system` preset 抛出 `PresetNotWritableError`。
- **狭窄变更：** 定位已存在的 `persona` 插件行（匹配 `id: 'persona'` 且 `name: '@deepseek-ai/dsh-persona'` 或 `'persona'`），并仅将其 `config.text` 更新为字符串标量值。由于输入严格序列化为字符串标量，无法注入任意 YAML 行。
- **严格前置条件：** 对非字符串输入抛出 `TypeError`，若组装中不存在匹配的插件行则抛出指明缺少 persona 行的错误。
- **挂载失效：** 成功写入后调用 `this.standing.delete(id)`，使后续会话挂载能加载到新代际，而已加入的现有会话保持其已挂载的代际。

## 考虑过的替代方案

- **重新引入任意组装文本写入：** 拒绝，因为允许在线上传输任意 YAML 组装载荷会打破仅复制创作的安全边界，并重新带来任意插件执行风险。
- **在会话创建时进行临时 persona 覆盖：** 拒绝，因为多 bot 客户端中的 bot 身份是供多个会话线程共享的持久 preset，而非一次性 prompt 参数。
- **将 persona 存放在单独的随附文件中：** 拒绝，因为 `@deepseek-ai/dsh-persona` 本身已经在统一的 `agent.cordis.yml` 格式中以标准 Cordis 插件行形式承载 persona 配置。

## 后果

- 原生应用与 SDK 客户端可以通过强类型、有界的方法安全更新用户 preset 上的 bot persona。
- 仅复制创作的安全不变量保持不变：无法跨客户端边界创作或挂载任意插件组装。
- 缺少 persona 行的 preset 无法直接通过 `setPersona` 配置 persona 文本，除非预先植入 persona 插件条目。
