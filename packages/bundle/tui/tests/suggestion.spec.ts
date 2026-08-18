import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  ASK_PLACEHOLDER,
  FALLBACK_SUGGESTION_WORDS,
  MAX_SUGGESTION_WORDS,
  SUGGESTION_TIMEOUT_MS,
  capSuggestion,
  conversationSnippet,
  fallbackSuggestion,
  promptPlaceholder,
  readSuggestionText,
  shouldApplySuggestion,
  suggestionGenerateOptions,
  suggestionUserPrompt,
} from '../src/suggestion.ts'
import type { TranscriptItem } from '../src/transcript.ts'

const user = (id: string, text: string): TranscriptItem => ({ kind: 'user', id, seq: 1, text })
const assistant = (id: string, text: string): TranscriptItem => ({
  kind: 'assistant', id, seq: 2, text, streaming: false,
})

describe('capSuggestion', () => {
  it('truncates to 10 words', () => {
    const words = Array.from({ length: 12 }, (_, index) => `w${index + 1}`)
    expect(capSuggestion(words.join(' '))).toBe(words.slice(0, MAX_SUGGESTION_WORDS).join(' '))
  })

  it('strips wrapping quotes, keeps the first line, and rejects junk', () => {
    expect(capSuggestion('"Add unit tests next"')).toBe('Add unit tests next')
    expect(capSuggestion(String.fromCharCode(39) + 'Add unit tests next' + String.fromCharCode(39))).toBe('Add unit tests next')
    expect(capSuggestion('Add tests now\nAnd then refactor everything')).toBe('Add tests now')
    expect(capSuggestion('   ')).toBeUndefined()
    expect(capSuggestion('""')).toBeUndefined()
    expect(capSuggestion('Add tests')).toBe('Add tests')
  })
})

describe('promptPlaceholder', () => {
  it('keeps Ask DSH on landing and uses the suggestion only when the editor is empty', () => {
    expect(promptPlaceholder({ input: '' })).toBe(ASK_PLACEHOLDER)
    expect(promptPlaceholder({ input: '', suggestion: 'Add unit tests next' })).toBe('Add unit tests next')
    expect(promptPlaceholder({ input: 'hello', suggestion: 'Add unit tests next' })).toBe(ASK_PLACEHOLDER)
    expect(promptPlaceholder({ input: '', suggestion: '' })).toBe(ASK_PLACEHOLDER)
  })

  it('replaces Ask DSH with the suggestion and never concatenates the two', () => {
    const suggestion = 'Add unit tests next'
    const shown = promptPlaceholder({ input: '', suggestion })
    expect(shown).toBe(suggestion)
    expect(shown).not.toContain(ASK_PLACEHOLDER)
    expect(shown.startsWith(ASK_PLACEHOLDER)).toBe(false)
    expect(`${ASK_PLACEHOLDER}${suggestion}`).not.toBe(shown)
    expect(`${ASK_PLACEHOLDER} ${suggestion}`).not.toBe(shown)
  })
})

describe('shouldApplySuggestion', () => {
  it('ignores stale, typed, or busy editors', () => {
    expect(shouldApplySuggestion({ input: '', busy: false }, 1, 1)).toBe(true)
    expect(shouldApplySuggestion({ input: '', busy: false }, 1, 2)).toBe(false)
    expect(shouldApplySuggestion({ input: 'x', busy: false }, 1, 1)).toBe(false)
    expect(shouldApplySuggestion({ input: '', busy: true }, 1, 1)).toBe(false)
  })
})

describe('conversationSnippet', () => {
  it('uses only the last user and last assistant text', () => {
    const items: TranscriptItem[] = [
      user('u1', 'first question'),
      assistant('a1', 'first answer'),
      user('u2', 'second question'),
      { kind: 'tool', id: 't1', seq: 3, callId: 'c', name: 'bash', args: '{}', status: 'success', expanded: false },
      assistant('a2', 'second answer'),
    ]
    expect(conversationSnippet(items)).toBe('User: second question\nAssistant: second answer')
    expect(conversationSnippet([user('u1', 'only user')])).toBe('')
    expect(conversationSnippet([])).toBe('')
    const long = 'x'.repeat(12)
    expect(conversationSnippet([user('u', long), assistant('a', 'ok')], 10)).toBe(`User: ${'x'.repeat(10)}…\nAssistant: ok`)
  })
})

describe('suggestionGenerateOptions', () => {
  it('builds a detached one-shot without sessionId or purpose', () => {
    const abort = new AbortController()
    const options = suggestionGenerateOptions({ provider: 'deepseek', model: 'v4' }, 'User: hi\nAssistant: hello', abort.signal)
    expect(options.sessionId).toBeUndefined()
    expect(options.purpose).toBeUndefined()
    expect(options.maxTokens).toBe(40)
    expect(options.system).toContain('ONLY the next user prompt')
    expect(suggestionUserPrompt('User: hi\nAssistant: hello')).toContain('User: hi')
    expect(options.messages).toHaveLength(1)
  })
})

describe('readSuggestionText', () => {
  it('assembles text deltas and ignores non-text blocks', async () => {
    async function* stream(): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: 'Add ' }
      yield { type: 'text-delta', index: 0, text: 'tests' }
      yield { type: 'reasoning-delta', index: 1, text: 'thinking' }
    }
    await expect(readSuggestionText(stream())).resolves.toBe('Add tests')
  })

  it('throws when the stream finishes as an error so the caller can fall back', async () => {
    async function* stream(): AsyncIterable<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'nope', code: 'AUTH' } } }
    }
    await expect(readSuggestionText(stream())).rejects.toThrow('nope')
  })
})

describe('SUGGESTION_TIMEOUT_MS', () => {
  it('aborts a hung detached completion after 8 seconds', () => {
    expect(SUGGESTION_TIMEOUT_MS).toBe(8000)
  })
})

describe('fallbackSuggestion', () => {
  it('takes the first 8 words of the last assistant', () => {
    const words = Array.from({ length: 12 }, (_, index) => `w${index + 1}`)
    expect(fallbackSuggestion([
      user('u', 'ask'),
      assistant('a1', 'ignored older'),
      assistant('a2', words.join(' ')),
    ])).toBe(words.slice(0, FALLBACK_SUGGESTION_WORDS).join(' '))
    expect(fallbackSuggestion([user('u', 'only user')])).toBeUndefined()
  })
})
