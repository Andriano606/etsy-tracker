// Wires the pure per-concern modules (db, settings, etsyApi, scanner, shops) to
// IPC channels. All Etsy traffic happens here in main — never in the renderer.

import { ipcMain, shell } from 'electron'
import type { WebContents } from 'electron'
import type { KeyStatus, KeyTestResult, Quota, ScanOutcome } from '../shared/types'
import { isAllowedExternalUrl } from '../shared/externalUrl'
import {
  type Db,
  deleteShop,
  getListing,
  listActiveListings,
  listScanChanges,
  listScans,
  listShopSummaries
} from './db'
import { EtsyApiError, type EtsyClient } from './etsyApi'
import type { Scanner } from './scanner'
import { composeApiKey, type KeyStore } from './settings'
import { addShop } from './shops'

export interface IpcContext {
  db: Db
  keyStore: KeyStore
  client: EtsyClient
  scanner: Scanner
  getQuota: () => Quota | null
  getWindow: () => WebContents | null
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
    // A bad key fails every shop the same way — stop instead of repeating it.
    const last = out[out.length - 1]
    if (!last.ok && /API-ключ/.test(last.error)) break
  }
  return out
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
    deleteShop(db, shopId)
    notifyShopsChanged(ctx)
    return { ok: true }
  })

  ipcMain.handle('listings:list', (_e, shopId: number) => listActiveListings(db, shopId))
  ipcMain.handle('listing:get', (_e, listingId: number) => getListing(db, listingId))
  ipcMain.handle('scans:list', (_e, shopId: number) => listScans(db, shopId))
  ipcMain.handle('scan:changes', (_e, scanId: number) => listScanChanges(db, scanId))

  ipcMain.handle('scan:shop', async (_e, shopId: number) => {
    sendToRenderer(ctx, 'scan:state', { shopId, running: true })
    try {
      return await scanner.scanShop(shopId)
    } finally {
      sendToRenderer(ctx, 'scan:state', { shopId, running: false })
      notifyShopsChanged(ctx)
    }
  })
  ipcMain.handle('scan:all', () => scanAll(ctx))

  ipcMain.handle('quota:get', () => ctx.getQuota())

  ipcMain.handle('shell:openExternal', async (_e, url: string): Promise<boolean> => {
    if (!isAllowedExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })
}
