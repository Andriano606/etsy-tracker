import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddShopResult,
  KeyStatus,
  KeyTestResult,
  Listing,
  Quota,
  ScanChange,
  ScanOutcome,
  ScanProgress,
  ScanSummary,
  ShopSummary
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
  listScans: (shopId: number): Promise<ScanSummary[]> => ipcRenderer.invoke('scans:list', shopId),
  getScanChanges: (scanId: number): Promise<ScanChange[]> =>
    ipcRenderer.invoke('scan:changes', scanId),

  scanShop: (shopId: number): Promise<ScanOutcome> => ipcRenderer.invoke('scan:shop', shopId),
  scanAll: (): Promise<ScanOutcome[]> => ipcRenderer.invoke('scan:all'),
  onScanProgress: (cb: (p: ScanProgress) => void): (() => void) => subscribe('scan:progress', cb),
  onScanState: (cb: (s: { shopId: number; running: boolean }) => void): (() => void) =>
    subscribe('scan:state', cb),

  getQuota: (): Promise<Quota | null> => ipcRenderer.invoke('quota:get'),
  onQuota: (cb: (q: Quota) => void): (() => void) => subscribe('quota:changed', cb),

  /** Opens https etsy.com URLs in the system browser; false if refused. */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
