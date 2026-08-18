import { describe, expect, it } from 'vitest'
import {
  CLINE_PASS_CHAT_MODELS,
  CONNECT_PROVIDERS,
  MISSING_KEY_GUIDANCE,
  OPENCODE_GO_CHAT_MODELS,
  connectProviderById,
  credentialRefsFor,
  formatConnectProviderLine,
  formatModelPickerLines,
  maskSecret,
  providerDisplayName,
  routeBaseURL,
  sortModelRows,
  writableCredentialRef,
} from '../src/connect.ts'

describe('TUI connect catalog', () => {
  it('routes OpenCode Go chat models to the zen/go completions prefix', () => {
    const provider = connectProviderById('opencode-go')
    expect(provider?.displayName).toBe('OpenCode Go')
    expect(writableCredentialRef(provider!)).toBe('OPENCODE_API_KEY')
    expect(credentialRefsFor(provider!)).toEqual(['OPENCODE_API_KEY', 'OPENCODE_GO_API_KEY'])
    expect(routeBaseURL('opencode-go')).toBe('https://opencode.ai/zen/go/v1')
    expect(provider?.route?.api).toBe('openai-completions')
    expect([...OPENCODE_GO_CHAT_MODELS]).toEqual([
      'glm-5.3',
      'glm-5.2',
      'glm-5.1',
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.6',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'hy3',
    ])
    expect(provider?.route?.models).toEqual([...OPENCODE_GO_CHAT_MODELS])
  })

  it('routes Cline Pass slugs to api.cline.bot/api/v1', () => {
    const provider = connectProviderById('cline-pass')
    expect(provider?.displayName).toBe('Cline Pass')
    expect(writableCredentialRef(provider!)).toBe('CLINE_API_KEY')
    expect(credentialRefsFor(provider!)).toEqual(['CLINE_API_KEY'])
    expect(routeBaseURL('cline-pass')).toBe('https://api.cline.bot/api/v1')
    expect(provider?.route?.api).toBe('openai-completions')
    expect(CLINE_PASS_CHAT_MODELS).toContain('cline-pass/deepseek-v4-flash')
    expect(CLINE_PASS_CHAT_MODELS).toContain('cline-pass/qwen3.8-max')
    expect(provider?.route?.models).toEqual([...CLINE_PASS_CHAT_MODELS])
  })

  it('keeps official DeepSeek connect-only (no pi-ai overlay route)', () => {
    const provider = connectProviderById('deepseek-official')
    expect(provider?.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
    expect(provider?.route).toBeUndefined()
    expect(routeBaseURL('deepseek-official')).toBeUndefined()
    expect(CONNECT_PROVIDERS.map(item => item.id)).toEqual([
      'opencode-go',
      'cline-pass',
      'deepseek-official',
    ])
  })

  it('masks secrets without echoing any key character', () => {
    const key = 'sk-live-secret-value'
    const masked = maskSecret(key)
    expect(masked).toBe('•'.repeat(key.length))
    expect(masked).not.toContain('sk')
    expect(masked).not.toContain('secret')
    expect(maskSecret('')).toBe('')
  })

  it('formats model picker rows grouped by provider display name', () => {
    const rows = sortModelRows([
      { provider: 'cline-pass', id: 'cline-pass/kimi-k3', name: 'cline-pass/kimi-k3' },
      { provider: 'opencode-go', id: 'glm-5.3', name: 'glm-5.3' },
      { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
    ])
    expect(rows.map(row => row.provider)).toEqual(['cline-pass', 'deepseek-official', 'opencode-go'])
    expect(formatModelPickerLines(rows)).toEqual([
      'Cline Pass / cline-pass/kimi-k3',
      'DeepSeek / deepseek-v4-flash',
      'OpenCode Go / glm-5.3',
    ])
    expect(providerDisplayName('unknown')).toBe('unknown')
  })

  it('labels connect rows without exposing a key', () => {
    expect(formatConnectProviderLine({
      id: 'opencode-go',
      displayName: 'OpenCode Go',
      apiKeyEnv: 'OPENCODE_API_KEY',
      configured: true,
      writable: true,
    })).toBe('OpenCode Go  configured')
    expect(formatConnectProviderLine({
      id: 'cline-pass',
      displayName: 'Cline Pass',
      apiKeyEnv: 'CLINE_API_KEY',
      configured: true,
      writable: false,
    })).toBe('Cline Pass  env (read-only)')
    expect(MISSING_KEY_GUIDANCE).toContain('/connect')
  })
})
