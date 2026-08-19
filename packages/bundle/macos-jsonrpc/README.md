# `@deepseek-ai/dsh-macos-jsonrpc`

English | [中文](README.zh.md)

The dsh macOS JSON-RPC bundle. [`cordis.patch.yml`](cordis.patch.yml) rides directly over [`dsh-base`](../base/README.md): it disables HMR, mounts the Code Mode worker runtime ([`dsh-code-runtime-worker-thread`](../../workflow/code-runtime-worker-thread/README.md)), inserts the JSON-RPC stdio server ([`dsh-sdk-jsonrpc-server`](../../sdk/server/README.md)), and configures Agent Presets ([`dsh-agent-presets`](../../preset/agent-presets/README.md)) with the default `code` preset.

The bundle mounts no terminal UI, web server, or stdout logger. The process reserves standard output exclusively for JSON-RPC messages to communicate with native macOS GUI client applications.

## Model Experience

None, as the bundle adds no model-visible tokens; prompts and tools belong to the base layer and configured agent presets.

#### KV Cache effect

None; the bundle adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **stdio transport only** — the bundle exposes JSON-RPC exclusively over standard input/output streams for parent process supervision.
