# @deepseek-ai/dsh-turn-loss-notice

[English](README.md) | 中文

一个回合在流式输出答案文本的过程中中途失败时,会留下一个不对称的信息空洞:界面已向用户展示了(部分)答案,但 `assistant/message` 从未提交,因此模型派生的历史记录会从用户的问题直接跳到其下一条提示。模型随后会诚实地重新推导——并可能给出不同的答案——或者更糟,当用户说"如你之前所说"时产生虚构。本插件封闭该空洞中属于模型的一侧:在下一个进入的回合,它前置一条上下文消息,告知模型其上一次回复未被保留。同一空洞中面向用户的一半属于嵌入产品的错误提示界面,不属于本插件。决策记录:[turn-loss-notice Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-turn-loss-notice.md)。

## 配置

```yaml
- id: turn-loss-notice
  name: '@deepseek-ai/dsh-turn-loss-notice'
```

无配置项。通知文本是模型可见的契约,触发条件是正确性规则,而非部署选择。

## 触发语义

当日志中最近一条 `turn/end` 为 `{kind: 'error'}`,且该回合中存在至少一个晚于其最后一条含内容 `assistant/message` 的 `text-delta` 块时,通知在回合的第一个进入步骤触发。两个限定条件都是承重的:

- **仅限 `text-delta`。** 工具调用与推理增量不是用户看到的答案;在第一个工具调用期间——任何文字输出之前——出错是常见的出错时机,必须保持静默。
- **仅限含内容消息。** 空内容的 `assistant/message` 仅为承载 max-tokens 步骤的用量而存在,不得作为"已提交"边界的锚点。
- **已提交的步骤仍被记住。** 在早先步骤已提交的多步骤回合中,只有流式输出后丢失的尾部才触发;在最后一次提交之后出错(如工具执行中)的回合不触发。
- **被中止的回合无法到达该谓词。** 循环在其错误分支之前将取消记录为 `{kind: 'aborted'}`——知情取消的用户不会收到通知。
- **崩溃尾部在结构上不可触及。** 该谓词要求已提交的 `turn/end`;不平衡的日志属于会话修复的领域,不得向其扩展该谓词。

派生是无状态的——会话日志即是记忆——因此它对重启免疫且无需去重:下一回合的扫描会看到中间已完成的回合,而连续失败的重试只有在新流式输出并丢失文本时才会再次触发(真实的第二次丢失)。

## 投递

通知被前置到进入步骤的消息中,由循环在模型调用之前作为普通注入的 `user/message`(来源 `{kind: 'plugin', plugin: 'turn-loss-notice', form: 'notice'}`)提交——因此即使承载它的回合同样失败,它也已持久记入日志;在日志和请求中都先于用户的提示;并且无需新的会话事件类型即可从会话日志重建。包装文本由生产者按 surface 投影的契约("包装由调用方所有")直接写入内容。空的首个条目(无步骤回合)绝不会为通知而被扩展成一次模型调用。

## 模型体验

### 回合丢失上下文消息

#### 模型看到的内容

在符合条件的丢失之后的第一个进入步骤,该 agent 在用户提示之前收到下面这条消息。不添加任何工具模式或常规调用文本。

##### 回合丢失通知

```markdown
<system-reminder>The previous response in this conversation failed mid-stream and was NOT retained. You have no record of what it said, even though the user may have seen part of it. If the user refers to it, say you do not have it and re-derive rather than reconstructing what you might have said.</system-reminder>
```

#### Token 影响

除非发生丢失,否则为零 token。通知是该 agent 的保留历史(一次约 70 token)。

#### KV 缓存影响

仅追加;新可见内容跟在可复用的请求前缀之后,不会使现有 KV 缓存条目失效。

## 已知限制与延后工作

- **崩溃路径的丢失不在覆盖范围内。** 进程崩溃不留下 `turn/end`,因此本插件永远看不到它;会话修复的 `interruptedTurnClosers` 为该领域合成工具调用收尾事件,但尚未告知模型丢失的文字。该缺口由修复层负责封闭,在此记录以免有人将本插件的谓词扩展到一个它无法匹配的形态。
- **面向用户的一半由产品负责。** 本插件只服务模型这一消费者;嵌入产品必须在其错误提示界面单独声明部分答案未被保留。
