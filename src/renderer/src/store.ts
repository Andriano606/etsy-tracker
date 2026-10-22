import { create } from 'zustand'
import type {
  KeyStatus,
  KeyTestResult,
  Listing,
  Quota,
  ScanChange,
  ScanProgress,
  ScanSummary,
  ShopSummary
} from '@shared/types'

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

export type SortMode = 'newest' | 'price-asc' | 'price-desc'

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
  /** Scan history of the selected shop, newest first. */
  scans: ScanSummary[]
  scanning: Record<number, boolean>
  progress: Record<number, ScanProgress | undefined>
  quota: Quota | null
  error: string | null
  search: string
  sort: SortMode

  showSettings: boolean
  showAddShop: boolean
  detailListing: Listing | null
  historyScan: ScanSummary | null
  historyChanges: ScanChange[]
  confirmRequest: { message: string; onResolve: (ok: boolean) => void } | null

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

  saveKey: (keystring: string, sharedSecret: string) => Promise<{ ok: boolean; error?: string }>
  clearKey: () => Promise<void>
  testKey: (keystring?: string, sharedSecret?: string) => Promise<KeyTestResult>

  setShowSettings: (v: boolean) => void
  setShowAddShop: (v: boolean) => void
  openListing: (l: Listing | null) => void
  openHistoryScan: (scan: ScanSummary | null) => Promise<void>
  requestConfirm: (message: string) => Promise<boolean>
  resolveConfirm: (ok: boolean) => void
}

export const useStore = create<AppState>((set, get) => ({
  loaded: false,
  keyStatus: null,
  shops: [],
  activeShopId: null,
  listings: [],
  lastChanges: [],
  scans: [],
  scanning: {},
  progress: {},
  quota: null,
  error: null,
  search: '',
  sort: 'newest',

  showSettings: false,
  showAddShop: false,
  detailListing: null,
  historyScan: null,
  historyChanges: [],
  confirmRequest: null,

  load: async () => {
    const [keyStatus, shops, quota] = await Promise.all([
      window.api.getKeyStatus(),
      window.api.listShops(),
      window.api.getQuota()
    ])
    set({ keyStatus, shops, quota, loaded: true })
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
    set({ activeShopId: id, search: '', listings: [], lastChanges: [], scans: [] })
    await get().reloadShopData()
  },

  reloadShopData: async () => {
    const id = get().activeShopId
    if (id == null) return
    const shop = get().shops.find((s) => s.id === id)
    const okScanId = shop?.lastOkScan?.id
    const [listings, scans, lastChanges] = await Promise.all([
      window.api.listListings(id),
      window.api.listScans(id),
      okScanId != null ? window.api.getScanChanges(okScanId) : Promise.resolve([] as ScanChange[])
    ])
    if (get().activeShopId !== id) return
    set({ listings, scans, lastChanges })
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
    const name = shop?.title || shop?.shopName || 'магазин'
    const ok = await get().requestConfirm(
      `Видалити «${name}»?\nУсі збережені товари та історія сканувань цього магазину будуть видалені.`
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

  saveKey: async (keystring, sharedSecret) => {
    const res = await window.api.setApiKey(keystring, sharedSecret)
    if (!res.ok) return { ok: false, error: res.error }
    set({ keyStatus: res.status })
    return { ok: true }
  },
  clearKey: async () => {
    const ok = await get().requestConfirm('Видалити збережений API-ключ Etsy?')
    if (!ok) return
    set({ keyStatus: await window.api.clearApiKey() })
  },
  testKey: (keystring, sharedSecret) => window.api.testApiKey(keystring, sharedSecret),

  setShowSettings: (showSettings) => set({ showSettings }),
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
  requestConfirm: (message) =>
    new Promise<boolean>((resolve) => set({ confirmRequest: { message, onResolve: resolve } })),
  resolveConfirm: (ok) => {
    const req = get().confirmRequest
    set({ confirmRequest: null })
    req?.onResolve(ok)
  }
}))
