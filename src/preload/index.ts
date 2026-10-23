import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddShopResult,
  BuyerCountryResult,
  ImageCounts,
  ImageSyncState,
  KeyStatus,
  KeyTestResult,
  Listing,
  ListingStatsPoint,
  MinioSettingsInput,
  MinioStatus,
  MinioTestResult,
  Promotion,
  Quota,
  Review,
  ReviewPage,
  ReviewSyncState,
  ScanChange,
  ScanOutcome,
  ScanProgress,
  ScanPromotions,
  ScanSummary,
  ShopStatsPayload,
  ShopSummary,
  StatsRange
} from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getKeyStatus: (): Promise<KeyStatus> => ipcRenderer.invoke('key:status'),
  setApiKey: (
    keystring: string,
    sharedSecret: string
  ): Promise<{ ok: true; status: KeyStatus } | { ok: false; error: string }> =>
    ipcRenderer.invoke('key:set', keystring, sharedSecret),
  clearApiKey: (): Promise<KeyStatus> => ipcRenderer.invoke('key:clear'),
  /** Ping Etsy with the given unsaved key, or the stored one when omitted. */
  testApiKey: (keystring?: string, sharedSecret?: string): Promise<KeyTestResult> =>
    ipcRenderer.invoke('key:test', keystring, sharedSecret),

  listShops: (): Promise<ShopSummary[]> => ipcRenderer.invoke('shops:list'),
  addShop: (input: string): Promise<AddShopResult> => ipcRenderer.invoke('shop:add', input),
  removeShop: (shopId: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shop:remove', shopId),
  onShopsChanged: (cb: (shops: ShopSummary[]) => void): (() => void) =>
    subscribe('shops:changed', cb),

  listListings: (shopId: number): Promise<Listing[]> => ipcRenderer.invoke('listings:list', shopId),
  getListing: (listingId: number): Promise<Listing | null> =>
    ipcRenderer.invoke('listing:get', listingId),
  /** The latest full Etsy API object stored for the listing (JSON text). */
  getListingRaw: (listingId: number): Promise<string | null> =>
    ipcRenderer.invoke('listing:raw', listingId),
  /** One listing's popularity per successful scan, oldest first. */
  getListingStats: (listingId: number): Promise<ListingStatsPoint[]> =>
    ipcRenderer.invoke('listing:stats', listingId),
  listScans: (shopId: number): Promise<ScanSummary[]> => ipcRenderer.invoke('scans:list', shopId),
  getScanChanges: (scanId: number): Promise<ScanChange[]> =>
    ipcRenderer.invoke('scan:changes', scanId),
  /** Promotions a scan saw start / end ("Акції"). */
  getScanPromotions: (scanId: number): Promise<ScanPromotions> =>
    ipcRenderer.invoke('scan:promotions', scanId),
  /** One listing's promotions, newest first. */
  getListingPromotions: (listingId: number): Promise<Promotion[]> =>
    ipcRenderer.invoke('listing:promotions', listingId),
  /** Settings → "Країна покупця" (ISO 3166-1 alpha-2; applies from the next scan). */
  getBuyerCountry: (): Promise<string> => ipcRenderer.invoke('buyerCountry:get'),
  setBuyerCountry: (country: string): Promise<BuyerCountryResult> =>
    ipcRenderer.invoke('buyerCountry:set', country),
  /** One listing's stored reviews, newest first, a page at a time. */
  getListingReviews: (listingId: number, offset = 0, limit = 20): Promise<ReviewPage> =>
    ipcRenderer.invoke('reviews:listing', listingId, offset, limit),
  /** Reviews first seen as new by a scan's review sync. */
  getNewReviews: (scanId: number): Promise<Review[]> => ipcRenderer.invoke('reviews:new', scanId),
  /** Start syncing the shop's reviews (continues a backfill); the live state comes via onReviewSync. */
  syncReviews: (shopId: number): Promise<void> => ipcRenderer.invoke('reviews:sync', shopId),
  onReviewSync: (cb: (s: ReviewSyncState) => void): (() => void) => subscribe('reviews:progress', cb),

  /** The Statistics view's data for a shop and period (null for an unknown shop). */
  getShopStats: (shopId: number, range: StatsRange): Promise<ShopStatsPayload | null> =>
    ipcRenderer.invoke('stats:shop', { shopId, range }),

  scanShop: (shopId: number): Promise<ScanOutcome> => ipcRenderer.invoke('scan:shop', shopId),
  scanAll: (): Promise<ScanOutcome[]> => ipcRenderer.invoke('scan:all'),
  onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => subscribe('scan:progress', cb),
  onScanState: (cb: (s: { shopId: number; running: boolean }) => void): (() => void) =>
    subscribe('scan:state', cb),

  getQuota: (): Promise<Quota | null> => ipcRenderer.invoke('quota:get'),

  getMinioStatus: (): Promise<MinioStatus> => ipcRenderer.invoke('minio:status'),
  setMinio: (
    input: MinioSettingsInput
  ): Promise<{ ok: true; status: MinioStatus } | { ok: false; error: string }> =>
    ipcRenderer.invoke('minio:set', input),
  /** Connect with the typed (unsaved) values over the stored ones. */
  testMinio: (input?: MinioSettingsInput): Promise<MinioTestResult> =>
    ipcRenderer.invoke('minio:test', input),
  getImageStatus: (shopId?: number | null): Promise<{ counts: ImageCounts; sync: ImageSyncState }> =>
    ipcRenderer.invoke('images:status', shopId),
  /** Start copying pending/failed images to MinIO (all shops when omitted). */
  syncImages: (shopId?: number | null): Promise<ImageSyncState> =>
    ipcRenderer.invoke('images:sync', shopId),
  onImageSync: (cb: (s: ImageSyncState) => void): (() => void) => subscribe('images:progress', cb),
  onQuota: (cb: (q: Quota) => void): (() => void) => subscribe('quota:changed', cb),

  /** Opens https etsy.com URLs in the system browser; false if refused. */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
