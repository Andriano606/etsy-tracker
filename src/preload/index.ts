import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddShopResult,
  BuyerCountryResult,
  CreateListingProgress,
  CreateListingResult,
  DeleteDraftOptions,
  DraftPullState,
  DraftPullSummary,
  ListingDraft,
  SendDraftOptions,
  PickedFile,
  SaveDraftInput,
  SaveDraftResult,
  ShippingOption,
  TaxonomyOption,
  EtsyAuthStatus,
  MyListing,
  MyListingPatch,
  MyListingState,
  MyListingsPage,
  MyShopPatch,
  MyShopProfile,
  MyShopResult,
  ImageCounts,
  ImageSyncState,
  KeyStatus,
  KeyTestResult,
  Listing,
  ListingMark,
  ListingMarkInput,
  ListingStatsPoint,
  MarkedListing,
  MarkListFilter,
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
  /** Set a listing's mark ("В роботі" / "Реалізовано"); status null/'none' removes it (value null). */
  setListingMark: (listingId: number, input: ListingMarkInput): Promise<MyShopResult<ListingMark | null>> =>
    ipcRenderer.invoke('marks:set', listingId, input),
  /** Every marked listing (optionally one status / shop), the latest change first. */
  listMarkedListings: (filter?: MarkListFilter): Promise<MarkedListing[]> => ipcRenderer.invoke('marks:list', filter),
  /** Marks changed elsewhere (Claude over MCP, a published draft completing its example's mark). */
  onMarksChanged: (cb: (e: { listingIds: number[] }) => void): (() => void) => subscribe('marks:changed', cb),
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

  /** "Мій магазин": sign in to Etsy (OAuth) to edit the user's own shop. */
  getEtsyAuth: (): Promise<EtsyAuthStatus> => ipcRenderer.invoke('etsyAuth:status'),
  /** Opens Etsy's consent page in the browser; returns its URL. */
  beginEtsyLogin: (redirectUri?: string): Promise<MyShopResult<string>> =>
    ipcRenderer.invoke('etsyAuth:begin', redirectUri),
  /** Finish with the redirect URL the user copied from the browser. */
  completeEtsyLogin: (pasted: string): Promise<MyShopResult<EtsyAuthStatus>> =>
    ipcRenderer.invoke('etsyAuth:complete', pasted),
  logoutEtsy: (): Promise<EtsyAuthStatus> => ipcRenderer.invoke('etsyAuth:logout'),
  onEtsyAuth: (cb: (s: EtsyAuthStatus) => void): (() => void) => subscribe('etsyAuth:changed', cb),
  getMyShop: (): Promise<MyShopResult<MyShopProfile>> => ipcRenderer.invoke('myShop:profile'),
  saveMyShop: (patch: MyShopPatch): Promise<MyShopResult<MyShopProfile>> =>
    ipcRenderer.invoke('myShop:saveProfile', patch),
  getMyListings: (state: MyListingState, offset = 0): Promise<MyShopResult<MyListingsPage>> =>
    ipcRenderer.invoke('myShop:listings', state, offset),
  saveMyListing: (listingId: number, patch: MyListingPatch): Promise<MyShopResult<MyListing>> =>
    ipcRenderer.invoke('myShop:saveListing', listingId, patch),
  /** Native file dialog; main keeps the paths, the renderer gets tokens. */
  pickListingFiles: (kind: 'images' | 'files' | 'videos'): Promise<PickedFile[]> =>
    ipcRenderer.invoke('myShop:pickFiles', kind),
  getTaxonomy: (): Promise<MyShopResult<TaxonomyOption[]>> => ipcRenderer.invoke('myShop:taxonomy'),
  getShippingProfiles: (): Promise<MyShopResult<ShippingOption[]>> => ipcRenderer.invoke('myShop:shippingProfiles'),
  getProcessingProfiles: (): Promise<MyShopResult<ShippingOption[]>> =>
    ipcRenderer.invoke('myShop:processingProfiles'),
  /** Drafts kept in the app (yours and the ones Claude prepared), newest first. */
  listDrafts: (): Promise<ListingDraft[]> => ipcRenderer.invoke('drafts:list'),
  /** Create (no id) or update a draft with its media (stored ids + picked tokens, in order). */
  saveDraft: (input: SaveDraftInput): Promise<SaveDraftResult> => ipcRenderer.invoke('drafts:save', input),
  /** Delete a draft in the app; {onEtsy: true} also deletes its linked Etsy listing (if it still exists). */
  deleteDraft: (id: number, opts?: DeleteDraftOptions): Promise<MyShopResult<{ deletedOnEtsy: boolean }>> =>
    ipcRenderer.invoke('drafts:delete', id, opts),
  /** "Зберегти як" for a stored draft file/photo: value null = the user cancelled. */
  saveDraftMedia: (mediaId: number): Promise<MyShopResult<{ path: string } | null>> =>
    ipcRenderer.invoke('drafts:saveMedia', mediaId),
  /**
   * Send to Etsy: a new listing (as an Etsy draft, or published — $0.20), or, once linked,
   * an update of that listing ({overwrite: true} replaces changes made on Etsy since the last sync).
   */
  sendDraft: (id: number, publish: boolean, opts?: SendDraftOptions): Promise<CreateListingResult> =>
    ipcRenderer.invoke('drafts:send', id, publish, opts),
  /** Forget the linked Etsy listing so the draft can be sent as a new one. */
  unlinkDraft: (id: number): Promise<MyShopResult<ListingDraft>> => ipcRenderer.invoke('drafts:unlink', id),
  /** Pull the own shop's Etsy drafts into the app now. */
  pullDrafts: (): Promise<MyShopResult<DraftPullSummary>> => ipcRenderer.invoke('drafts:pull'),
  /** The last/current pull (also pushed via onDraftsPull). */
  getDraftsPullState: (): Promise<DraftPullState> => ipcRenderer.invoke('drafts:pullState'),
  onDraftsChanged: (cb: (d: ListingDraft[]) => void): (() => void) => subscribe('drafts:changed', cb),
  onDraftsPull: (cb: (s: DraftPullState) => void): (() => void) => subscribe('drafts:pull', cb),
  /** Every feature's actions (main/features): {ok, value} | {ok: false, error}. */
  featureCall: (feature: string, action: string, args?: Record<string, unknown>): Promise<MyShopResult<unknown>> =>
    ipcRenderer.invoke('feature:call', feature, action, args ?? {}),
  /** Progress/events a feature pushes ({feature, type, payload}). */
  onFeatureEvent: (cb: (e: { feature: string; type: string; payload: unknown }) => void): (() => void) =>
    subscribe('feature:event', cb),
  onCreateListingProgress: (cb: (p: CreateListingProgress) => void): (() => void) =>
    subscribe('myShop:createProgress', cb),

  /** The MCP modal: the local MCP server's settings and state (incl. the token clients need). */
  getMcpStatus: (): Promise<McpStatus> => ipcRenderer.invoke('mcp:status'),
  /** Save and apply (start / stop / move to the new port). */
  setMcp: (input: McpSettingsInput): Promise<{ ok: true; status: McpStatus } | { ok: false; error: string }> =>
    ipcRenderer.invoke('mcp:set', input),
  regenerateMcpToken: (): Promise<McpStatus> => ipcRenderer.invoke('mcp:regenerateToken'),
  /** Copy text to the system clipboard; false if refused. */
  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:write', text),

  /** Opens https etsy.com URLs in the system browser; false if refused. */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
