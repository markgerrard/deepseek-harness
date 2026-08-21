# DS Bot v0

Date: 2026-08-19
Branch: `feat/ds-bot` (do not land on `feat/cc-style-tui`)
Status: draft for review — not implemented

Lives under `apps/macos/docs/` rather than `docs/` because `docs/**` in this repo is a bilingual pair.

A native macOS remote-control for DeepSeek Harness, shaped like Grok Bot (named teammates and threads) with Crush/TUI conversation mechanics. This is the first slice of a later always-on cloud-computer product. v0 runs the harness on this Mac.

## Goal

A SwiftUI macOS app in `apps/macos` that lets you create named Bots, open multiple threads per Bot, and talk to them through one local dsh JSON-RPC process. Each Bot has its own job text (model-visible), provider, model, and thinking level. Threads are isolated conversations on a shared workspace.

v0 is not done until two Bots in one process each complete a real-model turn (requires `DEEPSEEK_API_KEY` or the matching provider key).

## Non-goals (v0)

- Cloud computer, Agent Computer pane, takeover, or browser-use tools
- Always-on when this Mac sleeps or the app quits
- iOS
- WAN auth or a network transport (stdio JSON-RPC only)
- Group chat between Bots
- `/connect` UI, slash-command palette, session/list RPC
- Lifting `TuiController` onto a wire or changing the Ink TUI
- Private disk per Bot or per thread
- Extending `/Volumes/Workspace/repos/grok` (that app is a grok.com WebView)

## Product map

| Grok Bot | v0 |
|---|---|
| Named teammate (name, job, how it works) | User-authored dsh agent preset + display name + persona text |
| Thread list per Bot, one chat visible | One dsh session id per thread; Swift sidebar |
| Shared computer | Shared cwd / files / shell on this Mac |
| Isolated memory | Isolated session logs; isolated preset persona/tools |
| Provider / model / thinking per Bot | Per-Bot `provider`, `model`, `reasoningEffort` applied via `installModelSelection` |
| Crush-like transcript | Port of TUI `projectTranscript` (assistant, reasoning, tools, approvals) |
| Computer pane | Absent |

## Architecture

One SwiftUI process owns chrome and the Bot/thread roster. It spawns one dsh runtime and speaks the existing SDK JSON-RPC protocol (newline-delimited JSON-RPC on stdio), extended for presets and per-session model selection.

```text
apps/macos (SwiftUI)
  Bot list · thread list · Crush chat · approval sheet
        │  SDK JSON-RPC (stdio)
        ▼
dsh runtime (one process)
  dsh-base + agent-presets + jsonrpc server
  no Ink, no Host, no web
```

A **Bot** is a user-trust agent preset (`ctx.agentPresets.copy` of shipped `code` or `standard`) plus app-side provider/model/thinking. Job/description is the preset's `dsh-persona` `text`.

A **thread** is one dsh `SessionId` created with that preset. Unknown `session/prompt` ids create; `session/resume` rehydrates. Other sessions stay live in the same process.

`initialize.provider` / `initialize.model` remain process defaults for SDK compatibility. Every Bot thread sends its own selection; the server applies it with `installModelSelection` on that agent, not by re-handshake.

## Components

### dsh — SDK protocol (`packages/sdk/protocol`)

Add methods and fields. Do not accept arbitrary composition YAML on the wire.

- `presets/list` → roster rows (`id`, `trust`, `name`/`description` from `preset.yml`, `broken?`).
- `presets/copy` `{ from, id, name? }` — existing copy-only authoring.
- `presets/setPersona` `{ id, text }` — user-trust presets only. Replaces `config.text` on the existing `persona` row (`@deepseek-ai/dsh-persona`). Refuses system-trust ids, missing persona row, non-string text, and any payload that is not that string. Does not parse or write other YAML keys.
- `session/prompt` create path accepts optional `agentPreset`, `provider`, `model`, `reasoningEffort`. Required on first create from this app. Resume does not change preset (header is durable).
- `session/setModel` `{ sessionId, provider, model, reasoningEffort? }` — updates `installModelSelection` on a live agent so the next step uses it. An unknown or not-yet-live id is a typed error, not a no-op, so a client cannot believe a switch landed.

Approvals stay `session/request_permission` with closed outcomes `allowed-once` | `rejected` | `cancelled` | `unavailable`.

### dsh — SDK server (`packages/sdk/server`)

Today `createSession` does not mount a preset and uses process-wide provider/model.

On create:

1. `agentPresets.mount(agentCtx, agentPreset)` inside `setup` (the only supported join site).
2. `installModelSelection` with that Bot's provider/model/effort.
3. Persist `agentPreset` on the session header (existing field).

On resume: remount from the header's `agentPreset` (or `resolveSessionPreset`); apply the model selection the client sends on resume/setModel. Do not silently keep the process-wide initialize route if the client sent a per-Bot selection.

jsonrpc composition for the app: host plane is `dsh-base` plus `dsh-agent-presets` plus `dsh-sdk-jsonrpc-server`. Agent plane comes from presets. No `tui-runner`, no Host HTTP, no stdout logger.

Shipped copy source for new Bots: `code` (same coding agent as the TUI, including Code Mode). `standard` is allowed if Code Mode is unavailable in that composition; pick one in the Swift create sheet and default to `code`.

### Swift — `apps/macos`

Native SwiftUI, macOS 15+, SwiftPM or XcodeGen alongside the repo (same pattern as other native trees: source of record in-repo, no Ink).

Modules:

- `HarnessClient` — JSON-RPC stdio client (port the TS/Python client contract, not the Ink controller).
- `BotStore` — Bots and threads in Application Support JSON. A Bot holds `presetId`, `displayName`, `provider`, `model`, `reasoningEffort`, thread ids. Persona text lives in dsh; the store may cache it for the editor.
- `TranscriptProjection` — port of `packages/bundle/tui/src/transcript.ts` enough to render assistant, reasoning, tool, and command cards. Fixtures copied from TUI tests.
- `ChatView` / `BotList` / `ThreadList` / `ApprovalSheet` — Grok Bot chrome, no Computer pane.
- `RuntimeProcess` — spawn, restart, shutdown ladder matching SDK client (`shutdown` then SIGTERM/SIGKILL).

Keys: environment only (`DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`, `CLINE_API_KEY` as the TUI already documents). No `/connect` UI.

### Isolation

Chats and personas are per Bot/thread. Files, shell, and cwd are shared (Grok Bot's shared computer, without the pane). `initialize.cwd` is the user's chosen workspace, one per runtime.

`setPersona` after a Bot already has live threads: standing preset mounts keep the generation they joined (dsh stamp). New threads see the new text. Live threads keep the persona they started with. Document that in the Bot editor.

## Data flow

1. Launch: spawn runtime, `initialize` with `clientCapabilities.approvals: true`, `presets/list`.
2. Create Bot: `presets/copy` from `code` → `presets/setPersona` with job prose that keeps `{{model}}` and `{{cwd}}` as template variables → record provider/model/thinking in `BotStore`.
3. New thread: new UUID, `session/prompt` with `agentPreset` + model selection.
4. Visible chat: `session.event` filtered by `sessionId`, projected to cards.
5. Switch thread: if not live, `session/resume` then filter events. Other agents stay running.
6. Approval: sheet; dismiss = `rejected` (tool does not run).
7. Change Bot model: `session/setModel` on that Bot's live session ids; store the new values for future threads.
8. Quit: protocol `shutdown`, then the existing SDK dispose ladder. Bots stop.

## Errors

- Missing key: the open thread shows which env var that Bot's provider needs. Send is refused.
- Runtime crash / transport drop: banner with Restart. In-flight turns die. Restart then `session/resume` the visible thread; others resume when opened.
- Broken preset: omitted from the usable Bot list; show the server's `broken` reason.
- Unknown provider/model: refuse on send; keep the thread.
- `presets/setPersona` on a system preset or YAML-shaped payload: error, no file write.

## Testing

A check must fail if the behaviour is missing. Green skip is not a pass except the documented keyless skip below.

### SDK vitest (must run in CI without a key)

- Two sessions, one process, different `agentPreset` + provider/model/effort: each agent mounted the named preset and `installModelSelection` carried that triple. Fail if both agents share initialize's route.
- Resume restores header `agentPreset`. Fail if resume mounts the default or none.
- `setPersona` changes only `persona` `config.text`. Fail if arbitrary YAML in `text` is written as composition, or if a system-trust id is mutated.
- Approval closed set unchanged: garbage outcome → `rejected`; no grant.

### Swift XCTest (must run without the GUI)

- One Bot → many thread ids; events for session A never appear in B's projection.
- Transcript fixtures from TUI: assistant / reasoning / tool cards.
- Dismissed approval encodes `rejected`, not `allowed-once`.

### Live two-Bot e2e (required to call v0 done)

Requires a real provider key. Not a CI silent-pass: the job is skip (not pass) when the key is absent; the v0 completion claim is forbidden while skipped.

Procedure:

1. Spawn the macos jsonrpc composition.
2. Copy two user presets, `setPersona` to two distinct job strings (include a unique token in each).
3. Give them different `reasoningEffort` and/or model ids on the same keyed provider if only one key exists.
4. Prompt each session with a one-line instruction that can only be answered by that Bot's job token being in context (e.g. "State your job token and nothing else").
5. Assert both turns reach idle with assistant text, both session logs are distinct, and each assistant output reflects its own persona token (or the recorded request config shows the distinct model/effort if the model refuses to quote the token).
6. Fail if a single initialize route was used for both, if either session has no `agentPreset`, or if either log contains the other's session id as its own.

Keyless smoke (optional extra): fake/stub provider if one exists; never substitute for the live e2e.

No screenshot gate. Do not modify Ink TUI tests on `feat/crush-style-tui`.

## Key decisions

1. **Swift is a remote, not a Cordis plugin.** The TUI is in-process Ink. Swift talks SDK JSON-RPC. The TUI is the product model to copy (transcript, approvals, coding persona), not a library to link.
2. **Bots are dsh agent presets**, not only a Swift roster. Persona and tools are harness facts so a later cloud host still owns identity.
3. **Narrow `setPersona` RPC**, not Swift editing YAML and not first-turn prompt injection. Required for a later WAN client that cannot write `$DSH_HOME`.
4. **Per-Bot provider/model/thinking** via `installModelSelection`, not one initialize route and not one process per Bot.
5. **Shared workspace, isolated chats** — Grok Bot parity. No per-Bot cwd in v0.
6. **No Computer pane in v0.** Always-on cloud desktop is a later spec.
7. **App quit stops the harness.** Always-on is that later spec.
8. **Work only on `feat/ds-bot`.** `feat/cc-style-tui` stays the TUI branch.
9. **Live two-Bot real-model run is a completion gate**, not a nice-to-have.

## Open questions

None blocking v0. Deferred by construction: cloud computer host, iOS, `/connect`, session/list, persisting model/thinking inside the preset file (v0 stores those in `BotStore` and resends them).

## PR plan

Order is binding: protocol and server before the app.

1. **SDK protocol + server: presets and per-session model**
   `packages/sdk/{protocol,server,client}` and tests in (Testing / SDK vitest). No Swift.
2. **macos jsonrpc composition**
   Bundle/profile that loads base + agent-presets + jsonrpc, no TUI/Host. Wire `presets/*` to `ctx.agentPresets`.
3. **Swift HarnessClient + BotStore + projection**
   `apps/macos` library targets + XCTest. No full chrome required.
4. **SwiftUI chrome**
   Bot list, thread list, chat, approval sheet. Spawn/shutdown the runtime.
5. **Live two-Bot e2e**
   Gated on a real key. Lands last. v0 is not complete without a passing recorded run of this check.
