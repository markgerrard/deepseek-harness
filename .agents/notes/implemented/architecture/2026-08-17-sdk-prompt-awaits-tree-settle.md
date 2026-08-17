# Agent Note: SDK prompt awaits plugin-tree settle before session creation

Status: implemented

## Problem

The SDK JSON-RPC server's stdio surface attaches while the plugin tree is
still mounting, so a `session/prompt` can arrive and create a session before
every plugin has activated. A session created at that moment assembles an
INCOMPLETE model-facing tool surface for its first request, and the turn
proceeds without the missing tools — silently. Observed deterministically
(3/3) with `@deepseek-ai/dsh-mcp-client`, which blocks its own activation on
the initial tool sync exactly so consumers observe its tools: a first prompt
fired immediately after `initialize` produced a model request with no
`mcp__*` tools, while the second turn carried them. For an agent whose whole
purpose is its MCP tools (the callhub manager leaf), the first user question
is then answered from priors — the confident-wrong failure that composition
exists to prevent. Config entry order cannot fix it: the stdio listener
serves buffered frames as soon as its own apply registers, independent of
later entries' activation.

## Decision

`HarnessSdkJsonRpcServer.prompt` awaits `ctx.get('loader').await()` before
consulting the session maps, when a Loader with that method is present. After
boot the call resolves immediately, so steady-state prompts pay nothing.
Hand-mounted contexts without a Loader take no await at all — the guard is a
`typeof` check — preserving the synchronous prompt→create ordering their
callers rely on (`server.spec.ts` pins that ordering; all 137 SDK tests
pass unchanged).

The assembled-application regression lives in
`examples/callhub-agent/tests/keyless-smoke.e2e.ts`: the leaf lists
`mcp-client` before `sdk-jsonrpc-server`, the smoke fires `session/prompt`
straight after `initialize`, and asserts the FIRST model request's tool list
equals the exact composition allowlist. Red 3/3 before this change, green 3/3
after.

`initialize` deliberately does NOT gate on the tree: it carries no
tool-surface consequence, and answering it early keeps the handshake cheap
for clients that initialize eagerly and prompt later.
