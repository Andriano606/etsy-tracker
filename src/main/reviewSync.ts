// Syncs a shop's reviews (GET /shops/{shop_id}/reviews — one request returns
// up to 100 reviews of the WHOLE shop, each with its listing_id) into the
// `reviews` table. Runs after a scan has committed and is never part of it: a
// reviews failure can't fail or roll back a listing scan.
//
// Two phases, both resumable (the cursor in `review_sync` is saved together
// with every page, in one transaction):
//
// - **Backfill** — the whole history created at or before `backfill_upper`
//   (fixed when the backfill starts), walked from the newest created-time
//   window to the oldest. A window's bounds are in the past, so the set of
//   reviews in it does not move while we page it with `offset`: correctness
//   does not depend on the (undocumented) result order. The OAS caps every v3
//   offset at 12000, so a window holding more than `windowCap` reviews is
//   narrowed (`min_created`) until it fits; the first request of a window is
//   open-ended downwards, so a shop with ≤ 12100 reviews needs no narrowing at
//   all. Adjacent windows share their boundary second (bounds may be
//   inclusive or exclusive — the OAS doesn't say; duplicates are deduped by
//   the natural key).
// - **Incremental** — every later run first reads [synced_through − overlap,
//   now]: new reviews plus edits and late-indexed ones in the overlap.
//
// Each run spends at most `budget` requests (default 300) and stops early when
// the daily quota left is below `quotaReserve`; the next run (next scan, or
// "Синхронізувати відгуки") continues where it stopped.
//
// "New" vs. backfilled: only a review first inserted by an incremental pass
// counts as new — and while the backfill is incomplete, only one created after
// `backfill_upper` (anything older is still the backfill's territory).

import type { Quota, ReviewSyncState } from '../shared/types'
import {
  type Db,
  type ReviewInput,
  type ReviewSyncRow,
  countReviewsCreated,
  emptyReviewSync,
  getReviewSync,
  getShop,
  okScanIds,
  reviewTotals,
  sameReviewSync,
  saveReviewSync,
  transaction,
  upsertReviews,
  writeReviewStats
} from './db'
import {
  EtsyApiError,
  type EtsyClient,
  type EtsyTransactionReview,
  MAX_OFFSET,
  PAGE_LIMIT,
  type Paged,
  REVIEW_EPOCH_MIN
} from './etsyApi'
import { mapReview } from './mapEtsy'

/** Requests one run may spend per shop. ~9,300 reviews ≈ 94 requests. */
export const REVIEW_REQUEST_BUDGET = 300
/** Incremental passes re-read this much before the last synced point (edits, late indexing). */
export const REVIEW_OVERLAP_SEC = 7 * 24 * 3600
/** Deepest a created-time window can be paged: offset ≤ 12000 (+ one page). */
export const REVIEW_WINDOW_CAP = MAX_OFFSET + PAGE_LIMIT
/** Width of the first narrowed backfill window. */
export const REVIEW_DEFAULT_SPAN = 90 * 24 * 3600
/** Windows are never narrowed below this; such a window is paged up to the offset cap. */
export const REVIEW_MIN_SPAN = 3600
/** Extra passes per run over a finished window that is missing reviews (see `repass`). */
export const REVIEW_MAX_REPASS = 2
/** Stop a run when Etsy says fewer requests than this are left today (scans need them). */
export const REVIEW_QUOTA_RESERVE = 1000

export interface ReviewSyncDeps {
  db: Db
  client: EtsyClient
  now?: () => number
  budget?: number
  overlapSec?: number
  windowCap?: number
  quotaReserve?: number
  /** The latest quota headers (sidebar numbers); null = unknown. */
  getQuota?: () => Quota | null
  onState?: (s: ReviewSyncState) => void
  /** A run finished (whatever the outcome): queue the photo sync, refresh the renderer. */
  onDone?: (s: ReviewSyncState) => void
}

export interface ReviewSyncRequest {
  /** The scan this run belongs to (new reviews are attributed to it); default = the latest ok scan. */
  scanId?: number | null
}

export interface ReviewSyncer {
  /** Run a sync for one shop; a request made while one runs is queued once (merged). */
  sync(shopId: number, req?: ReviewSyncRequest): Promise<ReviewSyncState>
  state(shopId: number): ReviewSyncState | null
  isRunning(shopId: number): boolean
}

/** A Ukrainian message for a failed reviews request — never a crash. */
export function reviewErrorMessage(e: unknown): string {
  if (e instanceof EtsyApiError) {
    switch (e.kind) {
      case 'auth':
        return `Etsy не дозволяє читати відгуки цього магазину з цим ключем (HTTP ${e.status ?? 403}). Товари скануються як і раніше.`
      case 'not_found':
        return 'Відгуки цього магазину недоступні (HTTP 404). Товари скануються як і раніше.'
      case 'rate_limit':
        return 'Перевищено ліміт запитів до Etsy — відгуки догрузяться під час наступної синхронізації.'
      default:
        return `Відгуки: ${e.message}`
    }
  }
  return `Відгуки: ${e instanceof Error ? e.message : String(e)}`
}

class ShopGone extends Error {}

/**
 * Where to page next in a created-time window after reading the page at
 * `offset`; `known` = the window's `count` as the previous page saw it (null
 * on its first page). If the window lost reviews meanwhile (deleted or hidden
 * on Etsy), one removed before `offset` shifts an unread review below it —
 * whatever the result order — so step back by the drop (re-reading a few is
 * free: rows are deduped by key). A grown window only pushes reviews up
 * (re-read, never skipped); paging continues to the new count.
 */
export function pageStep(
  offset: number,
  known: number | null,
  page: Paged<unknown>
): { offset: number; count: number; done: boolean } {
  const count = page.count
  if (offset > 0 && known != null && count < known) {
    return { offset: Math.max(0, offset - (known - count)), count, done: false }
  }
  const next = offset + PAGE_LIMIT
  return { offset: next, count, done: page.results.length === 0 || next >= count || next > MAX_OFFSET }
}

export function createReviewSyncer(deps: ReviewSyncDeps): ReviewSyncer {
  const { db, client } = deps
  const now = deps.now ?? Date.now
  const budget = Math.max(1, deps.budget ?? REVIEW_REQUEST_BUDGET)
  const overlap = deps.overlapSec ?? REVIEW_OVERLAP_SEC
  const cap = deps.windowCap ?? REVIEW_WINDOW_CAP
  const reserve = deps.quotaReserve ?? REVIEW_QUOTA_RESERVE

  const states = new Map<number, ReviewSyncState>()
  const chains = new Map<number, Promise<unknown>>()
  const queued = new Map<number, { scanId: number | null; run: Promise<ReviewSyncState> }>()

  async function runOnce(shopId: number, requestedScanId: number | null): Promise<ReviewSyncState> {
    const state: ReviewSyncState = {
      shopId,
      running: true,
      phase: null,
      stored: 0,
      estimate: null,
      requests: 0,
      newReviews: 0,
      backfillComplete: false,
      budgetExhausted: false,
      error: null
    }
    const emit = (): void => {
      states.set(shopId, { ...state })
      deps.onState?.({ ...state })
    }
    const shop = getShop(db, shopId)
    if (!shop) {
      state.running = false
      state.error = 'Магазин не знайдено.'
      emit()
      return { ...state }
    }
    const scanId = requestedScanId ?? okScanIds(db, shopId, 1)[0] ?? null
    /** The cursor row as this run last read or wrote it — what the db must still hold. */
    let persisted: ReviewSyncRow | null = getReviewSync(db, shopId)
    /**
     * The committed cursor (+ the request counter). Each page works on a copy
     * that replaces it only once its transaction committed, so a failed commit
     * can never save a cursor past reviews that were not stored.
     */
    let st: ReviewSyncRow = { ...(persisted ?? emptyReviewSync(shopId)) }
    const nowS = Math.floor(now() / 1000)
    const firstRun = st.backfill_upper == null
    if (firstRun) {
      st.backfill_upper = nowS
      st.synced_through = nowS
      st.win_hi = nowS
      st.win_lo = null
      st.win_offset = 0
      st.win_count = null
    }
    const backfillDoneAtStart = !!st.backfill_complete
    const upper = st.backfill_upper!
    state.stored = reviewTotals(db, shopId).count
    state.estimate = st.total_estimate
    state.backfillComplete = backfillDoneAtStart
    emit()

    /**
     * Still the shop this run started on: not deleted, not deleted and added
     * again (same Etsy id, fresh rows), and its cursor is the one we left.
     */
    const stillOurs = (): boolean => {
      const s = getShop(db, shopId)
      if (!s || s.addedAt !== shop.addedAt) return false
      const row = getReviewSync(db, shopId)
      if (!persisted) return row == null
      return row != null && sameReviewSync(row, persisted)
    }

    let quotaNote: string | null = null
    const canRequest = (): boolean => {
      if (state.requests >= budget) {
        state.budgetExhausted = true
        return false
      }
      const left = deps.getQuota?.()?.remainingToday
      if (left != null && left < reserve) {
        state.budgetExhausted = true
        quotaNote = `Денний ліміт запитів Etsy майже вичерпано (залишилось ${left}) — відгуки догрузяться пізніше.`
        return false
      }
      return true
    }
    const fetchPage = async (q: {
      minCreated?: number
      maxCreated?: number
      offset: number
    }): Promise<Paged<EtsyTransactionReview>> => {
      state.requests++
      st.requests_total++
      return client.getShopReviews(shopId, { limit: PAGE_LIMIT, ...q })
    }
    /**
     * Store a page and the cursor `next` together (a crash resumes exactly
     * here); `then` runs inside the transaction after the upsert (it may still
     * change `next`). `next` becomes the run's cursor only once committed.
     */
    const commit = (
      next: ReviewSyncRow,
      results: EtsyTransactionReview[],
      isNew: (r: ReviewInput) => boolean,
      then?: () => void
    ): void => {
      let fresh = 0
      transaction(db, () => {
        if (!stillOurs()) throw new ShopGone()
        const mapped = results.filter((r) => r && r.listing_id != null).map(mapReview)
        fresh = upsertReviews(db, shopId, mapped, { now: now(), scanId, isNew }).fresh
        then?.()
        const t = reviewTotals(db, shopId)
        next.oldest_created = t.oldest
        next.newest_created = t.newest
        state.stored = t.count
        saveReviewSync(db, next)
      })
      st = next
      persisted = { ...next }
      state.newReviews += fresh
      state.estimate = st.total_estimate
      state.backfillComplete = !!st.backfill_complete
      emit()
    }

    /** Extra passes over one finished window this run (key → passes, stored count at the last check). */
    const repasses = new Map<string, { n: number; have: number }>()
    /**
     * A finished window [lo, hi] whose `count` reviews are not all stored
     * (an unstable result order skipped some across a page boundary) is paged
     * once more — up to REVIEW_MAX_REPASS times per run, while a pass still
     * finds missing ones. A window paged only up to the offset cap can't be.
     */
    const repass = (key: string, lo: number | null, hi: number, count: number): boolean => {
      if (count > cap) return false
      const have = countReviewsCreated(db, shopId, lo, hi)
      if (have >= count) return false
      const prev = repasses.get(key)
      if (prev && (prev.n >= REVIEW_MAX_REPASS || have <= prev.have)) return false
      repasses.set(key, { n: (prev?.n ?? 0) + 1, have })
      return true
    }

    try {
      // 1. Incremental: what appeared (or changed) since the last pass.
      if (!firstRun) {
        state.phase = 'incremental'
        if (st.inc_target == null) {
          st.inc_lo = Math.max(REVIEW_EPOCH_MIN, (st.synced_through ?? upper) - overlap)
          st.inc_hi = nowS
          st.inc_target = nowS
          st.inc_offset = 0
          st.inc_count = null
        }
        const isNew = (r: ReviewInput): boolean => backfillDoneAtStart || (r.createdTimestamp ?? 0) > upper
        while (st.inc_target != null && canRequest()) {
          const lo = st.inc_lo!
          const hi = st.inc_hi!
          const offset = st.inc_offset
          const page = await fetchPage({ minCreated: lo, maxCreated: hi, offset })
          const next = { ...st }
          if (offset === 0 && page.count > cap && hi - lo > REVIEW_MIN_SPAN) {
            // Too many for the offset cap: take the older half first.
            next.inc_hi = lo + Math.floor((hi - lo) / 2)
            commit(next, page.results, isNew)
            continue
          }
          const step = pageStep(offset, offset === 0 ? null : st.inc_count, page)
          next.inc_offset = step.offset
          next.inc_count = step.count
          const finish = (): void => {
            if (!step.done) return
            if (repass(`i:${lo}:${hi}`, lo, hi, step.count)) {
              next.inc_offset = 0
              next.inc_count = null
              return
            }
            if (hi < next.inc_target!) {
              next.inc_lo = hi
              next.inc_hi = next.inc_target
            } else {
              next.synced_through = next.inc_target
              next.inc_lo = next.inc_hi = next.inc_target = null
            }
            next.inc_offset = 0
            next.inc_count = null
          }
          commit(next, page.results, isNew, finish)
        }
      }

      // 2. Backfill: the history, newest window first, with what budget is left.
      if (!st.backfill_complete) state.phase = 'backfill'
      while (!st.backfill_complete && canRequest()) {
        const hi = st.win_hi ?? upper
        const lo = st.win_lo
        const offset = st.win_offset
        const page = await fetchPage({ maxCreated: hi, minCreated: lo ?? undefined, offset })
        const next = { ...st }
        if (offset === 0) {
          if (lo == null && hi === upper && next.total_estimate == null) next.total_estimate = page.count
          const width = lo == null ? null : hi - lo
          if (page.count > cap && (width == null || width > REVIEW_MIN_SPAN)) {
            const span =
              width == null ? (next.win_span ?? REVIEW_DEFAULT_SPAN) : Math.max(REVIEW_MIN_SPAN, Math.floor(width / 2))
            next.win_lo = Math.max(REVIEW_EPOCH_MIN, hi - span)
            next.win_span = span
            commit(next, page.results, () => false)
            continue
          }
        }
        const step = pageStep(offset, offset === 0 ? null : st.win_count, page)
        next.win_offset = step.offset
        next.win_count = step.count
        const finish = (): void => {
          if (!step.done) return
          if (repass(`b:${lo}:${hi}`, lo, hi, step.count)) {
            next.win_offset = 0
            next.win_count = null
            return
          }
          if (lo == null || lo <= REVIEW_EPOCH_MIN) {
            next.backfill_complete = 1
            next.win_hi = next.win_lo = next.win_count = null
          } else {
            // A sparse window: try a wider one next time it has to be narrowed.
            if (next.win_span != null && step.count < cap / 4) next.win_span *= 2
            next.win_hi = lo
            next.win_lo = null
            next.win_count = null
          }
          next.win_offset = 0
        }
        commit(next, page.results, () => false, finish)
      }
      // A clean run clears an old error; a quota stop leaves its note.
      st.last_error = quotaNote
    } catch (e) {
      if (e instanceof ShopGone) {
        state.running = false
        state.error = 'Магазин видалено.'
        emit()
        return { ...state }
      }
      st.last_error = reviewErrorMessage(e)
      state.error = st.last_error
    }

    st.last_run_requests = state.requests
    st.last_synced_at = now()
    // Nothing committed on a first run (403, 404, quota…): keep the shop
    // "never synced" — the backfill bounds start with the first stored page.
    const toSave: ReviewSyncRow =
      persisted?.backfill_upper == null
        ? { ...st, backfill_upper: null, synced_through: null, win_hi: null, win_lo: null, win_offset: 0, win_count: null }
        : st
    try {
      transaction(db, () => {
        if (!stillOurs()) throw new ShopGone()
        saveReviewSync(db, toSave)
        if (scanId != null) writeReviewStats(db, shopId, scanId, now())
      })
    } catch (e) {
      if (e instanceof ShopGone) state.error = state.error ?? 'Магазин видалено.'
      else state.error = state.error ?? reviewErrorMessage(e)
    }
    state.running = false
    state.phase = null
    state.backfillComplete = !!st.backfill_complete
    state.estimate = st.total_estimate
    if (!state.error && st.last_error) state.error = st.last_error
    emit()
    deps.onDone?.({ ...state })
    return { ...state }
  }

  function sync(shopId: number, req: ReviewSyncRequest = {}): Promise<ReviewSyncState> {
    const q = queued.get(shopId)
    if (q) {
      if (req.scanId != null) q.scanId = req.scanId
      return q.run
    }
    const entry = { scanId: req.scanId ?? null, run: null as unknown as Promise<ReviewSyncState> }
    queued.set(shopId, entry)
    const prev = chains.get(shopId) ?? Promise.resolve()
    entry.run = prev.then(() => {
      queued.delete(shopId)
      return runOnce(shopId, entry.scanId)
    })
    chains.set(shopId, entry.run.catch(() => undefined))
    return entry.run
  }

  return {
    sync,
    state: (shopId) => {
      const s = states.get(shopId)
      return s ? { ...s } : null
    },
    isRunning: (shopId) => !!states.get(shopId)?.running
  }
}
