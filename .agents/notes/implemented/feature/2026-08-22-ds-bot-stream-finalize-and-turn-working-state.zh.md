# Agent Note：DS Bot 流式收尾与回合级工作状态

Status: implemented

[English](2026-08-22-ds-bot-stream-finalize-and-turn-working-state.md) | 中文

## 问题

两个聊天界面缺陷。回合中途被中止时不会产生 `assistant/message`，投影器因此永远保持缓冲区开启：每次渲染都会在 `seq: Int.max` 处重新追加一个仍在流式中的幽灵气泡（内含整段已中止回复），渲染退避也一直钉在最慢档（一份存储转录在最后一条消息之后还有 8,677 个 chunk 事件）。另外，工作指示器在发送时点亮、prompt 被接受后即熄灭——纯文本回复期间它从不回来：in-flight 判定只匹配运行中的工具、流式推理或工作流，从不匹配流式助手文本。

## 决策

`TranscriptProjector.finalizeStream(seq:)` 在 `step/end` 与 `turn/end` 时把任何缓冲中的流转换为已完成条目，保留已送达的前缀；水合走同一条路径重放存储事件，因此旧聊天在加载时自愈，无需迁移。工作状态改为由回合生命周期驱动：`awaitingTurnSessions` 覆盖 发送 → `turn/start`（投递失败时清除），`activeTurnSessions` 覆盖 `turn/start` → `turn/end`；`isTurnActive` 取并集，指示器全程连续，包括 chunk 之间。

## 曾考虑的替代方案

**只在后续 `assistant/message` 到达时关闭流。** 拒绝：被中止的回合恰恰不会有这条消息——泄漏正源于此。**用 `session.status` 事件驱动指示器。** 暂缓：对单会话同样权威，但接上这个被丢弃的通知是独立工作，且能额外呈现子代理活动。

## 后果

**换来**：被中止/打断的流立即读作已完成回复，重启自愈；工作指示器覆盖所有回复形态的整个回合。**付出**：定稿的部分回复只是模型意图的前缀——显示为普通完成消息，暂无"被打断"的视觉标识。

## 测试

投影测试以 `step/end`/`turn/end` 结尾的存储事件序列钉住 `finalizeStream` 行为；`SessionControllerTests` 两个用例钉住 发送 → `turn/start` → `turn/end` 与投递失败的状态转换。并经运行中的应用 wire log 端到端验证。
