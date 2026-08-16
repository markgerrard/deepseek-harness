# Agent Note: 在结算时重放加载的操作队列

Status: implemented

[English](2026-08-16-sdk-cancel-load-settlement.md) | 中文

## Problem

`session/cancel` 必须恰好中止客户端在它之前发出的那些 prompt——在已存活的会话上，线上顺序天然保证这一点；但当惰性创建或恢复仍在进行时，prompt 与取消会堆积在一个尚不存在的会话上。[`session/cancel`](../feature/2026-08-15-sdk-session-cancel.md) 与 [`session/resume`](../feature/2026-08-15-sdk-session-resume.md) 起初用加载旁的取消状态来建模：先是以会话为键的标记，然后是等待者计数，再是取消到达时的计数快照。连续四轮评审小组各自在新的位置发现了当时模型的顺序缺陷：标记被失败的 resume 丢弃、又越过成功的 resume 泄漏；布尔值在第一个等待者结算时就施加中止，早于第二个等待者入队；实时计数把中止推迟到取消之后发出的 prompt 之后，该 prompt 已被确认却被悄悄丢弃；快照修正了「数谁」却没有修正「谁来递减」，于是一个未覆盖任何人的取消被继承进后继创建、杀掉了取消之后的 prompt，而一个被覆盖的 prompt 经由失败 resume 的拒绝延续到达后继时，走过比直接加入者更深的 promise 链，第二个入队，逃过了本属于它的中止。

底下不变的事实是：agent 观察到的 followup 与取消的顺序，必须与客户端的 prompt 与取消在线上到达的顺序一致；而每一个标量模型都是用计数加上一个关于 promise 延续顺序的假设来重建这一顺序。该假设是错的——当反应位于不同链深时，反应注册顺序不等于结算顺序——而计数永远无法恢复它从未存储过的顺序。

## Decision

进行中的加载持有一个有序操作队列。每个 `session/prompt` 与 `session/cancel` 处理器都在自己的 RPC 回合内同步追加，因此队列的顺序在构造上就是线上顺序。加载自身的结算延续——在加载启动时注册，因而是它上面的第一个反应——将队列一次性按序重放到存活的 agent 上：prompt 用 `followup`，取消用 `agent.cancel({ kind: 'user' })`。投递发生在同一个延续中，任何加入者的链深都无法重排它，每个取消恰好落在其前后消息之间。

排队 prompt 的 RPC 在重放之后以预先铸好的 `messageId` 解析，在加载失败时拒绝；它读取加载的 `outcome`（它跟随移交），而 `session/resume` 读取本次尝试自己的 `task`。排队的取消在操作对象上携带自己的结算，因此其 RPC 在该取消自身命运确定之时解析 `{}`——中止已在重放中执行、在把它作为打头取消丢弃的移交之时、或在死掉的加载或被拒的重放丢弃队列之时——绝不等待一个已把它丢弃的后继。操作对象按引用转移，幸存取消的结算随之进入后继。记录本身不携带任何取消状态。

当 resume 失败时，队列移交给延续它的惰性创建，但去掉打头的取消：前面没有任何 prompt 的取消在后继中无物可扫——后继的全部内容都晚于它——因此随失败的加载一同消亡。失败的创建不移交任何东西；其排队的 prompt 以创建的错误拒绝。关停期间不启动后继，排队的 prompt 以 resume 的错误拒绝。

注册表校验（`ctx.agents.get` 身份检查）每次重放执行一次，而非每个 prompt 一次：重放是一个延续，注册表在其语句之间不可能改变。过期的记录以与存活路径相同的 disposed-agent 错误拒绝整个队列。

## Alternatives considered

**以会话为键的标记、等待者布尔值、实时等待者计数、取消到达时的计数快照。** 依次都上线过，又依次被下一轮评审以复现的顺序违例否决（运行 `panel-dsh-wiring-r2-*`、`panel-dsh-cancel-r3-*`、`-r4-*`、`-r5-*`）。最终的缺陷类别是结构性的而非调参失误：覆盖范围——一个取消拥有哪些 prompt——是位置信息，标量只存储基数，于是每个变体都要靠 promise 延续顺序来重建位置，并在该顺序偏离线上顺序之处失效。

**用每 prompt 的覆盖标志代替队列。** 在加入时给每个 prompt 打上覆盖/未覆盖标签；只有被覆盖的 prompt 才拖住中止。已否决：对单个取消正确，但覆盖是相对最近一次取消而言的——`prompt, cancel, prompt, cancel` 需要每 prompt 的代际号才能说清哪个取消拥有哪个 prompt，而标志加代际号恰好重建了那个有序队列，只是存得更糟。

**取消不入队，每次加载至多施加一次中止。** 已否决：线上可以交错出 `prompt, cancel, prompt, cancel, prompt`，每个取消都是「中止其之前内容」的指令。重放队列对任意数量的取消都成立；单次合并的中止做不到。

**resume 失败时整队移交，包括打头的取消。** 已否决：先于所有消息投递到全新 agent 的中止至多是空操作，其唯一可观察的效果只会波及取消之后的工作。只去掉打头的取消，保留了每个仍有排队消息可扫的取消。

**为记录发布与结算之间的窗口加防护。** `createSession` 在其 task 结算之前就发布进 `sessions`，因此 `session/cancel` 原则上可能在加载中途走存活路径。让 `prompt`、`cancel` 与 `resume` 先查进行中表、再查记录表，从结构上关闭了它；该窗口也已被证明从 `handleRequest` 或线上不可达——从发布到重放的每一跳都是微任务，而传输投递的帧是宏任务。

## Consequences

**Bought**：一个机制取代了三个相互作用的标量、它们的钳制和继承参数。线上顺序在到达时存储一次、逐字重放；下游不再有任何代码推理延续深度。多取消交错的序列被忠实重放，这是任何计数变体都做不到的。加载中的会话与已存活的会话对同一线上顺序给出相同的中止位置。

**Paid**：排队 prompt 的 `followup` 在加载的结算延续中运行而非它自己的 RPC 处理器中，因此其 RPC 晚一个反应解析；注册表身份检查是每次重放一个决定——过期的记录拒绝的是每一个排队 prompt 而非逐个检查，排队的取消则无一例外地以 `{}` 结算。重放假定投递不抛出：`followup` 与 `cancel` 是 inbox 操作，经由它们同步抛出的事件监听器会放弃队列的剩余部分并拒绝每个排队 prompt，包括已投递的——只有宿主自备的传输对端或进程内监听器能触及，随附的 stdio 传输不能。`session/resume` RPC 报告其自身尝试的结果，而排队的 prompt 跟随后继，两者从同一个加载条目上读取不同的 promise；关停期间，失败 resume 上排队的 prompt 以该加载自身的错误拒绝，而非关停错误。

## Testing

无密钥单测，均在 `packages/sdk/server/tests/server.spec.ts`。`replays interleaved prompts and cancels on one load in wire order` 固定队列本身。`keeps wire order across a failed resume when a later prompt joins the successor` 在任何允许延续深度重排投递的模型下失败。`drops a cancel that covered no prompt with the load it raced` 固定打头取消的丢弃。`leaves a prompt that arrives after the cancel out of that cancel` 与 `out of the successor create` 固定两条加载路径上的中止位置。`aborts only after every prompt queued ahead of the cancel on one in-flight create` 及其失败 resume 变体固定多 prompt 覆盖。`does not acknowledge a transferred cancel before the successor runs its abort` 与 `acknowledges a dropped leading cancel even when the successor never settles` 将排队取消的结算固定在它自身的命运上：绝不早于其中止执行，也绝不落在一个已把它丢弃的后继之后。`does not start a successor create when a resume fails during shutdown` 固定关停收容。`rejects the whole queue on one registry check when the loaded agent is already detached` 固定单决定的重放校验、整队拒绝，以及取消 RPC 从不失败。`does not keep a pending cancel after lazy creation fails` 保持此后独立的重试不受影响。
