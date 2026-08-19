import { describe, expect, it } from 'vitest'
import {
  formatNumberedOption,
  formatQueuedLine,
  helpLines,
  renderApprovalDialog,
  renderConnectKeyDialog,
  renderHeader,
  renderLanding,
  renderOnboarding,
  renderOverlay,
  renderSidebar,
  sessionLines,
  WHALE_EYE,
  whaleArt,
} from '../src/chrome.ts'
import { COLORS, ICONS, PALETTE, PRODUCT_MARK, PRODUCT_NAME } from '../src/theme.ts'

const status = {
  provider: 'deepseek',
  model: 'v4',
  cwd: '/home/mark/src',
  busy: false,
  compact: false,
}

describe('Claude Code-like chrome strings', () => {
  it('does not draw a diagonal Crush header or wordmark', () => {
    const header = renderHeader(80, status, false)
    expect(header).toContain('v4')
    expect(header).not.toContain('╱')
    expect(header).not.toContain(PRODUCT_MARK)
    expect(renderHeader(40, status, true)).not.toContain(PRODUCT_NAME)
  })

  it('renders landing without Crush art and keeps unused sidebar helper', () => {
    expect(renderSidebar(24, 'Fix tests', status, '/home/mark')).toContain('Fix tests')
    const landing = renderLanding(60, status, '/home/mark')
    expect(landing).toContain('~/src')
    expect(landing).toContain('Type a message. / opens commands.')
    expect(landing).not.toContain('╱')
    expect(renderOnboarding(60, 'No API key')).toContain('No API key')
  })

  it('puts an original whale splash above cwd/model/hint on landing', () => {
    const landing = renderLanding(60, status, '/home/mark')
    expect(landing).toContain(WHALE_EYE)
    expect(landing.indexOf(WHALE_EYE)).toBeLessThan(landing.indexOf('~/src'))
    expect(landing).not.toContain('Crush')
    const lines = whaleArt(60)
    expect(lines.some(line => line.tone === 'body')).toBe(true)
    expect(lines.some(line => line.tone === 'accent')).toBe(true)
    expect(whaleArt(20).some(line => line.text.includes(WHALE_EYE))).toBe(true)
  })

  it('uses terracotta, lavender, green, red, and purple tokens — not default white', () => {
    expect(COLORS.brand).toBe('#D97757')
    expect(COLORS.user).toBe(PALETTE.brand)
    expect(COLORS.assistant).toBe('#E8E4DC')
    expect(COLORS.thinking).toBe(PALETTE.muted)
    expect(COLORS.tool).toBe('#C4B5FD')
    expect(COLORS.success).toBe('#6B8F71')
    expect(COLORS.error).toBe('#E85D4C')
    expect(COLORS.selector).toBe('#A78BFA')
    expect(COLORS.dim).toBe(PALETTE.muted)
  })

  it('lists overlays with a purple ❯ selector and no framed Crush box', () => {
    const overlay = renderOverlay(40, 'Models', ['deepseek / v4'], 0)
    expect(overlay).toContain('Models')
    expect(overlay).toContain(ICONS.selector)
    expect(overlay).not.toContain('◉')
    expect(overlay).not.toContain('╭')
    expect(sessionLines([])).toEqual(['No stored sessions yet.'])
    expect(sessionLines([{ id: 's', title: 'Hello', createdAt: 1 }])).toEqual(['Hello'])
    expect(helpLines().some(line => line.includes('ctrl+p'))).toBe(true)
    expect(helpLines().some(line => line.includes('queues while Working'))).toBe(true)
    expect(helpLines().some(line => line.includes('take back last queued'))).toBe(true)
    expect(formatQueuedLine(1, 'look at tests', 40)).toBe('queued 1  look at tests')
    expect(formatQueuedLine(2, 'a very long follow-up prompt', 18)).toBe('queued 2  a very …')
    expect(formatNumberedOption(2, 'No', 2)).toContain(`${ICONS.selector} 3. No`)
  })

  it('renders a proceed dialog for tool approval', () => {
    const dialog = renderApprovalDialog(60, 'Bash command', 'Run database migration', 1)
    expect(dialog).toContain('Do you want to proceed?')
    expect(dialog).toContain('1. Yes')
    expect(dialog).toContain('2. No')
    expect(dialog).toContain(`${ICONS.selector} 2. No`)
  })

  it('masks the connect key field and never echoes the secret', () => {
    const key = 'sk-live-do-not-print'
    const dialog = renderConnectKeyDialog(60, 'OpenCode Go', key, 'OPENCODE_API_KEY')
    expect(dialog).toContain('Enter your OpenCode Go Key.')
    expect(dialog).toContain('OPENCODE_API_KEY')
    expect(dialog).toContain('•')
    expect(dialog).not.toContain(key)
    expect(dialog).not.toContain('sk-live')
  })
})
