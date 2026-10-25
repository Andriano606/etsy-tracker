// Listing marks — the user's own bookkeeping of which example (competitor)
// listings they already made their own version of. Shared by main (validation,
// MCP) and the renderer (labels, the grid's filter and sort). Relative imports
// only (main has no @shared alias).

import type { Listing, ListingMark, ListingMarkInput, ListingMarkStatus, MarkFilter } from './types'

export const MARK_STATUSES: readonly ListingMarkStatus[] = ['in_progress', 'done']

/** The longest note a mark keeps. */
export const MARK_NOTE_MAX = 500

/** How a mark reads in the UI. */
export const MARK_LABEL: Record<ListingMarkStatus, string> = {
  in_progress: 'В роботі',
  done: 'Реалізовано'
}

/** The grid's filter (ShopView). */
export const MARK_FILTERS: ReadonlyArray<{ value: MarkFilter; label: string }> = [
  { value: 'any', label: 'Усі' },
  { value: 'none', label: 'Без мітки' },
  { value: 'in_progress', label: 'В роботі' },
  { value: 'done', label: 'Реалізовано' }
]

export const isMarkStatus = (v: unknown): v is ListingMarkStatus => v === 'in_progress' || v === 'done'

export const isMarkFilter = (v: unknown): v is MarkFilter => v === 'any' || v === 'none' || isMarkStatus(v)

/** Whether a listing passes the mark filter. */
export function matchesMark(mark: ListingMark | null | undefined, filter: MarkFilter): boolean {
  if (filter === 'any') return true
  if (filter === 'none') return !mark
  return mark?.status === filter
}

/** "Спершу з міткою": done first (2), then in progress (1), then unmarked (0). */
export function markRank(l: Pick<Listing, 'mark'>): number {
  return l.mark?.status === 'done' ? 2 : l.mark?.status === 'in_progress' ? 1 : 0
}

/** Thrown for a mark that can't be saved; the message is Ukrainian, for the UI. */
export class MarkError extends Error {}

const optId = (v: unknown, what: string): number | null | undefined => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = typeof v === 'string' ? Number(v.trim()) : v
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw new MarkError(`Некоректний ${what}.`)
  return n
}

/**
 * Check and normalise raw input (IPC, MCP): status in_progress|done|none|null,
 * a note ≤ 500 characters (trimmed; empty = none), positive ids. Absent fields
 * stay absent (= keep the stored value). Throws MarkError.
 */
export function normalizeMarkInput(raw: unknown): ListingMarkInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MarkError('Некоректні дані мітки.')
  const r = raw as Record<string, unknown>
  const status = r.status
  if (!(status === null || status === 'none' || isMarkStatus(status))) throw new MarkError('Невідома мітка.')
  const out: ListingMarkInput = { status }
  if (r.note !== undefined) {
    if (r.note !== null && typeof r.note !== 'string') throw new MarkError('Нотатка має бути текстом.')
    const note = (r.note ?? '').trim()
    if (note.length > MARK_NOTE_MAX) throw new MarkError(`Нотатка задовга: ${note.length} символів, можна до ${MARK_NOTE_MAX}.`)
    out.note = note || null
  }
  const ourListingId = optId(r.ourListingId, 'номер нашого товару')
  if (ourListingId !== undefined) out.ourListingId = ourListingId
  const ourDraftId = optId(r.ourDraftId, 'номер чернетки')
  if (ourDraftId !== undefined) out.ourDraftId = ourDraftId
  return out
}
