# Agent Note：HarnessClient 有界关闭

Status: implemented

[English](2026-08-22-harness-client-bounded-shutdown.md) | 中文

## 问题

`HarnessClientCore.shutdown()` 以无超时方式等待 `shutdown` RPC，随后无条件 `Process.waitUntilExit()`。缓慢或不应答的运行时——机器高负载或卡死的子进程——会让收尾永远挂起。Swift 测试套件以无限挂起复现了这一点：两个不同的子进程测试（`RuntimeProcessTests.testStartTwiceThrows`、`HarnessClientTests.testOnRequestReceivesServerRequest`）各自停在 shutdown 内部的 `XCTWaiter` 上；每次挂的测试不同，掩盖了共同的单一根因。

## 决策

关闭全程有界：尽力而为的 `shutdown` RPC 与 5 秒超时经"仅恢复一次"的门竞争（落败分支被放弃而非取消——进行中的 RPC continuation 无法被打断，等待两个分支会重新引入挂起）；句柄关闭后，子进程先 SIGTERM 并给 3 秒宽限，再 SIGKILL；最后 `waitUntilExit()` 在任一信号后迅速收割。假测试运行时新增 `FAKE_HANG_SHUTDOWN=1`，确定性地模拟不应答子进程。

## 曾考虑的替代方案

**超时时取消 RPC 任务。** 拒绝：取消无法打断已挂起的 continuation，任务组仍会等它——放弃是唯一诚实的竞争。**不加宽限直接杀。** 拒绝：SIGTERM 让守规矩的运行时有机会落盘；3 秒在正常路径上没有成本。

## 后果

**换来**：收尾必定完成；测试套件恢复确定性（140 个测试约 14 秒），并有回归测试把不应答子进程场景钉在 5–6 秒而非 ∞。**付出**：需要超过 5 秒才确认 `shutdown` 的运行时失去优雅窗口、死于信号；每次超时的关闭会泄漏一个被放弃分支的 continuation。

## 测试

`RuntimeProcessTests.testStopForceKillsUnresponsiveRuntime` 驱动新开关：修复前以挂起的方式失败，修复后约 5.6 秒通过；完整套件连同两个曾挂起的套件全部通过。
