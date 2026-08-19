# Agent Note: Preset persona authoring and per-session model selection

Status: implemented

English | [中文](2026-08-19-sdk-preset-session-model.zh.md)

## Problem

Locally authored agent presets allow users to duplicate shipped compositions and provide display metadata, but personalizing an agent's instructions (persona) previously required hand-editing `agent.cordis.yml` on disk. Copy-only preset authoring ([copy-only preset authoring note](../simplification/2026-08-08-copy-only-preset-authoring.md)) intentionally eliminated arbitrary composition text submission to prevent arbitrary plugin row injection (`!!js` evaluation and unverified plugin imports). However, native clients and SDK consumers (such as Swift Grok Bot) need to configure custom bot personas without granting arbitrary composition editing capabilities or requiring manual filesystem manipulation.

## Decision

We introduce `setPersonaText(preset, text)` in `@deepseek-ai/dsh-agent-presets/authoring` and the companion service method `AgentPresets.setPersona(id, text)`.

- **Restricted to user presets:** `setPersona` operates exclusively on presets with `user` trust, throwing `PresetNotWritableError` for deployment-shipped `system` presets.
- **Narrow mutation:** It locates the existing `persona` plugin row (matching `id: 'persona'` and `name: '@deepseek-ai/dsh-persona'` or `'persona'`) and updates only `config.text` as a scalar string value. Arbitrary YAML rows cannot be injected because the input is serialized strictly as a string scalar.
- **Strict preconditions:** Refuses non-string inputs with `TypeError` and throws an error naming the missing persona row if no matching plugin entry exists in the composition.
- **Mount invalidation:** Successful writes call `this.standing.delete(id)` so subsequent session mounts load the updated generation, while existing joined sessions retain their mounted generation.

## Alternatives considered

- **Reintroducing arbitrary composition text writing:** Rejected because allowing arbitrary YAML composition payloads over the wire breaks the copy-only authoring security boundary and reintroduces arbitrary plugin execution risks.
- **Ephemeral persona override at session creation:** Rejected because bot identities in multi-bot clients are durable presets that multiple session threads share rather than one-off prompt parameters.
- **Storing persona in a separate companion file:** Rejected because `@deepseek-ai/dsh-persona` already represents persona configuration as a standard Cordis plugin row within the unified `agent.cordis.yml` format.

## Consequences

- Native applications and SDK clients can safely update bot personas on user presets through a strongly typed, bounded method.
- The copy-only authoring invariant remains intact: no arbitrary plugin compositions can be authored or mounted across client boundaries.
- Presets lacking a persona row cannot have persona text configured via `setPersona` unless first seeded with a persona plugin entry.
