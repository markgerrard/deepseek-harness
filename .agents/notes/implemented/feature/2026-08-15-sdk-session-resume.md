# Agent Note: SDK JSON-RPC session/resume

Status: implemented

English | [中文](2026-08-15-sdk-session-resume.zh.md)

## Problem

The SDK JSON-RPC transport lazily creates a fresh agent for an unknown session id. A new runtime pointed at the same `DSH_SESSION_ROOT` and id therefore hits the persistence id-collision error instead of rehydrating the log. Combined with process-kill as the only way to abandon a wedged runtime, losing resume burns the conversation and the id. `ctx.agents.resume()` already exists and is what the subagent continuation manager uses for cold resume.

## Decision

`session/resume` is a client→server request whose params are `{ sessionId }`. The server looks the id up in its own session map. A hit returns `{}` without reloading. A miss calls `ctx.agents.resume({ resumeSessionId, agentOptions })` with the handshake provider/model/`maxTokens`, then stores the handle. Persistence, missing-log, corrupt-log, newer-harness, and compression-mismatch failures propagate as the JSON-RPC error. The method never creates a fresh session.

`session/prompt` on an unknown id still lazily creates. That default is not implicit resume.

`HarnessClient.resume` and the Python client's `session_resume` send this method. No `clientCapabilities` flag: old clients simply never call it.

## Alternatives considered

**Treat an unknown `session/prompt` id as implicit resume when a log exists.** A silent behaviour change would hide the collision that currently diagnoses a reused id, and would resume on every accidental reuse.

**Add a `resume: true` flag on `session/prompt`.** That mixes session lifecycle with enqueue. The continuation manager already splits `ctx.agents.resume()` from submitting the turn; the wire follows that split.

**Advertise resume through `clientCapabilities`.** Resume is a client-to-server method. Clients that do not know it never send it, so an advertisement would add handshake state with no compatibility to protect.

## Consequences

**Bought**: a client can rehydrate a persisted session after the runtime process exits, including after a kill, without burning the id.

**Paid**: a client must send `session/resume` before `session/prompt` on a persisted id. Forgetting that still produces today's collision.

## Testing

Keyless unit: `resumes a persisted session and then accepts a prompt` fails if the method is removed. `prompt of a persisted unknown id still lazily creates and collides` fails if prompt starts calling `resume`. Missing persistence, missing log, and corrupt log reject. `HarnessClient` and the Python client record the wire params.
