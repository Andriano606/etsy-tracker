import { vi } from 'vitest'
import type {
  AddShopResult,
  BuyerCountryResult,
  BuyerPrice,
  ImageCounts,
  ImageSyncState,
  KeyStatus,
  KeyTestResult,
  Listing,
  ListingStatsPoint,
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
  ScanPromotions,
  ScanSummary,
  ShopStatsPayload,
  ShopSummary,
  StatsRange
} from '../../src/shared/types'
import { useStore } from '../../src/renderer/src/store'

export const noKey: KeyStatus = { hasKey: false, masked: null, encrypted: false }
export const withKey: KeyStatus = { hasKey: true, masked: 'abcd…wxyz', encrypted: true }

export const minioDefault: MinioStatus = {
  enabled: true,
  endpoint: 'http://127.0.0.1:9100',
  accessKey: 'etsytracker',
  bucket: 'etsy-tracker',
  secretSource: 'default',
  encrypted: false
}

/** The MCP server as main reports it before it was ever enabled (no token yet). */
export const mcpOff: McpStatus = {
  enabled: false,
  port: 9102,
  url: 'http://127.0.0.1:9102/mcp',
  token: null,
  tokenEncrypted: false,
  running: false,
  error: null,
  requests: 0,
  lastRequestAt: null,
  lastClient: null
}

/** Enabled and listening, with a token. */
export const mcpOn = (over: Partial<McpStatus> = {}): McpStatus => ({
  ...mcpOff,
  enabled: true,
  running: true,
  token: 'tok_abc-123',
  tokenEncrypted: true,
  ...over
})

export const idleSync: ImageSyncState = {
  running: false,
  shopId: null,
  done: 0,
  total: 0,
  errors: 0,
  lastError: null,
  disabled: false
}

export const noImages: ImageCounts = { total: 0, stored: 0, pending: 0, error: 0 }

export const idleReviews = (shopId = 1, over: Partial<ReviewSyncState> = {}): ReviewSyncState => ({
  shopId,
  running: false,
  phase: null,
  stored: 0,
  estimate: null,
  requests: 0,
  newReviews: 0,
  backfillComplete: false,
  budgetExhausted: false,
  error: null,
  ...over
})

export const mkReview = (id: number, over: Partial<Review> = {}): Review => ({
  id,
  key: `t-${9000 + id}`,
  shopId: 1,
  listingId: 1,
  transactionId: 9000 + id,
  buyerUserId: null,
  rating: 5,
  text: `Review ${id}`,
  language: 'en',
  hasImage: false,
  imageStatus: null,
  createdAt: 1_760_000_000 + id,
  updatedAt: 1_760_000_000 + id,
  firstSeenAt: 0,
  firstSeenScanId: 1,
  origin: 'new',
  ...over
})

export const mkScan = (over: Partial<ScanSummary> = {}): ScanSummary => ({
  id: 1,
  shopId: 1,
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now() - 50_000,
  status: 'ok',
  error: null,
  isBaseline: false,
  truncated: false,
  total: 3,
  added: 0,
  removed: 0,
  changed: 0,
  returned: 0,
  ...over
})

export const mkShop = (over: Partial<ShopSummary> = {}): ShopSummary => ({
  id: 1,
  shopName: 'CeramicStudioUA',
  title: 'Handmade ceramics',
  url: 'https://www.etsy.com/shop/CeramicStudioUA',
  iconUrl: null,
  currency: 'UAH',
  etsyActiveCount: 3,
  addedAt: 0,
  activeCount: 3,
  lastOkScan: null,
  lastScan: null,
  newCount: 0,
  ...over
})

export const mkListing = (id: number, over: Partial<Listing> = {}): Listing => ({
  listingId: id,
  shopId: 1,
  title: `Listing ${id}`,
  description: `Description ${id}`,
  priceAmount: 1000 * id,
  priceDivisor: 100,
  currency: 'UAH',
  url: `https://www.etsy.com/listing/${id}/x`,
  tags: [],
  quantity: 1,
  etsyCreatedAt: 1_700_000_000 + id,
  etsyUpdatedAt: 1_700_000_000 + id,
  images: [
    {
      id: id * 10,
      rank: 1,
      url75: `https://i.etsystatic.com/1/il_75x75.${id}.jpg`,
      url170: `https://i.etsystatic.com/1/il_170x135.${id}.jpg`,
      url570: `https://i.etsystatic.com/1/il_570xN.${id}.jpg`,
      urlFull: `https://i.etsystatic.com/1/il_fullxfull.${id}.jpg`,
      width: 100,
      height: 100,
      alt: null
    }
  ],
  firstSeenAt: 0,
  lastSeenAt: 0,
  removedAt: null,
  ...over
})

export const mkChange = (
  id: number,
  kind: ScanChange['kind'],
  listing: Listing,
  over: Partial<ScanChange> = {}
): ScanChange => ({
  id,
  scanId: 1,
  listingId: listing.listingId,
  kind,
  oldValue: null,
  newValue: null,
  listing,
  ...over
})

/**
 * A buyer price like the issue's example: USD 2.50 base → 3.00 with 20 % UA
 * VAT → 1.20 with a 60 % promotion. `over` replaces fields; `discount: false`
 * gives the no-promotion shape.
 */
export const mkBuyerPrice = (over: Partial<BuyerPrice> & { discount?: boolean } = {}): BuyerPrice => {
  const { discount = true, ...rest } = over
  return {
    country: 'UA',
    currency: 'USD',
    base: { amount: 300, divisor: 100 },
    original: { amount: 300, divisor: 100 },
    discounted: discount ? { amount: 120, divisor: 100 } : null,
    discountAmount: discount ? { amount: 180, divisor: 100 } : null,
    discountPercentage: discount ? 60 : null,
    hasDiscount: discount,
    discountStart: discount ? Math.floor(new Date(new Date().getFullYear(), 9, 1).getTime() / 1000) : null,
    discountEnd: discount ? Math.floor(new Date(new Date().getFullYear(), 9, 31).getTime() / 1000) : null,
    shipping: null,
    isFreeShipping: null,
    ...rest
  }
}

export const mkPromotion = (id: number, over: Partial<Promotion> = {}): Promotion => ({
  id,
  listingId: 1,
  shopId: 1,
  country: 'UA',
  currency: 'USD',
  discountPercentage: 60,
  discountStart: 1_759_276_800,
  discountEnd: 1_761_868_800,
  original: { amount: 300, divisor: 100 },
  discounted: { amount: 120, divisor: 100 },
  discountAmount: { amount: 180, divisor: 100 },
  startKind: 'seen',
  startedScanId: 1,
  firstSeenAt: 1_759_300_000_000,
  lastSeenAt: 1_759_300_000_000,
  endedScanId: null,
  endedAt: null,
  endReason: null,
  ...over
})

export const noPromotions = (): ScanPromotions => ({ started: [], ended: [] })

/** What main answers for a shop with no scans and no reviews. */
export const emptyStats = (shopId = 1, range: StatsRange = 'all', over: Partial<ShopStatsPayload> = {}): ShopStatsPayload => ({
  shopId,
  range,
  from: null,
  to: Date.now(),
  scans: [],
  anchor: null,
  intervals: [],
  salesRate: [],
  reviews: { synced: false, complete: false, total: 0, avg: null, weeks: [], months: [] },
  top: { fromScanId: null, toScanId: null, fromAt: null, toAt: null, seriesAt: [], views: [], favorers: [], reviews: [] },
  ...over
})

/** A fully-stubbed window.api with sensible default resolutions. */
export function makeApi() {
  return {
    getKeyStatus: vi.fn(async (): Promise<KeyStatus> => withKey),
    setApiKey: vi.fn(
      async (): Promise<{ ok: true; status: KeyStatus } | { ok: false; error: string }> => ({
        ok: true,
        status: withKey
      })
    ),
    clearApiKey: vi.fn(async (): Promise<KeyStatus> => noKey),
    testApiKey: vi.fn(async (): Promise<KeyTestResult> => ({ ok: true, message: 'Ключ працює.' })),
    listShops: vi.fn(async (): Promise<ShopSummary[]> => []),
    addShop: vi.fn(async (): Promise<AddShopResult> => ({ ok: true, shop: mkShop({ id: 99 }) })),
    removeShop: vi.fn(async () => ({ ok: true })),
    onShopsChanged: vi.fn(() => () => {}),
    listListings: vi.fn(async (): Promise<Listing[]> => []),
    getListing: vi.fn(async (): Promise<Listing | null> => null),
    listScans: vi.fn(async (): Promise<ScanSummary[]> => []),
    getScanChanges: vi.fn(async (): Promise<ScanChange[]> => []),
    getScanPromotions: vi.fn(async (_scanId: number): Promise<ScanPromotions> => noPromotions()),
    getListingPromotions: vi.fn(async (_listingId: number): Promise<Promotion[]> => []),
    getBuyerCountry: vi.fn(async (): Promise<string> => 'UA'),
    setBuyerCountry: vi.fn(
      async (country: string): Promise<BuyerCountryResult> => ({ ok: true, country: country.trim().toUpperCase() })
    ),
    scanShop: vi.fn(async (shopId: number): Promise<ScanOutcome> => ({ ok: true, shopId, scan: mkScan() })),
    scanAll: vi.fn(async (): Promise<ScanOutcome[]> => []),
    onScanProgress: vi.fn(() => () => {}),
    onScanState: vi.fn(() => () => {}),
    getQuota: vi.fn(async (): Promise<Quota | null> => null),
    onQuota: vi.fn(() => () => {}),
    getListingRaw: vi.fn(async (): Promise<string | null> => null),
    getListingStats: vi.fn(async (): Promise<ListingStatsPoint[]> => []),
    getListingReviews: vi.fn(
      async (_listingId: number, offset = 0): Promise<ReviewPage> => ({ total: 0, offset, reviews: [] })
    ),
    getNewReviews: vi.fn(async (_scanId: number): Promise<Review[]> => []),
    // Like main: starts a run, returns nothing (the state comes via onReviewSync).
    syncReviews: vi.fn(async (_shopId: number): Promise<void> => undefined),
    onReviewSync: vi.fn(() => () => {}),
    getMinioStatus: vi.fn(async (): Promise<MinioStatus> => minioDefault),
    setMinio: vi.fn(
      async (
        _input: MinioSettingsInput
      ): Promise<{ ok: true; status: MinioStatus } | { ok: false; error: string }> => ({
        ok: true,
        status: { ...minioDefault, secretSource: 'stored', encrypted: true }
      })
    ),
    testMinio: vi.fn(
      async (_input?: MinioSettingsInput): Promise<MinioTestResult> => ({ ok: true, message: 'З’єднання є.' })
    ),
    getImageStatus: vi.fn(async (): Promise<{ counts: ImageCounts; sync: ImageSyncState }> => ({
      counts: noImages,
      sync: idleSync
    })),
    syncImages: vi.fn(async (): Promise<ImageSyncState> => ({ ...idleSync, running: true })),
    onImageSync: vi.fn(() => () => {}),
    getShopStats: vi.fn(
      async (shopId: number, range: StatsRange): Promise<ShopStatsPayload | null> => emptyStats(shopId, range)
    ),
    getMcpStatus: vi.fn(async (): Promise<McpStatus> => mcpOff),
    setMcp: vi.fn(
      async (input: McpSettingsInput): Promise<{ ok: true; status: McpStatus } | { ok: false; error: string }> => {
        const port = Number(input.port ?? 9102)
        const enabled = !!input.enabled
        return {
          ok: true,
          status: enabled
            ? mcpOn({ port, url: `http://127.0.0.1:${port}/mcp` })
            : { ...mcpOff, port, url: `http://127.0.0.1:${port}/mcp` }
        }
      }
    ),
    regenerateMcpToken: vi.fn(async (): Promise<McpStatus> => mcpOn({ token: 'tok_new-456' })),
    copyText: vi.fn(async (_text: string): Promise<boolean> => true),
    openExternal: vi.fn(async () => true)
  }
}

export type Api = ReturnType<typeof makeApi>

/** Reset the zustand store's data fields (keeps the action functions). */
export function resetStore(): void {
  useStore.setState({
    loaded: false,
    keyStatus: null,
    shops: [],
    activeShopId: null,
    listings: [],
    lastChanges: [],
    newReviews: [],
    scanPromotions: { started: [], ended: [] },
    reviewSync: {},
    scans: [],
    scanning: {},
    progress: {},
    quota: null,
    error: null,
    search: '',
    sort: 'newest',
    discountOnly: false,
    buyerCountry: null,
    imageCounts: null,
    imageSync: null,
    minioStatus: null,
    mcpStatus: null,
    showSettings: false,
    showMcp: false,
    showAddShop: false,
    detailListing: null,
    historyScan: null,
    historyChanges: [],
    statsShopId: null,
    confirmRequest: null
  })
}

/** Install a fresh stubbed window.api and reset the store. Returns the api. */
export function setupRenderer(): Api {
  const api = makeApi()
  ;(window as unknown as { api: Api }).api = api
  try {
    localStorage.clear()
  } catch {
    // ignore
  }
  resetStore()
  return api
}
