import { vi } from 'vitest'
import type {
  AddShopResult,
  ImageCounts,
  ImageSyncState,
  KeyStatus,
  KeyTestResult,
  Listing,
  ListingStatsPoint,
  MinioSettingsInput,
  MinioStatus,
  MinioTestResult,
  Quota,
  Review,
  ReviewPage,
  ReviewSyncState,
  ScanChange,
  ScanOutcome,
  ScanSummary,
  ShopSummary
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
    reviewSync: {},
    scans: [],
    scanning: {},
    progress: {},
    quota: null,
    error: null,
    search: '',
    sort: 'newest',
    imageCounts: null,
    imageSync: null,
    minioStatus: null,
    showSettings: false,
    showAddShop: false,
    detailListing: null,
    historyScan: null,
    historyChanges: [],
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
