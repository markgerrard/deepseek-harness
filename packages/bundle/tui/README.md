# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

The dsh Claude Code-like terminal UI bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md): it supplies the coding persona and tool mode, disables HMR, mounts Code Mode worker as a core execution capability, and inserts this package `tui-runner` plugin. It mounts no Host, HTTP server, Web runtime, or browser plugin.

After the Loader settles, the runner reads shared [`ctx.agentDefaultModel`](../../core/agent-default-model/README.md), creates or resumes one persisted Agent through `ctx.agents`, and mounts Claude Code-like Ink chrome. Prompts, slash commands, `/connect` API-key entry, model switching, session switching, approvals, and ask-user questions all go through official DSH services.

The ordinary `tui-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs`, parses an optional resume id, an optional opening prompt, and this app help, then provides `tuiStartup`.

## Launch from source

From the repository root, after a workspace install, run the tui alias of the dsh launcher. The shipped tui template auto-initializes on first use (dsh-base plus this bundle).

## Model Experience

None, as the TUI submits prompts as ordinary user messages; prompts and tools belong to the base and tui bundle rows.

#### KV Cache effect

None; the TUI adds nothing to the request prefix.

## Known Limitations and Deferred Work

- File attachments, mentions, and images: the editor is text-only.
- Bang-mode shell, MCP/LSP sidebar panels, and todo pills stay out of this MVP.
- Full glamour markdown, mouse expand, copy/highlight, custom themes are not ported.
- `/connect` stores OpenCode Go (`OPENCODE_API_KEY`), Cline Pass (`CLINE_API_KEY`), and official DeepSeek keys through `ctx.credentials`. The TUI bundle overlays `llm-pi-ai` with those two openai-completions gateways; official DeepSeek stays on `llm-deepseek`.
- OpenCode Go responses-API models (`grok-4.5`, `gpt-5.6-luna`) and anthropic-messages models are not listed.
- ctx.appExit is launcher-owned: booting outside the dsh launcher fails loud until the host provides the exit request.
