# Agent Note: DS Bot 中 SDK prompt 默认转向进行中的轮次

Status: implemented

[English](2026-08-21-sdk-prompt-steer-delivery.md) | 中文

## Problem

DS Bot 没有停止控件，而 `session/prompt` 一律通过 `agent.followup()` 投递，因此 bot 在轮次进行中收到的每条消息都会在运行轮次之后排入一个全新轮次。用户眼看 bot 走偏时既无法停止也无法纠偏——纠正要等失控轮次结束后才生效，然后又基于过时意图开启新轮次。

## Decision

`SessionPromptParams` 携带可选的 `steer` 标志。`steer: true` 通过 `agent.steer()` 投递：运行中的驱动在下一个步骤边界消费该消息，空闲驱动则开启一个轮次，因此转向随时可以安全发送。省略或 `false` 保持 `followup()` 的排队轮次投递。排在进行中惰性创建或恢复之后的 prompt 以其发送时的投递方式重放。DS Bot 的 `HarnessClient.prompt` 将 `steer` 默认为 `true`，且当线程可见地处于工作中时，应用在 prompt 被接受后跟发 `session/cancel { keepInbox: true }`：单独的转向只在下一个步骤边界被消费，而一次长文本生成永远到不了那个边界，keepInbox 中止会结束进行中的步骤，同时转向唤醒与消息幸存并重放为新轮次，立即回应重定向。需要严格轮次排队的 SDK 调用方在协议层传 `steer: false` 或省略该标志。

## Alternatives considered

**单独的 `session/steer` 方法。** 否决：投递位置是单个 prompt 的属性，不是另一种操作——第二个方法会为队列重放、惰性创建和关闭路径制造重复，却没有任何协议收益。

**仅在会话正在运行时转向。** 否决：客户端对运行状态的观察存在竞态；`agent.steer()` 在空闲时本来就退化为开启轮次，无条件默认既省一次协议往返，也消除竞态窗口。

**改做应用侧停止按钮。** 互补而非竞争：轮次进行中作曲框会显示停止控件（`SessionController.stopCurrentTurn()` 发送 `session/cancel`）；转向让下一条消息本身成为纠正，从根上减少了停止的需要。

## Consequences

**得到的**：发给忙碌 DS Bot 的消息会在下一个步骤边界重定向它；默认不再有任何东西排在失控轮次后面。

**付出的**：DS Bot 用户无法再从应用刻意在运行轮次后排一个后续轮次；协议保留该能力（省略 `steer`），所以这是应用界面的缺口，不是协议缺口。被步骤拒绝的转向消息按 agent 契约停留在收件箱中，直到下一次唤醒。

## Testing

`packages/sdk/server/tests/server.spec.ts` 固定了存活会话上的转向投递、省略时的 followup，以及转向经惰性创建队列重放后的保持。`SessionControllerTests.testPromptSteersByDefault` 通过打包的 fake runtime 固定应用记录的协议参数中带有 `steer: true`。

## Deferred

经 jsonrpc-agent 示例的转向投递 keyless 快照仍暂缓：回放下的轮次中转向依赖时序，而空闲转向场景需要一次带密钥的录制；在此之前协议与应用行为由上述包测试和 Swift 测试固定。
