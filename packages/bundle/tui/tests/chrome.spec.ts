import { describe, expect, it } from 'vitest'
import { helpLines, renderHeader, renderLanding, renderOnboarding, renderOverlay, renderSidebar, sessionLines } from '../src/chrome.ts'
import { PRODUCT_MARK, PRODUCT_NAME } from '../src/theme.ts'

const status = {
  provider: 'deepseek',
  model: 'v4',
  cwd: '/home/mark/src',
  busy: false,
  compact: false,
}

describe('Crush chrome strings', () => {
  it('draws the product mark and diagonal header', () => {
    const header = renderHeader(80, status, false)
    expect(header).toContain(PRODUCT_MARK)
    expect(header).toContain(PRODUCT_NAME)
    expect(header).toContain('╱')
    expect(renderHeader(40, status, true)).toContain(PRODUCT_NAME)
  })

  it('renders sidebar, landing, and onboarding', () => {
    expect(renderSidebar(24, 'Fix tests', status, '/home/mark')).toContain('Fix tests')
    expect(renderLanding(60, status, '/home/mark')).toContain('~/src')
    expect(renderOnboarding(60, 'No API key')).toContain('No API key')
  })

  it('frames overlays and lists sessions', () => {
    const overlay = renderOverlay(40, 'Models', ['deepseek / v4'], 0)
    expect(overlay).toContain('Models')
    expect(overlay).toContain('◉')
    expect(sessionLines([])).toEqual(['No stored sessions yet.'])
    expect(sessionLines([{ id: 's', title: 'Hello', createdAt: 1 }])).toEqual(['Hello'])
    expect(helpLines().some(line => line.includes('ctrl+p'))).toBe(true)
  })
})
