# Agent Note: DS Bot 拖动区域、悬停消息操作与流式渲染成本

Status: implemented

[English](2026-08-21-ds-bot-chat-interaction-polish.md) | 中文

## Problem

聊天界面的三个缺陷：在短消息里拖动选择文本会移动窗口，因为窗口开启了背景拖动且根视图背后垫着窗口拖动层；消息没有复制入口；数千词的流式回复即使在固定 10Hz 渲染合并下也会卡死主线程，因为对整个增长气泡做一次 markdown 重排就超过了间隔本身。

## Decision

关闭 `isMovableByWindowBackground` 并移除根级 `WindowDragArea`：拖动只属于显式的 40pt 头部条（侧栏、聊天、检查器）。消息行跟踪指针悬停并展示 Grok Bot 风格的操作行——带对勾确认的复制按钮加省略号菜单——bot 气泡在右侧、用户气泡在左侧，空闲时以透明度隐藏，展示不会引起回流。流式渲染采用与参照产品相同的逐段方式：`splitSettledTail` 在最后一个空行边界处切分（绝不在未闭合代码围栏内切分），每个已定型段落作为独立的 `.equatable()` markdown 子视图渲染，因此一个段落完成时只追加一个视图而不重建先前段落，每个 chunk 只重渲染进行中的尾部。合并间隔以该尾部为准——100ms，超过 4k 字符 250ms，超过 12k 500ms——所以普通散文保持灵敏，只有永不分段的文本才会退避。悬停操作在其弹出框打开期间保持可见，且行的整个宽度可命中测试，从气泡移向操作按钮不会丢失悬停。

## Alternatives considered

**对整段流式文本用单个 markdown 视图。** 否决：它的 body 每个 chunk 都重新求值，重建每个段落的富文本，这正是 3000 词回复卡死主线程的原因。在已定型段落边界处切分能给出相同的渲染结果，而每个 chunk 的成本只与一个段落成正比。

**用固定的更慢间隔代替缩放。** 否决：那会惩罚在 10Hz 下渲染毫无压力的短回复；成本随气泡长度增长，间隔也应如此。

**只用右键上下文菜单。** 否决：参照产品（Grok Bot）在气泡旁以悬停展示操作；可发现性正是需求的核心。

## Consequences

**得到的**：头部条之外处处可以选择文本；每条完成的消息都有悬停复制入口；任意长度的流都让主线程跑在自身排版工作之前。

**付出的**：段落在其空行边界到达前不带格式渲染；拖动窗口必须使用头部条。

## Testing

`splitSettledTail` 测试固定段落边界切分、无边界情形以及开启/闭合的代码围栏；`testStreamingTailLengthCountsOnlyTheUnsettledParagraph` 固定投影器的尾部度量；`testStreamRenderIntervalScalesWithLength` 固定间隔阈值；合并测试固定 chunk 与持久事件的 bump 行为。悬停展示与拖动区域属视图层接线，在运行中的应用里验证。
