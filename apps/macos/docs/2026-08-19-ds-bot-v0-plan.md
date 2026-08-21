# DS Bot v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a native macOS DS Bot shell (Grok Bot-style) that drives one local dsh JSON-RPC process, with named Bots (presets + per-Bot model/thinking) and isolated threads, proven by a live two-Bot real-model run.

**Architecture:** SwiftUI in `apps/macos` speaks the existing SDK stdio JSON-RPC protocol, extended for `presets/*`, per-session `agentPreset`, and `installModelSelection`. One harness process; Bots are user-authored copies of the shipped `code` preset; threads are session ids. No Ink, no Host/web, no Computer pane.

**Tech Stack:** TypeScript (dsh SDK/protocol/server, vitest), Swift 6 / macOS 15 SwiftUI (SwiftPM), JSON-RPC over stdio, Cordis agent presets.

**Spec:** `apps/macos/docs/2026-08-19-ds-bot-v0-design.md`

## Global Constraints

- Branch is `feat/ds-bot` only. Do not commit, push, or edit `feat/cc-style-tui`.
- Do not modify Ink TUI tests or `packages/bundle/tui` except reading `transcript.ts` as the projection source to port.
- `docs/**` is bilingual in this repo; do not add unpaired English files there. Agent Notes under `.agents/notes/` need a complete EN/ZH/`i18n.yaml` triplet.
- New TypeScript under `packages/*/*/src` is under the 100% per-file coverage gate.
- Python SDK is out of scope unless an existing test fails because of the protocol add.
- v0 is not done while the live two-Bot e2e is skipped for a missing key.
- App quit stops the harness. Always-on and WAN are later specs.

---

## File structure

| Path | Responsibility |
|---|---|
| `packages/sdk/protocol/src/types.ts` | Wire types for presets, prompt create fields, `session/setModel` |
| `packages/sdk/protocol/src/index.ts` | Re-export new types |
| `packages/preset/agent-presets/src/authoring.ts` | `setPersonaText` — replace only `persona` `config.text` |
| `packages/preset/agent-presets/src/index.ts` | `AgentPresets.setPersona(id, text)` |
| `packages/sdk/server/src/server.ts` | Dispatch new methods; mount preset + `installModelSelection` on create/resume |
| `packages/sdk/client/src/client.ts` | Typed client methods for the new RPCs |
| `packages/bundle/macos-jsonrpc/` | Host composition: base + agent-presets + jsonrpc, no TUI/Host |
| `apps/cli` / profile template | `macos` profile alias if a launcher entry is required to spawn the runtime |
| `apps/macos/Package.swift` | SwiftPM: `DsBotCore` lib, `DsBot` exe, `DsBotCoreTests` |
| `apps/macos/Sources/DsBotCore/JSONRPC.swift` | Newline-delimited JSON-RPC codec |
| `apps/macos/Sources/DsBotCore/HarnessClient.swift` | Spawn + protocol methods + approvals |
| `apps/macos/Sources/DsBotCore/BotStore.swift` | Bots, threads, provider/model/effort |
| `apps/macos/Sources/DsBotCore/TranscriptProjection.swift` | Port of TUI `projectTranscript` |
| `apps/macos/Sources/DsBotCore/RuntimeProcess.swift` | Shutdown ladder |
| `apps/macos/Sources/DsBot/` | SwiftUI chrome |
| `apps/macos/Tests/DsBotCoreTests/` | XCTest |
| `packages/sdk/server/tests/two-bot.e2e.ts` | Live two-Bot gate (skip without key) |

---

### Task 1: Protocol wire types

**Files:**
- Modify: `packages/sdk/protocol/src/types.ts`
- Modify: `packages/sdk/protocol/src/index.ts`
- Create: `packages/sdk/protocol/tests/types.spec.ts`

**Interfaces:**
- Consumes: existing `HarnessSdkRequestMap`
- Produces: types listed below; later tasks import them from `@deepseek-ai/dsh-sdk-protocol`

Add these types (do not change existing field meanings):

```ts
export interface PresetListResult {
  readonly presets: readonly PresetListItem[]
}

export interface PresetListItem {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

export interface PresetCopyParams {
  readonly from: string
  readonly id: string
  readonly name?: string
}

export interface PresetSetPersonaParams {
  readonly id: string
  readonly text: string
}

export interface SessionSetModelParams {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** Extend SessionPromptParams — existing fields stay required. */
export interface SessionPromptParams {
  sessionId: string
  contentBlocks: ContentBlock[]
  agentPreset?: string
  provider?: string
  model?: string
  reasoningEffort?: string
}

/** Extend SessionResumeParams. */
export interface SessionResumeParams {
  sessionId: string
  provider?: string
  model?: string
  reasoningEffort?: string
}
```

Add to `HarnessSdkRequestMap`:

```ts
'presets/list': { params: Record<string, never>; result: PresetListResult }
'presets/copy': { params: PresetCopyParams; result: Record<string, never> }
'presets/setPersona': { params: PresetSetPersonaParams; result: Record<string, never> }
'session/setModel': { params: SessionSetModelParams; result: Record<string, never> }
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { HarnessSdkRequestMap, SessionPromptParams } from '../src/index.ts'

describe('SDK protocol preset and per-session model fields', () => {
  it('names the new request methods on the request map', () => {
    const methods: (keyof HarnessSdkRequestMap)[] = [
      'presets/list', 'presets/copy', 'presets/setPersona', 'session/setModel',
    ]
    expect(methods).toHaveLength(4)
  })

  it('accepts optional create fields on session/prompt', () => {
    const params: SessionPromptParams = {
      sessionId: 's1',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      agentPreset: 'bot-a',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    }
    expect(params.agentPreset).toBe('bot-a')
    expect(params.reasoningEffort).toBe('high')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/sdk/protocol/tests/types.spec.ts`
Expected: FAIL compiling (`SessionPromptParams` has no `agentPreset`) or file missing.

- [ ] **Step 3: Write minimal types + exports**

Update `types.ts` and re-export every new interface from `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/sdk/protocol/tests/types.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/protocol/src/types.ts packages/sdk/protocol/src/index.ts packages/sdk/protocol/tests/types.spec.ts
git commit -m "feat(sdk-protocol): presets and per-session model wire types"
```

---

### Task 2: `AgentPresets.setPersona`

**Files:**
- Modify: `packages/preset/agent-presets/src/authoring.ts`
- Modify: `packages/preset/agent-presets/src/index.ts`
- Modify: `packages/preset/agent-presets/tests/authoring.spec.ts`
- Create: `.agents/notes/active/feature/2026-08-19-sdk-preset-session-model.md` plus `.zh.md` and `.i18n.yaml` (dsh pairing). The note states: `setPersona` writes only the existing `persona` row's `config.text` on a user-trust preset; it is not a composition-text authoring seam.

**Interfaces:**
- Consumes: `AgentPresets.copy`, `readComposition`, `PRESET_ID`, `js-yaml` (already used in `metadata.ts`)
- Produces: `AgentPresets.setPersona(id: string, text: string): Promise<void>` and `export async function setPersonaText(preset: AgentPreset, text: string): Promise<void>`

Persona row match: a composition list item whose `id === 'persona'` and `name` is `'@deepseek-ai/dsh-persona'` (or the short plugin name `persona` if a fixture uses it). `config` must be a mapping; set `config.text = text` as a YAML string scalar (not parsed as nested YAML). Invalidate `this.standing.delete(id)` after a successful write so the next mount sees the new generation; live joined sessions keep the old stamp (existing mount rule).

Errors (throw, do not write):
- `PresetNotWritableError` if `preset.trust !== 'user'`
- `Error` whose message includes `persona row` if no persona row exists
- `TypeError` if `text` is not a string (the TS signature is string; the SDK server still type-guards the wire)

- [ ] **Step 1: Write the failing tests** (append to `authoring.spec.ts`)

```ts
describe('setPersona', () => {
  it('replaces only the persona config.text on a user copy', async () => {
    await ctx.agentPresets.copy('standard', 'mine')
    await ctx.agentPresets.setPersona('mine', 'You are TOKEN-A. Working dir {{cwd}}. Model {{model}}.')
    const body = await ctx.agentPresets.read('mine')
    expect(body).toContain('You are TOKEN-A.')
    expect(body).toContain('id: persona')
    expect(body).toContain('name: \'@deepseek-ai/dsh-persona\'')
    // payload that looks like YAML must not become rows
    await ctx.agentPresets.setPersona('mine', '- id: evil\n  name: not-a-plugin')
    const after = await ctx.agentPresets.read('mine')
    expect(after).not.toMatch(/id: evil/)
    expect(after).toContain('- id: evil')
  })

  it('refuses a system-trust preset', async () => {
    await expect(ctx.agentPresets.setPersona('standard', 'nope'))
      .rejects.toThrow(/cannot be written|system/)
  })
})
```

Use the fixture `standard` composition in `packages/preset/agent-presets/tests/fixtures/system/standard/agent.cordis.yml`. If that fixture has no persona row, add a `persona` row to **that test fixture only** (not the shipped `apps/cli` presets — those already have one).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/preset/agent-presets/tests/authoring.spec.ts -t setPersona`
Expected: FAIL `setPersona is not a function`

- [ ] **Step 3: Implement `setPersonaText` + `AgentPresets.setPersona`**

Parse with `yaml.load` from `js-yaml`. If the document is not an array, throw. Find the persona row, assign `row.config = { ...row.config, text }`, `yaml.dump` the array, `writeFileAtomic` to `preset.path`. Then `this.standing.delete(id)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/preset/agent-presets/tests/authoring.spec.ts`
Expected: PASS including existing copy tests

- [ ] **Step 5: Commit**

```bash
git add packages/preset/agent-presets .agents/notes/active/feature/2026-08-19-sdk-preset-session-model.md \
  .agents/notes/active/feature/2026-08-19-sdk-preset-session-model.zh.md \
  .agents/notes/active/feature/2026-08-19-sdk-preset-session-model.i18n.yaml
git commit -m "feat(agent-presets): setPersona writes only persona text"
```

Record pairing hashes with `pnpm run verify-translation-pairing --write .agents/notes/active/feature/2026-08-19-sdk-preset-session-model.md` after both languages say the same thing.

---

### Task 3: SDK server — preset RPCs

**Files:**
- Modify: `packages/sdk/server/src/server.ts` (`handleRequest` switch + new methods)
- Modify: `packages/sdk/server/src/index.ts` if `inject` must include `agentPresets` — prefer `ctx.get('agentPresets')` so rosterless deployments keep working
- Modify: `packages/sdk/server/tests/server.spec.ts`

**Interfaces:**
- Consumes: `AgentPresets.list`, `.copy`, `.setPersona`; protocol types from Task 1
- Produces: `handleRequest('presets/list' | 'presets/copy' | 'presets/setPersona', params)`

Map service errors to thrown `Error` (JSON-RPC `-32603`) with the service message. If `ctx.get('agentPresets')` is missing, throw `Error('agent-presets is not composed')`.

- [ ] **Step 1: Write the failing tests** in `server.spec.ts`

Extend the existing `FakeTransport` + mocked `ctx` fixture. Add `agentPresets` mock:

```ts
it('lists, copies, and setPersona through JSON-RPC', async () => {
  const list = vi.fn(async () => [{ id: 'code', trust: 'system' as const, path: '/x' }])
  const copy = vi.fn(async () => undefined)
  const setPersona = vi.fn(async () => undefined)
  const ctx = {
    on: vi.fn(() => () => undefined),
    agents: { create: vi.fn(), get: vi.fn() },
    get: (key: string) => key === 'agentPresets'
      ? { list, copy, setPersona }
      : { listProviders: () => [{ id: 'mock' }] },
  } as unknown as Context
  const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
  await server.handleRequest('initialize', { cwd: '/tmp', provider: 'mock', model: 'm' })
  const listed = await server.handleRequest('presets/list', {})
  expect(listed).toEqual({ presets: [{ id: 'code', trust: 'system' }] })
  await server.handleRequest('presets/copy', { from: 'code', id: 'bot-a', name: 'A' })
  expect(copy).toHaveBeenCalledWith('code', 'bot-a', 'A')
  await server.handleRequest('presets/setPersona', { id: 'bot-a', text: 'job' })
  expect(setPersona).toHaveBeenCalledWith('bot-a', 'job')
})

it('rejects setPersona when text is not a string', async () => {
  const setPersona = vi.fn()
  // same ctx shape as above with setPersona
  await expect(server.handleRequest('presets/setPersona', { id: 'bot-a', text: { yaml: true } }))
    .rejects.toThrow(/text/)
  expect(setPersona).not.toHaveBeenCalled()
})
```

Strip `path` from list results — wire type has no `path`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/sdk/server/tests/server.spec.ts -t "lists, copies"`
Expected: FAIL `unknown DeepSeek Harness SDK runtime method: presets/list`

- [ ] **Step 3: Implement handlers**

In `handleRequest`, add the three cases. Implement:

```ts
private requirePresets(): AgentPresets {
  const presets = this.ctx.get('agentPresets')
  if (presets === undefined) throw new Error('agent-presets is not composed')
  return presets
}

private async listPresets(): Promise<PresetListResult> {
  const presets = await this.requirePresets().list()
  return {
    presets: presets.map(({ id, trust, name, description, broken }) => ({
      id, trust, ...name === undefined ? {} : { name },
      ...description === undefined ? {} : { description },
      ...broken === undefined ? {} : { broken },
    })),
  }
}
```

Guard `setPersona`: `typeof params.text === 'string'` else throw.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/sdk/server/tests/server.spec.ts`
Expected: PASS including existing resume/cancel tests

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/server
git commit -m "feat(sdk-server): presets/list copy setPersona"
```

---

### Task 4: SDK server — mount preset + per-session model on create

**Files:**
- Modify: `packages/sdk/server/src/server.ts` (`SessionRecord`, `createSession`, `prompt` path that starts a create)
- Modify: `packages/sdk/server/tests/server.spec.ts`

**Interfaces:**
- Consumes: `CreateAgentOptions.setup`, `installModelSelection`, `ReasoningEffortId` from `@deepseek-ai/dsh-llm`, `ctx.agentPresets.mount`
- Produces: create uses first `session/prompt`'s `agentPreset` / `provider` / `model` / `reasoningEffort`; `SessionRecord.selection: ModelSelectionRef`

Change `beginSessionLoad(..., () => this.createSession(sessionId))` to pass the **prompt params that started the create** (`params` from `prompt()`). Later queued prompts must not change preset or model.

`createSession`:

```ts
private async createSession(sessionId: string, prompt: SessionPromptParams): Promise<SessionRecord> {
  const provider = prompt.provider ?? this.provider
  const model = prompt.model ?? this.model
  const selection: ModelSelectionRef = {
    current: {
      provider,
      model,
      ...prompt.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(prompt.reasoningEffort) },
    },
    assembled: undefined,
  }
  const presets = this.ctx.get('agentPresets')
  const handle = await this.ctx.agents.create({
    sessionId: SessionId(sessionId),
    meta: {
      cwd: this.cwd,
      ...prompt.agentPreset === undefined ? {} : { agentPreset: prompt.agentPreset },
    },
    agentOptions: {
      provider,
      model,
      ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
    },
    setup: async (agentCtx) => {
      if (prompt.agentPreset !== undefined) {
        if (presets === undefined) throw new Error('agent-presets is not composed')
        await presets.mount(agentCtx, prompt.agentPreset)
      }
      installModelSelection(agentCtx, selection)
    },
  })
  const rec: SessionRecord = { handle, selection }
  this.sessions.set(sessionId, rec)
  return rec
}
```

If `prompt.provider` is set and `!this.hasAdapterFor(provider)` throw the same error `initialize` uses.

- [ ] **Step 1: Write the failing test**

```ts
it('mounts different presets and model selections on two creates in one server', async () => {
  const mounts: { id: string }[] = []
  const creates: { preset?: string; provider: string; model: string }[] = []
  const on = vi.fn(() => () => undefined)
  const ctx = {
    on: vi.fn(() => () => undefined),
    get: (key: string) => {
      if (key === 'llm') return { listProviders: () => [{ id: 'mock-a' }, { id: 'mock-b' }] }
      if (key === 'agentPresets') {
        return {
          mount: async (_ctx: Context, id: string) => {
            mounts.push({ id })
            return { id, trust: 'user', path: '/p' }
          },
        }
      }
      return undefined
    },
    agents: {
      get: () => undefined,
      create: vi.fn(async (options: {
        meta?: { agentPreset?: string }
        agentOptions?: { provider: string; model: string }
        setup?: (ctx: Context) => Promise<void>
      }) => {
        const agentCtx = { on } as unknown as Context
        await options.setup?.(agentCtx)
        creates.push({
          preset: options.meta?.agentPreset,
          provider: options.agentOptions!.provider,
          model: options.agentOptions!.model,
        })
        const agent = {
          id: SessionId(String(options.meta?.agentPreset)),
          session: { id: SessionId(String(options.meta?.agentPreset)) },
          followup: vi.fn(),
        }
        return { agent, dispose: vi.fn(async () => undefined) }
      }),
    },
  } as unknown as Context
  const server = new HarnessSdkJsonRpcServer(ctx, new FakeTransport())
  await server.handleRequest('initialize', { cwd: '/tmp', provider: 'mock-a', model: 'default-m' })
  await server.handleRequest('session/prompt', {
    sessionId: 's-a',
    contentBlocks: [{ type: 'text', text: 'a' }],
    agentPreset: 'bot-a',
    provider: 'mock-a',
    model: 'model-a',
    reasoningEffort: 'off',
  })
  await server.handleRequest('session/prompt', {
    sessionId: 's-b',
    contentBlocks: [{ type: 'text', text: 'b' }],
    agentPreset: 'bot-b',
    provider: 'mock-b',
    model: 'model-b',
    reasoningEffort: 'max',
  })
  expect(mounts.map(m => m.id)).toEqual(['bot-a', 'bot-b'])
  expect(creates.map(c => c.preset)).toEqual(['bot-a', 'bot-b'])
  expect(creates.map(c => c.model)).toEqual(['model-a', 'model-b'])
  expect(creates.every(c => c.model !== 'default-m')).toBe(true)
  expect(on).toHaveBeenCalled()
})
```

Fix `agent.id` / `session.id` to use the `sessionId` from options (`options.sessionId`), not the preset id. `CreateAgentOptions` includes `sessionId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/sdk/server/tests/server.spec.ts -t "mounts different presets"`
Expected: FAIL (create still uses initialize provider/model, no setup)

- [ ] **Step 3: Implement createSession as above**

Thread `SessionPromptParams` from `prompt()` into the create factory. Keep create-without-`agentPreset` working (existing tests that prompt `{ sessionId, contentBlocks }` only).

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/sdk/server/tests/server.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/server
git commit -m "feat(sdk-server): mount preset and per-session model on create"
```

---

### Task 5: `session/setModel` and resume selection

**Files:**
- Modify: `packages/sdk/server/src/server.ts` (`resumeSession`, `handleRequest`, `setModel`)
- Modify: `packages/sdk/server/tests/server.spec.ts`

**Interfaces:**
- Consumes: `SessionRecord.selection` from Task 4; `ResumeAgentOptions.setup`
- Produces: `handleRequest('session/setModel', { sessionId, provider, model, reasoningEffort? })`
- Unknown or not-yet-live `sessionId` → throw `Error` including `not live` (spec: typed error, not no-op)

`setModel`:

```ts
private async setModel(params: SessionSetModelParams): Promise<Record<string, never>> {
  const rec = this.sessions.get(params.sessionId)
  if (rec === undefined || this.sessionCreations.has(params.sessionId)) {
    throw new Error(`session/setModel: session ${params.sessionId} is not live`)
  }
  if (!this.hasAdapterFor(params.provider)) {
    throw new Error(`no adapter registered for provider "${params.provider}"`)
  }
  rec.selection.current = {
    provider: params.provider,
    model: params.model,
    ...params.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(params.reasoningEffort) },
  }
  return {}
}
```

`resumeSession(sessionId, params)`: read header preset via `handle.agent.session` after resume **or** pass setup that mounts `resolveSessionPreset`. The factory loads persistence first; `setup` can call `presets.mount(agentCtx, id)` using the reconstructed session's header. After `agents.resume`, if `params.provider`/`model`/`reasoningEffort` are present, set `selection.current` to those; else initialize defaults. Always `installModelSelection` in resume `setup`.

Header preset: `handle.agent.session.header.agentPreset` (confirm field on `Session` in `dsh-session`; tests should assert `agents.resume` was called with `setup` that invoked `mount` with that id). For the mock test, have `resume` invoke `setup` and return a handle whose `agent.session.header.agentPreset === 'bot-a'`.

- [ ] **Step 1: Write the failing tests**

```ts
it('setModel updates a live session and rejects unknown ids', async () => {
  // create s1 as in Task 4 fixture
  await expect(server.handleRequest('session/setModel', {
    sessionId: 'missing', provider: 'mock-a', model: 'm2',
  })).rejects.toThrow(/not live/)
  await server.handleRequest('session/setModel', {
    sessionId: 's1', provider: 'mock-a', model: 'm2', reasoningEffort: 'high',
  })
  expect(rec.selection.current.model).toBe('m2')
})

it('resume remounts header agentPreset and applies client model fields', async () => {
  const mounts: string[] = []
  ctx.agents.resume = vi.fn(async (options) => {
    const agentCtx = { on: vi.fn(() => () => undefined) }
    await options.setup?.(agentCtx as Context)
    return {
      agent: {
        id: SessionId('s1'),
        session: { id: SessionId('s1'), header: { agentPreset: 'bot-a' } },
        followup: vi.fn(),
      },
      dispose: vi.fn(async () => undefined),
    }
  })
  // initialize then:
  await server.handleRequest('session/resume', {
    sessionId: 's1', provider: 'mock-a', model: 'resumed-m', reasoningEffort: 'max',
  })
  expect(mounts).toContain('bot-a')
})
```

The resume mock cannot see header before setup. Implementation order: `agents.resume` already loads the session before `setup`. If the mock `resume` cannot provide header during setup, the **real** implementation should use `resolveSessionPreset` on the session object the factory exposes, **or** mount inside setup using `composedPreset` after bind.

Practical implementation for this codebase: in `setup` of resume, call:

```ts
const session = /* not available in setup args */
```

`setup` only receives `agentCtx`. After resume returns, the session exists. Mount **inside** `setup` by reading `agentCtx.agent?.session.header.agentPreset` if the unpublished agent already has `ctx.agent`. If unpublished agents do not expose header yet, pass the preset by first calling a persistence peek — too heavy.

**Chosen approach:** `resumeSession` calls `ctx.agents.resume({ setup })` where setup always `installModelSelection`. Then immediately after resume resolves, if `handle.agent.session.header.agentPreset` is set, we cannot remount (setup already finished).

So mount **must** happen in `setup`. Unpublished `agentCtx.agent` is documented as available on `Agent.ctx`. Use:

```ts
setup: async (agentCtx) => {
  const presetId = agentCtx.agent?.session.header.agentPreset
  if (presetId !== undefined) await presets.mount(agentCtx, presetId)
  installModelSelection(agentCtx, selection)
}
```

The mock resume must set `agentCtx.agent` before calling `setup`, **or** the test uses a real factory. Prefer a mock `resume` that does:

```ts
const agent = { session: { header: { agentPreset: 'bot-a' } } }
const agentCtx = { on, agent }
await options.setup?.(agentCtx)
```

Put that exact mock in the test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/sdk/server/tests/server.spec.ts -t "setModel"`
Expected: FAIL unknown method / no selection on record

- [ ] **Step 3: Implement `setModel` + resume setup**

- [ ] **Step 4: Run `packages/sdk/server/tests/server.spec.ts`**
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/server
git commit -m "feat(sdk-server): session/setModel and resume preset remount"
```

---

### Task 6: TypeScript SDK client methods

**Files:**
- Modify: `packages/sdk/client/src/client.ts`
- Modify: `packages/sdk/client/src/index.ts` if new errors
- Modify: `packages/sdk/client/tests/fake-runtime.ts`
- Modify: `packages/sdk/client/tests/sdk-client.spec.ts`

**Interfaces:**
- Consumes: protocol types from Task 1
- Produces:

```ts
async listPresets(): Promise<PresetListResult>
async copyPreset(from: string, id: string, name?: string): Promise<void>
async setPersona(id: string, text: string): Promise<void>
async prompt(sessionId: string, contentBlocks: ContentBlock[], extras?: {
  agentPreset?: string
  provider?: string
  model?: string
  reasoningEffort?: string
}): Promise<string>
async resume(sessionId: string, extras?: {
  provider?: string
  model?: string
  reasoningEffort?: string
}): Promise<void>
async setModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<void>
```

Keep existing `prompt(sessionId, contentBlocks)` call sites compiling (`extras` optional).

- [ ] **Step 1: Extend `fake-runtime.ts`** to answer `presets/list` with `{ presets: [] }`, `presets/copy` / `presets/setPersona` / `session/setModel` with `{}`, and echo `session/prompt` extras onto a `session.event` test hook if needed. Existing fake already handles `session/prompt` — pass through extra params without breaking.

- [ ] **Step 2: Write client tests** that `listPresets` returns the fake list, and `prompt(..., { agentPreset: 'bot-a' })` sends those fields (assert via fake-runtime recording `process.env` or a temp file the fake writes). Simplest: fake-runtime stores last prompt JSON on stderr in a parseable line, client test does not need that if the fake returns `messageId` only — then add a fake method `presets/list` returning `[{ id: 'code', trust: 'system' }]`.

```ts
it('lists presets from the runtime', async () => {
  await using client = ... // existing harness/client helper
  await client.initialize({ cwd: dir, provider: 'mock', model: 'm' })
  await expect(client.listPresets()).resolves.toEqual({
    presets: [{ id: 'code', trust: 'system' }],
  })
})
```

- [ ] **Step 3: Run to fail** (`listPresets is not a function`)

- [ ] **Step 4: Implement client methods using `this.request`**

- [ ] **Step 5: Run `pnpm exec vitest run packages/sdk/client/tests/sdk-client.spec.ts`**
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/client
git commit -m "feat(sdk-client): presets and per-session model methods"
```

---

### Task 7: macos JSON-RPC composition

**Files:**
- Create: `packages/bundle/macos-jsonrpc/package.json` (workspace package, `dsh.bundle.patch`, copy structure from `packages/bundle/headless/package.json`)
- Create: `packages/bundle/macos-jsonrpc/cordis.patch.yml`
- Create: `packages/bundle/macos-jsonrpc/src/index.ts` (named export plugin no-op runner **or** empty bundle that is patch-only — follow `dsh-headless`: a tiny `src/index.ts` + `invariant.ts` if the bundle gate requires them)
- Create: `packages/bundle/macos-jsonrpc/src/invariant.ts`
- Create: `packages/bundle/macos-jsonrpc/tests/macos-jsonrpc.spec.ts`
- Modify: `packages/boot/app-boot/src/profile.ts` — add to `PROFILE_TEMPLATES`: `macos: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-macos-jsonrpc']` next to `tui`. No `dsh macos` CLI alias (boot with `dsh --profile macos`).
- Modify: `packages/boot/app-boot/tests/profile.spec.ts` — assert the `macos` template tuple.
- Modify: `apps/cli/package.json` — add `"@deepseek-ai/dsh-macos-jsonrpc": "workspace:^"` like `dsh-tui`.
- `pnpm-workspace.yaml` is already `packages/*/*` — no change.

**cordis.patch.yml host plane (must not load tui-runner, web, or a stdout logger):**

```yaml
- id: sdk-jsonrpc-server
  name: '@deepseek-ai/dsh-sdk-jsonrpc-server'

- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: code
```

Stack this bundle **on `dsh-base`**. Do not duplicate base rows. Include `dsh-code-runtime-worker-thread` so the shipped `code` preset can mount (it requires `codeRuntime`). Mirror the TUI bundle's `code-runtime` insert, not the TUI runner.

- [ ] **Step 1: Write a test** that loads the patch file and asserts it contains `dsh-sdk-jsonrpc-server` and `dsh-agent-presets` and does not contain `dsh-tui` or `webserver`.

```ts
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('macos-jsonrpc bundle', () => {
  it('is jsonrpc + presets over base, not TUI or Host', async () => {
    const yml = await readFile(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    expect(yml).toContain('@deepseek-ai/dsh-sdk-jsonrpc-server')
    expect(yml).toContain('@deepseek-ai/dsh-agent-presets')
    expect(yml).not.toContain('@deepseek-ai/dsh-tui')
    expect(yml).not.toContain('webserver')
  })
})
```

- [ ] **Step 2: Run to fail** (file missing)

- [ ] **Step 3: Add the package** following `packages/bundle/headless/` (package.json name `@deepseek-ai/dsh-macos-jsonrpc`, `dsh.bundle`, invariant companion, README with Model Experience "None" because the bundle does not add model-visible tokens). Wire workspace `workspace:^` deps for every plugin named in the patch. Add `macos` to `PROFILE_TEMPLATES` and a profile.spec.ts assertion. Add the bundle to `apps/cli/package.json` dependencies.

- [ ] **Step 4: Run the bundle test + `pnpm run typecheck` scoped if available**

- [ ] **Step 5: Commit**

```bash
git add packages/bundle/macos-jsonrpc apps/cli
git commit -m "feat(bundle): macos jsonrpc profile over base and presets"
```

Spawn command for Swift Task 11 / live e2e, after `pnpm run build`:

```
pnpm dsh --profile macos
```

(equivalent: `node apps/cli/lib/bin.js --profile macos` from the repo root).

---

### Task 8: Swift JSON-RPC + HarnessClient

**Files:**
- Create: `apps/macos/Package.swift`
- Create: `apps/macos/Sources/DsBotCore/JSONRPC.swift`
- Create: `apps/macos/Sources/DsBotCore/ProtocolTypes.swift`
- Create: `apps/macos/Sources/DsBotCore/HarnessClient.swift`
- Create: `apps/macos/Tests/DsBotCoreTests/HarnessClientTests.swift`
- Create: `apps/macos/Tests/DsBotCoreTests/FakeRuntime.py` **do not** — stay in Swift: a `FakeRuntime` executable target that reads JSON-RPC lines on stdin and writes canned responses.

Simpler fake: `apps/macos/Tests/DsBotCoreTests/FakeRuntimeMain.swift` as `.executableTarget(name: "FakeSdkRuntime")` that:
- answers `initialize` with `{ serverInfo: { name: "deepseek-harness-sdk-runtime", version: "0.0.1" } }`
- answers `presets/list` with `{ presets: [{ id: "code", trust: "system" }] }`
- answers `session/prompt` with `{ messageId: "m1" }`
- answers `shutdown` with `{}`

**Interfaces:**
- Consumes: Task 1 method names (stringly identical)
- Produces:

```swift
public struct PresetListItem: Codable, Equatable {
  public var id: String
  public var trust: String
  public var name: String?
  public var description: String?
  public var broken: String?
}

public struct HarnessClient: Sendable {
  public init(command: String, arguments: [String], cwd: URL?)
  public func start() throws
  public func initialize(cwd: String, provider: String, model: String, approvals: Bool) async throws
  public func listPresets() async throws -> [PresetListItem]
  public func copyPreset(from: String, id: String, name: String?) async throws
  public func setPersona(id: String, text: String) async throws
  public func prompt(sessionId: String, text: String, agentPreset: String?, provider: String?, model: String?, reasoningEffort: String?) async throws -> String
  public func resume(sessionId: String, provider: String?, model: String?, reasoningEffort: String?) async throws
  public func setModel(sessionId: String, provider: String, model: String, reasoningEffort: String?) async throws
  public func cancel(sessionId: String) async throws
  public func shutdown() async throws
  public var events: AsyncStream<SessionEventNotification>
}
```

JSON-RPC ids are monotonically increasing integers. One `\n` per frame. Decode `error` objects into `HarnessRPCError`.

- [ ] **Step 1: Write `testListPresetsTalksToFakeRuntime`** spawning `FakeSdkRuntime`

```swift
func testListPresetsTalksToFakeRuntime() async throws {
  let runtime = try bundledFakeRuntimeURL()
  var client = HarnessClient(command: runtime.path, arguments: [], cwd: nil)
  try client.start()
  try await client.initialize(cwd: "/tmp", provider: "mock", model: "m", approvals: true)
  let presets = try await client.listPresets()
  XCTAssertEqual(presets.map(\.id), ["code"])
  try await client.shutdown()
}
```

- [ ] **Step 2: `swift test --package-path apps/macos --filter testListPresetsTalksToFakeRuntime`**
Expected: FAIL (target missing)

- [ ] **Step 3: Implement Package.swift, fake runtime, codec, client**

- [ ] **Step 4: Re-run the test**
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/macos
git commit -m "feat(macos): JSON-RPC HarnessClient against a fake runtime"
```

---

### Task 9: BotStore

**Files:**
- Create: `apps/macos/Sources/DsBotCore/BotStore.swift`
- Create: `apps/macos/Tests/DsBotCoreTests/BotStoreTests.swift`

**Interfaces:**

```swift
public struct Bot: Codable, Equatable, Identifiable {
  public var id: String          // preset id
  public var displayName: String
  public var provider: String
  public var model: String
  public var reasoningEffort: String // "off" | "high" | "max"
  public var threadIDs: [String]
}

public struct Thread: Codable, Equatable, Identifiable {
  public var id: String          // session id
  public var botID: String
  public var title: String
  public var createdAt: Date
}

public struct BotStore: Sendable {
  public init(fileURL: URL)
  public mutating func addBot(_ bot: Bot) throws
  public mutating func addThread(_ thread: Thread) throws
  public func threads(forBot id: String) -> [Thread]
  public func bot(forThread sessionID: String) -> Bot?
}
```

Persist as JSON atomically (`fileURL` + tmp + replace). Isolation test: thread ids of bot A never returned by `threads(forBot: B)`.

- [ ] **Step 1: Write failing XCTest** `testOneBotOwnsManyThreadsAndDoesNotLeak`

- [ ] **Step 2: Run to fail**

- [ ] **Step 3: Implement store**

- [ ] **Step 4: Pass**

- [ ] **Step 5: Commit** `feat(macos): BotStore maps bots to session threads`

---

### Task 10: TranscriptProjection

**Files:**
- Create: `apps/macos/Sources/DsBotCore/TranscriptProjection.swift`
- Create: `apps/macos/Tests/DsBotCoreTests/TranscriptProjectionTests.swift`

Port the cases in `packages/bundle/tui/tests/transcript.spec.ts`:
- user source `kind: user` shown; `plugin` omitted
- `assistant/chunk` text-delta + reasoning-delta → streaming assistant + reasoning
- `assistant/message` lands and replaces streaming text
- `tool/call` + `tool/result` → tool card `success`

Use the same item `id` scheme as the TUI (`user:${seq}`, `asst:${seq}`, `tool:${callId}`) so fixtures stay comparable.

Minimal event model:

```swift
public struct SessionEventDTO: Codable {
  public var type: String
  public var seq: Int
  public var data: JSONValue
}
```

Do not import the TS package. Copy behaviour, not code generation.

- [ ] **Step 1: Write XCTest mirroring the four TUI cases above as JSON fixtures**

- [ ] **Step 2: Run to fail**

- [ ] **Step 3: Implement `projectTranscript`**

- [ ] **Step 4: Pass**

- [ ] **Step 5: Commit** `feat(macos): port TUI transcript projection`

---

### Task 11: Approvals + runtime spawn/shutdown

**Files:**
- Create: `apps/macos/Sources/DsBotCore/Approval.swift`
- Modify: `apps/macos/Sources/DsBotCore/HarnessClient.swift` (`onRequest`)
- Create: `apps/macos/Sources/DsBotCore/RuntimeProcess.swift`
- Create: `apps/macos/Tests/DsBotCoreTests/ApprovalTests.swift`
- Create: `apps/macos/Tests/DsBotCoreTests/RuntimeProcessTests.swift`

**Interfaces:**

```swift
public enum SdkPermissionOutcome: String, Codable {
  case allowedOnce = "allowed-once"
  case rejected
  case cancelled
  case unavailable
}

public func outcomeForDismissedSheet() -> SdkPermissionOutcome { .rejected }

public struct RuntimeLaunch: Equatable {
  public var command: String
  public var arguments: [String]
  public var cwd: URL
}
```

`RuntimeProcess` spawn argv is the built dsh macos profile, e.g. `["node", "<repo>/apps/cli/lib/bin.js", "--profile", "macos"]` with `cwd` the user's workspace. Tests do not spawn real dsh: they spawn `FakeSdkRuntime` and assert `shutdown` is sent on `stop()`.

Dismissed approval test:

```swift
func testDismissedApprovalIsRejectedNotAllowed() {
  XCTAssertEqual(outcomeForDismissedSheet(), .rejected)
  XCTAssertNotEqual(outcomeForDismissedSheet().rawValue, "allowed-once")
}
```

- [ ] **Steps: failing tests → implement → pass → commit** `feat(macos): approval rejected-on-dismiss and runtime shutdown`

---

### Task 12: SwiftUI chrome

**Files:**
- Create: `apps/macos/Sources/DsBot/DsBotApp.swift`
- Create: `apps/macos/Sources/DsBot/RootView.swift` (HSplit: Bot list | Thread list | Chat)
- Create: `apps/macos/Sources/DsBot/CreateBotSheet.swift`
- Create: `apps/macos/Sources/DsBot/ChatView.swift`
- Create: `apps/macos/Sources/DsBot/ApprovalSheet.swift`
- Create: `apps/macos/Sources/DsBot/SessionController.swift` (wires HarnessClient + BotStore)
- Create: `apps/macos/Tests/DsBotCoreTests/SessionControllerTests.swift` (no ViewInspector required)

**Create Bot sheet fields:** display name, job text (persona), provider, model, thinking (`off`/`high`/`max`), template preset default `code`.

Flow in `SessionController.createBot`:
1. slug id from name (`[a-z0-9][a-z0-9-]*`)
2. `copyPreset(from: "code", id:slug, name:displayName)`
3. `setPersona` with job text plus ` Your working directory is {{cwd}}. You are powered by the {{model}} model.`
4. `BotStore.addBot`

`newThread`: UUID session id, `prompt(..., agentPreset: bot.id, provider:, model:, reasoningEffort:)`.

Visible chat: fold `events` where `sessionId == selected` through `projectTranscript`.

Missing key: if prompt/initialize fails with a message containing `DEEPSEEK_API_KEY` / `OPENCODE_API_KEY` / `CLINE_API_KEY`, show that string in the thread. Do not add `/connect` UI.

No Computer pane.

- [ ] **Step 1: XCTest `testCreateBotRecordsPresetAndModel`** against FakeSdkRuntime + temp BotStore

- [ ] **Step 2: Fail → implement controller + views → pass**

- [ ] **Step 3: Commit** `feat(macos): Grok Bot chrome for bots, threads, chat, approvals`

---

### Task 13: Live two-Bot e2e (completion gate)

**Files:**
- Create: `packages/sdk/server/tests/two-bot.live.e2e.ts`
- Register in `vitest.e2e.config.ts` (follow existing `test:e2e` / self-skip without `DEEPSEEK_API_KEY`)

**This test must skip (not pass) without a key.** Completing v0 requires a recorded passing run with the key present.

Procedure (spawn the **macos** composition, not the fake runtime):

```ts
const skip = process.env.DEEPSEEK_API_KEY === undefined
describe.skipIf(skip)('live two bots in one macos jsonrpc process', () => {
  it('gives each bot its own persona token in the assistant text', async () => {
    // 1. mkdtemp user preset root + session root
    // 2. spawn `pnpm dsh --profile macos` or node bin with DSH_HOME=temp
    // 3. HarnessClient initialize approvals true, provider deepseek-official, model deepseek-v4-flash
    // 4. copy code → bot-a, copy code → bot-b
    // 5. setPersona bot-a TOKEN-A, bot-b TOKEN-B (keep {{cwd}} {{model}})
    // 6. prompt s-a / s-b with different reasoningEffort ('off' vs 'max')
    //    user text: 'Reply with your job token only.'
    // 7. wait session.status idle for both
    // 8. collect assistant/message text per sessionId
    // 9. expect A contains TOKEN-A and not TOKEN-B; B contains TOKEN-B and not TOKEN-A
    // 10. fail if either session log mixed the other's sessionId as its own
  })
})
```

If the model will not quote the token, fall back to asserting `request/header` events (or equivalent logged call config) show distinct `reasoningEffort` **and** that `agentPreset` on each session header differs. Prefer the token check first.

- [ ] **Step 1: Write the test, run without key**

Run: `pnpm exec vitest run packages/sdk/server/tests/two-bot.live.e2e.ts --config vitest.e2e.config.ts`
Expected: suite skipped, zero passing tests in that file (or `skipped` count ≥ 1, `passed` 0)

- [ ] **Step 2: Run with `DEEPSEEK_API_KEY`**

Expected: FAIL until Tasks 1–7 work end-to-end, then PASS

- [ ] **Step 3: Commit the test** (can land before first green live run)

```bash
git add packages/sdk/server/tests/two-bot.live.e2e.ts vitest.e2e.config.ts
git commit -m "test(sdk): live two-bot e2e gate (skips without key)"
```

- [ ] **Step 4: Record a passing live run** in the commit message or `apps/macos/docs/e2e-run.txt` with: command, date, both session ids, both assistant excerpts. **Do not claim v0 done without this artefact.**

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| SDK `presets/list`, `copy`, `setPersona` | 1, 2, 3, 6 |
| `setPersona` only persona text; refuse system / non-string | 2, 3 |
| `session/prompt` create fields + mount + `installModelSelection` | 1, 4 |
| Two sessions different preset/model in one process | 4, 13 |
| Resume remounts header preset | 5 |
| `session/setModel` live-only error | 5 |
| macos jsonrpc composition, no Ink/web | 7 |
| Swift client, BotStore, projection, approvals dismissed=rejected | 8–11 |
| SwiftUI bots/threads/chat, no Computer pane | 12 |
| Shared cwd, isolated logs | 9, 13 |
| Live two-Bot real-model gate | 13 |
| Do not touch TUI branch / Ink tests | Global Constraints |
| App quit stops harness | 11 |

No remaining spec holes. Python SDK explicitly out of scope.
