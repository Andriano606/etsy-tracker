import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, openExternal } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  openExternal: vi.fn(async () => {})
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn)
  },
  shell: { openExternal }
}))

import { registerIpc, scanAll, testKey, type IpcContext } from '../../src/main/ipc'
import { createScanner } from '../../src/main/scanner'
import { createKeyStore } from '../../src/main/settings'
import { FakeEtsy, SHOP_ID } from '../helpers/fakeEtsy'
import { memDb, seedShop } from '../helpers/db'
import { fakeSafeStorage } from '../helpers/safeStorage'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function ctx(etsy = new FakeEtsy(2)) {
  const db = memDb()
  const keyStore = createKeyStore(join(mkdtempSync(join(tmpdir(), 'etsy-ipc-')), 's.json'), fakeSafeStorage())
  const client = etsy.client({ getApiKey: () => keyStore.getKey() })
  const sent: Array<[string, unknown]> = []
  const c: IpcContext = {
    db,
    keyStore,
    client,
    scanner: createScanner({ db, client }),
    getQuota: () => null,
    getWindow: () =>
      ({ isDestroyed: () => false, send: (ch: string, p: unknown) => sent.push([ch, p]) }) as never
  }
  return { c, etsy, sent }
}

const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!({}, ...args)

beforeEach(() => {
  handlers.clear()
  openExternal.mockClear()
})

describe('testKey', () => {
  it('pings with the typed (unsaved) key', async () => {
    const { c, etsy } = ctx()
    const r = await testKey(c, 'keystring1', 'secret1')
    expect(r).toMatchObject({ ok: true, applicationId: 1234567 })
    expect(etsy.fetch.calls[0].headers['x-api-key']).toBe('keystring1:secret1')
  })

  it('without arguments uses the stored key, or says none is stored', async () => {
    const { c } = ctx()
    expect(await testKey(c)).toEqual({ ok: false, message: 'Ключ не збережено.' })
    c.keyStore.setKey('keystring1', 'secret1')
    expect((await testKey(c)).ok).toBe(true)
  })

  it('reports a rejected key and invalid input', async () => {
    const { c, etsy } = ctx()
    etsy.intercept = () => ({ status: 403, body: { error: 'nope' } })
    expect(await testKey(c, 'k', 's')).toMatchObject({ ok: false, message: expect.stringMatching(/API-ключ/) })
    expect(await testKey(c, 'k', '')).toMatchObject({ ok: false, message: expect.stringMatching(/Shared secret/) })
  })
})

describe('registered handlers', () => {
  it('key:set never returns the key, only the masked status', async () => {
    const { c } = ctx()
    registerIpc(c)
    const res = (await call('key:set', 'abcd1234efgh5678wxyz', 'topsecret')) as { ok: boolean }
    expect(JSON.stringify(res)).not.toMatch(/topsecret|abcd1234efgh5678wxyz/)
    expect(res).toEqual({ ok: true, status: { hasKey: true, masked: 'abcd…wxyz', encrypted: true } })
    expect(await call('key:set', '', '')).toMatchObject({ ok: false })
  })

  it('shell:openExternal only opens https etsy.com URLs', async () => {
    const { c } = ctx()
    registerIpc(c)
    expect(await call('shell:openExternal', 'https://www.etsy.com/listing/1')).toBe(true)
    expect(await call('shell:openExternal', 'https://evil.example/')).toBe(false)
    expect(await call('shell:openExternal', 'file:///etc/passwd')).toBe(false)
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('shop:add notifies the renderer; shop:remove deletes', async () => {
    const { c, sent } = ctx()
    registerIpc(c)
    expect(await call('shop:add', 'CeramicStudioUA')).toMatchObject({ ok: false, error: expect.stringMatching(/не задано/) })
    c.keyStore.setKey('keystring1', 'secret1')
    const res = (await call('shop:add', 'CeramicStudioUA')) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(sent.some(([ch]) => ch === 'shops:changed')).toBe(true)
    expect(await call('shop:remove', SHOP_ID)).toEqual({ ok: true })
    expect(await call('shops:list')).toEqual([])
  })

  it('scan:shop sends scan:state around the scan', async () => {
    const { c, sent } = ctx()
    c.keyStore.setKey('keystring1', 'secret1')
    seedShop(c.db, { id: SHOP_ID })
    registerIpc(c)
    const out = (await call('scan:shop', SHOP_ID)) as { ok: boolean }
    expect(out.ok).toBe(true)
    const states = sent.filter(([ch]) => ch === 'scan:state').map(([, p]) => p)
    expect(states).toEqual([
      { shopId: SHOP_ID, running: true },
      { shopId: SHOP_ID, running: false }
    ])
  })
})

describe('scanAll', () => {
  it('scans every shop in order and stops early on a bad key', async () => {
    const { c, etsy } = ctx()
    seedShop(c.db, { id: SHOP_ID })
    seedShop(c.db, { id: 2, shopName: 'Second', addedAt: 2000 })
    // no key stored → the first shop fails with the API-key message
    const out = await scanAll(c)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ ok: false, shopId: SHOP_ID })
    expect(etsy.requests).toHaveLength(0)
  })

  it('continues past a shop-specific failure', async () => {
    const { c } = ctx()
    c.keyStore.setKey('keystring1', 'secret1')
    seedShop(c.db, { id: SHOP_ID })
    seedShop(c.db, { id: 2, shopName: 'Gone', addedAt: 2000 }) // 404 on Etsy
    const out = await scanAll(c)
    expect(out.map((o) => o.ok)).toEqual([true, false])
  })
})
