import { describe, expect, it } from 'vitest'
import { inventoryFeature } from '../../../src/main/features/inventory'
import { inventoriesByIds } from '../../../src/main/features/inventory/api'
import { NOT_SIGNED_IN, WRITES_OFF } from '../../../src/main/mcpStoreTools'
import {
  INVENTORY_TOOL_SUMMARY,
  inventoryToWrite,
  type InventoryOverviewPage,
  type InventoryWrite,
  type ListingInventory,
  type VariationImagesData
} from '../../../src/shared/features/inventory'
import { OWN_SHOP, callTool, featureCtx, mcpDeps, routedFetch, runAction, signedIn, signedOut, testClient } from '../../helpers/features'

// ------------------------------------------------ Etsy-shaped fixtures (OAS)
const money = (amount: number, currency = 'USD') => ({ amount, divisor: 100, currency_code: currency })

const etsyProduct = (id: number, size: string, valueId: number, price: number, quantity = 5) => ({
  product_id: id,
  sku: `SKU-${size}`,
  is_deleted: false,
  offerings: [{ offering_id: id * 10, quantity, is_enabled: true, is_deleted: false, price: money(price), readiness_state_id: 77 }],
  property_values: [{ property_id: 513, property_name: 'Size', scale_id: null, scale_name: null, value_ids: [valueId], values: [size] }]
})

/** Listing 1001: Size S/M/L, price and SKU vary by size (+ a deleted product Etsy shows with show_deleted only). */
const SIZED = {
  products: [
    etsyProduct(1, 'S', 901, 1000),
    etsyProduct(2, 'M', 902, 1200),
    etsyProduct(3, 'L', 903, 1400),
    { ...etsyProduct(4, 'XL', 904, 1600), is_deleted: true }
  ],
  price_on_property: [513],
  quantity_on_property: [],
  sku_on_property: [513],
  readiness_state_on_property: []
}

/** Listing 1002: no variations. */
const SIMPLE = {
  products: [
    {
      product_id: 11,
      sku: 'PLAN&amp;1',
      is_deleted: false,
      offerings: [{ offering_id: 111, quantity: 3, is_enabled: true, is_deleted: false, price: money(500), readiness_state_id: null }],
      property_values: []
    }
  ],
  price_on_property: [],
  quantity_on_property: [],
  sku_on_property: [],
  readiness_state_on_property: []
}

const image = (id: number, rank: number, url = `https://i.etsystatic.com/1/il_170x135.${id}.jpg`) => ({
  listing_id: 1001,
  listing_image_id: id,
  rank,
  url_75x75: url,
  url_170x135: url,
  url_570xN: url,
  url_fullxfull: url.replace('170x135', 'fullxfull'),
  full_height: 100,
  full_width: 100,
  alt_text: `Photo &amp; ${id}`
})

const listing = (id: number, title: string, inventory: unknown) => ({
  listing_id: id,
  shop_id: OWN_SHOP,
  title,
  description: '',
  state: 'active',
  url: `https://www.etsy.com/listing/${id}`,
  quantity: 9,
  price: money(777),
  images: [image(id * 10 + 2, 2), image(id * 10 + 1, 1)],
  inventory
})

/** What updateListingInventory answers: the sent products as a fresh inventory (new ids). */
function echoInventory(_url: URL, init?: RequestInit) {
  const b = JSON.parse(String(init?.body))
  return {
    body: {
      products: b.products.map((p: any, i: number) => ({
        product_id: 5000 + i,
        sku: p.sku,
        is_deleted: false,
        offerings: p.offerings.map((o: any) => ({
          offering_id: 6000 + i,
          quantity: o.quantity,
          is_enabled: o.is_enabled,
          is_deleted: false,
          price: money(Math.round(o.price * 100)),
          readiness_state_id: o.readiness_state_id
        })),
        property_values: p.property_values.map((v: any) => ({ scale_id: null, scale_name: null, property_name: null, ...v }))
      })),
      price_on_property: b.price_on_property,
      quantity_on_property: b.quantity_on_property,
      sku_on_property: b.sku_on_property,
      readiness_state_on_property: b.readiness_state_on_property
    }
  }
}

const inventoryOf = (url: URL) => (url.pathname.includes('/1002/') ? SIMPLE : SIZED)

const routes = {
  // before "/listings/{id}/inventory", which would match "batch" as an id
  'GET /v3/application/listings/batch/inventory': (url: URL) => {
    const ids = (url.searchParams.get('listing_ids') ?? '').split(',').map(Number)
    const all = [listing(1001, 'Sized planner', SIZED), listing(1002, 'Simple planner', SIMPLE), listing(1003, 'No inventory', null)]
    return { body: { count: ids.length, results: all.filter((l) => ids.includes(l.listing_id)) } }
  },
  'GET /v3/application/listings/{id}/inventory': (url: URL) => ({ body: inventoryOf(url) }),
  'PUT /v3/application/listings/{id}/inventory': echoInventory,
  'GET /v3/application/listings/{id}/inventory/products/{pid}': { body: etsyProduct(2, 'M', 902, 1200) },
  'GET /v3/application/listings/{id}/products/{pid}/offerings/{oid}': {
    body: { offering_id: 20, quantity: 5, is_enabled: true, is_deleted: false, price: money(1200), readiness_state_id: 77 }
  },
  [`GET /v3/application/shops/${OWN_SHOP}/listings`]: {
    body: {
      count: 103,
      results: [listing(1001, 'Sized planner', undefined), listing(1002, 'Simple planner', undefined), listing(1003, 'No inventory', undefined)]
    }
  },
  'GET /v3/application/listings/{id}/images': {
    body: { count: 3, results: [image(5002, 2), image(5001, 1), image(5003, 3, 'http://evil.example/x.jpg')] }
  },
  [`GET /v3/application/shops/${OWN_SHOP}/listings/{id}/variation-images`]: {
    body: { count: 1, results: [{ property_id: 513, value_id: 901, value: 'S', image_id: 5002 }] }
  },
  [`POST /v3/application/shops/${OWN_SHOP}/listings/{id}/variation-images`]: (_url: URL, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body))
    return { body: { count: b.variation_images.length, results: b.variation_images.map((v: any) => ({ ...v, value: 'M' })) } }
  }
}

const put = (fetch: { calls: Array<{ method: string; url: URL; body: string | null; headers: Record<string, string> }> }) =>
  fetch.calls.filter((c) => c.method === 'PUT')
const bodyOf = (c: { body: string | null }) => JSON.parse(String(c.body))

/** The full write body of SIZED as updateListingInventory wants it. */
const SIZED_BODY = {
  products: [
    ['S', 901, 10],
    ['M', 902, 12],
    ['L', 903, 14]
  ].map(([size, valueId, price]) => ({
    sku: `SKU-${size}`,
    property_values: [{ property_id: 513, value_ids: [valueId], values: [size], property_name: 'Size' }],
    offerings: [{ price, quantity: 5, is_enabled: true, readiness_state_id: 77 }]
  })),
  price_on_property: [513],
  quantity_on_property: [],
  sku_on_property: [513],
  readiness_state_on_property: []
}

describe('inventory actions', () => {
  it('get: getListingInventory with the OAuth token; deleted products left out, entities decoded', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const inv = (await runAction(inventoryFeature, 'get', { listingId: 1001 }, ctx)) as ListingInventory
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0].method).toBe('GET')
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/listings/1001/inventory')
    expect([...fetch.calls[0].url.searchParams.keys()]).toEqual([])
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
    expect(inv.products.map((p) => p.productId)).toEqual([1, 2, 3])
    expect(inv.products[0]).toEqual({
      productId: 1,
      sku: 'SKU-S',
      propertyValues: [{ propertyId: 513, propertyName: 'Size', scaleId: null, scaleName: null, valueIds: [901], values: ['S'] }],
      offerings: [{ offeringId: 10, price: { amount: 1000, divisor: 100, currency: 'USD' }, quantity: 5, isEnabled: true, readinessStateId: 77 }]
    })
    expect(inv.priceOnProperty).toEqual([513])
    const simple = (await runAction(inventoryFeature, 'get', { listingId: 1002 }, ctx)) as ListingInventory
    expect(simple.products[0].sku).toBe('PLAN&1')
  })

  it('get: signed out, a sign-in without listings_r, a bad id — no request', async () => {
    const out = featureCtx(routes, { status: signedOut })
    await expect(runAction(inventoryFeature, 'get', { listingId: 1001 }, out.ctx)).rejects.toThrow('Увійдіть в Etsy')
    const noScope = featureCtx(routes, { status: signedIn({ scopes: ['shops_r'] }) })
    await expect(runAction(inventoryFeature, 'get', { listingId: 1001 }, noScope.ctx)).rejects.toThrow('читання товарів')
    const { ctx, fetch } = featureCtx(routes)
    await expect(runAction(inventoryFeature, 'get', { listingId: 'x' }, ctx)).rejects.toThrow('Некоректний listingId.')
    expect([...out.fetch.calls, ...noScope.fetch.calls, ...fetch.calls]).toHaveLength(0)
  })

  it('get: Etsy errors come through in Ukrainian (404, 500 after a retry)', async () => {
    const nf = featureCtx({ 'GET /v3/application/listings/{id}/inventory': { status: 404, body: { error: 'no inventory' } } })
    await expect(runAction(inventoryFeature, 'get', { listingId: 1001 }, nf.ctx)).rejects.toThrow('HTTP 404')
    const down = featureCtx({ 'GET /v3/application/listings/{id}/inventory': { status: 503 } })
    await expect(runAction(inventoryFeature, 'get', { listingId: 1001 }, down.ctx)).rejects.toThrow('HTTP 503')
    expect(down.fetch.calls).toHaveLength(2)
  })

  it('update: PUT application/json with EVERY product, Money → float, ids/is_deleted/scale_name dropped', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const inv = (await runAction(inventoryFeature, 'get', { listingId: 1001 }, ctx)) as ListingInventory
    const write = inventoryToWrite(inv)
    write.products[1].offerings[0].price = 13.5
    const saved = (await runAction(inventoryFeature, 'update', { listingId: 1001, inventory: write }, ctx)) as ListingInventory
    const [call] = put(fetch)
    expect(call.url.pathname).toBe('/v3/application/listings/1001/inventory')
    expect([...call.url.searchParams.keys()]).toEqual([])
    expect(call.headers['content-type']).toBe('application/json')
    expect(call.headers.authorization).toBe('Bearer tok')
    const expected = structuredClone(SIZED_BODY)
    expected.products[1].offerings[0].price = 13.5
    expect(bodyOf(call)).toEqual(expected)
    expect(saved.products.map((p) => p.productId)).toEqual([5000, 5001, 5002])
    expect(saved.products[1].offerings[0].price).toEqual({ amount: 1350, divisor: 100, currency: 'USD' })
  })

  it('update: a third property adds max_variations_supported=3; a scale id is sent', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const pv = (id: number, v: string) => ({ propertyId: id, propertyName: `P${id}`, scaleId: id === 100 ? 19 : null, valueIds: [], values: [v] })
    const write: InventoryWrite = {
      products: [{ sku: '', propertyValues: [pv(100, '9'), pv(200, 'Red'), pv(513, 'A')], offerings: [{ price: 5, quantity: 1, isEnabled: true, readinessStateId: null }] }],
      priceOnProperty: [],
      quantityOnProperty: [],
      skuOnProperty: [],
      readinessStateOnProperty: []
    }
    await runAction(inventoryFeature, 'update', { listingId: 1001, inventory: write }, ctx)
    const [call] = put(fetch)
    expect(call.url.searchParams.get('max_variations_supported')).toBe('3')
    expect(bodyOf(call).products[0].property_values[0]).toEqual({ property_id: 100, value_ids: [], values: ['9'], property_name: 'P100', scale_id: 19 })
    expect(bodyOf(call).products[0].offerings[0]).toEqual({ price: 5, quantity: 1, is_enabled: true, readiness_state_id: null })
  })

  it('update: malformed or invalid inventories are refused before any request', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await expect(runAction(inventoryFeature, 'update', { listingId: 1001, inventory: 'x' }, ctx)).rejects.toThrow('Некоректні дані інвентарю.')
    await expect(runAction(inventoryFeature, 'update', { listingId: 1001, inventory: { products: [{ propertyValues: [], offerings: [{ price: '5' }] }] } }, ctx)).rejects.toThrow(
      'Некоректні дані інвентарю.'
    )
    const bad: InventoryWrite = {
      products: [{ sku: '', propertyValues: [], offerings: [{ price: 0, quantity: 1000, isEnabled: true, readinessStateId: null }] }],
      priceOnProperty: [],
      quantityOnProperty: [],
      skuOnProperty: [],
      readinessStateOnProperty: []
    }
    await expect(runAction(inventoryFeature, 'update', { listingId: 1001, inventory: bad }, ctx)).rejects.toThrow(
      'Варіант №1: ціна — додатне число, не більше 2 знаків після коми. Варіант №1: кількість — ціле число від 0 до 999.'
    )
    expect(fetch.calls).toHaveLength(0)
    const ro = featureCtx(routes, { status: signedIn({ scopes: ['listings_r'] }) })
    await expect(runAction(inventoryFeature, 'update', { listingId: 1001, inventory: bad }, ro.ctx)).rejects.toThrow('редагування товарів')
  })

  it('update: Etsy 400 (incompatible *_on_property) shows Etsy’s reason; 403; a 5xx PUT is retried once', async () => {
    const r400 = featureCtx({ ...routes, 'PUT /v3/application/listings/{id}/inventory': { status: 400, body: { error: 'price_on_property mismatch' } } })
    const inv = (await runAction(inventoryFeature, 'get', { listingId: 1002 }, r400.ctx)) as ListingInventory
    await expect(runAction(inventoryFeature, 'update', { listingId: 1002, inventory: inventoryToWrite(inv) }, r400.ctx)).rejects.toThrow(
      'Etsy відхилив запит як некоректний (HTTP 400). (price_on_property mismatch)'
    )
    const r403 = featureCtx({ ...routes, 'PUT /v3/application/listings/{id}/inventory': { status: 403 } })
    await expect(runAction(inventoryFeature, 'update', { listingId: 1002, inventory: inventoryToWrite(inv) }, r403.ctx)).rejects.toThrow('HTTP 403')
    const r503 = featureCtx({ ...routes, 'PUT /v3/application/listings/{id}/inventory': { status: 503 } })
    await expect(runAction(inventoryFeature, 'update', { listingId: 1002, inventory: inventoryToWrite(inv) }, r503.ctx)).rejects.toThrow('HTTP 503')
    expect(put(r503.fetch)).toHaveLength(2)
  })

  it('product: getListingProduct (OAuth); offering: getListingOffering (API key only)', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const p = (await runAction(inventoryFeature, 'product', { listingId: 1001, productId: 2 }, ctx)) as { productId: number; sku: string }
    expect(p).toMatchObject({ productId: 2, sku: 'SKU-M' })
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/listings/1001/inventory/products/2')
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
    const o = await runAction(inventoryFeature, 'offering', { listingId: 1001, productId: 2, offeringId: 20 }, ctx)
    expect(o).toEqual({ offeringId: 20, price: { amount: 1200, divisor: 100, currency: 'USD' }, quantity: 5, isEnabled: true, readinessStateId: 77 })
    expect(fetch.calls[1].url.pathname).toBe('/v3/application/listings/1001/products/2/offerings/20')
    expect(fetch.calls[1].headers.authorization).toBeUndefined()
    expect(fetch.calls[1].headers['x-api-key']).toBe('keystring:secret')
    await expect(runAction(inventoryFeature, 'offering', { listingId: 1001, productId: 2, offeringId: 0 }, ctx)).rejects.toThrow('Некоректний offeringId.')
    const out = featureCtx(routes, { status: signedOut })
    await expect(runAction(inventoryFeature, 'offering', { listingId: 1001, productId: 2, offeringId: 20 }, out.ctx)).rejects.toThrow('Увійдіть')
  })

  it('product, quickUpdate, variationImages: signed out or a missing scope → no request', async () => {
    const cases: Array<[string, Record<string, unknown>, string[], string]> = [
      ['product', { listingId: 1001, productId: 2 }, ['shops_r'], 'читання товарів'],
      ['quickUpdate', { listingId: 1002, price: 5 }, ['listings_r'], 'редагування товарів'],
      ['quickUpdate', { listingId: 1002, price: 5 }, ['listings_w'], 'читання товарів'],
      ['variationImages', { listingId: 1001 }, ['listings_w'], 'читання товарів']
    ]
    for (const [action, args, scopes, scopeText] of cases) {
      const out = featureCtx(routes, { status: signedOut })
      await expect(runAction(inventoryFeature, action, args, out.ctx)).rejects.toThrow('Увійдіть в Etsy')
      const noScope = featureCtx(routes, { status: signedIn({ scopes }) })
      await expect(runAction(inventoryFeature, action, args, noScope.ctx)).rejects.toThrow(scopeText)
      expect([...out.fetch.calls, ...noScope.fetch.calls]).toHaveLength(0)
    }
  })

  it('product, quickUpdate, variationImages: Etsy 4xx/5xx come through; nothing is written after a failed read', async () => {
    const productDown = featureCtx({ ...routes, 'GET /v3/application/listings/{id}/inventory/products/{pid}': { status: 404, body: { error: 'no product' } } })
    await expect(runAction(inventoryFeature, 'product', { listingId: 1001, productId: 2 }, productDown.ctx)).rejects.toThrow('no product')
    const invDown = featureCtx({ ...routes, 'GET /v3/application/listings/{id}/inventory': { status: 503 } })
    await expect(runAction(inventoryFeature, 'quickUpdate', { listingId: 1002, price: 5 }, invDown.ctx)).rejects.toThrow('HTTP 503')
    expect(put(invDown.fetch)).toHaveLength(0)
    const putRefused = featureCtx({ ...routes, 'PUT /v3/application/listings/{id}/inventory': { status: 400, body: { error: 'price too low' } } })
    await expect(runAction(inventoryFeature, 'quickUpdate', { listingId: 1002, price: 5 }, putRefused.ctx)).rejects.toThrow('price too low')
    const imagesDown = featureCtx({ ...routes, 'GET /v3/application/listings/{id}/images': { status: 500 } })
    await expect(runAction(inventoryFeature, 'variationImages', { listingId: 1001 }, imagesDown.ctx)).rejects.toThrow('HTTP 500')
    const linksDenied = featureCtx({
      ...routes,
      [`GET /v3/application/shops/${OWN_SHOP}/listings/{id}/variation-images`]: { status: 403, body: { error: 'not yours' } }
    })
    await expect(runAction(inventoryFeature, 'variationImages', { listingId: 1001 }, linksDenied.ctx)).rejects.toThrow('HTTP 403')
    await expect(runAction(inventoryFeature, 'variationImages', { listingId: -1 }, linksDenied.ctx)).rejects.toThrow('Некоректний listingId.')
  })

  it('quickUpdate: a listing without an inventory record gets its own reason, not "several variants"', async () => {
    const empty = { products: [], price_on_property: [], quantity_on_property: [], sku_on_property: [], readiness_state_on_property: [] }
    const { ctx, fetch } = featureCtx({ ...routes, 'GET /v3/application/listings/{id}/inventory': { body: empty } })
    const err = runAction(inventoryFeature, 'quickUpdate', { listingId: 1003, price: 5 }, ctx)
    await expect(err).rejects.toThrow('не має запису інвентарю')
    await expect(err).rejects.not.toThrow('кілька варіантів')
    expect(put(fetch)).toHaveLength(0)
  })

  it('overview: active listings page, then getListingsInventoryByListingIds for those ids', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const page = (await runAction(inventoryFeature, 'overview', {}, ctx)) as InventoryOverviewPage
    const [list, batch] = fetch.calls
    expect(list.url.pathname).toBe(`/v3/application/shops/${OWN_SHOP}/listings`)
    expect(Object.fromEntries(list.url.searchParams)).toEqual({ state: 'active', limit: '100', includes: 'Images' })
    expect(batch.url.pathname).toBe('/v3/application/listings/batch/inventory')
    expect(batch.url.searchParams.get('listing_ids')).toBe('1001,1002,1003')
    expect(batch.headers.authorization).toBe('Bearer tok')
    expect(page.total).toBe(103)
    expect(page.rows[0]).toMatchObject({
      listingId: 1001,
      title: 'Sized planner',
      imageUrl: 'https://i.etsystatic.com/1/il_170x135.10011.jpg',
      imageFullUrl: 'https://i.etsystatic.com/1/il_fullxfull.10011.jpg',
      priceMin: { amount: 1000, divisor: 100, currency: 'USD' },
      priceMax: { amount: 1400, divisor: 100, currency: 'USD' },
      totalQuantity: 15,
      productCount: 3,
      single: null,
      hasInventory: true
    })
    expect(page.rows[1].single).toMatchObject({ productId: 11, quantity: 3 })
    expect(page.rows[2]).toMatchObject({ hasInventory: false, totalQuantity: 9, priceMin: { amount: 777 }, single: null })
    await runAction(inventoryFeature, 'overview', { offset: 100 }, ctx)
    expect(fetch.calls[2].url.searchParams.get('offset')).toBe('100')
    await expect(runAction(inventoryFeature, 'overview', { offset: -1 }, ctx)).rejects.toThrow('Некоректний offset.')
  })

  it('overview: a failing inventory batch fails the page', async () => {
    const { ctx } = featureCtx({ ...routes, 'GET /v3/application/listings/batch/inventory': { status: 404, body: { error: 'listing 1003 not found' } } })
    await expect(runAction(inventoryFeature, 'overview', {}, ctx)).rejects.toThrow('listing 1003 not found')
  })

  it('inventoriesByIds: chunks of 100 ids', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await inventoriesByIds(ctx.client, Array.from({ length: 150 }, (_, i) => i + 1))
    expect(fetch.calls.map((c) => c.url.searchParams.get('listing_ids')!.split(',').length)).toEqual([100, 50])
  })

  it('quickUpdate: a listing without variations — read, then PUT the full inventory with the change', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const inv = (await runAction(inventoryFeature, 'quickUpdate', { listingId: 1002, price: '7,50', quantity: 4 }, ctx)) as ListingInventory
    expect(fetch.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /v3/application/listings/1002/inventory',
      'PUT /v3/application/listings/1002/inventory'
    ])
    expect(bodyOf(put(fetch)[0])).toEqual({
      products: [{ sku: 'PLAN&1', property_values: [], offerings: [{ price: 7.5, quantity: 4, is_enabled: true, readiness_state_id: null }] }],
      price_on_property: [],
      quantity_on_property: [],
      sku_on_property: [],
      readiness_state_on_property: []
    })
    expect(inv.products[0].offerings[0]).toMatchObject({ quantity: 4, price: { amount: 750 } })
    await runAction(inventoryFeature, 'quickUpdate', { listingId: 1002, sku: ' NEW-1 ' }, ctx)
    expect(bodyOf(put(fetch)[1]).products[0]).toMatchObject({ sku: 'NEW-1', offerings: [{ price: 5, quantity: 3 }] })
  })

  it('quickUpdate: refused for listings with variations, bad values, nothing to change', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await expect(runAction(inventoryFeature, 'quickUpdate', { listingId: 1001, price: 9 }, ctx)).rejects.toThrow('кілька варіантів')
    expect(put(fetch)).toHaveLength(0)
    await expect(runAction(inventoryFeature, 'quickUpdate', { listingId: 1002, price: '-1' }, ctx)).rejects.toThrow('Ціна — додатне число')
    await expect(runAction(inventoryFeature, 'quickUpdate', { listingId: 1002, price: 0 }, ctx)).rejects.toThrow('Ціна — додатне число')
    await expect(runAction(inventoryFeature, 'quickUpdate', { listingId: 1002, quantity: 1000 }, ctx)).rejects.toThrow('від 0 до 999')
    await expect(runAction(inventoryFeature, 'quickUpdate', { listingId: 1002 }, ctx)).rejects.toThrow('Нічого не змінено.')
    await expect(runAction(inventoryFeature, 'quickUpdate', { listingId: 1002, price: 1.234 }, ctx)).rejects.toThrow('не більше 2 знаків')
    expect(put(fetch)).toHaveLength(0)
  })

  it('variationImages: properties from the inventory, photos by rank (non-CDN URL dropped), current links', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const d = (await runAction(inventoryFeature, 'variationImages', { listingId: 1001 }, ctx)) as VariationImagesData
    expect(fetch.calls.map((c) => [c.url.pathname, c.headers.authorization ?? null])).toEqual([
      ['/v3/application/listings/1001/inventory', 'Bearer tok'],
      ['/v3/application/listings/1001/images', null],
      [`/v3/application/shops/${OWN_SHOP}/listings/1001/variation-images`, null]
    ])
    expect(d.properties).toEqual([
      { propertyId: 513, name: 'Size', values: [{ valueId: 901, value: 'S' }, { valueId: 902, value: 'M' }, { valueId: 903, value: 'L' }] }
    ])
    expect(d.photos).toEqual([
      { imageId: 5001, url: 'https://i.etsystatic.com/1/il_170x135.5001.jpg', urlFull: 'https://i.etsystatic.com/1/il_fullxfull.5001.jpg', rank: 1, alt: 'Photo & 5001' },
      { imageId: 5002, url: 'https://i.etsystatic.com/1/il_170x135.5002.jpg', urlFull: 'https://i.etsystatic.com/1/il_fullxfull.5002.jpg', rank: 2, alt: 'Photo & 5002' },
      // a non-CDN URL is dropped at every size
      { imageId: 5003, url: null, urlFull: null, rank: 3, alt: 'Photo & 5003' }
    ])
    expect(d.assigned).toEqual([{ propertyId: 513, valueId: 901, value: 'S', imageId: 5002 }])
  })

  it('saveVariationImages: POST application/json variation_images (OAuth); checked first', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const items = [{ propertyId: 513, valueId: 902, imageId: 5001 }]
    const saved = await runAction(inventoryFeature, 'saveVariationImages', { listingId: 1001, items }, ctx)
    const [call] = fetch.calls
    expect(call.method).toBe('POST')
    expect(call.url.pathname).toBe(`/v3/application/shops/${OWN_SHOP}/listings/1001/variation-images`)
    expect(call.headers['content-type']).toBe('application/json')
    expect(call.headers.authorization).toBe('Bearer tok')
    expect(bodyOf(call)).toEqual({ variation_images: [{ property_id: 513, value_id: 902, image_id: 5001 }] })
    expect(saved).toEqual([{ propertyId: 513, valueId: 902, value: 'M', imageId: 5001 }])
    await runAction(inventoryFeature, 'saveVariationImages', { listingId: 1001, items: [] }, ctx)
    expect(bodyOf(fetch.calls[1])).toEqual({ variation_images: [] })
    const dup = [...items, { propertyId: 513, valueId: 902, imageId: 5002 }]
    await expect(runAction(inventoryFeature, 'saveVariationImages', { listingId: 1001, items: dup }, ctx)).rejects.toThrow('лише одне фото')
    await expect(runAction(inventoryFeature, 'saveVariationImages', { listingId: 1001, items: [{ propertyId: 'a' }] }, ctx)).rejects.toThrow(
      'Некоректні дані інвентарю.'
    )
    expect(fetch.calls).toHaveLength(2)
    const ro = featureCtx(routes, { status: signedIn({ scopes: ['listings_r'] }) })
    await expect(runAction(inventoryFeature, 'saveVariationImages', { listingId: 1001, items }, ro.ctx)).rejects.toThrow('редагування товарів')
    const r409 = featureCtx({ ...routes, [`POST /v3/application/shops/${OWN_SHOP}/listings/{id}/variation-images`]: { status: 400, body: { error: 'image not on listing' } } })
    await expect(runAction(inventoryFeature, 'saveVariationImages', { listingId: 1001, items }, r409.ctx)).rejects.toThrow('image not on listing')
    expect(r409.fetch.calls).toHaveLength(1)
  })
})

const TOOL_NAMES = INVENTORY_TOOL_SUMMARY.map((t) => t.name)
const WRITE_TOOLS = INVENTORY_TOOL_SUMMARY.filter((t) => t.write).map((t) => t.name)

/** Valid arguments for every tool. */
const ARGS: Record<string, Record<string, unknown>> = {
  get_my_product_inventory: { product_id: 1001 },
  get_my_inventory_overview: {},
  update_my_product_price: { product_id: 1002, price: 6 },
  update_my_product_inventory: { product_id: 1002, variants: [{ price: 6, quantity: 2 }] },
  get_my_variation_photos: { product_id: 1001 },
  set_my_variation_photos: { product_id: 1001, links: [{ option_id: 513, value_id: 901, photo_id: 5001 }] }
}

describe('inventory MCP tools', () => {
  it('the tool list equals INVENTORY_TOOL_SUMMARY (names, order, write flags); closed schemas', () => {
    const tools = inventoryFeature.mcpTools!(mcpDeps(routes).deps)
    expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES)
    expect(tools.filter((t) => t.readOnly === false).map((t) => t.name)).toEqual(WRITE_TOOLS)
    expect(WRITE_TOOLS).toEqual(['update_my_product_price', 'update_my_product_inventory', 'set_my_variation_photos'])
    for (const t of tools) {
      expect(t.inputSchema.additionalProperties).toBe(false)
      if (t.readOnly === false) {
        expect(t.destructive).toBe(true)
        expect(t.description).toContain('only when the user asked')
      }
    }
  })

  it('get_my_product_inventory: options, varies-by lists and variants with offers', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(inventoryFeature, deps, 'get_my_product_inventory', { product_id: 1001 })
    expect(r.isError).toBe(false)
    expect(r.json).toMatchObject({
      product_id: 1001,
      currency: 'USD',
      options: [{ option_id: 513, name: 'Size', values: [{ value_id: 901, value: 'S' }, { value_id: 902, value: 'M' }, { value_id: 903, value: 'L' }] }],
      price_varies_by: [513],
      quantity_varies_by: [],
      sku_varies_by: [513],
      processing_varies_by: []
    })
    expect(r.json.variants[1]).toEqual({
      variant_id: 2,
      sku: 'SKU-M',
      options: [{ option_id: 513, option_name: 'Size', value: 'M', value_id: 902, scale: null }],
      offers: [{ offer_id: 20, price: 12, currency: 'USD', quantity: 5, enabled: true, processing_profile_id: 77 }]
    })
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/listings/1001/inventory')
  })

  it('get_my_product_inventory: one variant (getListingProduct) / one offer (getListingOffering); offer_id needs variant_id', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const v = await callTool(inventoryFeature, deps, 'get_my_product_inventory', { product_id: 1001, variant_id: 2 })
    expect(v.json).toMatchObject({ product_id: 1001, variant: { variant_id: 2, sku: 'SKU-M' } })
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/listings/1001/inventory/products/2')
    const o = await callTool(inventoryFeature, deps, 'get_my_product_inventory', { product_id: 1001, variant_id: 2, offer_id: 20 })
    expect(o.json).toEqual({
      product_id: 1001,
      variant_id: 2,
      offer: { offer_id: 20, price: 12, currency: 'USD', quantity: 5, enabled: true, processing_profile_id: 77 }
    })
    expect(fetch.calls[1].url.pathname).toBe('/v3/application/listings/1001/products/2/offerings/20')
    const bad = await callTool(inventoryFeature, deps, 'get_my_product_inventory', { product_id: 1001, offer_id: 20 })
    expect(bad).toMatchObject({ isError: true, text: 'offer_id needs variant_id.' })
    const unknown = await callTool(inventoryFeature, deps, 'get_my_product_inventory', { product_id: 1001, extra: 1 })
    expect(unknown).toMatchObject({ isError: true, text: 'Unknown argument "extra".' })
    expect(fetch.calls).toHaveLength(2)
  })

  it('get_my_inventory_overview: the active page by default, or given ids (others reported as not in the store)', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const page = await callTool(inventoryFeature, deps, 'get_my_inventory_overview', { offset: 0, limit: 3 })
    expect(Object.fromEntries(fetch.calls[0].url.searchParams)).toEqual({ state: 'active', limit: '3', includes: 'Images' })
    expect(fetch.calls[1].url.searchParams.get('listing_ids')).toBe('1001,1002,1003')
    expect(page.json.total).toBe(103)
    expect(page.json.products[0]).toEqual({
      product_id: 1001,
      title: 'Sized planner',
      status: 'active',
      currency: 'USD',
      price_min: 10,
      price_max: 14,
      total_quantity: 15,
      variants: 3,
      enabled_variants: 3,
      single_price_entry: false,
      has_variant_data: true
    })
    expect(page.json.products[1]).toMatchObject({ product_id: 1002, single_price_entry: true, price_min: 5, price_max: 5 })
    const byIds = await callTool(inventoryFeature, deps, 'get_my_inventory_overview', { product_ids: [1002, 1002, 4242] })
    expect(fetch.calls[2].url.searchParams.get('listing_ids')).toBe('1002,4242')
    expect(byIds.json.products.map((p: { product_id: number }) => p.product_id)).toEqual([1002])
    expect(byIds.json.not_in_store).toEqual([4242])
    const tooMany = await callTool(inventoryFeature, deps, 'get_my_inventory_overview', { product_ids: Array.from({ length: 101 }, (_, i) => i + 1) })
    expect(tooMany).toMatchObject({ isError: true, text: '"product_ids" must hold 1 to 100 ids.' })
    const bad = await callTool(inventoryFeature, deps, 'get_my_inventory_overview', { product_ids: [0] })
    expect(bad.isError).toBe(true)
  })

  it('get_my_inventory_overview: limit and offset reach the active page (default limit 100)', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(inventoryFeature, deps, 'get_my_inventory_overview', { limit: 10, offset: 20 })
    expect(r.isError).toBe(false)
    expect(Object.fromEntries(fetch.calls[0].url.searchParams)).toEqual({ state: 'active', limit: '10', offset: '20', includes: 'Images' })
    expect(r.json.offset).toBe(20)
    await callTool(inventoryFeature, deps, 'get_my_inventory_overview', {})
    expect(fetch.calls[2].url.searchParams.get('limit')).toBe('100')
  })

  it('get_my_inventory_overview: an unknown id (the batch answers 404) is bisected out and reported, the rest still read', async () => {
    const known = [1001, 1002, 1003]
    const strict = {
      ...routes,
      'GET /v3/application/listings/batch/inventory': (url: URL) => {
        const ids = (url.searchParams.get('listing_ids') ?? '').split(',').map(Number)
        if (ids.some((id) => !known.includes(id))) return { status: 404, body: { error: 'listing not found' } }
        const all = [listing(1001, 'Sized planner', SIZED), listing(1002, 'Simple planner', SIMPLE), listing(1003, 'No inventory', null)]
        return { body: { count: ids.length, results: all.filter((l) => ids.includes(l.listing_id)) } }
      }
    }
    const { deps, fetch } = mcpDeps(strict)
    const r = await callTool(inventoryFeature, deps, 'get_my_inventory_overview', { product_ids: [1001, 4242, 1002, 1003] })
    expect(r.isError).toBe(false)
    expect(r.json.products.map((p: { product_id: number }) => p.product_id)).toEqual([1001, 1002, 1003])
    expect(r.json.not_in_store).toEqual([4242])
    expect(fetch.calls.map((c) => c.url.searchParams.get('listing_ids'))).toEqual(['1001,4242,1002,1003', '1001,4242', '1001', '4242', '1002,1003'])
    const down = mcpDeps({ ...routes, 'GET /v3/application/listings/batch/inventory': { status: 500 } })
    const failed = await callTool(inventoryFeature, down.deps, 'get_my_inventory_overview', { product_ids: [1001, 1002] })
    expect(failed.isError).toBe(true)
    expect(down.fetch.calls).toHaveLength(2)
  })

  it('get_my_inventory_overview: a product of another store is not reported as mine', async () => {
    const foreign = {
      ...routes,
      'GET /v3/application/listings/batch/inventory': { body: { count: 1, results: [{ ...listing(9, 'Other', SIMPLE), shop_id: 1 }] } }
    }
    const r = await callTool(inventoryFeature, mcpDeps(foreign).deps, 'get_my_inventory_overview', { product_ids: [9] })
    expect(r.json).toEqual({ products: [], not_in_store: [9] })
  })

  it('update_my_product_price: GET then PUT the full single-variant inventory', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(inventoryFeature, deps, 'update_my_product_price', { product_id: 1002, price: 6.25, quantity: 0, sku: 'A1' })
    expect(r.isError).toBe(false)
    expect(bodyOf(put(fetch)[0]).products).toEqual([
      { sku: 'A1', property_values: [], offerings: [{ price: 6.25, quantity: 0, is_enabled: true, readiness_state_id: null }] }
    ])
    expect(r.json).toMatchObject({ updated: true, product_id: 1002, variants: [{ variant_id: 5000, sku: 'A1', offers: [{ price: 6.25, quantity: 0 }] }] })
    const none = await callTool(inventoryFeature, deps, 'update_my_product_price', { product_id: 1002 })
    expect(none).toMatchObject({ isError: true, text: 'Give price, quantity or sku.' })
    const multi = await callTool(inventoryFeature, deps, 'update_my_product_price', { product_id: 1001, price: 3 })
    expect(multi.isError).toBe(true)
    expect(multi.text).toContain('use update_my_product_inventory')
    const badPrice = await callTool(inventoryFeature, deps, 'update_my_product_price', { product_id: 1002, price: 1.005 })
    expect(badPrice.text).toBe('Variant #1: the price must be a positive number with at most 2 decimals.')
    const empty = { products: [], price_on_property: [], quantity_on_property: [], sku_on_property: [], readiness_state_on_property: [] }
    const bare = mcpDeps({ ...routes, 'GET /v3/application/listings/{id}/inventory': { body: empty } })
    const noRecord = await callTool(inventoryFeature, bare.deps, 'update_my_product_price', { product_id: 1003, price: 3 })
    expect(noRecord).toMatchObject({ isError: true, text: expect.stringContaining('Etsy has no inventory record for this listing yet') })
    expect(put(bare.fetch)).toHaveLength(0)
    const badQty = await callTool(inventoryFeature, deps, 'update_my_product_price', { product_id: 1002, quantity: 1000 })
    expect(badQty.text).toBe('Argument "quantity" must be ≤ 999.')
    expect(put(fetch)).toHaveLength(1)
  })

  it('update_my_product_inventory: the MCP variants list → the full inventory (ids looked up, processing kept, varies-by defaults)', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(inventoryFeature, deps, 'update_my_product_inventory', {
      product_id: 1001,
      variants: [
        { options: [{ option_id: 513, value: 's' }], sku: 'SKU-S', price: 11, quantity: 4 },
        { options: [{ option_id: 513, value: 'M' }], sku: 'SKU-M', price: 12, quantity: 4, enabled: false },
        { options: [{ option_id: 513, value: 'XXL' }], sku: 'SKU-XXL', price: 15, quantity: 4, processing_profile_id: 88 }
      ],
      processing_varies_by: [513]
    })
    expect(r.isError).toBe(false)
    const body = bodyOf(put(fetch)[0])
    expect(body.products).toEqual([
      { sku: 'SKU-S', property_values: [{ property_id: 513, value_ids: [901], values: ['s'], property_name: 'Size' }], offerings: [{ price: 11, quantity: 4, is_enabled: true, readiness_state_id: 77 }] },
      { sku: 'SKU-M', property_values: [{ property_id: 513, value_ids: [902], values: ['M'], property_name: 'Size' }], offerings: [{ price: 12, quantity: 4, is_enabled: false, readiness_state_id: 77 }] },
      { sku: 'SKU-XXL', property_values: [{ property_id: 513, value_ids: [], values: ['XXL'], property_name: 'Size' }], offerings: [{ price: 15, quantity: 4, is_enabled: true, readiness_state_id: 88 }] }
    ])
    expect(body).toMatchObject({ price_on_property: [513], quantity_on_property: [], sku_on_property: [513], readiness_state_on_property: [513] })
    expect(r.json.variants).toHaveLength(3)
  })

  it('update_my_product_inventory: explicit varies-by lists, a new option, validation in English, nothing sent', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const ok = await callTool(inventoryFeature, deps, 'update_my_product_inventory', {
      product_id: 1002,
      variants: [
        { options: [{ option_id: 514, option_name: 'Color', value: 'Red', value_id: 77 }], price: 5, quantity: 1 },
        { options: [{ option_id: 514, option_name: 'Color', value: 'Blue' }], price: 6, quantity: 1 }
      ],
      price_varies_by: [514]
    })
    expect(ok.isError).toBe(false)
    const body = bodyOf(put(fetch)[0])
    expect(body.products[0].property_values).toEqual([{ property_id: 514, value_ids: [77], values: ['Red'], property_name: 'Color' }])
    expect(body.price_on_property).toEqual([514])
    const same = await callTool(inventoryFeature, deps, 'update_my_product_inventory', {
      product_id: 1001,
      variants: [
        { options: [{ option_id: 513, value: 'S' }], sku: 'SKU-S', price: 11, quantity: 4 },
        { options: [{ option_id: 513, value: 'M' }], sku: 'SKU-M', price: 12, quantity: 5 }
      ]
    })
    expect(same).toMatchObject({ isError: true, text: 'The quantity must be the same for every variant, or make it depend on an option.' })
    const cases: Array<[unknown, string]> = [
      [[], '"variants" must be a non-empty list.'],
      [[{ price: 1, quantity: 1, color: 'x' }], 'variants[0]: unknown field "color".'],
      [[{ price: '1', quantity: 1 }], 'variants[0].price must be a number.'],
      [[{ price: 1, quantity: 1.5 }], 'variants[0].quantity must be a whole number.'],
      [[{ price: 1, quantity: 1, options: [{ option_id: 0, value: 'x' }] }], 'variants[0].options[0].option_id must be a positive whole number.'],
      [[{ price: 1, quantity: 1, options: [{ option_id: 5, value: ' ' }] }], 'variants[0].options[0].value must be non-empty text.'],
      [[{ price: 1, quantity: 1, options: [{ option_id: 5, value: 'a(b)' }] }], 'The value "a(b)" contains parentheses, which are not allowed.']
    ]
    for (const [variants, text] of cases) {
      const r = await callTool(inventoryFeature, deps, 'update_my_product_inventory', { product_id: 1001, variants })
      expect(r).toMatchObject({ isError: true, text })
    }
    const badIds = await callTool(inventoryFeature, deps, 'update_my_product_inventory', {
      product_id: 1001,
      variants: [{ price: 1, quantity: 1 }],
      sku_varies_by: ['x']
    })
    expect(badIds.text).toBe('"sku_varies_by" must be a list of positive whole numbers.')
    expect(put(fetch)).toHaveLength(1)
  })

  it('get_my_variation_photos / set_my_variation_photos', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const g = await callTool(inventoryFeature, deps, 'get_my_variation_photos', { product_id: 1001 })
    expect(g.json).toEqual({
      product_id: 1001,
      options: [
        {
          option_id: 513,
          name: 'Size',
          values: [
            { value_id: 901, value: 'S', photo_id: 5002 },
            { value_id: 902, value: 'M', photo_id: null },
            { value_id: 903, value: 'L', photo_id: null }
          ]
        }
      ],
      photos: [
        { photo_id: 5001, position: 1, alt_text: 'Photo & 5001' },
        { photo_id: 5002, position: 2, alt_text: 'Photo & 5002' },
        { photo_id: 5003, position: 3, alt_text: 'Photo & 5003' }
      ]
    })
    const s = await callTool(inventoryFeature, deps, 'set_my_variation_photos', ARGS.set_my_variation_photos)
    expect(s.json).toEqual({ product_id: 1001, links: [{ option_id: 513, value_id: 901, value: 'M', photo_id: 5001 }] })
    const post = fetch.calls.find((c) => c.method === 'POST')!
    expect(bodyOf(post)).toEqual({ variation_images: [{ property_id: 513, value_id: 901, image_id: 5001 }] })
    const two = await callTool(inventoryFeature, deps, 'set_my_variation_photos', {
      product_id: 1001,
      links: [
        { option_id: 513, value_id: 901, photo_id: 5001 },
        { option_id: 200, value_id: 1, photo_id: 5002 }
      ]
    })
    expect(two).toMatchObject({ isError: true, text: 'Photos can be linked to values of one option only.' })
    const bad = await callTool(inventoryFeature, deps, 'set_my_variation_photos', { product_id: 1001, links: [{ option_id: 513, value_id: 901 }] })
    expect(bad).toMatchObject({ isError: true, text: 'links[0].photo_id must be a positive whole number.' })
    expect(fetch.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('every tool: not signed in → the sign-in note; a sign-in lacking the scope → a note naming the OAuth scope', async () => {
    for (const name of TOOL_NAMES) {
      const { deps, fetch } = mcpDeps(routes, { status: signedOut })
      const r = await callTool(inventoryFeature, deps, name, ARGS[name])
      expect(r.isError, name).toBe(true)
      expect(r.text).toBe(NOT_SIGNED_IN)
      expect(fetch.calls).toHaveLength(0)
      const none = mcpDeps(routes, { status: signedIn({ scopes: [] }) })
      const s = await callTool(inventoryFeature, none.deps, name, ARGS[name])
      expect(s.text, name).toMatch(/Etsy sign-in lacks .*\(listings_[rw](, listings_[rw])?\)/)
      expect(none.fetch.calls).toHaveLength(0)
    }
  })

  it('write tools: changes switched off → WRITES_OFF, nothing sent; read tools still work', async () => {
    for (const name of TOOL_NAMES) {
      const { deps, fetch } = mcpDeps(routes, { writes: false })
      const r = await callTool(inventoryFeature, deps, name, ARGS[name])
      if (WRITE_TOOLS.includes(name)) {
        expect(r.text, name).toBe(WRITES_OFF)
        expect(fetch.calls).toHaveLength(0)
      } else expect(r.isError, name).toBe(false)
    }
  })

  it('Etsy errors reach the client with what Etsy said (403, 400 with a detail and a link, 5xx)', async () => {
    const failing = {
      ...routes,
      'GET /v3/application/listings/{id}/inventory': { status: 403, body: { error: 'Not your Etsy listing https://www.etsy.com/x' } },
      'PUT /v3/application/listings/{id}/inventory': { status: 400, body: { error: 'Etsy says: bad product' } },
      [`POST /v3/application/shops/${OWN_SHOP}/listings/{id}/variation-images`]: { status: 500 }
    }
    const { deps } = mcpDeps(failing)
    const g = await callTool(inventoryFeature, deps, 'get_my_product_inventory', { product_id: 1001 })
    expect(g.text).toBe('Etsy refused this action (HTTP 403): Not your Etsy listing https://www.etsy.com/x.')
    const okGet = mcpDeps({ ...failing, 'GET /v3/application/listings/{id}/inventory': routes['GET /v3/application/listings/{id}/inventory'] })
    const u = await callTool(inventoryFeature, okGet.deps, 'update_my_product_price', { product_id: 1002, price: 3 })
    expect(u.text).toBe('Etsy rejected the request as invalid (HTTP 400): Etsy says: bad product.')
    const s = await callTool(inventoryFeature, okGet.deps, 'set_my_variation_photos', ARGS.set_my_variation_photos)
    expect(s.isError).toBe(true)
    expect(okGet.fetch.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('tool texts name Etsy, its calls and OAuth scopes; writes say they change the live Etsy shop', () => {
    const tools = inventoryFeature.mcpTools!(mcpDeps(routes).deps)
    for (const t of tools) {
      expect(t.description, t.name).toContain('Etsy')
      expect(t.description, t.name).toMatch(/listings_[rw]/)
      if (t.readOnly === false) expect(t.description, t.name).toContain("changes the user's live Etsy shop")
      else expect(t.description, t.name).toMatch(/^Live from the Etsy API/)
    }
  })

  it('honesty: shop text reaches the client unchanged; no CDN URL, no raw_json, no token or key in anything a client gets', async () => {
    const etsyish = {
      ...routes,
      'GET /v3/application/listings/batch/inventory': {
        body: { count: 1, results: [{ ...listing(1001, 'Best Etsy planner https://www.etsy.com/listing/1', SIZED), raw_json: '{"secret":1}' }] }
      },
      [`GET /v3/application/shops/${OWN_SHOP}/listings`]: { body: { count: 1, results: [listing(1001, 'Etsy planner etsy.me/abc', undefined)] } },
      'GET /v3/application/listings/{id}/inventory': (url: URL) => ({
        body: url.pathname.includes('/1003/')
          ? {
              ...SIMPLE,
              products: [
                {
                  ...SIMPLE.products[0],
                  property_values: [
                    { property_id: 600, property_name: 'Etsy colour', scale_id: null, scale_name: null, value_ids: [1], values: ['Etsy red (https://etsy.com/x)'] }
                  ]
                }
              ]
            }
          : {
              ...SIZED,
              products: SIZED.products.map((p) => ({
                ...p,
                sku: 'ETSY-https://etsy.com/x',
                property_values: p.property_values.map((v) => ({ ...v, property_name: 'Etsy size', scale_name: 'Etsy scale', values: [`${v.values[0]} etsy.com/x`] }))
              }))
            }
      }),
      'GET /v3/application/listings/{id}/images': {
        body: { count: 1, results: [{ ...image(5001, 1), alt_text: 'Etsy photo, see https://www.etsy.com/listing/1' }] }
      },
      [`POST /v3/application/shops/${OWN_SHOP}/listings/{id}/variation-images`]: {
        body: { count: 1, results: [{ property_id: 513, value_id: 901, value: 'Etsy S', image_id: 5001 }] }
      }
    }
    const TOKEN = 'oauth-access-token-XYZ123'
    const withToken = (over: Parameters<typeof mcpDeps>[1] = {}) => mcpDeps(etsyish, { ...over, client: testClient(routedFetch(etsyish), TOKEN) })
    const { deps } = withToken()
    const texts: string[] = [JSON.stringify(inventoryFeature.mcpTools!(deps).map(({ run: _run, ...t }) => t))]
    const calls: Array<[string, Record<string, unknown>]> = [
      ...TOOL_NAMES.map((n): [string, Record<string, unknown>] => [n, ARGS[n]]),
      ['get_my_product_inventory', { product_id: 1001, variant_id: 2 }],
      ['get_my_product_inventory', { product_id: 1001, variant_id: 2, offer_id: 20 }],
      ['get_my_inventory_overview', { product_ids: [1001] }],
      ['update_my_product_price', { product_id: 1001, price: 2 }],
      ['update_my_product_inventory', { product_id: 1001, variants: [{ price: 0, quantity: 1 }] }],
      // refusals that quote the shop's own option names and values
      ['update_my_product_price', { product_id: 1003, price: 1.234 }],
      [
        'update_my_product_inventory',
        {
          product_id: 1001,
          variants: ['red', 'blue'].map((colour, i) => ({
            options: [
              { option_id: 513, value: 'S etsy.com/x' },
              { option_id: 600, option_name: 'Etsy colour https://etsy.com/c', value: `Etsy ${colour}` }
            ],
            price: i + 1,
            quantity: 1
          })),
          price_varies_by: [513]
        }
      ]
    ]
    const results: Record<string, string[]> = {}
    for (const [name, args] of calls) {
      const r = await callTool(inventoryFeature, deps, name, args)
      ;(results[name] ??= []).push(r.text)
      texts.push(r.text)
    }
    for (const name of TOOL_NAMES) {
      texts.push((await callTool(inventoryFeature, withToken({ status: signedOut }).deps, name, ARGS[name])).text)
      texts.push((await callTool(inventoryFeature, withToken({ writes: false }).deps, name, ARGS[name])).text)
    }
    const all = texts.join('\n')
    // (a) the shop's own text, exactly as Etsy holds it
    expect(results.get_my_inventory_overview.join('\n')).toContain('"title":"Etsy planner etsy.me/abc"')
    expect(results.get_my_inventory_overview.join('\n')).toContain('"title":"Best Etsy planner https://www.etsy.com/listing/1"')
    const inv = JSON.parse(results.get_my_product_inventory[0])
    expect(inv.variants[0]).toMatchObject({ sku: 'ETSY-https://etsy.com/x', options: [{ option_name: 'Etsy size', value: 'S etsy.com/x', scale: 'Etsy scale' }] })
    expect(inv.options[0]).toMatchObject({ name: 'Etsy size', values: [{ value: 'S etsy.com/x' }, { value: 'M etsy.com/x' }, { value: 'L etsy.com/x' }] })
    const photos = JSON.parse(results.get_my_variation_photos[0])
    expect(photos.photos).toEqual([{ photo_id: 5001, position: 1, alt_text: 'Etsy photo, see https://www.etsy.com/listing/1' }])
    expect(JSON.parse(results.set_my_variation_photos[0]).links[0].value).toBe('Etsy S')
    expect(all).toContain('Variant "Etsy red (https://etsy.com/x)": the price must be')
    expect(all).toContain('The value "Etsy red (https://etsy.com/x)" contains parentheses')
    expect(all).toContain('The price must be the same for variants with the same Etsy size')
    // (b) never a CDN URL (the fixtures' photos all have one), raw API data, the token or the API key
    for (const t of texts) {
      expect(t).not.toMatch(/etsystatic\.com/i)
      expect(t).not.toContain('raw_json')
      expect(t).not.toContain(TOKEN)
      expect(t).not.toContain('keystring')
    }
  })
})
