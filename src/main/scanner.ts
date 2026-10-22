// Scan one shop: read every active listing from Etsy, fetch details (images) for
// what is new or modified, diff against the stored snapshot and write it all in
// ONE transaction. All network I/O happens before the transaction, so a failure
// anywhere (network, 429 exhaustion, API error mid-pagination) leaves the stored
// listings untouched — only the scan row is marked 'error'.

import type { Listing, ScanOutcome, ScanProgress, Shop, TrackedFields } from '../shared/types'
import {
  type Db,
  type ListingInput,
  failStaleRunningScans,
  finishScanError,
  finishScanOk,
  getScan,
  getShop,
  hasOkScan,
  insertChange,
  insertRunningScan,
  listAllListings,
  markListingRemoved,
  transaction,
  updateShopInfo,
  upsertListing
} from './db'
import { EtsyApiError, type EtsyClient } from './etsyApi'
import { mapListing, mapShop } from './mapEtsy'

// ----------------------------------------------------------------- pure diff

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
  /** Active before and now, with a different title or price. */
  changed: ChangedListing[]
  /** Active before, not active now (empty when removal detection is off). */
  removed: Listing[]
}

/** Title/price differences between the stored and the fresh listing; null if none. */
export function trackedDiff(
  prev: Listing,
  next: ListingInput
): { old: TrackedFields; new: TrackedFields } | null {
  const o: TrackedFields = {}
  const n: TrackedFields = {}
  if (prev.title !== next.title) {
    o.title = prev.title
    n.title = next.title
  }
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

// --------------------------------------------------------------- apply (tx)

export interface ApplyScanInput {
  shopId: number
  scanId: number
  current: ListingInput[]
  diff: DiffResult
  isBaseline: boolean
  truncated: boolean
  now: number
  /** Fresh Etsy-side shop fields, written in the same transaction. */
  shopInfo?: Omit<Shop, 'addedAt'>
}

/** Write a finished scan: upserts, removals, change rows and the scan totals — atomically. */
export function applyScan(db: Db, a: ApplyScanInput): void {
  transaction(db, () => {
    if (a.shopInfo) updateShopInfo(db, a.shopInfo)
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
    finishScanOk(db, a.scanId, a.now, {
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

// ------------------------------------------------------------------- scanner

export interface ScannerDeps {
  db: Db
  client: EtsyClient
  now?: () => number
  onProgress?: (p: ScanProgress) => void
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
    const prevById = new Map(prev.map((l) => [l.listingId, l]))

    // Details (images) only for what is new, returning, modified, or image-less.
    // A listing deleted since paging is just absent from `details` (kept with
    // its stored images, or none) — getListingsByIds tolerates batch 404s.
    const needDetails = active.listings
      .filter((l) => {
        const p = prevById.get(l.listing_id)
        if (!p || p.removedAt != null || p.images.length === 0) return true
        const updated = l.updated_timestamp ?? l.last_modified_timestamp ?? null
        return updated !== p.etsyUpdatedAt
      })
      .map((l) => l.listing_id)
    if (needDetails.length) {
      progress({ shopId, phase: 'details', done: 0, total: needDetails.length, label: `Деталі 0/${needDetails.length}` })
    }
    const details = await client.getListingsByIds(needDetails, (done, total) =>
      progress({ shopId, phase: 'details', done, total, label: `Деталі ${done}/${total}` })
    )

    const current = active.listings.map((l) => {
      const d = details.get(l.listing_id)
      return mapListing(l, d ? (d.images ?? []) : null, currency)
    })

    // Listings that look gone may only have shifted between pages while we read.
    // Re-check them through the batch endpoint before calling them removed. Ids
    // Etsy answers 404 for (deleted) are absent from the result → removed.
    const currentIds = new Set(current.map((l) => l.listingId))
    const missing = active.truncated
      ? []
      : prev.filter((p) => p.removedAt == null && !currentIds.has(p.listingId)).map((p) => p.listingId)
    if (missing.length) {
      progress({ shopId, phase: 'verify', done: 0, total: missing.length, label: `Перевірка зниклих 0/${missing.length}` })
      const still = await client.getListingsByIds(missing, (done, total) =>
        progress({ shopId, phase: 'verify', done, total, label: `Перевірка зниклих ${done}/${total}` })
      )
      for (const v of still.values()) {
        if (v.state === 'active' && Number(v.shop_id) === shopId) {
          current.push(mapListing(v, v.images ?? [], currency))
        }
      }
    }

    progress({ shopId, phase: 'saving', done: 0, total: 1, label: 'Збереження…' })
    const isBaseline = !hasOkScan(db, shopId)
    const diff = diffListings(prev, current, { detectRemoved: !active.truncated })
    const at = now()
    applyScan(db, {
      shopInfo: { ...mapShop(etsyShop, shop.addedAt), id: shopId },
      shopId,
      scanId,
      current,
      diff,
      isBaseline,
      truncated: active.truncated,
      now: at
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
