import { create } from 'zustand'
import type {
  DraftPullState,
  EtsyAuthStatus,
  ListingDraft,
  ImageCounts,
  ImageSyncState,
  KeyStatus,
  KeyTestResult,
  Listing,
  ListingMark,
  ListingMarkInput,
  MarkFilter,
  McpStatus,
  MinioSettingsInput,
  MinioStatus,
  MinioTestResult,
  Quota,
  Review,
  ReviewSyncState,
  ScanChange,
  ScanProgress,
  ScanPromotions,
  ScanSummary,
  ShopSummary
} from '@shared/types'
import type { SortMode } from '@shared/listingFilter'

export type { SortMode }

/** How a confirm dialog reads (ConfirmModal): heading, the confirm button's verb, red or not (default: guessed). */
/** One image of the full-size viewer: its biggest URL, plus words for it. */
export interface ViewerImage {
  src: string
  /** Read by screen readers; also the caption when there is no `caption`. */
  alt?: string
  caption?: string
  /**
   * The picture's etsy-tracker:// reference (shared/claudeRef.ts: photoRef, reviewPhotoRef, …):
   * the viewer's "Копіювати для Claude" copies it. Absent = no such button (e.g. a picture
   * the MCP tools can't address).
   */
  ref?: string
}

export interface ConfirmOptions {
  title?: string
  confirmLabel?: string
  danger?: boolean
}

/** localStorage key for the last-selected shop. */
const UI_KEY = 'etsyTracker.ui'

function loadActiveShop(): number | null {
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (!raw) return null
    const v = (JSON.parse(raw) as { activeShopId?: unknown }).activeShopId
    return typeof v === 'number' ? v : null
  } catch {
    return null
  }
}

function saveActiveShop(id: number | null): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ activeShopId: id }))
  } catch {
    // Non-critical.
  }
}

const NO_PROMOTIONS: ScanPromotions = { started: [], ended: [] }

/**
 * Shops with a single "Сканувати повторно" call in flight. scanAll must not
 * clear their spinner when it finishes: main reports each shop done as soon as
 * it is scanned, so the user can rescan one while scanAll is still running.
 */
const singleScans = new Map<number, number>()

interface AppState {
  loaded: boolean
  keyStatus: KeyStatus | null
  shops: ShopSummary[]
  activeShopId: number | null
  /** Active listings of the selected shop. */
  listings: Listing[]
  /** Changes recorded by the selected shop's latest successful scan. */
  lastChanges: ScanChange[]
  /** Reviews first seen as new by that scan's review sync. */
  newReviews: Review[]
  /** Promotions that scan saw start / end ("Акції"). */
  scanPromotions: ScanPromotions
  /** Review sync runs, per shop, pushed by main. */
  reviewSync: Record<number, ReviewSyncState | undefined>
  /** Scan history of the selected shop, newest first. */
  scans: ScanSummary[]
  scanning: Record<number, boolean>
  progress: Record<number, ScanProgress | undefined>
  quota: Quota | null
  error: string | null
  search: string
  sort: SortMode
  /** "Зі знижкою": only listings with an active discount in the grid. */
  discountOnly: boolean
  /** The grid's mark filter (Усі / Без мітки / В роботі / Реалізовано). */
  markFilter: MarkFilter
  /** Settings → "Країна покупця" (buyer prices; applies from the next scan). */
  buyerCountry: string | null
  /** MinIO copy state of the selected shop's images. */
  imageCounts: ImageCounts | null
  /** The background image sync (all shops), pushed by main. */
  imageSync: ImageSyncState | null
  minioStatus: MinioStatus | null
  /** The local MCP server (the MCP modal; the sidebar button's dot). */
  mcpStatus: McpStatus | null
  /** Signed in to Etsy (OAuth) for "Мій магазин"; pushed by main on every change. */
  etsyAuth: EtsyAuthStatus | null

  showSettings: boolean
  showMcp: boolean
  showMyShop: boolean
  /** "📝 Чернетки": null = closed, 'list', or a draft open in the editor (null id = a new one). */
  draftsView: null | 'list' | { draftId: number | null }
  /** Listing drafts kept in the app (main pushes `drafts:changed`). */
  drafts: ListingDraft[]
  /** The pull of the own shop's Etsy drafts into the app (main pushes `drafts:pull`). */
  draftPull: DraftPullState
  /** The shop whose "ℹ️ Більше" window (feature shop panels) is open. */
  shopPanelsFor: number | null
  /** The open sidebar feature window (TOP_MODALS id). */
  featureModal: string | null
  showAddShop: boolean
  detailListing: Listing | null
  historyScan: ScanSummary | null
  historyChanges: ScanChange[]
  /** The shop whose "📊 Статистика" view is open. */
  statsShopId: number | null
  confirmRequest: (ConfirmOptions & { message: string; onResolve: (ok: boolean) => void }) | null
  /** The full-size image viewer (ui/ImageViewer) over everything: null = closed. */
  viewer: { images: ViewerImage[]; index: number } | null

  /** Open the full-size viewer on one image or a gallery (starting at `index`). */
  openImage: (images: ViewerImage | ViewerImage[], index?: number) => void
  closeImage: () => void
  load: () => Promise<void>
  setShops: (shops: ShopSummary[]) => void
  selectShop: (id: number | null) => Promise<void>
  reloadShopData: () => Promise<void>
  addShop: (input: string) => Promise<{ ok: boolean; error?: string }>
  removeShop: (id: number) => Promise<void>
  scanShop: (id: number) => Promise<void>
  scanAll: () => Promise<void>
  setScanning: (shopId: number, running: boolean) => void
  setProgress: (p: ScanProgress) => void
  setQuota: (q: Quota | null) => void
  setError: (e: string | null) => void
  setSearch: (s: string) => void
  setSort: (s: SortMode) => void
  setDiscountOnly: (v: boolean) => void
  setMarkFilter: (v: MarkFilter) => void
  /**
   * Set / remove a listing's mark (marks:set); on success the open shop's
   * listings and the open listing window show it at once.
   */
  setListingMark: (listingId: number, input: ListingMarkInput) => Promise<{ ok: true; mark: ListingMark | null } | { ok: false; error: string }>
  /** Marks changed elsewhere (main pushes `marks:changed`: Claude, a published draft): refresh what shows them. */
  marksChanged: (listingIds: number[]) => Promise<void>
  saveBuyerCountry: (country: string) => Promise<{ ok: boolean; error?: string }>

  saveKey: (keystring: string, sharedSecret: string) => Promise<{ ok: boolean; error?: string }>
  clearKey: () => Promise<void>
  testKey: (keystring?: string, sharedSecret?: string) => Promise<KeyTestResult>

  setReviewSync: (s: ReviewSyncState) => void
  setImageSync: (s: ImageSyncState) => void
  saveMinio: (input: MinioSettingsInput) => Promise<{ ok: boolean; error?: string }>
  testMinio: (input?: MinioSettingsInput) => Promise<MinioTestResult>

  setShowSettings: (v: boolean) => void
  setShowMcp: (v: boolean) => void
  setShowMyShop: (v: boolean) => void
  openDrafts: (v: null | 'list' | { draftId: number | null }) => void
  openShopPanels: (shopId: number | null) => void
  openFeatureModal: (id: string | null) => void
  setDrafts: (d: ListingDraft[]) => void
  setDraftPull: (s: DraftPullState) => void
  /** "Синхронізувати з Etsy": pull the own shop's Etsy drafts now (never throws; the outcome lands in `draftPull`). */
  pullDrafts: () => Promise<void>
  setEtsyAuth: (s: EtsyAuthStatus) => void
  setMcpStatus: (s: McpStatus) => void
  setShowAddShop: (v: boolean) => void
  openListing: (l: Listing | null) => void
  openHistoryScan: (scan: ScanSummary | null) => Promise<void>
  openStats: (shopId: number | null) => void
  /** The in-app confirm dialog; `opts` = heading, the button's verb, red tone. */
  requestConfirm: (message: string, opts?: ConfirmOptions) => Promise<boolean>
  resolveConfirm: (ok: boolean) => void
}

/** No pull of Etsy's drafts yet (what main answers before the first one). */
export const IDLE_DRAFT_PULL: DraftPullState = { running: false, lastAt: null, lastSummary: null, error: null }

/** The signed-in user's own shop id (Etsy sign-in), or null. */
export function ownShopId(s: Pick<AppState, 'etsyAuth'>): number | null {
  return s.etsyAuth?.loggedIn ? (s.etsyAuth.shopId ?? null) : null
}

export const useStore = create<AppState>((set, get) => ({
  loaded: false,
  keyStatus: null,
  shops: [],
  activeShopId: null,
  listings: [],
  lastChanges: [],
  newReviews: [],
  scanPromotions: NO_PROMOTIONS,
  reviewSync: {},
  scans: [],
  scanning: {},
  progress: {},
  quota: null,
  error: null,
  search: '',
  sort: 'newest',
  discountOnly: false,
  markFilter: 'any',
  buyerCountry: null,
  imageCounts: null,
  imageSync: null,
  minioStatus: null,
  mcpStatus: null,
  etsyAuth: null,

  showSettings: false,
  showMcp: false,
  showMyShop: false,
  draftsView: null,
  drafts: [],
  draftPull: IDLE_DRAFT_PULL,
  shopPanelsFor: null,
  featureModal: null,
  showAddShop: false,
  detailListing: null,
  historyScan: null,
  historyChanges: [],
  statsShopId: null,
  confirmRequest: null,
  viewer: null,

  load: async () => {
    const [keyStatus, shops, quota, minioStatus, buyerCountry, mcpStatus, etsyAuth] = await Promise.all([
      window.api.getKeyStatus(),
      window.api.listShops(),
      window.api.getQuota(),
      window.api.getMinioStatus(),
      window.api.getBuyerCountry().catch(() => null),
      window.api.getMcpStatus().catch(() => null),
      window.api.getEtsyAuth().catch(() => null)
    ])
    const drafts = await window.api.listDrafts().catch(() => [] as ListingDraft[])
    set({ keyStatus, shops, quota, minioStatus, buyerCountry, mcpStatus, etsyAuth, drafts, loaded: true })
    const remembered = loadActiveShop()
    const pick = shops.find((s) => s.id === remembered)?.id ?? shops[0]?.id ?? null
    await get().selectShop(pick)
  },

  setShops: (shops) => {
    const prev = get().shops
    set({ shops })
    const active = get().activeShopId
    if (active == null) {
      if (shops.length) void get().selectShop(shops[0].id)
      return
    }
    const now = shops.find((s) => s.id === active)
    if (!now) {
      void get().selectShop(shops[0]?.id ?? null)
      return
    }
    // A scan finished (or failed) for the open shop — refresh its data.
    const before = prev.find((s) => s.id === active)
    if (before?.lastScan?.id !== now.lastScan?.id || before?.lastOkScan?.id !== now.lastOkScan?.id) {
      void get().reloadShopData()
    }
  },

  selectShop: async (id) => {
    saveActiveShop(id)
    set({
      activeShopId: id,
      search: '',
      listings: [],
      lastChanges: [],
      newReviews: [],
      scanPromotions: NO_PROMOTIONS,
      scans: [],
      imageCounts: null
    })
    await get().reloadShopData()
  },

  reloadShopData: async () => {
    const id = get().activeShopId
    if (id == null) return
    const shop = get().shops.find((s) => s.id === id)
    const okScanId = shop?.lastOkScan?.id
    const [listings, scans, lastChanges, images, newReviews, scanPromotions] = await Promise.all([
      window.api.listListings(id),
      window.api.listScans(id),
      okScanId != null ? window.api.getScanChanges(okScanId) : Promise.resolve([] as ScanChange[]),
      window.api.getImageStatus(id),
      okScanId != null ? window.api.getNewReviews(okScanId) : Promise.resolve([] as Review[]),
      okScanId != null ? window.api.getScanPromotions(okScanId) : Promise.resolve(NO_PROMOTIONS)
    ])
    if (get().activeShopId !== id) return
    set({
      listings,
      scans,
      lastChanges,
      newReviews,
      scanPromotions,
      imageCounts: images.counts,
      imageSync: images.sync
    })
  },

  addShop: async (input) => {
    const res = await window.api.addShop(input)
    if (!res.ok) return { ok: false, error: res.error }
    const shops = get().shops.some((s) => s.id === res.shop.id)
      ? get().shops
      : [...get().shops, res.shop]
    set({ shops, showAddShop: false })
    await get().selectShop(res.shop.id)
    return { ok: true }
  },

  removeShop: async (id) => {
    const shop = get().shops.find((s) => s.id === id)
    const name = shop?.shopName || 'магазин'
    const ok = await get().requestConfirm(
      `Видалити магазин «${name}» з програми?\nУсі збережені товари та історія сканувань будуть видалені. На Etsy нічого не зміниться.`,
      { title: 'Видалити магазин?', confirmLabel: 'Видалити магазин', danger: true }
    )
    if (!ok) return
    const res = await window.api.removeShop(id)
    if (!res.ok) {
      set({ error: res.error ?? 'Не вдалося видалити магазин.' })
      return
    }
    const shops = get().shops.filter((s) => s.id !== id)
    set({ shops })
    if (get().activeShopId === id) await get().selectShop(shops[0]?.id ?? null)
  },

  scanShop: async (id) => {
    singleScans.set(id, (singleScans.get(id) ?? 0) + 1)
    set((s) => ({ scanning: { ...s.scanning, [id]: true }, error: null }))
    try {
      const res = await window.api.scanShop(id)
      if (!res.ok && res.busy) set({ error: res.error })
      // Failed scans are recorded on the shop (lastScan) and shown in its view.
      set({ shops: await window.api.listShops() })
      if (get().activeShopId === id) await get().reloadShopData()
    } finally {
      const left = (singleScans.get(id) ?? 1) - 1
      if (left > 0) singleScans.set(id, left)
      else singleScans.delete(id)
      set((s) => ({
        scanning: { ...s.scanning, [id]: false },
        progress: { ...s.progress, [id]: undefined }
      }))
    }
  },

  scanAll: async () => {
    const ids = get().shops.map((s) => s.id)
    set((s) => ({
      scanning: { ...s.scanning, ...Object.fromEntries(ids.map((i) => [i, true])) },
      error: null
    }))
    try {
      const results = await window.api.scanAll()
      // Per-shop failures show on each shop; only "everything failed" (e.g. a bad
      // key) gets the global banner.
      const first = results[0]
      if (first && !first.ok && results.every((r) => !r.ok)) set({ error: first.error })
      set({ shops: await window.api.listShops() })
      await get().reloadShopData()
    } finally {
      // Reset only the shops scanAll marked — not one rescanned on its own meanwhile.
      const done = ids.filter((i) => !singleScans.has(i))
      set((s) => ({
        scanning: { ...s.scanning, ...Object.fromEntries(done.map((i) => [i, false])) },
        progress: { ...s.progress, ...Object.fromEntries(done.map((i) => [i, undefined])) }
      }))
    }
  },

  setScanning: (shopId, running) =>
    set((s) => ({
      scanning: { ...s.scanning, [shopId]: running },
      progress: running ? s.progress : { ...s.progress, [shopId]: undefined }
    })),
  setProgress: (p) => set((s) => ({ progress: { ...s.progress, [p.shopId]: p } })),
  setQuota: (quota) => set({ quota }),
  setError: (error) => set({ error }),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
  setDiscountOnly: (discountOnly) => set({ discountOnly }),
  setMarkFilter: (markFilter) => set({ markFilter }),
  setListingMark: async (listingId, input) => {
    let res
    try {
      res = await window.api.setListingMark(listingId, input)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok) return { ok: false, error: res.error }
    const mark = res.value
    set((s) => ({
      listings: s.listings.map((l) => (l.listingId === listingId ? { ...l, mark } : l)),
      detailListing: s.detailListing?.listingId === listingId ? { ...s.detailListing, mark } : s.detailListing
    }))
    return { ok: true, mark }
  },
  marksChanged: async (listingIds) => {
    const ids = new Set(listingIds)
    const shown = get().listings.some((l) => ids.has(l.listingId))
    const open = get().detailListing
    await Promise.all([
      shown ? get().reloadShopData() : Promise.resolve(),
      open && ids.has(open.listingId)
        ? window.api.getListing(open.listingId).then((fresh) => {
            const cur = get().detailListing
            if (fresh && cur?.listingId === fresh.listingId) set({ detailListing: { ...cur, mark: fresh.mark ?? null } })
          })
        : Promise.resolve()
    ])
  },
  saveBuyerCountry: async (country) => {
    const res = await window.api.setBuyerCountry(country)
    if (!res.ok) return { ok: false, error: res.error }
    set({ buyerCountry: res.country })
    return { ok: true }
  },

  saveKey: async (keystring, sharedSecret) => {
    const res = await window.api.setApiKey(keystring, sharedSecret)
    if (!res.ok) return { ok: false, error: res.error }
    set({ keyStatus: res.status })
    return { ok: true }
  },
  clearKey: async () => {
    const ok = await get().requestConfirm(
      'Видалити збережений ключ доступу до Etsy?\nБез нього програма не зможе сканувати магазини, доки ви не введете ключ знову.',
      { title: 'Видалити ключ?', confirmLabel: 'Видалити ключ', danger: true }
    )
    if (!ok) return
    set({ keyStatus: await window.api.clearApiKey() })
  },
  testKey: (keystring, sharedSecret) => window.api.testApiKey(keystring, sharedSecret),

  setReviewSync: (s) => {
    set((st) => ({ reviewSync: { ...st.reviewSync, [s.shopId]: s } }))
    // A finished run changed counts, badges and the "Нові відгуки" group.
    if (!s.running && get().activeShopId === s.shopId) {
      void (async () => {
        const shops = await window.api.listShops()
        set({ shops })
        await get().reloadShopData()
      })()
    }
  },
  setImageSync: (imageSync) => {
    const wasRunning = get().imageSync?.running
    set({ imageSync })
    // Refresh the open shop's counts while copying (throttled by main) and at the end.
    const id = get().activeShopId
    if (id != null && (wasRunning || !imageSync.running)) {
      void window.api.getImageStatus(id).then((r) => {
        if (get().activeShopId === id) set({ imageCounts: r.counts })
      })
    }
  },
  saveMinio: async (input) => {
    const res = await window.api.setMinio(input)
    if (!res.ok) return { ok: false, error: res.error }
    set({ minioStatus: res.status })
    return { ok: true }
  },
  testMinio: (input) => window.api.testMinio(input),

  openImage: (images, index = 0) => {
    const all = Array.isArray(images) ? images : [images]
    const list = all.filter((i) => !!i?.src)
    if (!list.length) return
    // The index counts in the given list: keep pointing at the same image after empty entries are dropped.
    const i = Number.isFinite(index) ? Math.trunc(index) : 0
    const at = list.indexOf(all[i])
    set({ viewer: { images: list, index: at >= 0 ? at : Math.min(Math.max(0, i), list.length - 1) } })
  },
  closeImage: () => set({ viewer: null }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setShowMcp: (showMcp) => set({ showMcp }),
  setShowMyShop: (showMyShop) => set({ showMyShop }),
  openDrafts: (draftsView) => set({ draftsView }),
  openShopPanels: (shopPanelsFor) => set({ shopPanelsFor }),
  openFeatureModal: (featureModal) => set({ featureModal }),
  setDrafts: (drafts) => set({ drafts }),
  setDraftPull: (draftPull) => set({ draftPull }),
  pullDrafts: async () => {
    if (get().draftPull.running) return
    set({ draftPull: { ...get().draftPull, running: true, error: null } })
    let next: DraftPullState
    try {
      const res = await window.api.pullDrafts()
      next = res.ok
        ? { running: false, lastAt: Date.now(), lastSummary: res.value, error: null }
        : { ...get().draftPull, running: false, error: res.error }
    } catch (e) {
      next = { ...get().draftPull, running: false, error: e instanceof Error ? e.message : String(e) }
    }
    // Main pushes the same state (`drafts:pull`); a push that came first is replaced by the answer.
    set({ draftPull: next })
    const drafts = await window.api.listDrafts().catch(() => null)
    if (drafts) set({ drafts })
  },
  setEtsyAuth: (etsyAuth) => set({ etsyAuth }),
  setMcpStatus: (mcpStatus) => set({ mcpStatus }),
  setShowAddShop: (showAddShop) => set({ showAddShop }),
  openListing: (detailListing) => set({ detailListing }),
  openHistoryScan: async (scan) => {
    if (!scan) {
      set({ historyScan: null, historyChanges: [] })
      return
    }
    set({ historyScan: scan, historyChanges: [] })
    const changes = await window.api.getScanChanges(scan.id)
    if (get().historyScan?.id === scan.id) set({ historyChanges: changes })
  },
  openStats: (statsShopId) => set({ statsShopId }),
  requestConfirm: (message, opts = {}) =>
    new Promise<boolean>((resolve) => set({ confirmRequest: { ...opts, message, onResolve: resolve } })),
  resolveConfirm: (ok) => {
    const req = get().confirmRequest
    set({ confirmRequest: null })
    req?.onResolve(ok)
  }
}))
