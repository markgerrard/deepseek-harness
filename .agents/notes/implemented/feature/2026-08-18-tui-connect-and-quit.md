# Agent Note: TUI connect, gateway routes, and quit-twice

Status: implemented

English | [中文](2026-08-18-tui-connect-and-quit.zh.md)

## Problem

The Crush-style TUI only checked `DEEPSEEK_API_KEY` and could not store a key or route turns to OpenCode Go or Cline Pass. First ctrl+c also quit immediately, unlike Crush.

## Decision

`/connect` picks OpenCode Go, Cline Pass, or official DeepSeek and stores the key through `ctx.credentials.set` (`OPENCODE_API_KEY`, `CLINE_API_KEY`, `DEEPSEEK_API_KEY`). The TUI bundle overlays `llm-pi-ai` with two `openai-completions` routes: `opencode-go` at `https://opencode.ai/zen/go/v1` and `cline-pass` at `https://api.cline.bot/api/v1`. `/model` lists those catalogs grouped by provider; `installModelSelection` sends the next turn to the selected route. Official DeepSeek stays on `llm-deepseek`. First ctrl+c opens Crush's quit dialog (Are you sure you want to quit?, Yep! / Nope with Nope selected); second ctrl+c or Yep quits, and n / Nope / esc dismisses.

## Alternatives considered

**A parallel TUI secret file.** Rejected: the official credentials seam already writes `$DSH_HOME/.credentials.yaml`.

**Copy Crush or OpenCode source.** Rejected: the constraint is Crush visual language over official DSH services.

**One mixed-protocol OpenCode Go route.** Rejected: `llm-pi-ai` is one wire protocol per route. Responses-API and anthropic-messages Go models stay unlisted.

## Consequences

**Bought**: paste keys in the TUI, pick gateway models, and match Crush quit-twice.

**Paid**: `grok-4.5` / `gpt-5.6-luna` (responses) and OpenCode Go anthropic-messages models are not listed. `OPENCODE_GO_API_KEY` counts as configured for first-run only; the writable and route ref is `OPENCODE_API_KEY`.

## Testing

Unit tests lock route baseURLs, credential refs, model catalog rows, `maskSecret`, and `resolveQuitKey` (first ctrl+c opens, second exits, n/esc dismisses, enter/space confirm the selected button).

## Deferred

Responses-API OpenCode Go models, and a second `anthropic-messages` OpenCode Go route.
