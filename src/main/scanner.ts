// Scan one shop: read every active listing from Etsy, fetch details (views,
// images, videos, personalization) for all of them, diff against the stored
// snapshot and write it all in ONE transaction. All Etsy API I/O happens before
// the transaction, so a failure anywhere (network, 429 exhaustion, API error
// mid-pagination) leaves the stored listings untouched — only the scan row is
// marked 'error'. Copying images to MinIO is NOT part of a scan: it runs after
// the commit (imageSync.ts) and can never fail or roll back a scan.

import type { Listing, ScanOutcome, ScanProgress, ShopStats, TrackedFields } from '../shared/types'
import {
  type Db,
  type ListingInput,
  type ShopInput,
  continuePromotion,
  endPromotion,
  failStaleRunningScans,
  finishScanError,
  finishScanOk,
  getScan,
  getListingViews,
  getOpenPromotion,
  getShop,
  hasOkScan,
  insertChange,
  insertListingPriceStats,
  insertListingStats,
  insertRunningScan,
  insertShopStats,
  listAllListings,
  markListingRemoved,
  startPromotion,
  transaction,
  updateShopInfo,
  upsertListing
} from './db'
import { EtsyApiError, type EtsyClient } from './etsyApi'
import { type BuyerPriceRequest, listingStats, mapListing, mapShop, shopStats } from './mapEtsy'
import { countsAsEnd, countsAsStart, promotionStep } from './promotions'

export interface ChangedListing {
  listing: ListingInput
  old: TrackedFields
  new: TrackedFields
}

export interface DiffResult {
  /** Never seen before. */
  added: ListingInput[]
  /** Stored as removed, active again. */
  returned: ListingInput[]
  /** Active before and now, with different content (see `trackedDiff`). */
  changed: ChangedListing[]
  /** Active before, not active now (empty when removal detection is off). */
  removed: Listing[]
}

/** Longest description kept in a change row (old and new each). */
export const DESCRIPTION_EXCERPT = 1000

export function excerpt(text: string, max = DESCRIPTION_EXCERPT): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

const sorted = (a: readonly string[]): string[] => [...a].sort()
const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** Weight + dimensions + units as one comparable string; null when none is set. */
export function dimensionsOf(d: Listing['details']): string | null {
  if (!d) return null
  const dims = [d.itemLength, d.itemWidth, d.itemHeight]
  const parts: string[] = []
  if (d.itemWeight != null) parts.push(`${d.itemWeight} ${d.itemWeightUnit ?? ''}`.trim())
  if (dims.some((x) => x != null)) {
    parts.push(`${dims.map((x) => x ?? '?').join('×')} ${d.itemDimensionsUnit ?? ''}`.trim())
  }
  return parts.length ? parts.join(', ') : null
}

/**
 * Content differences between the stored and the fresh listing; null if none.
 *
 * Always compared: title, price (by value), description, tags (as a set).
 * Images (listing_image_ids in rank order): when this scan fetched them and
 * the stored row had them. The other content fields (materials, styles,
 * who/when made, category, section, type, processing time, personalization
 * flags/questions, variations, weight/dimensions, videos) only when the stored
 * row was already written with schema v2 (`details` present) — a v1 row has
 * none of them, so the first v2 rescan must not flag every listing.
 * Never a change: views, favorers, featured rank (popularity) and quantity
 * (stock) — those are recorded per scan in listing_stats.
 */
export function trackedDiff(
  prev: Listing,
  next: ListingInput
): { old: TrackedFields; new: TrackedFields } | null {
  const o: TrackedFields = {}
  const n: TrackedFields = {}
  const set = <K extends keyof TrackedFields>(k: K, a: TrackedFields[K], b: TrackedFields[K]): void => {
    o[k] = a
    n[k] = b
  }
  if (prev.title !== next.title) set('title', prev.title, next.title)
  const priceChanged =
    prev.priceAmount * next.priceDivisor !== next.priceAmount * prev.priceDivisor ||
    prev.currency !== next.currency
  if (priceChanged) {
    o.priceAmount = prev.priceAmount
    o.priceDivisor = prev.priceDivisor
    o.currency = prev.currency
    n.priceAmount = next.priceAmount
    n.priceDivisor = next.priceDivisor
    n.currency = next.currency
  }
  if (prev.description !== next.description) {
    set('description', excerpt(prev.description), excerpt(next.description))
  }
  if (!sameList(sorted(prev.tags), sorted(next.tags))) set('tags', prev.tags, next.tags)

  const pd = prev.details ?? null
  if (next.images && (pd || prev.images.length > 0)) {
    const a = prev.images.map((i) => i.id)
    const b = next.images.map((i) => i.id)
    if (!sameList(a, b)) set('images', a, b)
  }

  const nd = next.details ?? null
  if (pd && nd) {
    if (!sameList(sorted(pd.materials), sorted(nd.materials))) set('materials', pd.materials, nd.materials)
    if (!sameList(sorted(pd.styles), sorted(nd.styles))) set('styles', pd.styles, nd.styles)
    const scalars = [
      'whoMade',
      'whenMade',
      'taxonomyId',
      'shopSectionId',
      'listingType',
      'isPersonalizable',
      'isCustomizable',
      'hasVariations'
    ] as const
    for (const k of scalars) {
      if ((pd[k] ?? null) !== (nd[k] ?? null)) set(k, pd[k] as never, nd[k] as never)
    }
    if (pd.processingMin !== nd.processingMin || pd.processingMax !== nd.processingMax) {
      set('processingMin', pd.processingMin, nd.processingMin)
      set('processingMax', pd.processingMax, nd.processingMax)
    }
    const da = dimensionsOf(pd)
    const db = dimensionsOf(nd)
    if (da !== db) set('dimensions', da, db)
    // Stored null is ambiguous (not fetched vs. none) — compare only a known
    // previous value against a fresh details answer.
    const pa = pd.personalization
    const personalizationFetched = next.personalizationFetched ?? next.detailsFetched
    if (personalizationFetched && pa != null && JSON.stringify(pa) !== JSON.stringify(nd.personalization ?? null)) {
      set('personalization', pa, nd.personalization ?? null)
    }
    if (next.videos && prev.videos) {
      const va = prev.videos.map((v) => v.id).sort((x, y) => x - y)
      const vb = next.videos.map((v) => v.id).sort((x, y) => x - y)
      if (!sameList(va, vb)) set('videos', va, vb)
    }
  }
  return Object.keys(n).length ? { old: o, new: n } : null
}

export function diffListings(
  prev: Listing[],
  current: ListingInput[],
  opts: { detectRemoved: boolean }
): DiffResult {
  const byId = new Map(prev.map((l) => [l.listingId, l]))
  const currentIds = new Set(current.map((l) => l.listingId))
  const out: DiffResult = { added: [], returned: [], changed: [], removed: [] }
  for (const l of current) {
    const p = byId.get(l.listingId)
    if (!p) out.added.push(l)
    else if (p.removedAt != null) out.returned.push(l)
    else {
      const d = trackedDiff(p, l)
      if (d) out.changed.push({ listing: l, ...d })
    }
  }
  if (opts.detectRemoved) {
    for (const p of prev) {
      if (p.removedAt == null && !currentIds.has(p.listingId)) out.removed.push(p)
    }
  }
  return out
}

export interface ApplyScanInput {
  shopId: number
  scanId: number
  current: ListingInput[]
  diff: DiffResult
  isBaseline: boolean
  truncated: boolean
  now: number
  /** Fresh Etsy-side shop fields, written in the same transaction. */
  shopInfo?: Omit<ShopInput, 'addedAt'>
  /** Shop popularity of this scan → shop_stats. */
  shopStats?: ShopStats
  /** The stored listings before this scan (their buyer prices are the previous observation). */
  prev?: Listing[]
  /** Buyer country the scan asked prices for (null = none) and whether Etsy served them. */
  buyerCountry?: string | null
  buyerPrices?: 'ok' | 'unavailable' | null
}

/**
 * Promotions per listing whose buyer price this scan learned (see
 * `promotionStep`); returns how many started / ended. Runs before the
 * upserts: it compares with the stored (previous) buyer price. A returned
 * listing counts as new (its stored price is from before it vanished), and a
 * removed listing's running promotion ends as 'removed' (not reported).
 */
export function applyPromotions(
  db: Db,
  a: Pick<ApplyScanInput, 'shopId' | 'scanId' | 'current' | 'prev' | 'diff' | 'now'>
): { started: number; ended: number } {
  const before = new Map((a.prev ?? []).map((p) => [p.listingId, p]))
  const added = new Set([...a.diff.added, ...a.diff.returned].map((l) => l.listingId))
  let started = 0
  let ended = 0
  for (const l of a.current) {
    const bp = l.buyerPrice
    if (!bp) continue
    const open = getOpenPromotion(db, l.listingId)
    const step = promotionStep(open, before.get(l.listingId)?.buyerPrice ?? null, bp, {
      isNew: added.has(l.listingId)
    })
    if (open && step.continue) continuePromotion(db, open.id, bp, a.scanId, a.now)
    if (open && step.end) endPromotion(db, open.id, step.end, a.scanId, a.now)
    if (step.start) startPromotion(db, a.shopId, l.listingId, bp, step.start, a.scanId, a.now)
    if (countsAsStart(step)) started++
    if (countsAsEnd(step)) ended++
  }
  for (const r of a.diff.removed) {
    const open = getOpenPromotion(db, r.listingId)
    if (open) endPromotion(db, open.id, 'removed', a.scanId, a.now)
  }
  return { started, ended }
}

/**
 * Write a finished scan atomically: shop info, upserts (with images/videos),
 * removals, change rows, listing_stats/shop_stats (baseline included) and the
 * scan totals.
 */
export function applyScan(db: Db, a: ApplyScanInput): void {
  transaction(db, () => {
    if (a.shopInfo) updateShopInfo(db, a.shopInfo, a.now)
    const promos = applyPromotions(db, a)
    for (const l of a.current) upsertListing(db, l, a.now)
    for (const r of a.diff.removed) markListingRemoved(db, r.listingId, a.now)
    if (!a.isBaseline) {
      for (const l of a.diff.added) insertChange(db, a.scanId, l.listingId, 'added', null, null)
      for (const l of a.diff.returned) {
        insertChange(db, a.scanId, l.listingId, 'returned', null, null)
      }
      for (const c of a.diff.changed) {
        insertChange(db, a.scanId, c.listing.listingId, 'changed', c.old, c.new)
      }
      for (const r of a.diff.removed) {
        insertChange(db, a.scanId, r.listingId, 'removed', null, null)
      }
    }
    // Views unknown this scan (no details answer, or a distrusted 0): the
    // listing row kept its last value — carry it so the history stays continuous.
    insertListingStats(
      db,
      a.scanId,
      a.current.map((l) => {
        const s = listingStats(l)
        return s.views == null ? { ...s, views: getListingViews(db, l.listingId) } : s
      })
    )
    // Seller + buyer price per scan: the price/promotion history (buyer price
    // NULL = this scan didn't learn it; never a content "change").
    insertListingPriceStats(
      db,
      a.scanId,
      a.current.map((l) => ({
        listingId: l.listingId,
        priceAmount: l.priceAmount,
        priceDivisor: l.priceDivisor,
        currency: l.currency,
        buyerPrice: l.buyerPrice ?? null
      }))
    )
    if (a.shopStats) insertShopStats(db, a.scanId, a.shopId, a.shopStats)
    finishScanOk(db, a.scanId, a.now, {
      buyerCountry: a.buyerCountry ?? null,
      buyerPrices: a.buyerPrices ?? null,
      promotionsStarted: promos.started,
      promotionsEnded: promos.ended,
      isBaseline: a.isBaseline,
      truncated: a.truncated,
      total: a.current.length,
      added: a.isBaseline ? 0 : a.diff.added.length,
      removed: a.isBaseline ? 0 : a.diff.removed.length,
      changed: a.isBaseline ? 0 : a.diff.changed.length,
      returned: a.isBaseline ? 0 : a.diff.returned.length
    })
  })
}

/**
 * Etsy's `views` is a lifetime count tabulated once a day; the OAS says a 0
 * may also mean "not yet tabulated, not active during the last tabulation or
 * an error fetching the value". A 0 for a listing that already had views is
 * therefore treated as unknown (null → the stored value is kept, no negative
 * delta, no bogus listing_stats point).
 */
export function distrustZeroViews(prev: Listing[], current: ListingInput[]): void {
  const before = new Map(prev.map((p) => [p.listingId, p.views]))
  for (const l of current) {
    if (l.views === 0 && (before.get(l.listingId) ?? 0) > 0) l.views = null
  }
}

export interface ScannerDeps {
  db: Db
  client: EtsyClient
  now?: () => number
  onProgress?: (p: ScanProgress) => void
  /**
   * The buyer country to ask Etsy's buyer-facing prices for (Settings →
   * "Країна покупця"), read once at the start of every scan's details;
   * null/absent = no buyer prices.
   */
  getBuyerCountry?: () => string | null
}

export interface Scanner {
  scanShop(shopId: number): Promise<ScanOutcome>
  isScanning(shopId: number): boolean
}

export function scanErrorMessage(e: unknown): string {
  if (e instanceof EtsyApiError) return e.message
  const msg = e instanceof Error ? e.message : String(e)
  return `Помилка сканування: ${msg}`
}

export function createScanner(deps: ScannerDeps): Scanner {
  const { db, client } = deps
  const now = deps.now ?? Date.now
  const running = new Set<number>()
  failStaleRunningScans(db, now())

  const progress = (p: ScanProgress): void => deps.onProgress?.(p)

  async function run(shopId: number, scanId: number): Promise<ScanOutcome> {
    const shop = getShop(db, shopId)
    if (!shop) throw new Error('магазин не знайдено в базі')

    // Fresh shop info first — also turns a deleted/renamed shop into a clean 404.
    const etsyShop = await client.getShop(shopId)
    const currency = etsyShop.currency_code ?? shop.currency

    progress({ shopId, phase: 'pages', done: 0, total: 1, label: 'Сторінка 1…' })
    const active = await client.getAllActiveListings(shopId, (page, pages) =>
      progress({ shopId, phase: 'pages', done: page, total: pages, label: `Сторінка ${page}/${pages}` })
    )

    const prev = listAllListings(db, shopId)

    // Details for EVERY active listing: views exist only in the
    // with-associations schema, and images/videos/personalization come from
    // here too — ≈1 request per 100 listings on every scan.
    const ids = active.listings.map((l) => l.listing_id)
    if (ids.length) {
      progress({ shopId, phase: 'details', done: 0, total: ids.length, label: `Деталі 0/${ids.length}` })
    }
    // One buyer country for the whole scan, even if Settings change meanwhile.
    const buyerCountry = deps.getBuyerCountry?.() ?? null
    const detailOpts = { buyerCountry }
    const details = await client.getListingsByIds(
      ids,
      (done, total) => progress({ shopId, phase: 'details', done, total, label: `Деталі ${done}/${total}` }),
      detailOpts
    )

    // A listing deleted between paging and the details call (404) is still
    // saved from its page data, keeping its stored images/views.
    const includes = client.detailIncludes()
    const buyer = (): BuyerPriceRequest => ({
      country: buyerCountry,
      asked: !!buyerCountry && !client.buyerPriceRefused(buyerCountry),
      at: now()
    })
    // 'ok' only when some details answer actually carried `buyer_price`: Etsy
    // might accept includes=BuyerPrice and still leave it out, or no batch
    // answered (every chunk went through single GETs, which the OAS says never
    // carry it). Such a scan learned no buyer price at all → 'unavailable'
    // (the per-listing rule still keeps the stored prices: unknown ≠ none).
    const learned = [...details.values()].some((d) => d.buyer_price !== undefined && 'buyer_price' in d)
    const buyerPricesOk = !!buyerCountry && !client.buyerPriceRefused(buyerCountry) && (learned || ids.length === 0)
    const req = buyer()
    const current = active.listings.map((l) =>
      mapListing(l, details.get(l.listing_id) ?? null, currency, includes, req)
    )

    const currentIds = new Set(current.map((l) => l.listingId))
    const missing = active.truncated
      ? []
      : prev.filter((p) => p.removedAt == null && !currentIds.has(p.listingId)).map((p) => p.listingId)
    if (missing.length) {
      progress({ shopId, phase: 'verify', done: 0, total: missing.length, label: `Перевірка зниклих 0/${missing.length}` })
      const still = await client.getListingsByIds(
        missing,
        (done, total) =>
          progress({ shopId, phase: 'verify', done, total, label: `Перевірка зниклих ${done}/${total}` }),
        detailOpts
      )
      for (const v of still.values()) {
        if (v.state === 'active' && Number(v.shop_id) === shopId) {
          current.push(mapListing(v, v, currency, client.detailIncludes(), buyer()))
        }
      }
    }

    distrustZeroViews(prev, current)

    progress({ shopId, phase: 'saving', done: 0, total: 1, label: 'Збереження…' })
    const isBaseline = !hasOkScan(db, shopId)
    const diff = diffListings(prev, current, { detectRemoved: !active.truncated })
    const at = now()
    applyScan(db, {
      shopInfo: { ...mapShop(etsyShop, shop.addedAt), id: shopId },
      shopStats: shopStats(etsyShop),
      shopId,
      scanId,
      current,
      diff,
      isBaseline,
      truncated: active.truncated,
      now: at,
      prev,
      buyerCountry,
      buyerPrices: buyerCountry ? (buyerPricesOk ? 'ok' : 'unavailable') : null
    })
    const scan = getScan(db, scanId)
    if (!scan) throw new Error('scan row vanished')
    return { ok: true, shopId, scan }
  }

  return {
    isScanning: (shopId) => running.has(shopId),

    async scanShop(shopId) {
      if (running.has(shopId)) {
        return { ok: false, shopId, busy: true, error: 'Цей магазин уже сканується.' }
      }
      if (!getShop(db, shopId)) {
        return { ok: false, shopId, error: 'Магазин не знайдено.' }
      }
      running.add(shopId)
      const scanId = insertRunningScan(db, shopId, now())
      try {
        return await run(shopId, scanId)
      } catch (e) {
        const error = scanErrorMessage(e)
        try {
          finishScanError(db, scanId, now(), error)
        } catch {
          // The shop (and its scan row) may be gone — nothing left to record.
        }
        return { ok: false, shopId, error }
      } finally {
        running.delete(shopId)
      }
    }
  }
}
