import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'
import { apply as applyInvariant, name as invariantName } from '../src/invariant.ts'

describe('macos-jsonrpc bundle', () => {
  it('is jsonrpc + presets over base, not TUI or Host', async () => {
    const yml = await readFile(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    expect(yml).toContain('@deepseek-ai/dsh-sdk-jsonrpc-server')
    expect(yml).toContain('@deepseek-ai/dsh-agent-presets')
    expect(yml).toContain('@deepseek-ai/dsh-code-runtime-worker-thread')
    expect(yml).toMatch(/default:\s*code/)
    expect(yml).toContain('cline-pass')
    expect(yml).toContain('CLINE_API_KEY')
    expect(yml).toContain('https://api.cline.bot/api/v1')
    expect(yml).toContain('cline-pass/deepseek-v4-flash')
    expect(yml).toContain('cline-pass/deepseek-v4-pro')
    expect(yml).not.toContain('@deepseek-ai/dsh-tui')
    expect(yml).not.toContain('webserver')
  })

  it('exports a no-op plugin', () => {
    expect(name).toBe('macos-jsonrpc')
    const ctx = new Context()
    expect(() => { apply(ctx) }).not.toThrow()
  })

  it('registers invariant companion', async () => {
    const ctx = new Context()
    let registeredName = ''
    let registeredFn: unknown
    ctx.provide('invariants', {
      register: (pkg: string, fn: (child: Context) => void) => {
        registeredName = pkg
        registeredFn = fn
        fn(ctx)
        return () => {}
      },
    } as never)
    const disposer = await applyInvariant(ctx)
    expect(invariantName).toBe('macos-jsonrpc-invariant')
    expect(registeredName).toBe('@deepseek-ai/dsh-macos-jsonrpc')
    expect(typeof registeredFn).toBe('function')
    expect(typeof disposer).toBe('function')
    disposer()
  })
})
