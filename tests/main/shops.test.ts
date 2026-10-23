import { describe, expect, it } from 'vitest'
import { addShop, ensureShopTracked } from '../../src/main/shops'
import { getShop, listShopSummaries } from '../../src/main/db'
import { FakeEtsy, SHOP_ID } from '../helpers/fakeEtsy'
import { memDb } from '../helpers/db'
import findShopsFx from '../fixtures/findShops.json'

describe('addShop', () => {
  it('resolves a pasted link to the shop and stores it', async () => {
    const db = memDb()
    const etsy = new FakeEtsy(0)
    const res = await addShop(db, etsy.client(), 'https://www.etsy.com/uk/shop/CeramicStudioUA?ref=x', 77)
    if (!res.ok) throw new Error(res.error)
    expect(res.shop).toMatchObject({
      id: SHOP_ID,
      shopName: 'CeramicStudioUA',
      title: 'Handmade ceramics from Lviv & more',
      currency: 'UAH',
      etsyActiveCount: 3,
      addedAt: 77,
      activeCount: 0,
      lastOkScan: null
    })
    expect(res.shop.iconUrl).toMatch(/^https:\/\/i\.etsystatic\.com\//)
    const q = etsy.requests[0]
    expect(q.pathname).toBe('/v3/application/shops')
    expect(q.searchParams.get('shop_name')).toBe('CeramicStudioUA')
  })

  it('picks the exact match out of fuzzy findShops results', async () => {
    const db = memDb()
    const etsy = new FakeEtsy(0, { intercept: () => ({ body: findShopsFx }) })
    const res = await addShop(db, etsy.client(), 'ceramicstudioua')
    expect(res.ok && res.shop.id).toBe(20987654)
  })

  it('rejects a listing URL without calling Etsy', async () => {
    const etsy = new FakeEtsy(0)
    const res = await addShop(memDb(), etsy.client(), 'https://www.etsy.com/listing/123/x')
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/товар/) })
    expect(etsy.requests).toHaveLength(0)
  })

  it('reports a shop Etsy does not know', async () => {
    const etsy = new FakeEtsy(0)
    const res = await addShop(memDb(), etsy.client(), 'NoSuchShop')
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/не знайдено на Etsy/) })
  })

  it('rejects duplicates by name (case-insensitive) and by shop id', async () => {
    const db = memDb()
    const etsy = new FakeEtsy(0)
    expect((await addShop(db, etsy.client(), 'CeramicStudioUA')).ok).toBe(true)
    const again = await addShop(db, etsy.client(), 'https://www.etsy.com/shop/ceramicstudioua')
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/уже додано/) })
    expect(listShopSummaries(db)).toHaveLength(1)
  })

  it('passes an API error through as a message', async () => {
    const etsy = new FakeEtsy(0, { intercept: () => ({ status: 403, body: { error: 'nope' } }) })
    const res = await addShop(memDb(), etsy.client(), 'CeramicStudioUA')
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/API-ключ/) })
  })
})

describe('ensureShopTracked (the signed-in user’s own shop)', () => {
  it('adds it by id once; no-op when tracked', async () => {
    const db = memDb()
    const etsy = new FakeEtsy(0)
    expect(await ensureShopTracked(db, etsy.client(), SHOP_ID, 5)).toBe(true)
    expect(getShop(db, SHOP_ID)).toMatchObject({ shopName: 'CeramicStudioUA', addedAt: 5 })
    expect(await ensureShopTracked(db, etsy.client(), SHOP_ID)).toBe(false)
    expect(etsy.requests.filter((u) => u.pathname === `/v3/application/shops/${SHOP_ID}`)).toHaveLength(1)
  })
})
