import { describe, expect, it } from 'vitest'
import { MARK_FILTERS, MARK_LABEL, MARK_NOTE_MAX, MarkError, isMarkFilter, markRank, matchesMark, normalizeMarkInput } from '../../src/shared/marks'
import { mkMark } from '../renderer/helpers'

describe('listing marks (shared)', () => {
  it('labels and filters read in plain Ukrainian', () => {
    expect(MARK_LABEL).toEqual({ in_progress: 'В роботі', done: 'Реалізовано' })
    expect(MARK_FILTERS.map((f) => f.label)).toEqual(['Усі', 'Без мітки', 'В роботі', 'Реалізовано'])
    expect(MARK_FILTERS.map((f) => f.value).every(isMarkFilter)).toBe(true)
    expect(isMarkFilter('yes')).toBe(false)
  })

  it('matchesMark / markRank', () => {
    const done = mkMark({ status: 'done' })
    const wip = mkMark({ status: 'in_progress' })
    expect([matchesMark(done, 'any'), matchesMark(null, 'any'), matchesMark(undefined, 'none'), matchesMark(done, 'none')]).toEqual([true, true, true, false])
    expect([matchesMark(done, 'done'), matchesMark(wip, 'done'), matchesMark(wip, 'in_progress'), matchesMark(null, 'done')]).toEqual([true, false, true, false])
    expect([markRank({ mark: done }), markRank({ mark: wip }), markRank({ mark: null }), markRank({})]).toEqual([2, 1, 0, 0])
  })

  it('normalizeMarkInput: trims the note (empty = none), keeps absent fields absent, parses ids', () => {
    expect(normalizeMarkInput({ status: 'done' })).toEqual({ status: 'done' })
    expect(normalizeMarkInput({ status: 'none' })).toEqual({ status: 'none' })
    expect(normalizeMarkInput({ status: null, note: 'x' })).toEqual({ status: null, note: 'x' })
    expect(normalizeMarkInput({ status: 'in_progress', note: '  hi  ', ourListingId: ' 4242 ', ourDraftId: 7 })).toEqual({
      status: 'in_progress',
      note: 'hi',
      ourListingId: 4242,
      ourDraftId: 7
    })
    expect(normalizeMarkInput({ status: 'done', note: '   ', ourListingId: null, ourDraftId: '' })).toEqual({ status: 'done', note: null, ourListingId: null, ourDraftId: null })
    expect(normalizeMarkInput({ status: 'done', note: 'x'.repeat(MARK_NOTE_MAX) }).note).toHaveLength(500)
  })

  it('normalizeMarkInput refuses bad input with Ukrainian MarkErrors', () => {
    const bad = (v: unknown): string => {
      try {
        normalizeMarkInput(v)
      } catch (e) {
        expect(e).toBeInstanceOf(MarkError)
        return (e as Error).message
      }
      throw new Error('accepted')
    }
    expect(bad(undefined)).toBe('Некоректні дані мітки.')
    expect(bad([])).toBe('Некоректні дані мітки.')
    expect(bad({})).toBe('Невідома мітка.')
    expect(bad({ status: 'DONE' })).toBe('Невідома мітка.')
    expect(bad({ status: 'done', note: ['x'] })).toBe('Нотатка має бути текстом.')
    expect(bad({ status: 'done', note: 'x'.repeat(501) })).toBe('Нотатка задовга: 501 символів, можна до 500.')
    expect(bad({ status: 'done', ourListingId: 0 })).toBe('Некоректний номер нашого товару.')
    expect(bad({ status: 'done', ourListingId: 'abc' })).toBe('Некоректний номер нашого товару.')
    expect(bad({ status: 'done', ourDraftId: 2 ** 60 })).toBe('Некоректний номер чернетки.')
  })
})
