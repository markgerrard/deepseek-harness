import { describe, expect, it } from 'vitest'
import {
  formatNumberedOption,
  formatQueuedLine,
  formatCostLines,
  formatAgentsLine,
  agentLines,
  formatSteerLine,
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
import { COLORS, ICONS, PALETTE, PRODUCT_MARK, PRODUCT_NAME, PRODUCT_TITLE, PRODUCT_VERSION, WHALE_TONES } from '../src/theme.ts'

const status = {
  provider: 'deepseek',
  model: 'v4',
  cwd: '/home/mark/src',
  busy: false,
  compact: false,
}

describe('Claude Code-like chrome strings', () => {
  it('does not draw a diagonal header band or wordmark', () => {
    const header = renderHeader(80, status, false)
    expect(header).toContain('v4')
    expect(header).not.toContain('╱')
    expect(header).not.toContain(PRODUCT_MARK)
    expect(renderHeader(40, status, true)).not.toContain(PRODUCT_NAME)
  })

  it('renders landing without borrowed art and keeps unused sidebar helper', () => {
    expect(renderSidebar(24, 'Fix tests', status, '/home/mark')).toContain('Fix tests')
    const landing = renderLanding(60, status, '/home/mark')
    expect(landing).toContain('~/src')
    expect(landing).toContain('Type a message. / opens commands.')
    expect(landing).toContain(PRODUCT_TITLE)
    expect(landing).toContain(PRODUCT_VERSION)
    expect(landing).not.toContain('╱')
    expect(renderOnboarding(60, 'No API key')).toContain('No API key')
  })

  it('puts a left-facing whale beside title/version, model, and cwd on landing', () => {
    const landing = renderLanding(60, status, '/home/mark')
    expect(WHALE_EYE).toBe('█  █')
    expect(landing).toContain(WHALE_EYE)
    expect(landing).toContain('█')
    expect(landing).toContain(`${PRODUCT_TITLE} ${PRODUCT_VERSION}`)
    expect(landing).toContain('deepseek / v4')
    expect(landing).not.toContain('(O)')
    const first = landing.split('\n')[0] ?? ''
    expect(first).toContain('▄')
    expect(first).toContain(`${PRODUCT_TITLE} ${PRODUCT_VERSION}`)
    const lines = whaleArt(60)
    expect(lines[0]?.text.startsWith('▄')).toBe(true)
    expect(lines.some(line => line.text.includes('██████▄▄'))).toBe(true)
    expect(lines.some(line => line.text.startsWith('█  █'))).toBe(true)
    expect(lines.every(line => !line.text.includes('▄▄██████'))).toBe(true)
    const tones = new Set(lines.flatMap(line => line.segments.map(segment => segment.tone)))
    expect(tones.has('block')).toBe(true)
    expect(tones.has('spray')).toBe(true)
    expect(tones.has('hole')).toBe(true)
    expect(lines.some(line => line.segments.length > 1)).toBe(true)
    expect(lines.every(line => line.text === line.segments.map(segment => segment.text).join(''))).toBe(true)
    expect(Math.max(...lines.map(line => line.text.length))).toBeLessThan(28)
    expect(lines.length).toBeGreaterThanOrEqual(6)
    expect(lines.length).toBeLessThanOrEqual(8)
    expect(whaleArt(20).some(line => line.text.includes(WHALE_EYE))).toBe(true)
    expect(whaleArt(20)[0]?.text.startsWith('▄')).toBe(true)
    expect(WHALE_TONES.block).toBe(COLORS.deepseek)
    expect(WHALE_TONES.spray).toBe('#8AA0FF')
    expect(WHALE_TONES.hole).toBe(COLORS.bg)
    expect(COLORS.deepseek).toBe('#4D6BFE')
    expect(PALETTE.deepseek).toBe('#4D6BFE')
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
    expect(COLORS.deepseek).toBe(PALETTE.deepseek)
    expect(PALETTE.deepseek).toBe('#4D6BFE')
  })

  it('lists overlays with a purple ❯ selector and no framed box', () => {
    const overlay = renderOverlay(40, 'Models', ['deepseek / v4'], 0)
    expect(overlay).toContain('Models')
    expect(overlay).toContain(ICONS.selector)
    expect(overlay).not.toContain('◉')
    expect(overlay).not.toContain('╭')
    expect(sessionLines([])).toEqual(['No stored sessions yet.'])
    expect(sessionLines([{ id: 's', title: 'Hello', createdAt: 1 }])).toEqual(['Hello'])
    expect(helpLines().some(line => line.includes('ctrl+p'))).toBe(true)
    expect(helpLines().some(line => line.includes('queues while Working'))).toBe(true)
    expect(helpLines().some(line => line.includes('ctrl+t') && line.includes('steer this turn (next step)'))).toBe(true)
    expect(helpLines().every(line => !line.includes('shift+t  steer'))).toBe(true)
    expect(helpLines().some(line => line.includes('shift+tab') && line.includes('cycle permission mode'))).toBe(true)
    expect(helpLines().some(line => line.includes('pgup') && line.includes('scroll transcript'))).toBe(true)
    expect(helpLines().some(line => line.includes('pgdn') && line.includes('re-pin'))).toBe(true)
    expect(helpLines().some(line => line.includes('esc esc') && line.includes('rewind last prompt'))).toBe(true)
    expect(helpLines().some(line => line.includes('ctrl+o') && line.includes('expand'))).toBe(true)
    expect(helpLines().every(line => !line.includes('space   expand') && !line.startsWith('space'))).toBe(true)
    expect(helpLines().some(line => line.includes('/attach') && line.includes('local image'))).toBe(true)
    expect(helpLines().every(line => !line.includes('ctrl+enter'))).toBe(true)
    expect(helpLines().some(line => line.includes('take back last queued'))).toBe(true)
    expect(helpLines().some(line => line.includes('reverse search history'))).toBe(true)
    expect(helpLines().some(line => line.includes('ctrl+left/right') && line.includes('esc b/f') && line.includes('word jump'))).toBe(true)
    expect(helpLines().some(line => line.includes('/clear'))).toBe(true)
    expect(helpLines().some(line => line.includes('/cost'))).toBe(true)
    expect(helpLines().some(line => line.includes('/agents'))).toBe(true)
    expect(helpLines().some(line => line.includes('!cmd'))).toBe(true)
    expect(helpLines().some(line => line.includes('@path'))).toBe(true)
    expect(formatCostLines(undefined, 128000)).toEqual(['No token measurement yet.'])
    expect(formatCostLines(1280, 128000)).toEqual(['1280 / 128000 tokens', '1% of context'])
    expect(formatCostLines(42, undefined)).toEqual(['42 tokens'])
    expect(formatQueuedLine(1, 'look at tests', 40)).toBe('queued 1  look at tests')
    expect(formatQueuedLine(2, 'a very long follow-up prompt', 18)).toBe('queued 2  a very …')
    expect(formatSteerLine(1, 'stop rewriting', 40)).toBe('steer 1  stop rewriting')
    expect(formatSteerLine(2, 'a very long steer prompt', 18)).toBe('steer 2  a very l…')
    expect(formatAgentsLine(3, 1)).toBe('agents 3  ·  1 running')
    expect(agentLines([])).toEqual(['No subagents.'])
    expect(agentLines([{ name: 'researcher', mode: 'continuable', status: 'running' }])).toEqual(['researcher  continuable  running'])
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
