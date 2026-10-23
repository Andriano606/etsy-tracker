import { describe, expect, it, vi } from 'vitest'
import { type ImageRow, getImageRow, markImageStored, upsertListing } from '../../src/main/db'
import {
  createImageProtocolHandler,
  parseImageUrl,
  resolveImageSource
} from '../../src/main/imageProtocol'
import { memDb, mkInput, seedShop } from '../helpers/db'
import { FakeImageStore, cdnBytes, fakeCdn } from '../helpers/fakeImageStore'

const row = (over: Partial<ImageRow> = {}): ImageRow =>
  ({
    listing_image_id: 7,
    listing_id: 1,
    shop_id: 2,
    rank: 1,
    url_75x75: 'https://i.etsystatic.com/75.jpg',
    url_170x135: 'https://i.etsystatic.com/170.jpg',
    url_570xN: 'https://i.etsystatic.com/570.jpg',
    url_fullxfull: 'https://i.etsystatic.com/full.jpg',
    sync_status: 'stored',
    key_full: 'k/full.jpg',
    key_570: 'k/570xN.jpg',
    ...over
  }) as ImageRow

describe('parseImageUrl', () => {
  it('accepts etsyimg://img/{id}/{size}', () => {
    expect(parseImageUrl('etsyimg://img/6012345678/570xN')).toEqual({ imageId: 6012345678, size: '570xN' })
    expect(parseImageUrl('etsyimg://img/1/fullxfull')).toEqual({ imageId: 1, size: 'fullxfull' })
  })
  it.each([
    'etsyimg://img/1/huge',
    'etsyimg://other/1/570xN',
    'https://img/1/570xN',
    'etsyimg://img/abc/570xN',
    'etsyimg://img/0/570xN',
    'etsyimg://img/1/570xN/extra',
    'not a url'
  ])('rejects %s', (u) => {
    expect(parseImageUrl(u)).toBeNull()
  })
})

describe('resolveImageSource (pure fallback logic)', () => {
  it('stored + store available → MinIO, with the CDN URL as fallback', () => {
    expect(resolveImageSource(row(), 'fullxfull', true)).toEqual({
      kind: 'store',
      key: 'k/full.jpg',
      fallbackUrl: 'https://i.etsystatic.com/full.jpg'
    })
    // small sizes are served from the 570xN copy
    expect(resolveImageSource(row(), '75x75', true)).toMatchObject({ kind: 'store', key: 'k/570xN.jpg', fallbackUrl: 'https://i.etsystatic.com/75.jpg' })
    // no thumbnail copy → the original
    expect(resolveImageSource(row({ key_570: null }), '570xN', true)).toMatchObject({ key: 'k/full.jpg' })
  })
  it('not stored, or store unavailable → the CDN URL of that size', () => {
    expect(resolveImageSource(row({ sync_status: 'pending' }), '570xN', true)).toEqual({
      kind: 'cdn',
      url: 'https://i.etsystatic.com/570.jpg'
    })
    expect(resolveImageSource(row(), '170x135', false)).toEqual({ kind: 'cdn', url: 'https://i.etsystatic.com/170.jpg' })
    expect(resolveImageSource(row({ sync_status: 'stored', key_full: null, key_570: null }), 'fullxfull', true)).toMatchObject({
      kind: 'cdn'
    })
  })
  it('unknown image → none; empty small-size URL falls back to a bigger one', () => {
    expect(resolveImageSource(null, '570xN', true)).toEqual({ kind: 'none' })
    expect(resolveImageSource(row({ sync_status: 'pending', url_75x75: '' }), '75x75', true)).toEqual({
      kind: 'cdn',
      url: 'https://i.etsystatic.com/570.jpg'
    })
  })
})

describe('etsyimg:// handler', () => {
  function setup() {
    const db = memDb()
    seedShop(db)
    const img = {
      id: 5,
      rank: 1,
      url75: 'https://i.etsystatic.com/5_75.jpg',
      url170: 'https://i.etsystatic.com/5_170.jpg',
      url570: 'https://i.etsystatic.com/5_570.jpg',
      urlFull: 'https://i.etsystatic.com/5_full.jpg',
      width: null,
      height: null,
      alt: null
    }
    upsertListing(db, mkInput(1, { images: [img] }), 1)
    const store = new FakeImageStore()
    const cdn = fakeCdn()
    let enabled = true
    const missing: number[] = []
    const handler = createImageProtocolHandler({
      db,
      getStore: async () => (enabled ? store : null),
      fetch: cdn,
      onMissing: (r) => missing.push(r.listing_image_id)
    })
    const get = (u: string) => handler(new Request(u))
    const markStored = async () => {
      await store.put('s/full.jpg', Buffer.from('FROM-MINIO-FULL'), 'image/jpeg')
      await store.put('s/570.jpg', Buffer.from('FROM-MINIO-570'), 'image/jpeg')
      markImageStored(db, { listing_id: 1, listing_image_id: 5 }, img.urlFull, {
        keyFull: 's/full.jpg',
        key570: 's/570.jpg',
        byteSize: 15,
        contentType: 'image/jpeg',
        etag: 'e',
        sha256: 'h',
        storedAt: 2
      })
    }
    return { db, store, cdn, get, markStored, missing, disable: () => (enabled = false) }
  }

  it('streams the MinIO copy when stored', async () => {
    const { get, markStored, cdn } = setup()
    await markStored()
    const res = await get('etsyimg://img/5/570xN')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(await res.text()).toBe('FROM-MINIO-570')
    expect(await (await get('etsyimg://img/5/fullxfull')).text()).toBe('FROM-MINIO-FULL')
    expect(cdn.calls).toEqual([])
  })

  it('falls back to the Etsy CDN when not stored yet', async () => {
    const { get, cdn } = setup()
    const res = await get('etsyimg://img/5/570xN')
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer())).toEqual(cdnBytes('https://i.etsystatic.com/5_570.jpg'))
    expect(cdn.calls).toEqual(['https://i.etsystatic.com/5_570.jpg'])
  })

  it('falls back to the CDN when MinIO is down or disabled', async () => {
    const { get, markStored, store, cdn, disable } = setup()
    await markStored()
    store.down = true
    expect(Buffer.from(await (await get('etsyimg://img/5/fullxfull')).arrayBuffer())).toEqual(
      cdnBytes('https://i.etsystatic.com/5_full.jpg')
    )
    store.down = false
    disable()
    await get('etsyimg://img/5/75x75')
    expect(cdn.calls).toEqual(['https://i.etsystatic.com/5_full.jpg', 'https://i.etsystatic.com/5_75.jpg'])
  })

  it('falls back to the CDN when the object vanished from the bucket, and reports it (re-queue)', async () => {
    const { get, markStored, store, cdn, missing } = setup()
    await markStored()
    store.objects.clear()
    expect((await get('etsyimg://img/5/570xN')).status).toBe(200)
    expect(cdn.calls).toEqual(['https://i.etsystatic.com/5_570.jpg'])
    expect(missing).toEqual([5])
  })

  it('a MinIO outage is not reported as a missing object', async () => {
    const { get, markStored, store, missing } = setup()
    await markStored()
    store.down = true
    await get('etsyimg://img/5/570xN')
    expect(missing).toEqual([])
  })

  it('never fetches a stored URL that is not https on etsystatic.com (file:, etsyimg:, other hosts)', async () => {
    const db = memDb()
    seedShop(db)
    const bad = (id: number, u: string) => ({ id, rank: id, url75: u, url170: u, url570: u, urlFull: u, width: null, height: null, alt: null })
    upsertListing(
      db,
      mkInput(1, {
        images: [bad(1, 'file:///etc/hostname'), bad(2, 'etsyimg://img/2/570xN'), bad(3, 'https://evil.example/x.jpg')]
      }),
      1
    )
    const cdn = fakeCdn()
    const handler = createImageProtocolHandler({ db, getStore: async () => null, fetch: cdn })
    for (const id of [1, 2, 3]) expect((await handler(new Request(`etsyimg://img/${id}/570xN`))).status).toBe(404)
    expect(cdn.calls).toEqual([])
    expect(resolveImageSource(row({ sync_status: 'pending', url_570xN: 'file:///x' }), '570xN', true)).toEqual({
      kind: 'cdn',
      url: 'https://i.etsystatic.com/full.jpg'
    })
  })

  it('502 when the CDN answers with something that is not an image', async () => {
    const { db } = setup()
    const html = createImageProtocolHandler({
      db,
      getStore: async () => null,
      fetch: (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    })
    expect((await html(new Request('etsyimg://img/5/570xN'))).status).toBe(502)
  })

  it('400 for a malformed URL, 404 for an unknown image, 502 when the CDN fails too', async () => {
    const { db, get } = setup()
    expect((await get('etsyimg://img/x/570xN')).status).toBe(400)
    expect((await get('etsyimg://img/999/570xN')).status).toBe(404)
    const failing = createImageProtocolHandler({
      db,
      getStore: async () => null,
      fetch: vi.fn(async () => {
        throw new TypeError('offline')
      }) as unknown as typeof fetch
    })
    expect((await failing(new Request('etsyimg://img/5/570xN'))).status).toBe(502)
    expect(getImageRow(db, 5)!.sync_status).toBe('pending')
  })
})
