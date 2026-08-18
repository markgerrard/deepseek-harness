# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

The dsh Crush-style terminal UI bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md): it supplies the coding persona and tool mode, disables HMR, mounts Code Mode worker as a core execution capability, and inserts this package `tui-runner` plugin. It mounts no Host, HTTP server, Web runtime, or browser plugin.

After the Loader settles, the runner reads shared [`ctx.agentDefaultModel`](../../core/agent-default-model/README.md), creates or resumes one persisted Agent through `ctx.agents`, and mounts Crush-inspired Ink chrome. Prompts, slash commands, model switching, session switching, approvals, and ask-user questions all go through official DSH services.

The ordinary `tui-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs`, parses an optional resume id, an optional opening prompt, and this app help, then provides `tuiStartup`.

## Launch from source

From the repository root, after a workspace install, run the tui alias of the dsh launcher. The shipped tui template auto-initializes on first use (dsh-base plus this bundle).

## Model Experience

None, as the TUI submits prompts as ordinary user messages; prompts and tools belong to the base and tui bundle rows.

#### KV Cache effect

None; the TUI adds nothing to the request prefix.

## Known Limitations and Deferred Work

- Crush file attachments, mentions, and images: the editor is text-only.
- Bang-mode shell, MCP/LSP sidebar panels, and todo pills stay out of this MVP.
- Full glamour markdown, mouse expand, copy/highlight, custom themes are not ported.
- First-run guidance only; the TUI never creates a credential store.
- ctx.appExit is launcher-owned: booting outside the dsh launcher fails loud until the host provides the exit request.
