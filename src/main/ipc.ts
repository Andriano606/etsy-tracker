// Wires the pure per-concern modules (db, settings, etsyApi, scanner, shops) to
// IPC channels. All Etsy traffic happens here in main — never in the renderer.

import { ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import type {
  ImageCounts,
  ImageSyncState,
  KeyStatus,
  KeyTestResult,
  MinioSettingsInput,
  MinioStatus,
  MinioTestResult,
  Quota,
  Review,
  ReviewPage,
  ReviewSyncState,
  ScanOutcome,
  ShopStatsPayload
} from '../shared/types'
import { isAllowedExternalUrl } from '../shared/externalUrl'
import {
  type Db,
  deleteShop,
  getListing,
  getListingRaw,
  imageCounts,
  listActiveListings,
  listListingReviews,
  listListingStats,
  listNewReviews,
  listScanChanges,
  listScans,
  listShopObjectKeys,
  listShopSummaries,
  resetStoredImages
} from './db'
import { EtsyApiError, type EtsyClient } from './etsyApi'
import { type ImageStore, describeStoreError } from './imageStore'
import type { ImageSyncer } from './imageSync'
import type { ReviewSyncer } from './reviewSync'
import type { Scanner } from './scanner'
import {
  type KeyStore,
  type MinioConfig,
  type MinioSettingsStore,
  MINIO_DEFAULTS,
  composeApiKey,
  normalizeMinioEndpoint,
  validateBucketName
} from './settings'
import { parseStatsRange, shopStatsPayload } from './shopStats'
import { addShop } from './shops'

export interface IpcContext {
  db: Db
  keyStore: KeyStore
  client: EtsyClient
  scanner: Scanner
  getQuota: () => Quota | null
  getWindow: () => WebContents | null
  /** MinIO settings (secret stays in main). */
  minio: MinioSettingsStore
  /** The background image copier (Etsy CDN → MinIO). */
  images: ImageSyncer
  /** Build a store for a config — used by "Перевірити з'єднання". */
  makeStore: (cfg: MinioConfig) => Promise<ImageStore>
  /** MinIO settings were saved: drop the cached store. */
  onMinioChanged: () => void
  /** The background review sync (GET /shops/{id}/reviews), after scans or on demand. */
  reviews: ReviewSyncer
}

export interface ImageStatus {
  counts: ImageCounts
  sync: ImageSyncState
}

export function sendToRenderer(ctx: IpcContext, channel: string, payload: unknown): void {
  const wc = ctx.getWindow()
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

export function notifyShopsChanged(ctx: IpcContext): void {
  sendToRenderer(ctx, 'shops:changed', listShopSummaries(ctx.db))
}

/** Ping Etsy with the given (unsaved) key, or the stored one. */
export async function testKey(
  ctx: Pick<IpcContext, 'client' | 'keyStore'>,
  keystring?: string,
  sharedSecret?: string
): Promise<KeyTestResult> {
  let key: string | undefined
  try {
    if (keystring || sharedSecret) key = composeApiKey(keystring ?? '', sharedSecret ?? '')
    else if (!ctx.keyStore.getKey()) return { ok: false, message: 'Ключ не збережено.' }
    const pong = await ctx.client.ping(key)
    return {
      ok: true,
      message: `Ключ працює (application_id ${pong.application_id}).`,
      applicationId: pong.application_id
    }
  } catch (e) {
    return { ok: false, message: e instanceof EtsyApiError || e instanceof Error ? e.message : String(e) }
  }
}

export async function scanAll(ctx: IpcContext): Promise<ScanOutcome[]> {
  const out: ScanOutcome[] = []
  for (const s of listShopSummaries(ctx.db)) {
    sendToRenderer(ctx, 'scan:state', { shopId: s.id, running: true })
    out.push(await ctx.scanner.scanShop(s.id))
    sendToRenderer(ctx, 'scan:state', { shopId: s.id, running: false })
    notifyShopsChanged(ctx)
    const last = out[out.length - 1]
    if (last.ok) {
      startImageSync(ctx, s.id)
      startReviewSync(ctx, s.id, last.scan.id)
    }
    // A bad key fails every shop the same way — stop instead of repeating it.
    if (!last.ok && /API-ключ/.test(last.error)) break
  }
  return out
}

/**
 * After a successful scan: copy its new/changed images to MinIO in the
 * background. Never awaited by the scan and never able to fail it.
 */
export function startImageSync(ctx: Pick<IpcContext, 'images'>, shopId: number | null, force = false): void {
  ctx.images?.sync({ shopId, force }).catch(() => undefined)
}

/**
 * After a successful scan (or on "Синхронізувати відгуки"): sync the shop's
 * reviews in the background. Never awaited by the scan and never able to fail it.
 */
export function startReviewSync(ctx: Pick<IpcContext, 'reviews'>, shopId: number, scanId?: number | null): void {
  ctx.reviews?.sync(shopId, { scanId: scanId ?? null }).catch(() => undefined)
}

/** An id from the renderer as a positive safe integer, else null (the handler answers "nothing"). */
export function positiveId(v: unknown): number | null {
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** A review sync run finished: copy its photos, refresh the renderer's shop list. */
export function onReviewSyncDone(ctx: IpcContext, s: ReviewSyncState): void {
  startImageSync(ctx, s.shopId)
  notifyShopsChanged(ctx)
}

/** Typed (unsaved) settings over the stored ones; throws a Ukrainian message on bad input. */
export function mergeMinioConfig(stored: MinioConfig | null, input: MinioSettingsInput = {}): MinioConfig {
  const secretKey = input.secretKey?.trim() || stored?.secretKey
  if (!secretKey) {
    throw new Error('Збережений Secret key не вдалося розшифрувати — введіть його ще раз.')
  }
  return {
    enabled: input.enabled ?? stored?.enabled ?? true,
    endpoint: normalizeMinioEndpoint(input.endpoint ?? stored?.endpoint ?? MINIO_DEFAULTS.endpoint),
    accessKey: input.accessKey?.trim() || stored?.accessKey || MINIO_DEFAULTS.accessKey,
    secretKey,
    bucket: validateBucketName(input.bucket ?? stored?.bucket ?? MINIO_DEFAULTS.bucket)
  }
}

/** Connect with the given (or stored) settings: signed request + bucket creation. */
export async function testMinio(
  ctx: Pick<IpcContext, 'minio' | 'makeStore'>,
  input?: MinioSettingsInput
): Promise<MinioTestResult> {
  try {
    const cfg = mergeMinioConfig(ctx.minio.getConfig(), input)
    const store = await ctx.makeStore(cfg)
    await store.ping()
    await store.ensureBucket()
    return { ok: true, message: `З’єднання є: ${cfg.endpoint}, бакет «${cfg.bucket}» готовий.` }
  } catch (e) {
    return { ok: false, message: describeStoreError(e) }
  }
}

export function registerIpc(ctx: IpcContext): void {
  const { db, keyStore, client, scanner } = ctx

  ipcMain.handle('key:status', (): KeyStatus => keyStore.status())
  ipcMain.handle(
    'key:set',
    (_e, keystring: string, sharedSecret: string): { ok: true; status: KeyStatus } | { ok: false; error: string } => {
      try {
        return { ok: true, status: keyStore.setKey(keystring, sharedSecret) }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )
  ipcMain.handle('key:clear', (): KeyStatus => keyStore.clear())
  ipcMain.handle('key:test', (_e, keystring?: string, sharedSecret?: string) =>
    testKey(ctx, keystring, sharedSecret)
  )

  ipcMain.handle('shops:list', () => listShopSummaries(db))
  ipcMain.handle('shop:add', async (_e, input: string) => {
    const res = await addShop(db, client, String(input ?? ''))
    if (res.ok) notifyShopsChanged(ctx)
    return res
  })
  ipcMain.handle('shop:remove', (_e, shopId: number): { ok: boolean; error?: string } => {
    if (scanner.isScanning(shopId)) {
      return { ok: false, error: 'Зачекайте, доки сканування цього магазину завершиться.' }
    }
    const keys = listShopObjectKeys(db, shopId)
    deleteShop(db, shopId)
    void ctx.images.removeObjects(keys)
    notifyShopsChanged(ctx)
    return { ok: true }
  })

  ipcMain.handle('listings:list', (_e, shopId: number) => listActiveListings(db, shopId))
  ipcMain.handle('listing:get', (_e, listingId: number) => getListing(db, listingId))
  ipcMain.handle('listing:raw', (_e, listingId: number) => getListingRaw(db, listingId))
  ipcMain.handle('listing:stats', (_e, listingId: number) => listListingStats(db, listingId))
  ipcMain.handle('scans:list', (_e, shopId: number) => listScans(db, shopId))
  ipcMain.handle('reviews:listing', (_e, listingId: number, offset?: number, limit?: number): ReviewPage => {
    const id = positiveId(listingId)
    if (id == null) return { total: 0, offset: 0, reviews: [] }
    return listListingReviews(db, id, Number(offset ?? 0), Number(limit ?? 20))
  })
  ipcMain.handle('reviews:new', (_e, scanId: number): Review[] => {
    const id = positiveId(scanId)
    return id == null ? [] : listNewReviews(db, id)
  })
  // Starts (or queues) a run and returns nothing: `reviews:progress` is the
  // only source of the live state — a state returned here would be the
  // previous run's (the new one starts a microtask later) and could overwrite
  // the new run's first "running" event in the renderer.
  ipcMain.handle('reviews:sync', (_e, shopId: number): void => {
    const id = positiveId(shopId)
    if (id != null) startReviewSync(ctx, id)
  })
  ipcMain.handle('scan:changes', (_e, scanId: number) => listScanChanges(db, scanId))
  // The Statistics view: one compact, chart-ready payload per shop and period.
  // A bad shop id answers null; an unknown range is "Усе".
  ipcMain.handle('stats:shop', (_e, input: unknown): ShopStatsPayload | null => {
    const o = (input && typeof input === 'object' ? input : {}) as { shopId?: unknown; range?: unknown }
    const id = positiveId(o.shopId)
    if (id == null) return null
    return shopStatsPayload(db, id, parseStatsRange(o.range), Date.now())
  })

  ipcMain.handle('scan:shop', async (_e, shopId: number) => {
    sendToRenderer(ctx, 'scan:state', { shopId, running: true })
    try {
      const res = await scanner.scanShop(shopId)
      if (res.ok) {
        startImageSync(ctx, shopId)
        startReviewSync(ctx, shopId, res.scan.id)
      }
      return res
    } finally {
      sendToRenderer(ctx, 'scan:state', { shopId, running: false })
      notifyShopsChanged(ctx)
    }
  })
  ipcMain.handle('scan:all', () => scanAll(ctx))

  ipcMain.handle('quota:get', () => ctx.getQuota())

  ipcMain.handle('minio:status', (): MinioStatus => ctx.minio.status())
  ipcMain.handle(
    'minio:set',
    (_e, input: MinioSettingsInput): { ok: true; status: MinioStatus } | { ok: false; error: string } => {
      try {
        const before = ctx.minio.status()
        const status = ctx.minio.set(input ?? {})
        ctx.onMinioChanged()
        // Another server or bucket holds none of our copies: queue them all again.
        if (before.endpoint !== status.endpoint || before.bucket !== status.bucket) {
          resetStoredImages(db)
        }
        // Always run: a disabled store finishes at once with `disabled`, which
        // also clears a stale MinIO error in the renderer.
        startImageSync(ctx, null)
        return { ok: true, status }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )
  ipcMain.handle('minio:test', (_e, input?: MinioSettingsInput) => testMinio(ctx, input))

  ipcMain.handle(
    'images:status',
    (_e, shopId?: number | null): ImageStatus => ({
      counts: imageCounts(db, shopId ?? null),
      sync: ctx.images.state()
    })
  )
  ipcMain.handle('images:sync', (_e, shopId?: number | null): ImageSyncState => {
    startImageSync(ctx, shopId ?? null, true)
    return ctx.images.state()
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string): Promise<boolean> => {
    if (!isAllowedExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })
}
