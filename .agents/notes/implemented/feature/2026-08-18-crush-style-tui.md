# Agent Note: Crush-style TUI

Status: implemented

English | [中文](2026-08-18-crush-style-tui.zh.md)

## Problem

The shipped dsh surfaces are the browser app and a one-shot headless runner. There is no interactive terminal UI that reuses official DSH agent, session, command, model, approval, and credential services. A later request asked for Crush-like chrome without forking Crush Go source or reimplementing the agent loop.

## Decision

Add an in-box bundle `@deepseek-ai/dsh-tui` that follows the headless/web-app pattern: a `tui` profile template (`dsh-base` plus this bundle), a `tui-startup` command-line provider, and a `tui-runner` that creates or resumes an Agent through `ctx.agents` and mounts Ink chrome. Crush layout, keybindings, sidebar, landing, overlays, and tool cards are presentation only. Slash dispatch, model switch, session list/resume, approvals, and ask-user questions call official DSH services. The product mark is DSH / DeepSeek, not Crush.

## Alternatives considered

**Port Crush Go source into the repo.** That would fork another agent loop, tool runner, and credential store. The constraint is Crush visual language over official DSH services.

**Add a new capability group instead of a bundle.** Headless and web-app already show the shipped-profile pattern. A capability group would re-center the agent loop, which this change must not touch.

**Build a custom TTY renderer.** Ink plus React 18 matches the web-client React major and keeps chrome helpers pure for unit tests without a snapshot harness.

## Consequences

**Bought**: `dsh tui` (and the tui profile) auto-initializes and launches an interactive Crush-style surface over the same services as web and headless.

**Paid**: Crush extras (attachments, bang-mode shell, MCP/LSP panels, glamour markdown) stay deferred. Credential entry is `/connect` over `ctx.credentials`; first ctrl+c opens the quit dialog. The TUI is a presentation layer and fails closed on missing `ctx.appExit`.

## Testing

Unit tests cover layout, status, commands, state, chrome, cards, transcript projection, connect helpers, and quit-twice. Loader composition covers the startup provider. The runner test substitutes the Ink renderer and drives a scripted Agent factory.
