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

import { mergeMinioConfig, registerIpc, scanAll, testKey, testMinio, type IpcContext } from '../../src/main/ipc'
import { createImageSyncer } from '../../src/main/imageSync'
import { createScanner } from '../../src/main/scanner'
import { createKeyStore, createMinioSettingsStore, MINIO_DEFAULTS } from '../../src/main/settings'
import { getListing, imageCounts } from '../../src/main/db'
import { FakeImageStore, fakeCdn } from '../helpers/fakeImageStore'
import { FakeEtsy, SHOP_ID } from '../helpers/fakeEtsy'
import { memDb, seedShop } from '../helpers/db'
import { fakeSafeStorage } from '../helpers/safeStorage'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function ctx(etsy = new FakeEtsy(2)) {
  const db = memDb()
  const file = join(mkdtempSync(join(tmpdir(), 'etsy-ipc-')), 's.json')
  const keyStore = createKeyStore(file, fakeSafeStorage())
  const client = etsy.client({ getApiKey: () => keyStore.getKey() })
  const sent: Array<[string, unknown]> = []
  const store = new FakeImageStore()
  const cdn = fakeCdn()
  const minio = createMinioSettingsStore(file, fakeSafeStorage())
  const images = createImageSyncer({
    db,
    getStore: async () => (minio.status().enabled ? store : null),
    fetch: cdn,
    sleep: async () => {},
    onState: (st) => sent.push(['images:progress', st]) // index.ts wires this to the window
  })
  const makeStore = vi.fn(async () => store)
  const onMinioChanged = vi.fn()
  const c: IpcContext = {
    db,
    keyStore,
    client,
    scanner: createScanner({ db, client }),
    getQuota: () => null,
    getWindow: () =>
      ({ isDestroyed: () => false, send: (ch: string, p: unknown) => sent.push([ch, p]) }) as never,
    minio,
    images,
    makeStore,
    onMinioChanged
  }
  return { c, etsy, sent, store, cdn, makeStore, onMinioChanged }
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

describe('images after a scan', () => {
  it('scan:shop returns as soon as the scan is saved; the MinIO copy runs after it', async () => {
    const { c, store } = ctx()
    c.keyStore.setKey('keystring1', 'secret1')
    seedShop(c.db, { id: SHOP_ID })
    registerIpc(c)
    const out = (await call('scan:shop', SHOP_ID)) as { ok: boolean }
    expect(out.ok).toBe(true)
    // The listing is committed with pending images before any upload happened.
    expect(getListing(c.db, 1)!.images.every((i) => i.syncStatus === 'pending')).toBe(true)
    await c.images.sync() // waits behind the run the handler started
    expect(imageCounts(c.db, SHOP_ID)).toEqual({ total: 4, stored: 4, pending: 0, error: 0 })
    expect(store.objects.size).toBe(8) // fullxfull + 570xN per image
    const status = (await call('images:status', SHOP_ID)) as { counts: { stored: number } }
    expect(status.counts.stored).toBe(4)
  })

  it('MinIO down: the scan still succeeds; images stay pending', async () => {
    const { c, store } = ctx()
    store.down = true
    c.keyStore.setKey('keystring1', 'secret1')
    seedShop(c.db, { id: SHOP_ID })
    registerIpc(c)
    expect(((await call('scan:shop', SHOP_ID)) as { ok: boolean }).ok).toBe(true)
    const state = await c.images.sync()
    expect(state.lastError).toMatch(/MinIO недоступний/)
    expect(imageCounts(c.db, SHOP_ID)).toMatchObject({ stored: 0, pending: 4 })
  })

  it('shop:remove deletes the shop’s MinIO objects', async () => {
    const { c, store } = ctx()
    c.keyStore.setKey('keystring1', 'secret1')
    seedShop(c.db, { id: SHOP_ID })
    registerIpc(c)
    await call('scan:shop', SHOP_ID)
    await c.images.sync()
    expect(store.objects.size).toBe(8)
    expect(await call('shop:remove', SHOP_ID)).toEqual({ ok: true })
    await vi.waitFor(() => expect(store.objects.size).toBe(0))
  })

  it('images:sync starts a forced run and returns the current state', async () => {
    const { c } = ctx()
    registerIpc(c)
    const st = (await call('images:sync', null)) as { running: boolean }
    expect(typeof st.running).toBe('boolean')
  })
})

describe('MinIO settings over IPC', () => {
  it('minio:status never contains the secret; minio:set stores it and drops the cached store', async () => {
    const { c, onMinioChanged } = ctx()
    registerIpc(c)
    const st = await call('minio:status')
    expect(st).toMatchObject({ endpoint: MINIO_DEFAULTS.endpoint, bucket: 'etsy-tracker', secretSource: 'default' })
    expect(JSON.stringify(st)).not.toContain(MINIO_DEFAULTS.secretKey)
    const res = (await call('minio:set', { secretKey: 'my-new-secret-1', bucket: 'photos' })) as {
      ok: boolean
      status: unknown
    }
    expect(res.ok).toBe(true)
    expect(JSON.stringify(res)).not.toContain('my-new-secret-1')
    expect(res.status).toMatchObject({ bucket: 'photos', secretSource: 'stored', encrypted: true })
    expect(onMinioChanged).toHaveBeenCalledTimes(1)
    expect(await call('minio:set', { bucket: 'Bad_Bucket' })).toMatchObject({ ok: false, error: expect.stringMatching(/бакета/) })
  })

  it('switching MinIO off still runs the syncer, so the renderer gets `disabled` instead of a stale error', async () => {
    const { c, sent } = ctx()
    registerIpc(c)
    expect(await call('minio:set', { enabled: false })).toMatchObject({ ok: true, status: { enabled: false } })
    await vi.waitFor(() =>
      expect(sent.some(([ch, p]) => ch === 'images:progress' && (p as { disabled: boolean }).disabled)).toBe(true)
    )
  })

  it('a new endpoint or bucket queues every stored image again; other changes do not', async () => {
    const { c, store } = ctx()
    c.keyStore.setKey('keystring1', 'secret1')
    seedShop(c.db, { id: SHOP_ID })
    registerIpc(c)
    await call('scan:shop', SHOP_ID)
    await c.images.sync()
    expect(imageCounts(c.db, SHOP_ID).stored).toBe(4)
    store.down = true // keep the queued run from uploading again before we look
    await call('minio:set', { secretKey: 'my-new-secret-1' })
    expect(imageCounts(c.db, SHOP_ID).stored).toBe(4)
    await call('minio:set', { bucket: 'photos' })
    expect(imageCounts(c.db, SHOP_ID)).toMatchObject({ stored: 0, pending: 4 })
    store.down = false
    await c.images.sync()
    expect(imageCounts(c.db, SHOP_ID).stored).toBe(4)
  })

  it('listing:stats returns the per-scan popularity history', async () => {
    const { c } = ctx()
    c.keyStore.setKey('keystring1', 'secret1')
    seedShop(c.db, { id: SHOP_ID })
    registerIpc(c)
    await call('scan:shop', SHOP_ID)
    await call('scan:shop', SHOP_ID)
    const pts = (await call('listing:stats', 1)) as Array<{ views: number; numFavorers: number }>
    expect(pts).toHaveLength(2)
    expect(pts[0]).toMatchObject({ views: 101, numFavorers: 11 })
  })

  it('minio:test connects with typed values over the stored ones', async () => {
    const { c, makeStore, store } = ctx()
    registerIpc(c)
    const ok = (await call('minio:test', { endpoint: 'localhost:9100', secretKey: 'typed-secret-1' })) as {
      ok: boolean
      message: string
    }
    expect(ok.ok).toBe(true)
    expect(ok.message).toMatch(/http:\/\/localhost:9100.*etsy-tracker/)
    expect(makeStore).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:9100', secretKey: 'typed-secret-1', accessKey: 'etsytracker' })
    )
    expect(store.bucketReady).toBe(true)
    store.down = true
    expect(await testMinio(c)).toMatchObject({ ok: false, message: expect.stringMatching(/недоступний/) })
  })

  it('mergeMinioConfig needs a secret when the stored one is unreadable', () => {
    expect(() => mergeMinioConfig(null, {})).toThrow(/розшифрувати/)
    expect(mergeMinioConfig(null, { secretKey: 'abcdefgh' })).toMatchObject({
      endpoint: MINIO_DEFAULTS.endpoint,
      bucket: MINIO_DEFAULTS.bucket,
      secretKey: 'abcdefgh'
    })
  })
})
