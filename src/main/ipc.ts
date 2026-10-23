// Wires the pure per-concern modules (db, settings, etsyApi, scanner, shops) to
// IPC channels. All Etsy traffic happens here in main — never in the renderer.

import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { readFile, stat } from 'fs/promises'
import { basename } from 'path'
import type { WebContents } from 'electron'
import type {
  BuyerCountryResult,
  CreateListingResult,
  ListingDraft,
  SaveDraftInput,
  EtsyAuthStatus,
  PickedFile,
  ShippingOption,
  TaxonomyOption,
  MyListing,
  MyListingPatch,
  MyListingsPage,
  MyShopPatch,
  MyShopProfile,
  MyShopResult,
  ImageCounts,
  ImageSyncState,
  KeyStatus,
  KeyTestResult,
  McpSettingsInput,
  McpStatus,
  MinioSettingsInput,
  MinioStatus,
  MinioTestResult,
  Promotion,
  Quota,
  Review,
  ReviewPage,
  ReviewSyncState,
  ScanOutcome,
  ScanPromotions,
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
  listListingPromotions,
  listListingReviews,
  listListingStats,
  listNewReviews,
  listScanChanges,
  listScanPromotions,
  listScans,
  listShopObjectKeys,
  listShopSummaries,
  resetStoredImages
} from './db'
import { EtsyApiError, type EtsyClient } from './etsyApi'
import { type EtsyAuth, EtsyAuthError } from './etsyAuth'
import { type DraftMediaSlot, DraftError, deleteDraft, listDrafts, saveDraft, sendDraft } from './drafts'
import {
  type FileRegistry,
  createFileRegistry,
  createTaxonomyCache,
  listMyListings,
  loadMyShop,
  loadProcessingOptions,
  loadShippingOptions,
  myShopErrorMessage,
  saveMyListing,
  saveMyShop
} from './myShop'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, isMyListingState } from '../shared/myShop'
import { type ImageStore, describeStoreError } from './imageStore'
import type { ImageSyncer } from './imageSync'
import type { McpService } from './mcpServer'
import type { ReviewSyncer } from './reviewSync'
import type { Scanner } from './scanner'
import {
  type BuyerCountryStore,
  type KeyStore,
  type McpSettingsStore,
  type MinioConfig,
  type MinioSettingsStore,
  MINIO_DEFAULTS,
  composeApiKey,
  normalizeMinioEndpoint,
  validateBucketName
} from './settings'
import { parseStatsRange, shopStatsPayload } from './shopStats'
import { addShop, ensureShopTracked } from './shops'
import { FEATURES } from './features'
import type { FeatureCtx } from './features/types'
import { FeatureError } from './features/common'

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
  /** Settings → "Країна покупця" (buyer prices; read by the scanner at each scan). */
  buyerCountry: BuyerCountryStore
  /** The MCP modal: the local MCP server's settings (port, on/off, token)… */
  mcpSettings: McpSettingsStore
  /** …and the server itself (started/stopped to match them). */
  mcp: McpService
  /** Signed in to Etsy (OAuth) — "Мій магазин" edits the user's own shop with it. */
  etsyAuth: EtsyAuth
  /** Files picked for a new listing (tests inject one; else made by registerIpc). */
  files?: FileRegistry
  /** Reads a picked file (tests inject one; else fs). */
  readFile?: (path: string) => Promise<Uint8Array<ArrayBuffer>>
  /** The OAuth access token for features that need the raw value (tokenScopes); tests inject one. */
  accessToken?: () => Promise<string | null>
  /** The native "open file" dialog (tests inject one; else Electron's). */
  showOpenDialog?: (opts: Electron.OpenDialogOptions) => Promise<{ canceled: boolean; filePaths: string[] }>
}

/**
 * The signed-in user's shop is tracked like any other (the sidebar marks it
 * "мій"): add it when it isn't. Never throws; true = it was just added.
 */
export async function ensureOwnShopTracked(ctx: Pick<IpcContext, 'db' | 'client' | 'etsyAuth'>): Promise<boolean> {
  const st = ctx.etsyAuth.status()
  if (!st.loggedIn || !st.shopId) return false
  try {
    return await ensureShopTracked(ctx.db, ctx.client, st.shopId)
  } catch {
    return false
  }
}

/** Longest text `clipboard:write` copies (the MCP configs are < 1 KB). */
export const CLIPBOARD_MAX = 20_000

export interface ImageStatus {
  counts: ImageCounts
  sync: ImageSyncState
}

export function sendToRenderer(ctx: Pick<IpcContext, 'getWindow'>, channel: string, payload: unknown): void {
  const wc = ctx.getWindow()
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

export function notifyShopsChanged(ctx: IpcContext): void {
  sendToRenderer(ctx, 'shops:changed', listShopSummaries(ctx.db))
}

/** The drafts changed (here, or a draft Claude prepared over MCP): the renderer's list. */
export function notifyDraftsChanged(ctx: Pick<IpcContext, 'db' | 'getWindow'>): void {
  sendToRenderer(ctx, 'drafts:changed', listDrafts(ctx.db))
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
  // Promotions a scan saw start/end (the "Акції" group) and one listing's history.
  ipcMain.handle('scan:promotions', (_e, scanId: number): ScanPromotions => {
    const id = positiveId(scanId)
    return id == null ? { started: [], ended: [] } : listScanPromotions(db, id)
  })
  ipcMain.handle('listing:promotions', (_e, listingId: number): Promotion[] => {
    const id = positiveId(listingId)
    return id == null ? [] : listListingPromotions(db, id)
  })
  // Settings → "Країна покупця": applies from the next scan (the scanner reads it per scan).
  ipcMain.handle('buyerCountry:get', (): string => ctx.buyerCountry.get())
  ipcMain.handle('buyerCountry:set', (_e, country: unknown): BuyerCountryResult => {
    try {
      return { ok: true, country: ctx.buyerCountry.set(country) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
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

  // "Мій магазин": sign in to Etsy (OAuth + PKCE; the user pastes the redirect
  // URL back), then read/edit the own shop. Every answer is {ok, value|error}.
  ipcMain.handle('etsyAuth:status', (): EtsyAuthStatus => ctx.etsyAuth.status())
  ipcMain.handle(
    'etsyAuth:begin',
    async (_e, redirectUri?: unknown): Promise<MyShopResult<string>> => {
      try {
        const url = ctx.etsyAuth.begin(typeof redirectUri === 'string' && redirectUri.trim() ? redirectUri : undefined)
        if (isAllowedExternalUrl(url)) await shell.openExternal(url)
        return { ok: true, value: url }
      } catch (e) {
        return { ok: false, error: e instanceof EtsyAuthError ? e.message : myShopErrorMessage(e) }
      }
    }
  )
  ipcMain.handle(
    'etsyAuth:complete',
    async (_e, pasted: unknown): Promise<MyShopResult<EtsyAuthStatus>> => {
      try {
        const st = await ctx.etsyAuth.complete(String(pasted ?? ''))
        if (await ensureOwnShopTracked(ctx)) notifyShopsChanged(ctx)
        return { ok: true, value: st }
      } catch (e) {
        return { ok: false, error: myShopErrorMessage(e) }
      }
    }
  )
  ipcMain.handle('etsyAuth:logout', (): EtsyAuthStatus => ctx.etsyAuth.logout())
  const own = { client, auth: ctx.etsyAuth }
  const result = async <T>(f: () => Promise<T>): Promise<MyShopResult<T>> => {
    try {
      return { ok: true, value: await f() }
    } catch (e) {
      return { ok: false, error: myShopErrorMessage(e) }
    }
  }
  ipcMain.handle('myShop:profile', (): Promise<MyShopResult<MyShopProfile>> => result(() => loadMyShop(own)))
  ipcMain.handle(
    'myShop:saveProfile',
    (_e, patch: MyShopPatch): Promise<MyShopResult<MyShopProfile>> => result(() => saveMyShop(own, patch ?? {}))
  )
  ipcMain.handle(
    'myShop:listings',
    (_e, state: unknown, offset?: unknown): Promise<MyShopResult<MyListingsPage>> =>
      result(() => {
        if (!isMyListingState(state)) throw new Error('Невідомий стан лістингів.')
        const off = Number(offset ?? 0)
        return listMyListings(own, state, Number.isSafeInteger(off) && off > 0 ? off : 0)
      })
  )
  // "Новий лістинг": native file picking (the renderer gets tokens, never paths),
  // the category tree, shipping/processing profiles, and the creation itself.
  const files = ctx.files ?? (ctx.files = createFileRegistry())
  const taxonomy = createTaxonomyCache(client)
  const openDialog =
    ctx.showOpenDialog ??
    ((opts: Electron.OpenDialogOptions) => {
      const win = BrowserWindow.getFocusedWindow()
      return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
    })
  ipcMain.handle('myShop:pickFiles', async (_e, kind: unknown): Promise<PickedFile[]> => {
    const images = kind === 'images'
    const videos = kind === 'videos'
    const res = await openDialog({
      title: images ? 'Фото для лістингу' : videos ? 'Відео для лістингу' : 'Файли для покупця',
      properties: videos ? ['openFile'] : ['openFile', 'multiSelections'],
      filters: images
        ? [{ name: 'Фото', extensions: IMAGE_EXTENSIONS }]
        : videos
          ? [{ name: 'Відео', extensions: VIDEO_EXTENSIONS }]
          : []
    })
    if (res.canceled) return []
    const out: PickedFile[] = []
    for (const path of res.filePaths) {
      try {
        const st = await stat(path)
        if (st.isFile()) out.push(files.add(path, basename(path), st.size))
      } catch {
        // vanished between the dialog and now — skip it
      }
    }
    return out
  })
  ipcMain.handle('myShop:taxonomy', (): Promise<MyShopResult<TaxonomyOption[]>> => result(() => taxonomy()))
  ipcMain.handle('myShop:shippingProfiles', (): Promise<MyShopResult<ShippingOption[]>> =>
    result(() => loadShippingOptions(own))
  )
  ipcMain.handle('myShop:processingProfiles', (): Promise<MyShopResult<ShippingOption[]>> =>
    result(() => loadProcessingOptions(own))
  )
  // Drafts in the app ("📝 Чернетки"): saved with their media, reviewed, then sent.
  ipcMain.handle('drafts:list', (): ListingDraft[] => listDrafts(db))
  ipcMain.handle('drafts:save', async (_e, input: SaveDraftInput): Promise<MyShopResult<ListingDraft>> => {
    try {
      if (!input || typeof input !== 'object' || !input.fields) throw new DraftError('Некоректні дані чернетки.')
      const read = ctx.readFile ?? ((p: string) => readFile(p) as Promise<Uint8Array<ArrayBuffer>>)
      const slots = async (refs: unknown): Promise<DraftMediaSlot[]> => {
        const out: DraftMediaSlot[] = []
        for (const r of Array.isArray(refs) ? refs : []) {
          if (r && typeof r === 'object' && 'mediaId' in r) out.push({ mediaId: Number((r as { mediaId: unknown }).mediaId) })
          else {
            const f = files.get(String((r as { token?: unknown })?.token ?? ''))
            if (!f) throw new DraftError('Вибраний файл більше недоступний — виберіть його ще раз.')
            out.push({ name: f.name, data: await read(f.path) })
          }
        }
        return out
      }
      const id = input.id != null ? positiveId(input.id) : undefined
      if (input.id != null && id == null) throw new DraftError('Некоректний id чернетки.')
      const draft = saveDraft(
        db,
        { id: id ?? undefined, source: 'app', fields: input.fields, photos: await slots(input.photos), files: await slots(input.files) },
        Date.now()
      )
      notifyDraftsChanged(ctx)
      return { ok: true, value: draft }
    } catch (e) {
      return { ok: false, error: e instanceof DraftError ? e.message : myShopErrorMessage(e) }
    }
  })
  ipcMain.handle('drafts:delete', (_e, id: unknown): boolean => {
    const n = positiveId(id)
    const ok = n != null && deleteDraft(db, n)
    if (ok) notifyDraftsChanged(ctx)
    return ok
  })
  ipcMain.handle('drafts:send', async (_e, id: unknown, publish: unknown): Promise<CreateListingResult> => {
    const n = positiveId(id)
    if (n == null) return { ok: false, error: 'Некоректний id чернетки.' }
    try {
      return await sendDraft(
        { ...own, db, onProgress: (p) => sendToRenderer(ctx, 'myShop:createProgress', p) },
        n,
        publish === true
      )
    } catch (e) {
      return { ok: false, error: myShopErrorMessage(e) }
    } finally {
      notifyDraftsChanged(ctx)
    }
  })
  // Every feature's actions through one channel: feature:call(featureId, action, args)
  // → {ok, value} | {ok: false, error} (features/*.ts; progress via feature:event).
  const featureCtx: FeatureCtx = {
    db,
    client,
    authStatus: () => ctx.etsyAuth.status(),
    files,
    readFile: ctx.readFile ?? ((p: string) => readFile(p) as Promise<Uint8Array<ArrayBuffer>>),
    emit: () => undefined, // replaced per call with the calling feature's id
    taxonomy,
    accessToken: ctx.accessToken ?? (() => ctx.etsyAuth.getAccessToken()),
    now: Date.now
  }
  ipcMain.handle(
    'feature:call',
    async (_e, featureId: unknown, action: unknown, args: unknown): Promise<MyShopResult<unknown>> => {
      const feature = FEATURES.find((f) => f.id === featureId)
      const run = feature && typeof action === 'string' && Object.hasOwn(feature.actions, action) ? feature.actions[action] : null
      if (!feature || !run) return { ok: false, error: `Невідома дія: ${String(featureId)}.${String(action)}` }
      try {
        const a = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
        const emit: FeatureCtx['emit'] = (type, payload) =>
          sendToRenderer(ctx, 'feature:event', { feature: feature.id, type, payload })
        return { ok: true, value: await run(a, { ...featureCtx, emit }) }
      } catch (e) {
        return { ok: false, error: e instanceof FeatureError || e instanceof DraftError ? e.message : myShopErrorMessage(e) }
      }
    }
  )

  ipcMain.handle(
    'myShop:saveListing',
    (_e, listingId: unknown, patch: MyListingPatch): Promise<MyShopResult<MyListing>> =>
      result(() => {
        const id = positiveId(listingId)
        if (id == null) throw new Error('Некоректний id лістингу.')
        return saveMyListing(own, id, patch ?? {})
      })
  )

  // The MCP modal. Saving applies at once: the server starts, stops or moves
  // to the new port; a port in use comes back as `status.error`.
  ipcMain.handle('mcp:status', (): McpStatus => ctx.mcp.status())
  ipcMain.handle(
    'mcp:set',
    async (_e, input: McpSettingsInput): Promise<{ ok: true; status: McpStatus } | { ok: false; error: string }> => {
      try {
        ctx.mcpSettings.set(input ?? {})
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
      return { ok: true, status: await ctx.mcp.apply() }
    }
  )
  // Clients configured with the old token stop working at once (it is read per request).
  ipcMain.handle('mcp:regenerateToken', (): McpStatus => {
    ctx.mcpSettings.regenerateToken()
    return ctx.mcp.status()
  })
  // "Копіювати" buttons: Electron's clipboard (navigator.clipboard needs a focused,
  // permitted document; this always works).
  ipcMain.handle('clipboard:write', (_e, text: unknown): boolean => {
    if (typeof text !== 'string' || !text || text.length > CLIPBOARD_MAX) return false
    clipboard.writeText(text)
    return true
  })

  ipcMain.handle('shell:openExternal', async (_e, url: string): Promise<boolean> => {
    if (!isAllowedExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })
}
