# Agent Note: 让待处理的取消与其竞态的那次加载一同结算

Status: implemented

[English](2026-08-16-sdk-cancel-load-settlement.md) | 中文

## Problem

[`session/cancel`](../feature/2026-08-15-sdk-session-cancel.md) 把「加载进行中到达的取消」记在一个以会话 id 为键的 `Set<string>` 里，而加载自身的生命周期位于 `sessionCreations`。于是同一份取消状态由两个操作共同持有，而 [`session/resume`](../feature/2026-08-15-sdk-session-resume.md) 又为它新增了第三条路径：等待 resume 的 `session/prompt` 会在该 resume 失败后惰性创建。

与失败的 resume 竞态的取消会丢失。等待中的 prompt 先注册了自己的拒绝处理器，因此它在 `cancel` 运行自己的拒绝处理器之前就启动了惰性创建，而后者删除了该 prompt 入队后本要消费的标记。`session/cancel` 返回 `{}`，新建的会话照常运行已排队的消息——正是当初为进行中的惰性创建编写取消逻辑所要防止的、对客户端可见的同一种失败。

与成功的 resume 竞态的取消则从不清除。已兑现的分支中止了仍存活的 agent，却把标记留在集合里，随后一个不相关的 `session/prompt` 消费了它，取消了客户端从未要求取消的轮次。

已兑现的分支还会在等待中的 prompt 尚未入队时就中止 agent，因此一次普通的「创建后取消」会调用两次 `agent.cancel`。

## Decision

取消意图是它所竞态的那次加载上的字段，而不是与之并列的、以会话为键的状态：`PendingSessionLoad` 携带 `cancelled`、`promptWaiters` 与 `cancelWaiters`，`SessionRecord` 则自其加载结算之时起携带 `pendingCancel` 与 `waitingPrompts`。

取消只覆盖它到达时已在等待该加载的那些 prompt。`session/cancel` 把 `promptWaiters` 快照进 `cancelWaiters`，结算时转移的是该快照而非实时计数。此后才加入的 prompt 是在取消之后发出的，而反应注册顺序会让被覆盖的 prompt 的入队排在它之前，因此中止恰好落在两者之间。

成功结算的加载把取消交给记录。由完成该操作的一方生效，至多一次：被覆盖的 `session/prompt` 全部完成入队尝试之后，由最后一个生效，因为 `agent.cancel` 不会武装后续工作，被覆盖却在中止之后才入队的 prompt 仍会运行；取消到达时没有等待中 prompt 的加载，则由 `session/cancel` 调用自身完成。等待者是计数而非布尔标记——一个布尔值无法表达是否还有第二个 prompt 加入了同一次加载且尚欠一次入队。

该计数注销的是入队*尝试*，而非入队本身：活体 agent 校验抛出的 prompt 从不调用 `followup`，其 `finally` 仍会注销该义务。若一直等到真正入队，则在校验、消息构造或 `followup` 抛出时，取消将被永久搁置。

失败的加载把取消交给延续该操作的一方。等待中的 prompt 所启动的惰性创建通过 `beginSessionLoad` 的 `inherited` 参数，连同意图与其覆盖范围一并继承。无人延续的失败加载则连同那个从未建成的记录一起丢弃该意图，因此不影响此后独立的重试——并且什么都不会被中止，这正是 README 所述的第三种结果。

## Alternatives considered

**保留集合，只是不再在加载失败时删除。** 已否决：该删除的存在正是为了让失败的加载不毒化此后独立的重试。没有代际范围，保留标记只是把「丢失的取消」换成「被窃取的取消」。

**用布尔值表示等待中的 prompt，而不用计数。** 已否决：当两个 prompt 加入同一次加载时，先入队的那个消费掉唯一一次生效，第二个则在中止之后才入队，于是客户端在取消之前发出的消息仍会运行。那正是所报缺陷本身的形态，只不过多了一个等待者。

**等待实时的等待者计数，而不用快照。** 已否决：那样一来，在取消之后才加入该加载的 prompt 也会把中止拖住，而中止最终落在一个已经含有该 prompt 消息的收件箱上——客户端拿到了 `messageId`，该消息却被一个先于它发出的取消悄悄丢弃。这还会让行为取决于客户端无法观测的因素，因为同样的序列在仍存活的会话上并不会波及后来的 prompt。

**把继承来的意图带到一个已经在进行中的加载上。** 已否决为「无需求的状态」：唯一会继承意图的延续者自己构造后继加载，而延续同一次失败加载的每个兄弟都在同一轮微任务中读取同一份意图，因此该条目本就已经持有它。那行代码会执行，却无法改变任何结果。

**为「记录发布」与「等待中 prompt 入队」之间的窗口加防护。** `createSession` 在其加载结算之前就把记录发布进 `sessions`，因此 `session/cancel` 原则上可能走仍存活会话的路径，在该 prompt 入队之前就中止。已否决为不可达：从发布到 `followup` 的每一跳都是微任务，而以宏任务投递的取消——任何传输投递帧的方式——都落在其后。在此加防护只会成为一处永久摆设，去处理任何调用方都无法产生的边界情况。

**把集合拆成 `resume:` 与 `create:` 两类键。** 已否决：`session/cancel` 是以裸会话 id 定位进行中的加载的，拆分后的键在真正需要它的位置读不到。

**一律在加载结算时施加取消。** 已否决：那会落在等待中的 prompt 入队之前，而 `agent.cancel` 不会武装后续工作，已排队的消息仍会运行。

## Consequences

**Bought**：一次加载的取消由一个结算点持有。与任一加载结果竞态的取消，至多归结为一次 `agent.cancel`，且落在它所覆盖的每一个 prompt 都已完成入队之后、以及在它之后发出的任何 prompt 之前；在其竞态的操作从未完成时则归结为零次。正在加载的会话与仍存活的会话对取消的应答一致，因此由客户端自身的顺序决定什么被中止。

**Paid**：`beginSessionLoad` 多了一个继承参数，因此失败 resume 的取消意图体现在后继加载的构造处，而不是一张共享的表里。`session/prompt` 会在 await 之前先读取其会话是否已存活，因为只有等待过某次加载的 prompt 才对该加载欠一次入队——这与 `beginSessionLoad` 自身对 `sessions` 的读取构成耦合，因此该计数是被钳制的，而非被信任的。

## Testing

无密钥单测：`cancels the lazy create a prompt starts after the resume it was waiting on fails` 在缺少继承参数时失败。`does not carry a cancel of a resumed session into the next prompt` 在已结算的加载遗留意图时失败。`cancels only after every prompt that joined one in-flight create has enqueued` 与 `cancels only after every prompt that joined a failing resume has enqueued` 在等待者是布尔值而非计数时失败。`leaves a prompt that arrives after the cancel out of that cancel` 与 `leaves a prompt that arrives after the cancel out of an inherited lazy create` 在中止等待实时等待者计数、而非取消到达时所取快照时失败。`cancels a session whose lazy creation is still in flight` 固定为单次 `agent.cancel`。`does not keep a pending cancel after lazy creation fails` 保持此后独立的 prompt 不被取消。
