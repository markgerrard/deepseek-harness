# Agent Note: SDK prompt awaits plugin-tree settle before session creation

Status: implemented

English | [中文](2026-08-17-sdk-prompt-awaits-tree-settle.zh.md)

## Problem

The SDK JSON-RPC server's stdio surface attaches while the plugin tree is still mounting, so a `session/prompt` can arrive and create a session before every plugin has activated. A session created at that moment assembles an INCOMPLETE model-facing tool surface for its first request, and the turn proceeds without the missing tools — silently. Observed deterministically (3/3) with `@deepseek-ai/dsh-mcp-client`, which blocks its own activation on the initial tool sync exactly so consumers observe its tools: a first prompt fired immediately after `initialize` produced a model request with no `mcp__*` tools, while the second turn carried them. For an agent whose whole purpose is its MCP tools (the callhub manager leaf), the first user question is then answered from priors — the confident-wrong failure that composition exists to prevent. Config entry order cannot fix it: the stdio listener serves buffered frames as soon as its own apply registers, independent of later entries' activation.

## Decision

`HarnessSdkJsonRpcServer.prompt` awaits `ctx.get('loader').await()` before consulting the session maps, when a Loader with that method is present. After boot the call resolves immediately, so steady-state prompts pay nothing. Hand-mounted contexts without a Loader take no await at all — the guard is a `typeof` check — preserving the synchronous prompt→create ordering their callers rely on (`server.spec.ts` pins that ordering; all 137 SDK tests pass unchanged).

The assembled-application regression lives in `examples/callhub-agent/tests/keyless-smoke.e2e.ts`: the leaf lists `mcp-client` before `sdk-jsonrpc-server`, the smoke fires `session/prompt` straight after `initialize`, and asserts the FIRST model request's tool list equals the exact composition allowlist. Red 3/3 before this change, green 3/3 after.

`initialize` now also awaits tree settle before replying (the runtime's `jsonrpc` plugin gates it), so an eager handshake observes async sibling capabilities too. The prompt-side await remains authoritative for the tool surface: it covers clients that prompt without initializing, and hand-mounted contexts without a Loader stay synchronous on both paths.

## Alternatives considered

- **Gate only `initialize`**: rejected as the sole mechanism — a client may prompt without initializing, and the tool-surface consequence lives on session creation, not the handshake.
- **Reorder config entries so the server mounts last**: cannot work; the stdio listener serves buffered frames as soon as its own apply registers, independent of later entries' activation.
- **Block `mcp-client` consumers via service dependency**: the SDK server injects only `agents` and must serve compositions with no MCP at all; declaring optional dependencies per sibling capability does not scale to arbitrary leaves.

## Consequences

The first prompt of a Loader-mounted composition always sees the fully assembled tool surface, at the cost of one tree-settle await on the first prompt (free at steady state). Hand-mounted test contexts keep their synchronous prompt→create ordering, so the guard adds no test churn. A plugin that never settles now also stalls the first prompt rather than silently serving without its tools — misconfiguration surfaces as a hang at the boundary instead of a confident wrong answer.
