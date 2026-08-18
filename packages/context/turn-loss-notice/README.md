# @deepseek-ai/dsh-turn-loss-notice

English | [中文](README.zh.md)

A turn that dies mid-stream after streaming answer text leaves an asymmetric hole: the interface showed the user a (partial) answer, but no `assistant/message` ever committed, so the model's derived history jumps from the user's question straight to their next prompt. The model then re-derives honestly — and may answer differently — or, worse, confabulates when the user says "as you said before". This plugin closes the model's side of that hole: at the next entered turn it prepends one context message telling the model its previous response was not retained. The user-facing half of the same hole belongs to the embedding product's error surface, not to this plugin. Decision record: [the turn-loss-notice Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-turn-loss-notice.md).

## Config

```yaml
- id: turn-loss-notice
  name: '@deepseek-ai/dsh-turn-loss-notice'
```

No configuration. The notice text is a model-visible contract and the trigger is a correctness rule, not a deployment choice.

## Trigger semantics

The notice fires on the first entered step of a turn when the log's most recent `turn/end` is `{kind: 'error'}` AND that turn holds at least one `text-delta` chunk later than its last content-bearing `assistant/message`. Both qualifiers are load-bearing:

- **`text-delta` only.** Tool-call and reasoning deltas are not an answer the user saw; an error during the first tool call — before any prose — is the common error timing and must stay silent.
- **Content-bearing only.** An empty-content `assistant/message` exists solely to host a max-tokens step's usage and must not anchor the "already committed" boundary.
- **Committed steps stay remembered.** In a multi-step turn whose earlier step committed, only a streamed-and-lost tail triggers; a turn that errored after its last commit (e.g. in tool execution) does not.
- **Aborted turns cannot reach the predicate.** The loop records a cancellation as `{kind: 'aborted'}` before its error branch — a user who cancelled knowingly gets no notice.
- **Crash tails are structurally out of reach.** The predicate requires a committed `turn/end`; an unbalanced log is session repair's domain, and this predicate must not be widened toward it.

The derivation is stateless — the session log is the memory — so it is restart-proof and needs no dedupe: the next turn's scan sees a completed turn between, and a consecutive failed retry re-triggers only when it newly streamed and lost text (a real second loss).

## Delivery

The notice is prepended to the entered step's messages, which the loop commits as an ordinary injected `user/message` (source `{kind: 'plugin', plugin: 'turn-loss-notice', form: 'notice'}`) before the model call — so it is durably logged even if the turn it rides also dies, precedes the user's prompt in both log and request, and is reconstructable from the session log with no new session event type. Framing is producer-baked per the surface projection's contract ("framing is caller-owned"). An empty first entry (a no-step turn) is never widened into a model call for the notice's sake.

## Model Experience

### Turn-loss context message

#### What the model sees

On the first entered step after a qualifying loss, that agent receives the message below, before the user's prompt. No tool schema or normal-call text is added.

##### Turn-loss notice

```markdown
<system-reminder>The previous response in this conversation failed mid-stream and was NOT retained. You have no record of what it said, even though the user may have seen part of it. If the user refers to it, say you do not have it and re-derive rather than reconstructing what you might have said.</system-reminder>
```

#### Token effect

Zero tokens unless a loss occurred. The notice is retained history for that agent (~70 tokens once).

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Crash-path losses are not covered.** A process crash leaves no `turn/end`, so this plugin never sees it; session repair's `interruptedTurnClosers` synthesizes tool-call closers for that domain but does not yet tell the model about lost prose. That gap is repair's to close, recorded here so nobody widens this plugin's predicate toward a shape it cannot match.
- **The user-facing half is product-owned.** This plugin serves only the model consumer; an embedding product must separately state on its error surface that the partial answer was not retained.
