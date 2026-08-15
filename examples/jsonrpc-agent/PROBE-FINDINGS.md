# SDK runtime probe findings (2026-08-15)

Evaluating `@deepseek-ai/dsh-sdk-*` as the integration surface for a headless
agent, in the way we already drive Codex App Server and the Claude Agent SDK.
Everything below was **observed by running the runtime**, not read from docs.

Driver: `probe-driver.mjs` — raw newline-delimited JSON-RPC over stdio to
`packages/examples/jsonrpc-demo/lib/bin.js`, exactly as a Go adapter would.
Model route: `deepseek/deepseek-chat` via an OpenAI-compatible gateway
(`DEEPSEEK_BASE_URL=https://openrouter.ai/api/v1`) — no DeepSeek account
needed, which itself is a useful finding.

## Confirmed working

**Live turn with real tool execution.** `initialize` →
`{"serverInfo":{"name":"deepseek-harness-sdk-runtime","version":"0.0.1"}}`,
`session/prompt` → `messageId`, then 29 `session.event` frames for one turn:
`turn/start`, `step/start`, 13 × `assistant/chunk`, `tool/call`, `tool/result`,
`assistant/message`, `session/title`, `turn/end`. The bash tool really ran
(`echo probe-ok` → `probe-ok`).

**Streaming is available on this surface.** 13 `assistant/chunk` frames with
structured `block-start` / `blockType` markers. (The ACP surface is
committed-message-only; the SDK surface is not.)

**Event payloads are richer than Codex's.** Monotonic `seq`, `time`,
`turn`/`step` correlation, `callId` linking call to result, and
`sourceEventSeqs` giving provenance from a result back to the call.

**MCP over Streamable HTTP with a bearer sourced from process env.** Verified
against a header-capturing stub: the child sent
`Authorization: Bearer <token>` with the token appearing **zero times** on
disk. This is the `bearer_token_env_var` containment property, by
configuration — no patch required. See `probe-mcp.cordis.yml`.

**Code Mode does what it claims, and stays observable.** With
`tools: { mode: code }` plus `dsh-code-runtime-worker-thread`, a 4-operation
task produced **one** `tool/call` (`run_code`) and 4 ×
`tool/code-dispatch-start` + 4 × `tool/code-dispatch`. Each dispatch carries
`rootCallId` / `parentCallId` / `subCallId`, plus per-operation `name`,
`arguments` and `isError` — so a per-operation activity UI still renders every
step while the model makes a single round-trip. The three files were really
written. See `probe-code-mode.cordis.yml`.

**Subagents, with clean attribution.** `subagent.started` carries
`{parentSessionId, childSessionId}`, and every `session.event` carries
`sessionId`; one delegated task split 47 parent events / 56 child events,
trivially separable. The child really wrote its file. This is better than
Codex, where child activity has to be inferred.

**The sandbox is real.** Under `mode: read-only` a write attempt returned
`bash: blocked.txt: Read-only file system` and nothing was created.

## Confirmed gaps

**No approvals on this surface.** Under a read-only sandbox the denial was
terminal — no `approval/asked` was emitted, the tool simply failed. Escalation
needs an asker plugin, and even with one the SDK transport cannot relay the
question: the protocol README states server→client requests are a dead
capability. Both ends already exist (`JsonRpcTransportPeer.request()`; the
Python client's `respond()` / `respond_error()`), so this is unwired, not
unbuildable.

**No cancel, and no resume — together these are worse than either alone.**
Cancelling means killing the process. But a fresh runtime pointed at the same
`DSH_SESSION_ROOT` with the same session id fails:

```
session "probe-session-1" already has a persisted log on disk that does not
match this live session (id collision)
```

An unknown session id *lazily creates* a new agent+session; it does not
rehydrate the persisted one. So killing to cancel loses the conversation **and**
burns the session id. Note the Host layer references "cold-resume", so the
capability appears to exist off this transport.

**Session-persistence compression is per-composition and fail-loud.** Reusing
one `DSH_SESSION_ROOT` across the plain-`.jsonl` and zstd compositions errors
with a message naming the fix. Use a separate root per composition.

## The pattern

All three gaps are the same shape: the capability exists in-repo but is not
wired to the SDK transport. Cancel exists in `packages/acp/acp`
(`session/cancel`). Approvals exist as a stubbed responder plus a
bidirectional transport. Resume appears in the Host as cold-resume. The SDK
surface is four days old and pre-release (`0.0.1`, "no compatibility
promise"), so this is youth, not architecture — the patches are wiring jobs.

## Incidental upstream bug

`examples/package.json` is documented as declaring "the union of every leaf's
cordis.yml plugins as `workspace:*`", but omits `@deepseek-ai/dsh-mcp-client`,
so `examples/mcp-memory/*.cordis.yml` cannot boot from `examples/`. Added here.

## Reproducing

```sh
export DEEPSEEK_API_KEY=...          # any OpenAI-compatible gateway key
export DEEPSEEK_BASE_URL=https://openrouter.ai/api/v1
export DSH_MODEL=deepseek/deepseek-chat
export DSH_CWD=/tmp/dsh-ws DSH_SESSION_ROOT=/tmp/dsh-sessions
export DSH_CORDIS_CONFIG=$PWD/examples/jsonrpc-agent/probe-code-mode.cordis.yml
node examples/jsonrpc-agent/probe-driver.mjs "your task"
```

Each config needs its own `DSH_SESSION_ROOT`. Configs must live where their
plugins resolve (pnpm strict isolation) — hence `examples/jsonrpc-agent/`.
