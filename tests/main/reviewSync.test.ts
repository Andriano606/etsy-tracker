import { describe, expect, it } from 'vitest'
import {
  REVIEW_DEFAULT_SPAN,
  REVIEW_OVERLAP_SEC,
  createReviewSyncer,
  pageStep,
  reviewErrorMessage,
  type ReviewSyncDeps
} from '../../src/main/reviewSync'
import { EtsyApiError, MAX_OFFSET } from '../../src/main/etsyApi'
import {
  type Db,
  deleteShop,
  getListing,
  getReviewSync,
  getShopSummary,
  insertRunningScan,
  finishScanOk,
  listListingReviews,
  listListingStats,
  listNewReviews,
  upsertListing,
  insertListingStats
} from '../../src/main/db'
import { FakeEtsy, SHOP_ID, mkEtsyReview, reviewCreated } from '../helpers/fakeEtsy'
import type { EtsyClient } from '../../src/main/etsyApi'
import { memDb, mkInput, seedShop } from '../helpers/db'
import type { ReviewSyncState } from '../../src/shared/types'

const REVIEWS_PATH = `/v3/application/shops/${SHOP_ID}/reviews`

/** A shop with listings 1–3 and one ok scan; `n` reviews on Etsy; the clock just after the newest. */
function setup(n: number, over: Partial<ReviewSyncDeps> = {}) {
  const db = memDb()
  seedShop(db, { id: SHOP_ID })
  for (const id of [1, 2, 3]) upsertListing(db, mkInput(id, { shopId: SHOP_ID }), 1)
  const scanId = okScan(db)
  const etsy = new FakeEtsy(0)
  for (let i = 1; i <= n; i++) etsy.reviews.push(mkEtsyReview(i))
  const clock = { s: reviewCreated(n) + 3600 }
  const states: ReviewSyncState[] = []
  const syncer = createReviewSyncer({
    db,
    client: etsy.client(),
    now: () => clock.s * 1000,
    onState: (s) => states.push(s),
    ...over
  })
  return { db, etsy, clock, syncer, scanId, states }
}

function okScan(db: Db, at = 5000): number {
  const id = insertRunningScan(db, SHOP_ID, at)
  finishScanOk(db, id, at + 1, { isBaseline: false, truncated: false, total: 3, added: 0, removed: 0, changed: 0, returned: 0 })
  insertListingStats(
    db,
    id,
    [1, 2, 3].map((listingId) => ({ listingId, views: 1, numFavorers: 1, featuredRank: null, quantity: 1 }))
  )
  return id
}

const count = (db: Db): number => (db.prepare('SELECT COUNT(*) AS n FROM reviews').get() as { n: number }).n
const storedTx = (db: Db): Set<number> =>
  new Set((db.prepare('SELECT transaction_id AS t FROM reviews').all() as Array<{ t: number }>).map((r) => r.t))
/** Transaction ids live on Etsy that are not stored. */
const missing = (db: Db, etsy: FakeEtsy): number[] => {
  const got = storedTx(db)
  return etsy.reviews.map((r) => Number(r.transaction_id)).filter((t) => !got.has(t))
}
/** Sync until the backfill completes (at most `max` runs), an hour apart. */
async function untilComplete(t: { syncer: { sync: (id: number) => Promise<ReviewSyncState> }; clock: { s: number } }, max = 20) {
  let st!: ReviewSyncState
  for (let i = 0; i < max; i++) {
    st = await t.syncer.sync(SHOP_ID)
    if (st.backfillComplete) break
    t.clock.s += 3600
  }
  return st
}
const origins = (db: Db): Record<string, number> =>
  Object.fromEntries(
    (db.prepare('SELECT origin, COUNT(*) AS n FROM reviews GROUP BY origin').all() as Array<{ origin: string; n: number }>).map(
      (r) => [r.origin, r.n]
    )
  )

describe('backfill', () => {
  it('first run reads the whole history; nothing is "new"; stats are written for the scan', async () => {
    const { db, etsy, syncer, scanId } = setup(250)
    const st = await syncer.sync(SHOP_ID, { scanId })
    expect(st).toMatchObject({ running: false, stored: 250, estimate: 250, backfillComplete: true, newReviews: 0, error: null })
    expect(etsy.count(REVIEWS_PATH)).toBe(3)
    expect(count(db)).toBe(250)
    expect(origins(db)).toEqual({ backfill: 250 })
    const sync = getReviewSync(db, SHOP_ID)!
    expect(sync).toMatchObject({ backfill_complete: 1, total_estimate: 250, requests_total: 3, last_error: null })
    expect(sync.oldest_created).toBe(reviewCreated(1))
    expect(sync.newest_created).toBe(reviewCreated(250))
    // Listing 2 gets reviews 1, 4, 7, … (n % 3 === 1).
    const l2 = getListing(db, 2)!
    expect(l2).toMatchObject({ reviewCount: 84, reviewsNew: 0, reviewsPartial: false })
    expect(listListingStats(db, 2)).toEqual([expect.objectContaining({ reviewCount: 84, reviewsComplete: true })])
    expect(listNewReviews(db, scanId)).toEqual([])
    expect(getShopSummary(db, SHOP_ID)!.reviews).toMatchObject({ stored: 250, backfillComplete: true, estimate: 250, newCount: 0 })
  })

  it('a shop without reviews completes with one request', async () => {
    const { db, etsy, syncer } = setup(0)
    expect(await syncer.sync(SHOP_ID)).toMatchObject({ stored: 0, backfillComplete: true, estimate: 0 })
    expect(etsy.count(REVIEWS_PATH)).toBe(1)
    expect(getListing(db, 1)).toMatchObject({ reviewCount: 0, reviewAvg: null })
  })

  it('resumes across runs within the request budget, saving the cursor after every page', async () => {
    const { db, etsy, syncer, scanId } = setup(450, { budget: 2 })
    const r1 = await syncer.sync(SHOP_ID, { scanId })
    expect(r1).toMatchObject({ stored: 200, requests: 2, budgetExhausted: true, backfillComplete: false, error: null })
    expect(getReviewSync(db, SHOP_ID)).toMatchObject({ win_offset: 200, backfill_complete: 0 })
    // Partial counts are marked as such.
    expect(getListing(db, 1)!.reviewsPartial).toBe(true)
    expect(listListingStats(db, 1)[0].reviewsComplete).toBe(false)
    expect(getShopSummary(db, SHOP_ID)!.reviews).toMatchObject({ stored: 200, estimate: 450, backfillComplete: false })

    // Run 2 spends one request on the incremental pass, one on the backfill.
    const r2 = await syncer.sync(SHOP_ID, { scanId })
    expect(r2).toMatchObject({ stored: 300, requests: 2, backfillComplete: false })
    const r3 = await syncer.sync(SHOP_ID, { scanId })
    const r4 = await syncer.sync(SHOP_ID, { scanId })
    expect(r4).toMatchObject({ stored: 450, backfillComplete: true })
    expect(r3.backfillComplete).toBe(false)
    expect(count(db)).toBe(450)
    expect(origins(db)).toEqual({ backfill: 450 })
    // 5 backfill pages + 3 incremental passes (runs 2–4), nothing wasted.
    expect(etsy.count(REVIEWS_PATH)).toBe(8)
  })

  for (const order of ['desc', 'asc', 'shuffle'] as const) {
    it(`narrows created-time windows to respect the offset cap (order: ${order})`, async () => {
      // A cap of 50 per window stands in for Etsy's 12 000-offset limit.
      const { db, etsy, syncer } = setup(230, { windowCap: 50 })
      etsy.reviewOrder = order
      const st = await syncer.sync(SHOP_ID)
      expect(st).toMatchObject({ stored: 230, backfillComplete: true, estimate: 230 })
      expect(count(db)).toBe(230)
      for (const u of etsy.requests) {
        const offset = Number(u.searchParams.get('offset') ?? 0)
        const min = u.searchParams.get('min_created')
        const max = Number(u.searchParams.get('max_created'))
        // Every paged window (offset > 0) holds at most the cap.
        if (offset > 0) {
          const inWindow = etsy.reviews.filter(
            (r) => r.created_timestamp! <= max && (min == null || r.created_timestamp! >= Number(min))
          ).length
          expect(inWindow).toBeLessThanOrEqual(50)
        }
        expect(offset).toBeLessThanOrEqual(MAX_OFFSET)
      }
      // The first narrowed window uses the default span.
      const second = etsy.requests[1]
      expect(Number(second.searchParams.get('max_created')) - Number(second.searchParams.get('min_created'))).toBe(
        REVIEW_DEFAULT_SPAN
      )
    })
  }

  it('a review created exactly on a window boundary is stored once', async () => {
    const { db, etsy, syncer } = setup(120, { windowCap: 50 })
    // Duplicate the timestamp of a review onto another one: both share a boundary second.
    etsy.reviews[60].created_timestamp = etsy.reviews[59].created_timestamp
    await syncer.sync(SHOP_ID)
    expect(count(db)).toBe(120)
  })

  it('narrowing and paging resume across runs too', async () => {
    const { db, syncer } = setup(230, { windowCap: 50, budget: 3 })
    let st: ReviewSyncState
    let runs = 0
    do {
      st = await syncer.sync(SHOP_ID)
      runs++
    } while (!st.backfillComplete && runs < 50)
    expect(st.backfillComplete).toBe(true)
    expect(count(db)).toBe(230)
    expect(origins(db)).toEqual({ backfill: 230 })
  })
})

describe('incremental', () => {
  it('reads [synced − overlap, now]: new reviews are "new", edits update the row', async () => {
    const { db, etsy, syncer, clock } = setup(150)
    await syncer.sync(SHOP_ID)
    const before = etsy.requests.length
    // Two days later: two new reviews, one edited inside the overlap, one edited long ago.
    clock.s += 2 * 86_400
    etsy.reviews.push(
      mkEtsyReview(151, { created_timestamp: clock.s - 3600, listing_id: 2 }),
      mkEtsyReview(152, { created_timestamp: clock.s - 60, listing_id: 2, image_url_fullxfull: 'https://i.etsystatic.com/r/1.jpg' })
    )
    const recent = etsy.reviews[148] // n = 149, created 1 day before the backfill's upper bound
    Object.assign(recent, { rating: 1, review: 'Changed my mind', updated_timestamp: clock.s - 100 })
    etsy.reviews[0].review = 'Edited years later — outside the overlap'
    const scan2 = okScan(db, 9000)
    const st = await syncer.sync(SHOP_ID, { scanId: scan2 })
    expect(st).toMatchObject({ newReviews: 2, stored: 152, error: null })
    expect(etsy.requests.length - before).toBe(1)
    const q = etsy.requests[before]
    expect(Number(q.searchParams.get('min_created'))).toBe(reviewCreated(150) + 3600 - REVIEW_OVERLAP_SEC)
    expect(Number(q.searchParams.get('max_created'))).toBe(clock.s)
    expect(origins(db)).toEqual({ backfill: 150, new: 2 })
    const fresh = listNewReviews(db, scan2)
    expect(fresh.map((r) => r.transactionId)).toEqual([5152, 5151])
    expect(fresh[0]).toMatchObject({ listingTitle: 'Listing 2', hasImage: true, imageStatus: 'pending', origin: 'new' })
    const edited = db.prepare('SELECT rating, review, changed_at, origin FROM reviews WHERE transaction_id = 5149').get()
    expect(edited).toMatchObject({ rating: 1, review: 'Changed my mind', origin: 'backfill' })
    expect((edited as { changed_at: number }).changed_at).toBe(clock.s * 1000)
    // Growth: the listing's "+N" = reviews first seen as new by the latest scan's sync.
    expect(getListing(db, 2)).toMatchObject({ reviewsNew: 2 })
    expect(getShopSummary(db, SHOP_ID)!.reviews!.newCount).toBe(2)
    expect(listListingStats(db, 2).map((p) => p.reviewCount)).toEqual([50, 52])
    // The next scan's sync finds nothing new: the "+N" goes back to 0.
    const scan3 = okScan(db, 10000)
    clock.s += 3600
    expect((await syncer.sync(SHOP_ID, { scanId: scan3 })).newReviews).toBe(0)
    expect(getListing(db, 2)!.reviewsNew).toBe(0)
  })

  it('while the backfill is incomplete only reviews created after its upper bound are new', async () => {
    const { db, etsy, syncer, clock } = setup(300, { budget: 1 })
    await syncer.sync(SHOP_ID) // newest 100 of 300 stored
    const upper = getReviewSync(db, SHOP_ID)!.backfill_upper!
    clock.s += 86_400
    etsy.reviews.push(mkEtsyReview(301, { created_timestamp: clock.s - 10 }))
    // A late-indexed old review inside the overlap: backfill territory, not "new".
    etsy.reviews.push(mkEtsyReview(302, { created_timestamp: upper - 3 * 86_400 - 5 }))
    const st = await syncer.sync(SHOP_ID)
    expect(st.newReviews).toBe(1)
    const rows = db.prepare('SELECT transaction_id, origin FROM reviews WHERE transaction_id IN (5301, 5302)').all()
    expect(rows).toEqual(
      expect.arrayContaining([
        { transaction_id: 5301, origin: 'new' },
        { transaction_id: 5302, origin: 'backfill' }
      ])
    )
  })

  it('once the backfill is complete, any review the incremental pass finds first is new', async () => {
    const { db, etsy, syncer, clock } = setup(10)
    await syncer.sync(SHOP_ID)
    clock.s += 3600
    etsy.reviews.push(mkEtsyReview(11, { created_timestamp: reviewCreated(10) - 600 })) // indexed late
    expect((await syncer.sync(SHOP_ID)).newReviews).toBe(1)
    expect(origins(db)).toEqual({ backfill: 10, new: 1 })
  })

  it('an incremental window too big for the offset cap is split', async () => {
    const { db, etsy, syncer, clock } = setup(5, { windowCap: 50 })
    await syncer.sync(SHOP_ID)
    const start = clock.s
    clock.s += 200 * 600
    for (let i = 0; i < 120; i++) etsy.reviews.push(mkEtsyReview(1000 + i, { created_timestamp: start + 600 * (i + 1) }))
    const st = await syncer.sync(SHOP_ID)
    expect(st).toMatchObject({ newReviews: 120, stored: 125 })
    expect(getReviewSync(db, SHOP_ID)).toMatchObject({ synced_through: clock.s, inc_target: null })
  })
})

describe('failures never crash and keep the progress', () => {
  it('403 / 404 give a friendly message; the run ends cleanly', async () => {
    for (const status of [403, 404]) {
      const { db, etsy, syncer } = setup(10)
      etsy.reviewsStatus = status
      const st = await syncer.sync(SHOP_ID)
      expect(st.running).toBe(false)
      expect(st.error).toMatch(status === 403 ? /не дозволяє читати відгуки.*403/ : /недоступні \(HTTP 404\)/)
      expect(getReviewSync(db, SHOP_ID)!.last_error).toBe(st.error)
      expect(getShopSummary(db, SHOP_ID)!.reviews).toMatchObject({ stored: 0, lastError: st.error })
      // Fixed later: the next run clears the error.
      etsy.reviewsStatus = null
      expect(await syncer.sync(SHOP_ID)).toMatchObject({ error: null, stored: 10 })
      expect(getReviewSync(db, SHOP_ID)!.last_error).toBeNull()
    }
  })

  it('an error mid-backfill keeps the pages already stored and resumes there', async () => {
    const { db, etsy, syncer } = setup(350)
    etsy.intercept = (url, nth) => (nth === 3 ? { status: 400, body: { error: 'boom' } } : null)
    const st = await syncer.sync(SHOP_ID)
    expect(st.error).toMatch(/Відгуки: .*400/)
    expect(count(db)).toBe(200)
    etsy.intercept = undefined
    expect(await syncer.sync(SHOP_ID)).toMatchObject({ stored: 350, backfillComplete: true, error: null })
  })

  it('429 exhaustion says it will continue later', () => {
    expect(reviewErrorMessage(new EtsyApiError('rate_limit', 'x', 429))).toMatch(/наступної синхронізації/)
    expect(reviewErrorMessage(new Error('disk full'))).toBe('Відгуки: disk full')
  })

  it('stops before spending the daily-quota reserve', async () => {
    const { etsy, syncer } = setup(10, {
      getQuota: () => ({ limitPerDay: 10000, remainingToday: 50, limitPerSecond: 10, remainingThisSecond: 10, at: 0 })
    })
    const st = await syncer.sync(SHOP_ID)
    expect(etsy.requests).toHaveLength(0)
    expect(st).toMatchObject({ budgetExhausted: true, stored: 0 })
    expect(st.error).toMatch(/Денний ліміт.*50/)
  })

  it('a shop deleted mid-sync stops the run without errors', async () => {
    const { db, etsy, syncer } = setup(250)
    etsy.intercept = (_url, nth) => {
      if (nth === 2) deleteShop(db, SHOP_ID)
      return null
    }
    const st = await syncer.sync(SHOP_ID)
    expect(st.running).toBe(false)
    expect(count(db)).toBe(0)
    expect(getReviewSync(db, SHOP_ID)).toBeNull()
  })

  it('an unknown shop is refused without a request', async () => {
    const { etsy, syncer } = setup(1)
    expect((await syncer.sync(424242)).error).toMatch(/не знайдено/)
    expect(etsy.requests).toHaveLength(0)
  })
})

describe('the set changes while a window is paged', () => {
  it('pageStep steps back by the drop when a window lost reviews, never past 0', () => {
    const page = (count: number, n = 100) => ({ count, results: Array.from({ length: n }) })
    expect(pageStep(0, null, page(250))).toEqual({ offset: 100, count: 250, done: false })
    expect(pageStep(200, 250, page(250, 50))).toEqual({ offset: 300, count: 250, done: true })
    expect(pageStep(200, 250, page(247, 47))).toEqual({ offset: 197, count: 247, done: false })
    expect(pageStep(100, 400, page(250))).toEqual({ offset: 0, count: 250, done: false })
    // A grown window is paged on to its new count.
    expect(pageStep(200, 250, page(310))).toEqual({ offset: 300, count: 310, done: false })
  })

  it('a review deleted on Etsy between backfill runs skips nothing', async () => {
    const t = setup(450, { budget: 2 })
    await t.syncer.sync(SHOP_ID) // the newest 200; resumes at offset 200
    expect(getReviewSync(t.db, SHOP_ID)).toMatchObject({ win_offset: 200, win_count: 450 })
    // The buyer deletes the newest review: every older one moves up by one.
    t.etsy.reviews.splice(t.etsy.reviews.findIndex((r) => r.transaction_id === 5450), 1)
    t.clock.s += 3600
    const st = await untilComplete(t)
    expect(st.backfillComplete).toBe(true)
    expect(missing(t.db, t.etsy)).toEqual([])
  })

  it('reviews deleted between two pages of one run skip nothing either', async () => {
    const t = setup(350)
    t.etsy.intercept = (_url, nth) => {
      if (nth === 2) t.etsy.reviews.splice(t.etsy.reviews.length - 3, 3) // three of the newest
      return null
    }
    const st = await t.syncer.sync(SHOP_ID)
    expect(st.backfillComplete).toBe(true)
    expect(missing(t.db, t.etsy)).toEqual([])
  })

  it('same-second reviews in an unstable order across page boundaries are all stored (extra passes)', async () => {
    const t = setup(0)
    // 1000 reviews, 37 per second: a sort by created time alone ties across every page boundary.
    const base = 1_700_000_000
    for (let i = 0; i < 1000; i++) t.etsy.reviews.push(mkEtsyReview(i + 1, { created_timestamp: base + Math.floor(i / 37) }))
    t.etsy.reviewOrder = 'unstable'
    t.clock.s = base + 3600
    const st = await t.syncer.sync(SHOP_ID)
    expect(st.backfillComplete).toBe(true)
    expect(count(t.db)).toBe(1000)
    // One pass is 10 requests; the window was re-paged because it came up short.
    expect(t.etsy.count(REVIEWS_PATH)).toBeGreaterThan(10)
  })

  it('a window that stays short (a review we cannot store) is re-paged once, then accepted', async () => {
    const t = setup(150)
    t.etsy.reviews[10].listing_id = null as unknown as number // counted by Etsy, never stored
    const st = await t.syncer.sync(SHOP_ID)
    expect(st).toMatchObject({ backfillComplete: true, stored: 149 })
    expect(t.etsy.count(REVIEWS_PATH)).toBe(4) // 2 pages + one more pass that found nothing new
  })
})

describe('the cursor never runs ahead of what was stored', () => {
  it('a failed page commit leaves the cursor before that page; the next run stores it', async () => {
    const t = setup(250)
    // A one-shot SQLite failure on the second page's first insert.
    t.db.exec(`CREATE TABLE boom (armed INTEGER); INSERT INTO boom VALUES (0);
      CREATE TRIGGER boom_t BEFORE INSERT ON reviews WHEN (SELECT armed FROM boom) = 1
      BEGIN SELECT RAISE(ABORT, 'disk I/O error (simulated)'); END;`)
    t.etsy.intercept = (_url, nth) => {
      t.db.exec(`UPDATE boom SET armed = ${nth === 2 ? 1 : 0}`)
      return null
    }
    const r1 = await t.syncer.sync(SHOP_ID, { scanId: t.scanId })
    expect(r1.error).toMatch(/disk I\/O error/)
    expect(count(t.db)).toBe(100)
    expect(getReviewSync(t.db, SHOP_ID)).toMatchObject({ win_offset: 100, backfill_complete: 0, requests_total: 2 })
    t.etsy.intercept = undefined
    t.db.exec('UPDATE boom SET armed = 0')
    const r2 = await t.syncer.sync(SHOP_ID, { scanId: t.scanId })
    expect(r2).toMatchObject({ error: null, backfillComplete: true, stored: 250 })
    expect(missing(t.db, t.etsy)).toEqual([])
  })

  it('a shop deleted and added again during a run gets none of the stale run’s cursor', async () => {
    const db = memDb()
    seedShop(db, { id: SHOP_ID })
    const scanId = okScan(db)
    const etsy = new FakeEtsy(0)
    for (let i = 1; i <= 350; i++) etsy.reviews.push(mkEtsyReview(i))
    const clock = { s: reviewCreated(350) + 3600 }
    const base = etsy.client()
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let reached!: () => void
    const atGate = new Promise<void>((r) => (reached = r))
    const client: EtsyClient = {
      ...base,
      getShopReviews: async (id, q) => {
        if (++calls === 3) {
          reached()
          await gate
        }
        return base.getShopReviews(id, q)
      }
    }
    const syncer = createReviewSyncer({ db, client, now: () => clock.s * 1000 })
    const run = syncer.sync(SHOP_ID, { scanId })
    await atGate // two pages stored, the third request in flight
    deleteShop(db, SHOP_ID)
    seedShop(db, { id: SHOP_ID }) // same Etsy id, same added_at even
    const scan2 = okScan(db, 9000)
    release()
    const stale = await run
    expect(stale).toMatchObject({ running: false, error: 'Магазин видалено.' })
    expect(count(db)).toBe(0)
    expect(getReviewSync(db, SHOP_ID)).toBeNull()
    const fresh = await syncer.sync(SHOP_ID, { scanId: scan2 })
    expect(fresh).toMatchObject({ error: null, backfillComplete: true, stored: 350 })
  })

  it('a first run that never got an answer (403) leaves the shop "never synced"', async () => {
    const t = setup(10)
    t.etsy.reviewsStatus = 403
    const st = await t.syncer.sync(SHOP_ID, { scanId: t.scanId })
    expect(st.error).toMatch(/403/)
    expect(getReviewSync(t.db, SHOP_ID)).toMatchObject({ backfill_upper: null, backfill_complete: 0, last_error: st.error })
    expect(getListing(t.db, 1)).toMatchObject({ reviewCount: null, reviewAvg: null, reviewsPartial: false })
    expect(getShopSummary(t.db, SHOP_ID)!.reviews).toMatchObject({ synced: false, stored: 0, lastError: st.error })
    expect(listListingStats(t.db, 1)[0].reviewCount).toBeNull()
    // Fixed later: the first answered run starts the backfill then.
    t.etsy.reviewsStatus = null
    t.clock.s += 3600
    expect(await t.syncer.sync(SHOP_ID, { scanId: t.scanId })).toMatchObject({ error: null, stored: 10, backfillComplete: true })
    expect(getReviewSync(t.db, SHOP_ID)!.backfill_upper).toBe(t.clock.s)
    expect(getListing(t.db, 1)).toMatchObject({ reviewCount: 3, reviewsPartial: false })
    expect(getShopSummary(t.db, SHOP_ID)!.reviews!.synced).toBe(true)
  })
})

describe('runs per shop', () => {
  it('a request made while one runs is queued once and merged', async () => {
    // Hold the first response until we have queued more requests.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const etsy0 = new FakeEtsy(0)
    const { etsy, syncer } = setup(10, {
      client: etsy0.client({
        fetch: (async (...a: Parameters<typeof fetch>) => {
          await gate
          return etsy0.fetch(...a)
        }) as typeof fetch
      })
    })
    etsy0.reviews = etsy.reviews
    const a = syncer.sync(SHOP_ID)
    // Not started yet: merged into the same run.
    expect(syncer.sync(SHOP_ID)).toBe(a)
    await new Promise((r) => setTimeout(r, 0)) // run 1 has started
    expect(syncer.isRunning(SHOP_ID)).toBe(true)
    const b = syncer.sync(SHOP_ID)
    const c = syncer.sync(SHOP_ID)
    expect(b).toBe(c)
    expect(b).not.toBe(a)
    release()
    await Promise.all([a, b, c])
    // Run 1 = backfill (1 request), run 2 = incremental (1 request).
    expect(etsy0.count(REVIEWS_PATH)).toBe(2)
    expect(syncer.isRunning(SHOP_ID)).toBe(false)
    expect(syncer.state(SHOP_ID)).toMatchObject({ running: false, stored: 10 })
  })

  it('reports progress while running', async () => {
    const { states, syncer } = setup(250)
    await syncer.sync(SHOP_ID)
    expect(states[0]).toMatchObject({ running: true, stored: 0 })
    expect(states.filter((s) => s.running).map((s) => s.stored)).toEqual([0, 100, 200, 250])
    expect(states.at(-1)).toMatchObject({ running: false, phase: null })
  })
})

describe('listListingReviews', () => {
  it('pages a listing’s reviews newest first', async () => {
    const { db, syncer } = setup(90)
    await syncer.sync(SHOP_ID)
    const p1 = listListingReviews(db, 1, 0, 20)
    expect(p1.total).toBe(30) // n % 3 === 0
    expect(p1.reviews).toHaveLength(20)
    expect(p1.reviews[0].createdAt).toBe(reviewCreated(90))
    const p2 = listListingReviews(db, 1, 20, 20)
    expect(p2.reviews).toHaveLength(10)
    expect(p2.reviews.at(-1)!.createdAt).toBe(reviewCreated(3))
    expect(listListingReviews(db, 1, 0, 100000).reviews).toHaveLength(30)
  })
})
