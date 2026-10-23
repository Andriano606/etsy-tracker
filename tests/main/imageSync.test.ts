import { describe, expect, it, vi } from 'vitest'
import { deleteShop, getImageRow, getListing, imageCounts, listShopObjectKeys } from '../../src/main/db'
import { DownloadError, createImageSyncer, downloadImage } from '../../src/main/imageSync'
import { createScanner } from '../../src/main/scanner'
import type { ImageSyncState, ScanOutcome } from '../../src/shared/types'
import { memDb, seedShop } from '../helpers/db'
import { FakeEtsy, SHOP_ID, mkEtsyImage } from '../helpers/fakeEtsy'
import { FakeImageStore, cdnBytes, fakeCdn, type FakeCdnOptions } from '../helpers/fakeImageStore'

function setup(count = 2, cdnOpts: FakeCdnOptions = {}) {
  const db = memDb()
  seedShop(db, { id: SHOP_ID })
  const etsy = new FakeEtsy(count)
  const scanner = createScanner({ db, client: etsy.client() })
  const store = new FakeImageStore()
  let enabled = true
  const cdn = fakeCdn(cdnOpts)
  const states: ImageSyncState[] = []
  const images = createImageSyncer({
    db,
    getStore: async () => (enabled ? store : null),
    fetch: cdn,
    sleep: async () => {},
    progressIntervalMs: 0,
    onState: (s) => states.push(s)
  })
  return {
    db,
    etsy,
    scanner,
    store,
    cdn,
    images,
    states,
    disable: () => {
      enabled = false
    }
  }
}

const ok = (o: ScanOutcome) => {
  if (!o.ok) throw new Error(o.error)
  return o.scan
}

describe('image sync (Etsy CDN → MinIO)', () => {
  it('stores fullxfull and 570xN of every new image under shops/{shop}/listings/{listing}/{image}/', async () => {
    const { db, scanner, store, images, states } = setup(2)
    ok(await scanner.scanShop(SHOP_ID))
    const st = await images.sync({ shopId: SHOP_ID })
    expect(st).toMatchObject({ running: false, done: 4, total: 4, errors: 0, lastError: null })
    expect([...store.objects.keys()].sort()).toEqual(
      [
        `shops/${SHOP_ID}/listings/1/11/570xN.jpg`,
        `shops/${SHOP_ID}/listings/1/11/fullxfull.jpg`,
        `shops/${SHOP_ID}/listings/1/12/570xN.jpg`,
        `shops/${SHOP_ID}/listings/1/12/fullxfull.jpg`,
        `shops/${SHOP_ID}/listings/2/21/570xN.jpg`,
        `shops/${SHOP_ID}/listings/2/21/fullxfull.jpg`,
        `shops/${SHOP_ID}/listings/2/22/570xN.jpg`,
        `shops/${SHOP_ID}/listings/2/22/fullxfull.jpg`
      ].sort()
    )
    const full = store.objects.get(`shops/${SHOP_ID}/listings/1/11/fullxfull.jpg`)!
    expect(full.body).toEqual(cdnBytes('https://i.etsystatic.com/1/il_fullxfull.11.jpg'))
    expect(full.contentType).toBe('image/jpeg')
    expect(getImageRow(db, 11)).toMatchObject({
      sync_status: 'stored',
      key_full: `shops/${SHOP_ID}/listings/1/11/fullxfull.jpg`,
      key_570: `shops/${SHOP_ID}/listings/1/11/570xN.jpg`,
      byte_size: full.body.length,
      content_type: 'image/jpeg',
      etag: full.etag,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
    expect(imageCounts(db, SHOP_ID)).toEqual({ total: 4, stored: 4, pending: 0, error: 0 })
    expect(states[0]).toMatchObject({ running: true, shopId: SHOP_ID })
    expect(states.at(-1)).toMatchObject({ running: false, done: 4 })
    // A second run has nothing to do.
    expect(await images.sync()).toMatchObject({ total: 0, done: 0 })
  })

  it('a replaced image is downloaded, the old one’s objects deleted', async () => {
    const { db, etsy, scanner, store, images } = setup(1)
    ok(await scanner.scanShop(SHOP_ID))
    await images.sync()
    etsy.listings[0].images = [mkEtsyImage(1, 1), mkEtsyImage(1, 3)] // 12 → 13
    ok(await scanner.scanShop(SHOP_ID))
    const st = await images.sync()
    expect(st).toMatchObject({ total: 1, done: 1, errors: 0 })
    expect(store.removed.sort()).toEqual([`shops/${SHOP_ID}/listings/1/12/570xN.jpg`, `shops/${SHOP_ID}/listings/1/12/fullxfull.jpg`])
    expect(store.objects.has(`shops/${SHOP_ID}/listings/1/13/fullxfull.jpg`)).toBe(true)
    expect(getImageRow(db, 12)).toMatchObject({ key_full: null, key_570: null })
    expect(getListing(db, 1)!.images.map((i) => [i.id, i.syncStatus])).toEqual([
      [11, 'stored'],
      [13, 'stored']
    ])
  })

  it('a changed URL of the same image is re-downloaded; a new extension replaces the old object', async () => {
    const { db, etsy, scanner, store, images } = setup(1)
    ok(await scanner.scanShop(SHOP_ID))
    await images.sync()
    etsy.listings[0].images = [
      mkEtsyImage(1, 1, { url_fullxfull: 'https://i.etsystatic.com/1/il_fullxfull.11_v2.png' }),
      mkEtsyImage(1, 2)
    ]
    ok(await scanner.scanShop(SHOP_ID))
    const cdnPng = fakeCdn({ contentType: 'image/png' })
    const again = createImageSyncer({ db, getStore: async () => store, fetch: cdnPng, sleep: async () => {} })
    expect(await again.sync()).toMatchObject({ total: 1, done: 1 })
    expect(getImageRow(db, 11)).toMatchObject({
      sync_status: 'stored',
      key_full: `shops/${SHOP_ID}/listings/1/11/fullxfull.png`
    })
    expect(store.objects.has(`shops/${SHOP_ID}/listings/1/11/fullxfull.jpg`)).toBe(false)
    expect(store.objects.get(`shops/${SHOP_ID}/listings/1/11/fullxfull.png`)!.body).toEqual(
      cdnBytes('https://i.etsystatic.com/1/il_fullxfull.11_v2.png')
    )
  })

  it('MinIO down: the scan is fine, images stay pending, and a later run stores them', async () => {
    const { db, scanner, store, images } = setup(2)
    store.down = true
    ok(await scanner.scanShop(SHOP_ID))
    const st = await images.sync()
    expect(st.lastError).toMatch(/MinIO недоступний/)
    expect(st.done).toBe(0)
    expect(imageCounts(db, SHOP_ID)).toMatchObject({ pending: 4, stored: 0, error: 0 })
    // MinIO is back: the next run (after the next scan, or "Синхронізувати фото") catches up.
    store.down = false
    expect(await images.sync()).toMatchObject({ done: 4, lastError: null })
    expect(imageCounts(db, SHOP_ID)).toMatchObject({ pending: 0, stored: 4 })
  })

  it('MinIO failing mid-run stops the run without marking images as errors', async () => {
    const { db, scanner, store, images } = setup(3)
    ok(await scanner.scanShop(SHOP_ID))
    store.failPutsAfter = 2 // the server dies after two uploads
    const st = await images.sync()
    expect(st.lastError).toMatch(/MinIO/)
    const c = imageCounts(db, SHOP_ID)
    expect(c.error).toBe(0)
    expect(c.pending).toBeGreaterThan(0)
    expect(c.stored + c.pending).toBe(6)
  })

  it('disabled MinIO: nothing is downloaded, images stay pending', async () => {
    const { db, scanner, cdn, images, disable } = setup(1)
    disable()
    ok(await scanner.scanShop(SHOP_ID))
    expect(await images.sync()).toMatchObject({ disabled: true, done: 0 })
    expect(cdn.calls).toEqual([])
    expect(imageCounts(db, SHOP_ID).pending).toBe(2)
  })

  it('a CDN 404 marks that image as an error (retried later), the others are stored', async () => {
    const { db, scanner, images, store } = setup(1, { status: { 'il_fullxfull.12.': 404 } })
    ok(await scanner.scanShop(SHOP_ID))
    const st = await images.sync()
    expect(st).toMatchObject({ done: 2, errors: 1 })
    expect(getImageRow(db, 12)).toMatchObject({ sync_status: 'error', sync_attempts: 1, sync_error: expect.stringMatching(/HTTP 404/) })
    expect(getImageRow(db, 11)!.sync_status).toBe('stored')
    expect(store.objects.size).toBe(2)
  })

  it('a missing 570xN thumbnail (404) still stores the original', async () => {
    const { db, scanner, images } = setup(1, { status: { il_570xN: 404 } })
    ok(await scanner.scanShop(SHOP_ID))
    await images.sync()
    expect(getImageRow(db, 11)).toMatchObject({ sync_status: 'stored', key_570: null })
  })

  it('a transient 570xN failure fails the image (retried later) instead of storing it without a thumbnail', async () => {
    const db = memDb()
    seedShop(db, { id: SHOP_ID })
    const etsy = new FakeEtsy(1)
    const scanner = createScanner({ db, client: etsy.client() })
    const store = new FakeImageStore()
    let cdn = fakeCdn({ failing: ['il_570xN'] })
    const images = createImageSyncer({
      db,
      getStore: async () => store,
      fetch: ((u: RequestInfo | URL, i?: RequestInit) => cdn(u, i)) as typeof fetch,
      sleep: async () => {}
    })
    ok(await scanner.scanShop(SHOP_ID))
    expect(await images.sync()).toMatchObject({ errors: 2 })
    expect(getImageRow(db, 11)).toMatchObject({ sync_status: 'error', key_570: null, key_full: null })
    expect(store.objects.size).toBe(0)
    cdn = fakeCdn()
    await images.sync()
    expect(getImageRow(db, 11)).toMatchObject({
      sync_status: 'stored',
      key_570: `shops/${SHOP_ID}/listings/1/11/570xN.jpg`
    })
  })

  it('a shop deleted while its images sync leaves no orphaned objects in MinIO', async () => {
    const db = memDb()
    seedShop(db, { id: SHOP_ID })
    const etsy = new FakeEtsy(3)
    ok(await createScanner({ db, client: etsy.client() }).scanShop(SHOP_ID))
    const store = new FakeImageStore()
    const cdn = fakeCdn()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let n = 0
    const slow = (async (u: RequestInfo | URL, i?: RequestInit) => {
      if (n++ === 0) await gate
      return cdn(u, i)
    }) as typeof fetch
    const images = createImageSyncer({ db, getStore: async () => store, fetch: slow, sleep: async () => {}, concurrency: 1 })
    const run = images.sync()
    await new Promise((r) => setTimeout(r, 5))
    const keys = listShopObjectKeys(db, SHOP_ID)
    deleteShop(db, SHOP_ID)
    await images.removeObjects(keys)
    release()
    await run
    expect(store.objects.size).toBe(0)
  })

  it('a forced sync re-uploads stored images whose objects are gone (bucket wiped / switched)', async () => {
    const { db, scanner, images, store } = setup(2)
    ok(await scanner.scanShop(SHOP_ID))
    await images.sync()
    expect(store.objects.size).toBe(8)
    store.objects.clear()
    await images.sync() // a normal run trusts the DB…
    expect(store.objects.size).toBe(0)
    const st = await images.sync({ shopId: SHOP_ID, force: true }) // …the manual one checks
    expect(st).toMatchObject({ total: 4, done: 4, errors: 0 })
    expect(store.objects.size).toBe(8)
    expect(imageCounts(db, SHOP_ID)).toMatchObject({ stored: 4, pending: 0 })
  })

  it('cleanup racing a rescan that revives the image: the row ends up pending and is uploaded again', async () => {
    const { db, etsy, scanner, images, store } = setup(1)
    ok(await scanner.scanShop(SHOP_ID))
    await images.sync()
    const imgs = etsy.listings[0].images!
    const gone = imgs.pop()!
    ok(await scanner.scanShop(SHOP_ID)) // image removed → cleanup next run
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const realRemove = store.remove.bind(store)
    store.remove = async (k: string) => {
      await gate
      return realRemove(k)
    }
    const run = images.sync()
    await new Promise((r) => setTimeout(r, 5))
    imgs.push(gone)
    ok(await scanner.scanShop(SHOP_ID)) // back before the delete finished
    release()
    await run
    store.remove = realRemove
    await images.sync()
    const id = gone.listing_image_id as number
    expect(getImageRow(db, id)).toMatchObject({ removed_at: null, sync_status: 'stored' })
    expect(store.objects.has(getImageRow(db, id)!.key_full!)).toBe(true)
  })

  it('concurrent requests are queued and merged; at most `concurrency` downloads at once', async () => {
    const db = memDb()
    seedShop(db, { id: SHOP_ID })
    const etsy = new FakeEtsy(5)
    ok(await createScanner({ db, client: etsy.client() }).scanShop(SHOP_ID))
    let inFlight = 0
    let peak = 0
    const slow = (async (input: RequestInfo | URL) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 2))
      inFlight--
      return new Response(cdnBytes(String(input)), { headers: { 'content-type': 'image/jpeg' } })
    }) as typeof fetch
    const store = new FakeImageStore()
    const getStore = vi.fn(async () => store)
    const images = createImageSyncer({ db, getStore, fetch: slow, sleep: async () => {}, concurrency: 3 })
    const a = images.sync({ shopId: SHOP_ID })
    await new Promise((r) => setTimeout(r, 0)) // let the first run start
    const b = images.sync({ shopId: SHOP_ID })
    const c = images.sync({ shopId: null })
    expect(b).toBe(c) // requests waiting behind a running sync merge into one run
    expect(a).not.toBe(b)
    const [ra, rb] = await Promise.all([a, b, c])
    expect(ra.done).toBe(10)
    expect(rb).toMatchObject({ shopId: null, total: 0 }) // merged to "all shops"; nothing left
    expect(getStore).toHaveBeenCalledTimes(2)
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('removeObjects is best effort', async () => {
    const { images, store } = setup(0)
    store.objects.set('a', { body: Buffer.from('x'), contentType: null, etag: 'e' })
    await images.removeObjects(['a', 'missing'])
    expect(store.objects.size).toBe(0)
    store.down = true
    await expect(images.removeObjects(['b'])).resolves.toBeUndefined()
  })
})

describe('downloadImage', () => {
  const CDN = 'https://i.etsystatic.com/1/il_fullxfull.1.jpg'
  const opts = (fetch: typeof globalThis.fetch) => ({ fetch, sleep: async () => {}, timeoutMs: 1000, retries: 2 })

  it('retries 5xx and network errors, then succeeds', async () => {
    let n = 0
    const f = (async () => {
      n++
      if (n === 1) throw new TypeError('fetch failed')
      if (n === 2) return new Response('', { status: 503 })
      return new Response(Buffer.from('img'), { headers: { 'content-type': 'image/webp' } })
    }) as unknown as typeof fetch
    const d = await downloadImage('https://i.etsystatic.com/x.webp', opts(f))
    expect(d.contentType).toBe('image/webp')
    expect(d.body.toString()).toBe('img')
    expect(n).toBe(3)
  })

  it('refuses anything that is not an https etsystatic.com URL without fetching it', async () => {
    const f = vi.fn(async () => new Response(Buffer.from('x'), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch
    for (const u of ['file:///etc/hostname', 'etsyimg://img/1/570xN', 'http://i.etsystatic.com/x.jpg', 'https://evil.example/x.jpg', '']) {
      await expect(downloadImage(u, opts(f))).rejects.toThrow(/не на CDN Etsy/)
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects a response without a content-type', async () => {
    const bare = (async () => {
      const r = new Response(Buffer.from('x'))
      r.headers.delete('content-type')
      return r
    }) as unknown as typeof fetch
    await expect(downloadImage(CDN, opts(bare))).rejects.toThrow(/не зображення/)
  })

  it('does not retry a 404 and rejects non-images', async () => {
    const f404 = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    await expect(downloadImage(CDN, opts(f404))).rejects.toBeInstanceOf(DownloadError)
    expect(f404).toHaveBeenCalledTimes(1)
    const html = (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    await expect(downloadImage(CDN, opts(html))).rejects.toThrow(/не зображення/)
  })

  it('times out a stalled download', async () => {
    const hang = ((_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_r, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      )) as typeof fetch
    await expect(downloadImage(CDN, { fetch: hang, sleep: async () => {}, timeoutMs: 10, retries: 1 })).rejects.toThrow(
      /тайм-аут/
    )
  })
})
