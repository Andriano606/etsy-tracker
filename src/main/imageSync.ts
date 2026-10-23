// Copies listing images — and review photos (`reviews.image_url_fullxfull`,
// written by the review sync) — from Etsy's CDN into the image store (MinIO),
// outside of any scan transaction: a scan commits its DB rows first (new/replaced
// images land in listing_images as 'pending'), then this loop downloads and
// uploads them. A MinIO outage or a disabled store never touches a scan — the
// rows simply stay 'pending' and are picked up by the next run (after the next
// scan or the manual "Синхронізувати фото"). CDN downloads do not count against
// the Etsy API quota; we still keep it gentle (small concurrency, timeouts,
// a couple of retries).

import { createHash } from 'crypto'
import type { ImageSyncState } from '../shared/types'
import {
  type Db,
  type ImageRow,
  type ReviewImageRow,
  getImageRow,
  getReviewImageRow,
  listImagesToCleanup,
  listImagesToSync,
  listReviewImagesToCleanup,
  listReviewImagesToSync,
  listStoredImages,
  listStoredReviewImages,
  markImageError,
  markImageMissing,
  markImageObjectsDeleted,
  markImageStored,
  markReviewImageError,
  markReviewImageMissing,
  markReviewImageObjectDeleted,
  markReviewImageStored
} from './db'
import { isEtsyCdnUrl } from '../shared/externalUrl'
import {
  type ImageStore,
  ImageStoreError,
  describeStoreError,
  imageExt,
  imageObjectKey,
  reviewObjectKey
} from './imageStore'

export class DownloadError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'DownloadError'
  }
}

export interface Downloaded {
  body: Buffer
  contentType: string | null
}

export interface DownloadOptions {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  timeoutMs: number
  retries: number
  /** Refuse anything bigger (Etsy originals are a few MB). */
  maxBytes?: number
}

/** GET an image from the CDN with a timeout; 5xx/429/network/timeout errors are retried. */
export async function downloadImage(url: string, o: DownloadOptions): Promise<Downloaded> {
  const maxBytes = o.maxBytes ?? 50 * 1024 * 1024
  if (!isEtsyCdnUrl(url)) throw new DownloadError('Адреса зображення не на CDN Etsy (https://*.etsystatic.com)')
  let last = new DownloadError('не завантажено')
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    if (attempt > 0) await o.sleep(500 * 2 ** (attempt - 1))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs)
    try {
      const res = await o.fetch(url, { signal: ctrl.signal })
      if (!res.ok) {
        last = new DownloadError(`CDN Etsy відповів HTTP ${res.status}`, res.status)
        if (res.status === 429 || res.status >= 500) continue
        throw last // 404 etc.: retrying won't help
      }
      const contentType = res.headers.get('content-type')
      if (!contentType || !/^image\//i.test(contentType)) {
        throw new DownloadError(`CDN Etsy повернув не зображення (${contentType ?? 'без content-type'})`, res.status)
      }
      const body = Buffer.from(await res.arrayBuffer())
      if (body.length === 0) throw new DownloadError('CDN Etsy повернув порожній файл', res.status)
      if (body.length > maxBytes) throw new DownloadError(`Завеликий файл (${body.length} байт)`, res.status)
      return { body, contentType }
    } catch (e) {
      if (e instanceof DownloadError) throw e
      last = ctrl.signal.aborted
        ? new DownloadError(`CDN Etsy не відповідає (тайм-аут ${Math.round(o.timeoutMs / 1000)} с)`)
        : new DownloadError(`Немає з’єднання з CDN Etsy: ${(e as Error)?.message ?? e}`)
    } finally {
      clearTimeout(timer)
    }
  }
  throw last
}

export interface ImageSyncDeps {
  db: Db
  /** The store to use now; null = MinIO is switched off. May throw on a bad config. */
  getStore: () => Promise<ImageStore | null>
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Parallel downloads. Default 3. */
  concurrency?: number
  /** Per-download timeout. Default 30 s. */
  timeoutMs?: number
  /** Retries per download for 5xx/429/network. Default 2. */
  retries?: number
  /** 'error' rows are retried automatically until this many failures. Default 5. */
  maxAttempts?: number
  onState?: (s: ImageSyncState) => void
  /** Min gap between two progress events while running. Default 250 ms. */
  progressIntervalMs?: number
}

export interface ImageSyncRequest {
  /** null/undefined = every shop. */
  shopId?: number | null
  /** Also retry images that already failed `maxAttempts` times. */
  force?: boolean
}

export interface ImageSyncer {
  /** Run a sync (queued behind a running one; queued requests are merged). */
  sync(req?: ImageSyncRequest): Promise<ImageSyncState>
  state(): ImageSyncState
  /** Best-effort delete (shop removal). Never throws. */
  removeObjects(keys: string[]): Promise<void>
}

const idle = (): ImageSyncState => ({
  running: false,
  shopId: null,
  done: 0,
  total: 0,
  errors: 0,
  lastError: null,
  disabled: false
})

export function createImageSyncer(deps: ImageSyncDeps): ImageSyncer {
  const { db } = deps
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const concurrency = Math.max(1, deps.concurrency ?? 3)
  const dl: DownloadOptions = {
    fetch: doFetch,
    sleep,
    timeoutMs: deps.timeoutMs ?? 30_000,
    retries: deps.retries ?? 2
  }
  const maxAttempts = deps.maxAttempts ?? 5
  const interval = deps.progressIntervalMs ?? 250

  let current: ImageSyncState = idle()
  let lastEmit = 0
  const emit = (force = false): void => {
    const t = now()
    if (!force && t - lastEmit < interval) return
    lastEmit = t
    deps.onState?.({ ...current })
  }

  let chain: Promise<unknown> = Promise.resolve()
  let queued: ImageSyncRequest | null = null
  let queuedRun: Promise<ImageSyncState> | null = null

  async function storeOne(store: ImageStore, snapshot: ImageRow): Promise<void> {
    // The run works from a list taken when it started: the shop may have been
    // deleted, the image removed or already stored since. Re-read before work.
    const row = getImageRow(db, snapshot.listing_image_id, snapshot.listing_id)
    if (!row || row.removed_at != null || row.sync_status === 'stored') return
    const full = await downloadImage(row.url_fullxfull, dl)
    // The grid thumbnail is optional — but only a thumbnail that does not exist
    // (no URL, 404/410) is skipped; a transient failure fails the image so the
    // whole row is retried instead of staying 'stored' without a 570xN copy.
    let thumb: Downloaded | null = null
    if (row.url_570xN && isEtsyCdnUrl(row.url_570xN)) {
      try {
        thumb = await downloadImage(row.url_570xN, dl)
      } catch (e) {
        const status = e instanceof DownloadError ? e.status : undefined
        if (status !== 404 && status !== 410) throw e
        thumb = null
      }
    }
    const keyFull = imageObjectKey(row.shop_id, row.listing_id, row.listing_image_id, 'fullxfull', imageExt(full.contentType, row.url_fullxfull))
    const uploaded: string[] = []
    const { etag } = await store.put(keyFull, full.body, full.contentType)
    uploaded.push(keyFull)
    let key570: string | null = null
    if (thumb) {
      key570 = imageObjectKey(row.shop_id, row.listing_id, row.listing_image_id, '570xN', imageExt(thumb.contentType, row.url_570xN))
      await store.put(key570, thumb.body, thumb.contentType)
      uploaded.push(key570)
    }
    // A replaced URL with another extension leaves the old object behind — drop it.
    for (const old of [row.key_full, row.key_570]) {
      if (old && old !== keyFull && old !== key570) await store.remove(old)
    }
    const recorded = markImageStored(db, row, row.url_fullxfull, {
      keyFull,
      key570,
      byteSize: full.body.length,
      contentType: full.contentType,
      etag,
      sha256: createHash('sha256').update(full.body).digest('hex'),
      storedAt: now()
    })
    if (!recorded) {
      // Nothing points at what was just uploaded (the shop/listing was deleted
      // meanwhile, or a rescan replaced the URL): delete it rather than orphan it.
      const after = getImageRow(db, row.listing_image_id, row.listing_id)
      const referenced = new Set([after?.key_full, after?.key_570].filter(Boolean))
      for (const k of uploaded) if (!referenced.has(k)) await store.remove(k)
    }
  }

  /** A review photo (only fullxfull exists): same rules as a listing image. */
  async function storeReview(store: ImageStore, snapshot: ReviewImageRow): Promise<void> {
    const row = getReviewImageRow(db, snapshot.id)
    if (!row || !row.image_url_fullxfull || row.image_sync_status === 'stored') return
    const url = row.image_url_fullxfull
    const full = await downloadImage(url, dl)
    const key = reviewObjectKey(row.shop_id, row.review_key, imageExt(full.contentType, url))
    const { etag } = await store.put(key, full.body, full.contentType)
    if (row.image_key && row.image_key !== key) await store.remove(row.image_key)
    const recorded = markReviewImageStored(db, row.id, url, {
      key,
      byteSize: full.body.length,
      contentType: full.contentType,
      etag,
      sha256: createHash('sha256').update(full.body).digest('hex'),
      storedAt: now()
    })
    if (!recorded && getReviewImageRow(db, row.id)?.image_key !== key) await store.remove(key)
  }

  async function runOnce(req: ImageSyncRequest): Promise<ImageSyncState> {
    current = { ...idle(), running: true, shopId: req.shopId ?? null }
    emit(true)
    const finish = (patch: Partial<ImageSyncState>): ImageSyncState => {
      current = { ...current, ...patch, running: false }
      emit(true)
      return { ...current }
    }

    let store: ImageStore | null
    try {
      store = await deps.getStore()
    } catch (e) {
      return finish({ lastError: describeStoreError(e) })
    }
    if (!store) return finish({ disabled: true })
    try {
      await store.ensureBucket()
    } catch (e) {
      return finish({ lastError: describeStoreError(e) })
    }

    // Objects of images that left their listing.
    for (const row of listImagesToCleanup(db)) {
      try {
        for (const k of [row.key_full, row.key_570]) if (k) await store.remove(k)
        markImageObjectsDeleted(db, row, row.key_full, row.key_570)
      } catch (e) {
        return finish({ lastError: describeStoreError(e) })
      }
    }
    // Review photos the API no longer returns (the buyer's privacy settings):
    // keep only what Etsy still shows.
    for (const row of listReviewImagesToCleanup(db)) {
      try {
        await store.remove(row.image_key!)
        markReviewImageObjectDeleted(db, row.id, row.image_key!)
      } catch (e) {
        return finish({ lastError: describeStoreError(e) })
      }
    }

    // Manual sync: check that what the DB calls 'stored' is really in the
    // bucket (switched bucket, wiped volume, objects deleted by hand) and
    // queue the missing ones again.
    if (req.force) {
      try {
        for (const row of listStoredImages(db, req.shopId ?? null)) {
          for (const k of [row.key_full, row.key_570]) {
            if (!k || !(await store.stat(k))) {
              markImageMissing(db, row)
              break
            }
          }
        }
        for (const row of listStoredReviewImages(db, req.shopId ?? null)) {
          if (!row.image_key || !(await store.stat(row.image_key))) markReviewImageMissing(db, row.id)
        }
      } catch (e) {
        return finish({ lastError: describeStoreError(e) })
      }
    }

    const scope = { shopId: req.shopId ?? null, maxAttempts: req.force ? null : maxAttempts }
    type Task = { kind: 'listing'; row: ImageRow } | { kind: 'review'; row: ReviewImageRow }
    const rows: Task[] = [
      ...listImagesToSync(db, scope).map((row): Task => ({ kind: 'listing', row })),
      ...listReviewImagesToSync(db, scope).map((row): Task => ({ kind: 'review', row }))
    ]
    current.total = rows.length
    emit(true)

    let next = 0
    let storeFailure: string | null = null
    const worker = async (): Promise<void> => {
      while (next < rows.length && storeFailure == null) {
        const task = rows[next++]
        try {
          if (task.kind === 'listing') await storeOne(store!, task.row)
          else await storeReview(store!, task.row)
        } catch (e) {
          if (e instanceof ImageStoreError) {
            // MinIO itself is failing: stop, leave the rest pending for next time.
            storeFailure = e.message
            return
          }
          const msg = (e as Error)?.message ?? String(e)
          if (task.kind === 'listing') markImageError(db, task.row, task.row.url_fullxfull, msg)
          else markReviewImageError(db, task.row.id, task.row.image_url_fullxfull ?? '', msg)
          current.errors++
        }
        current.done++
        emit()
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker))
    return finish({ lastError: storeFailure })
  }

  function sync(req: ImageSyncRequest = {}): Promise<ImageSyncState> {
    if (queued && queuedRun) {
      // Merge into the run that has not started yet.
      if ((queued.shopId ?? null) !== (req.shopId ?? null)) queued.shopId = null
      queued.force = !!(queued.force || req.force)
      return queuedRun
    }
    queued = { shopId: req.shopId ?? null, force: !!req.force }
    const run = chain.then(() => {
      const r = queued!
      queued = null
      queuedRun = null
      return runOnce(r)
    })
    queuedRun = run
    chain = run.catch(() => undefined)
    return run
  }

  return {
    sync,
    state: () => ({ ...current }),
    async removeObjects(keys) {
      if (!keys.length) return
      try {
        const store = await deps.getStore()
        if (!store) return
        for (const k of keys) await store.remove(k)
      } catch {
        // Orphans in the bucket are harmless; the shop is gone from the DB anyway.
      }
    }
  }
}
