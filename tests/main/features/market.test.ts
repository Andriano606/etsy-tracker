import { describe, expect, it } from 'vitest'
import {
  buyerCategories,
  flattenBuyerTaxonomy,
  marketFeature,
  matchCategories
} from '../../../src/main/features/market'
import { MARKET_TOOL_SUMMARY } from '../../../src/shared/features/market'
import { ASSOCIATION_KEYS, mkEtsyImage, mkEtsyListing } from '../../helpers/fakeEtsy'
import { callTool, featureCtx, mcpDeps, routedFetch, runAction, signedOut, testClient } from '../../helpers/features'

/** A /listings/active page item: a listing without its associations. */
function pageItem(id: number, over: Record<string, unknown> = {}) {
  const l: Record<string, unknown> = { ...mkEtsyListing(id), shop_id: 7000 + id, ...over }
  for (const k of ASSOCIATION_KEYS) delete l[k]
  return l
}

const PAGE = {
  count: 1234,
  results: [
    pageItem(1, { title: 'Mug &amp; cup', tags: ['mug &amp; cup', 'gift'], original_creation_timestamp: 1_600_000_000 }),
    pageItem(2, { url: 'https://evil.example/listing/2', views: undefined, num_favorers: undefined })
  ]
}

const BATCH = {
  count: 2,
  results: [
    mkEtsyListing(1, { images: [mkEtsyImage(1, 2), mkEtsyImage(1, 1)] }),
    mkEtsyListing(2, { images: [mkEtsyImage(2, 1, { url_570xN: 'file:///etc/passwd' })], views: 77 })
  ]
}

const TREE = {
  count: 2,
  results: [
    {
      id: 1,
      level: 0,
      name: 'Home &amp; Living',
      parent_id: null,
      children: [
        { id: 11, level: 1, name: 'Kitchen', parent_id: 1, children: [{ id: 111, level: 2, name: 'Mugs', parent_id: 11, children: [] }] },
        { id: 12, level: 1, name: 'Wall Art', parent_id: 1, children: [] }
      ]
    },
    { id: 2, level: 0, name: 'Art & Collectibles', parent_id: null, children: [{ id: 21, level: 1, name: 'Prints', parent_id: 2 }] }
  ]
}

const PROPS = {
  count: 1,
  results: [
    {
      property_id: 200,
      name: 'primary_color',
      display_name: 'Primary color',
      scales: [{ scale_id: 5, display_name: 'Inches', description: 'Length &amp; width' }],
      is_required: false,
      supports_attributes: true,
      supports_variations: true,
      is_multivalued: true,
      max_values_allowed: 2,
      possible_values: [
        { value_id: 1, name: 'Red', scale_id: null, equal_to: [] },
        { value_id: null, name: 'Etsy blue', scale_id: 5, equal_to: [] }
      ],
      selected_values: []
    }
  ]
}

const routes = {
  'GET /v3/application/listings/active': { body: PAGE },
  'GET /v3/application/listings/batch': { body: BATCH },
  'GET /v3/application/buyer-taxonomy/nodes': { body: TREE },
  'GET /v3/application/buyer-taxonomy/nodes/{id}/properties': { body: PROPS },
  'GET /v3/application/shops/{id}': { body: { shop_id: 7001, shop_name: 'FoxPrints', title: null, currency_code: 'USD', listing_active_count: 3, url: '', icon_url_fullxfull: null } }
}

const q = (url: URL) => Object.fromEntries(url.searchParams)
const searchCalls = (fetch: ReturnType<typeof routedFetch>) => fetch.calls.filter((c) => c.url.pathname === '/v3/application/listings/active')

describe('market: search (findAllListingsActive)', () => {
  it('sends every OAS query parameter, then reads the photos in ONE batch call', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const r = await runAction(
      marketFeature,
      'search',
      { keywords: ' planner ', taxonomyId: 111, minPrice: '2.5', maxPrice: 40, sort: 'price_low', shopLocation: 'Ukraine', limit: 24, offset: 48 },
      ctx
    )
    expect(fetch.calls).toHaveLength(2)
    const [search, batch] = fetch.calls
    expect(search.method).toBe('GET')
    expect(search.url.pathname).toBe('/v3/application/listings/active')
    expect(q(search.url)).toEqual({
      limit: '24',
      offset: '48',
      keywords: 'planner',
      sort_on: 'price',
      sort_order: 'asc',
      min_price: '2.5',
      max_price: '40',
      taxonomy_id: '111',
      shop_location: 'Ukraine'
    })
    // API key only — no OAuth token on public endpoints.
    expect(search.headers['x-api-key']).toBe('keystring:secret')
    expect(search.headers.authorization).toBeUndefined()
    expect(batch.url.pathname).toBe('/v3/application/listings/batch')
    expect(q(batch.url)).toEqual({ listing_ids: '1,2', includes: 'Images,Videos,Personalization' })
    expect(batch.headers.authorization).toBeUndefined()

    expect(r).toEqual({
      count: 1234,
      offset: 48,
      limit: 24,
      sorted: true,
      imagesError: null,
      listings: [
        {
          listingId: 1,
          shopId: 7001,
          title: 'Mug & cup',
          priceAmount: 1001,
          priceDivisor: 100,
          currency: 'UAH',
          url: 'https://www.etsy.com/listing/1/item',
          tags: ['mug & cup', 'gift'],
          numFavorers: 11,
          views: 101,
          createdAt: 1_600_000_000,
          imageUrl: 'https://i.etsystatic.com/1/il_570xN.11.jpg',
          imageFullUrl: 'https://i.etsystatic.com/1/il_fullxfull.11.jpg'
        },
        {
          listingId: 2,
          shopId: 7002,
          title: 'Listing 2',
          priceAmount: 1002,
          priceDivisor: 100,
          currency: 'UAH',
          url: null,
          tags: expect.any(Array),
          numFavorers: null,
          views: 77,
          createdAt: 1_700_000_000,
          imageUrl: null,
          imageFullUrl: null
        }
      ]
    })
  })

  it('defaults: relevance (score, desc), 24 per page, offset 0; empty filters are not sent', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await runAction(marketFeature, 'search', { keywords: 'mug', minPrice: '', maxPrice: null, shopLocation: '  ' }, ctx)
    expect(q(searchCalls(fetch)[0].url)).toEqual({ limit: '24', offset: '0', keywords: 'mug', sort_on: 'score', sort_order: 'desc' })
  })

  it.each([
    ['newest', 'created', 'desc'],
    ['oldest', 'created', 'asc'],
    ['price_high', 'price', 'desc'],
    ['updated', 'updated', 'desc']
  ])('sort %s → sort_on=%s, sort_order=%s', async (sort, on, order) => {
    const { ctx, fetch } = featureCtx(routes)
    await runAction(marketFeature, 'search', { taxonomyId: 12, sort }, ctx)
    const p = q(searchCalls(fetch)[0].url)
    expect([p.sort_on, p.sort_order, p.taxonomy_id]).toEqual([on, order, '12'])
  })

  it('a price range alone is a valid search; the sort is then not sent (the OAS: sort_on/sort_order need a search option)', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const r = (await runAction(marketFeature, 'search', { minPrice: 5, sort: 'price_low' }, ctx)) as any
    expect(q(searchCalls(fetch)[0].url)).toEqual({ limit: '24', offset: '0', min_price: '5' })
    expect(r).toMatchObject({ count: 1234, sorted: false })
    const max = featureCtx(routes)
    await runAction(marketFeature, 'search', { maxPrice: '20' }, max.ctx)
    expect(q(searchCalls(max.fetch)[0].url)).toEqual({ limit: '24', offset: '0', max_price: '20' })
  })

  it('an answer without a results array is an error, not "nothing found"', async () => {
    const { ctx, fetch } = featureCtx({ ...routes, 'GET /v3/application/listings/active': { body: { count: 5 } } })
    await expect(runAction(marketFeature, 'search', { keywords: 'mug' }, ctx)).rejects.toThrow('Etsy повернув неочікувану відповідь.')
    expect(fetch.calls).toHaveLength(1)
  })

  it('the full-size photo is validated too: a non-CDN fullxfull falls back to the 570xN, no thumbnail = no full size', async () => {
    const batch = {
      count: 2,
      results: [
        mkEtsyListing(1, { images: [mkEtsyImage(1, 1, { url_fullxfull: 'https://evil.example/full.jpg' })] }),
        mkEtsyListing(2, { images: [mkEtsyImage(2, 1, { url_570xN: 'file:///etc/passwd' })] })
      ]
    }
    const { ctx } = featureCtx({ ...routes, 'GET /v3/application/listings/batch': { body: batch } })
    const r = (await runAction(marketFeature, 'search', { keywords: 'mug' }, ctx)) as any
    expect(r.listings.map((l: any) => [l.imageUrl, l.imageFullUrl])).toEqual([
      ['https://i.etsystatic.com/1/il_570xN.11.jpg', 'https://i.etsystatic.com/1/il_570xN.11.jpg'],
      [null, null]
    ])
  })

  it('a failing photo batch only costs the photos', async () => {
    const { ctx } = featureCtx({ ...routes, 'GET /v3/application/listings/batch': { status: 500, body: { error: 'boom' } } })
    const r = (await runAction(marketFeature, 'search', { keywords: 'mug' }, ctx)) as any
    expect(r.listings).toHaveLength(2)
    expect(r.listings.every((l: any) => l.imageUrl === null && l.imageFullUrl === null)).toBe(true)
    expect(r.imagesError).toMatch(/^Фото не завантажилися: Сервер Etsy повернув помилку \(HTTP 500\)/)
  })

  it('no results → no batch call', async () => {
    const { ctx, fetch } = featureCtx({ ...routes, 'GET /v3/application/listings/active': { body: { count: 0, results: [] } } })
    const r = (await runAction(marketFeature, 'search', { keywords: 'zzz' }, ctx)) as any
    expect(r).toMatchObject({ count: 0, listings: [] })
    expect(fetch.calls).toHaveLength(1)
  })

  it.each([
    [{}, 'Вкажіть ключові слова, категорію, розташування магазину або ціну.'],
    [{ keywords: '   ', minPrice: '', maxPrice: null }, 'Вкажіть ключові слова'],
    [{ keywords: 'a', minPrice: 10, maxPrice: 5 }, 'Ціна «від» більша за ціну «до».'],
    [{ keywords: 'a', minPrice: -1 }, 'Ціна від має бути невід’ємним числом.'],
    [{ keywords: 'a', maxPrice: 'abc' }, 'Ціна до має бути невід’ємним числом.'],
    [{ keywords: 'a', sort: 'cheapest' }, 'Невідоме сортування.'],
    [{ keywords: 'a', sort: 'toString' }, 'Невідоме сортування.'],
    [{ taxonomyId: 0 }, 'Некоректний taxonomyId.'],
    [{ keywords: 'a', limit: 0 }, 'Некоректний limit'],
    [{ keywords: 'a', limit: 101 }, 'Некоректний limit'],
    [{ keywords: 'a', offset: 12001 }, 'Некоректний offset'],
    [{ keywords: 'a', offset: 1.5 }, 'Некоректний offset'],
    [{ keywords: 'x'.repeat(201) }, 'довше за 200'],
    [{ keywords: 5 }, 'має бути текстом'],
    [{ shopLocation: 'x'.repeat(101) }, 'довше за 100']
  ])('bad args %j → %s, nothing sent', async (args, msg) => {
    const { ctx, fetch } = featureCtx(routes)
    await expect(runAction(marketFeature, 'search', args, ctx)).rejects.toThrow(msg)
    expect(fetch.calls).toHaveLength(0)
  })

  it('Etsy errors come through in Ukrainian (unparsable location → 400, 429)', async () => {
    const bad = featureCtx({ ...routes, 'GET /v3/application/listings/active': { status: 400, body: { error: 'Invalid shop_location' } } })
    await expect(runAction(marketFeature, 'search', { shopLocation: 'Nowhere' }, bad.ctx)).rejects.toThrow(
      'Etsy відхилив запит як некоректний (HTTP 400). (Invalid shop_location)'
    )
    const busy = featureCtx({ ...routes, 'GET /v3/application/listings/active': { status: 429, headers: { 'retry-after': '3600' } } })
    await expect(runAction(marketFeature, 'search', { keywords: 'a' }, busy.ctx)).rejects.toThrow('Перевищено ліміт')
  })

  it('works without an Etsy sign-in (public search)', async () => {
    const { ctx } = featureCtx(routes, { status: signedOut })
    await expect(runAction(marketFeature, 'search', { keywords: 'mug' }, ctx)).resolves.toMatchObject({ count: 1234 })
  })
})

describe('market: buyer categories (getBuyerTaxonomyNodes)', () => {
  it('flattens the tree into decoded paths', () => {
    expect(flattenBuyerTaxonomy(TREE.results)).toEqual([
      { id: 1, name: 'Home & Living', level: 0, parentId: null, path: 'Home & Living' },
      { id: 11, name: 'Kitchen', level: 1, parentId: 1, path: 'Home & Living › Kitchen' },
      { id: 111, name: 'Mugs', level: 2, parentId: 11, path: 'Home & Living › Kitchen › Mugs' },
      { id: 12, name: 'Wall Art', level: 1, parentId: 1, path: 'Home & Living › Wall Art' },
      { id: 2, name: 'Art & Collectibles', level: 0, parentId: null, path: 'Art & Collectibles' },
      { id: 21, name: 'Prints', level: 1, parentId: 2, path: 'Art & Collectibles › Prints' }
    ])
  })

  it('matches every word of the path, own name first, then shallower; an id; the roots for an empty query; capped', () => {
    const all = flattenBuyerTaxonomy(TREE.results)
    expect(matchCategories(all, 'HOME kit', 10).categories.map((c) => c.id)).toEqual([11, 111])
    expect(matchCategories(all, 'mugs', 10).categories.map((c) => c.id)).toEqual([111])
    expect(matchCategories(all, 'art', 10).categories.map((c) => c.id)).toEqual([2, 12, 21])
    expect(matchCategories(all, '21', 10).categories.map((c) => c.id)).toEqual([21])
    expect(matchCategories(all, ' ', 10)).toEqual({ total: 2, categories: [all[0], all[4]] })
    expect(matchCategories(all, 'home', 2)).toMatchObject({ total: 4, categories: [{ id: 1 }, { id: 11 }] })
    expect(matchCategories(all, 'nothing here', 10)).toEqual({ total: 0, categories: [] })
  })

  it('action: GET /buyer-taxonomy/nodes once per client (cached), API key only', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const a = (await runAction(marketFeature, 'categories', { query: 'mugs' }, ctx)) as any
    expect(a).toEqual({ total: 1, categories: [{ id: 111, name: 'Mugs', level: 2, parentId: 11, path: 'Home & Living › Kitchen › Mugs' }] })
    await runAction(marketFeature, 'categories', { query: 'wall', limit: 5 }, ctx)
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/buyer-taxonomy/nodes')
    expect([...fetch.calls[0].url.searchParams]).toEqual([])
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
  })

  it('a failed load is not cached', async () => {
    let n = 0
    const fetch = routedFetch({ 'GET /v3/application/buyer-taxonomy/nodes': () => (n++ === 0 ? { status: 404, body: { error: 'x' } } : { body: TREE }) })
    const client = testClient(fetch)
    await expect(buyerCategories(client)).rejects.toThrow('HTTP 404')
    await expect(buyerCategories(client)).resolves.toHaveLength(6)
  })

  it('a 200 answer without a results array is an error and is not cached', async () => {
    let n = 0
    const fetch = routedFetch({ 'GET /v3/application/buyer-taxonomy/nodes': () => (n++ === 0 ? { body: { count: 0 } } : { body: TREE }) })
    const client = testClient(fetch)
    await expect(buyerCategories(client)).rejects.toThrow('Etsy повернув неочікувану відповідь.')
    await expect(buyerCategories(client)).resolves.toHaveLength(6)
    expect(fetch.calls).toHaveLength(2)
  })

  it('bad args', async () => {
    const { ctx } = featureCtx(routes)
    await expect(runAction(marketFeature, 'categories', { query: 5 }, ctx)).rejects.toThrow('має бути текстом')
    await expect(runAction(marketFeature, 'categories', { query: 'a', limit: 0 }, ctx)).rejects.toThrow('Некоректний limit')
  })
})

describe('market: category properties (getPropertiesByBuyerTaxonomyId)', () => {
  it('GET /buyer-taxonomy/nodes/{taxonomy_id}/properties, mapped and decoded', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const r = await runAction(marketFeature, 'properties', { taxonomyId: 111 }, ctx)
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/buyer-taxonomy/nodes/111/properties')
    expect(fetch.calls[0].method).toBe('GET')
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
    expect(r).toEqual([
      {
        propertyId: 200,
        name: 'primary_color',
        displayName: 'Primary color',
        isRequired: false,
        supportsAttributes: true,
        supportsVariations: true,
        isMultivalued: true,
        maxValuesAllowed: 2,
        scales: [{ scaleId: 5, name: 'Inches', description: 'Length & width' }],
        possibleValues: [
          { valueId: 1, name: 'Red', scaleId: null },
          { valueId: null, name: 'Etsy blue', scaleId: 5 }
        ]
      }
    ])
  })

  it('bad id → nothing sent; Etsy 404 → Ukrainian error', async () => {
    const { ctx, fetch } = featureCtx({ ...routes, 'GET /v3/application/buyer-taxonomy/nodes/{id}/properties': { status: 404, body: { error: 'No taxonomy' } } })
    await expect(runAction(marketFeature, 'properties', { taxonomyId: 'x' }, ctx)).rejects.toThrow('Некоректний taxonomyId.')
    expect(fetch.calls).toHaveLength(0)
    await expect(runAction(marketFeature, 'properties', { taxonomyId: 9 }, ctx)).rejects.toThrow('HTTP 404')
    const odd = featureCtx({ ...routes, 'GET /v3/application/buyer-taxonomy/nodes/{id}/properties': { body: {} } })
    await expect(runAction(marketFeature, 'properties', { taxonomyId: 9 }, odd.ctx)).rejects.toThrow('неочікувану відповідь')
  })
})

describe('market: shop name for "Стежити за магазином" (getShop)', () => {
  it('GET /shops/{shop_id} → shop_name', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await expect(runAction(marketFeature, 'shopName', { shopId: 7001 }, ctx)).resolves.toBe('FoxPrints')
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/shops/7001')
  })

  it('bad id, 404, or no name', async () => {
    const { ctx } = featureCtx({ ...routes, 'GET /v3/application/shops/{id}': { status: 404, body: { error: 'gone' } } })
    await expect(runAction(marketFeature, 'shopName', { shopId: -1 }, ctx)).rejects.toThrow('Некоректний shopId.')
    await expect(runAction(marketFeature, 'shopName', { shopId: 5 }, ctx)).rejects.toThrow('HTTP 404')
    const nameless = featureCtx({ ...routes, 'GET /v3/application/shops/{id}': { body: { shop_id: 5 } } })
    await expect(runAction(marketFeature, 'shopName', { shopId: 5 }, nameless.ctx)).rejects.toThrow('не повернув назву')
  })
})

describe('market MCP tools', () => {
  it('tool list = MARKET_TOOL_SUMMARY (same order), all read-only with closed schemas', () => {
    const tools = marketFeature.mcpTools!(mcpDeps(routes).deps)
    expect(tools.map((t) => t.name)).toEqual(MARKET_TOOL_SUMMARY.map((t) => t.name))
    expect(MARKET_TOOL_SUMMARY.every((t) => !t.write)).toBe(true)
    for (const t of tools) {
      expect(t.readOnly).not.toBe(false)
      expect(t.inputSchema.additionalProperties).toBe(false)
    }
  })

  it('search_market: arguments → the OAS query; products without photos (no batch call)', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(marketFeature, deps, 'search_market', {
      keywords: 'mug',
      category_id: 111,
      min_price: 1,
      max_price: 99.5,
      sort: 'price_high',
      store_location: 'Germany',
      limit: 50,
      offset: 100
    })
    expect(r.isError).toBe(false)
    expect(fetch.calls).toHaveLength(1)
    expect(q(fetch.calls[0].url)).toEqual({
      limit: '50',
      offset: '100',
      keywords: 'mug',
      sort_on: 'price',
      sort_order: 'desc',
      min_price: '1',
      max_price: '99.5',
      taxonomy_id: '111',
      shop_location: 'Germany'
    })
    expect(r.json).toEqual({
      total: 1234,
      sorted: true,
      offset: 100,
      returned: 2,
      products: [
        {
          id: 1,
          store_id: 7001,
          title: 'Mug & cup',
          price: 10.01,
          currency: 'UAH',
          tags: ['mug & cup', 'gift'],
          favorites: 11,
          views: 101,
          created_at: '2020-09-13T12:26:40.000Z',
          url: 'https://www.etsy.com/listing/1/item'
        },
        // a non-etsy.com url is never passed on
        expect.objectContaining({ id: 2, store_id: 7002, favorites: null, views: null, created_at: '2023-11-14T22:13:20.000Z', url: null })
      ]
    })
  })

  it('search_market defaults: relevance, 25, offset 0', async () => {
    const { deps, fetch } = mcpDeps(routes)
    await callTool(marketFeature, deps, 'search_market', { store_location: 'Kyiv' })
    expect(q(fetch.calls[0].url)).toEqual({ limit: '25', offset: '0', sort_on: 'score', sort_order: 'desc', shop_location: 'Kyiv' })
  })

  it('search_market: a price range alone searches unsorted (sorted: false)', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(marketFeature, deps, 'search_market', { max_price: 30, sort: 'price_low' })
    expect(r.isError).toBe(false)
    expect(q(fetch.calls[0].url)).toEqual({ limit: '25', offset: '0', max_price: '30' })
    expect(r.json).toMatchObject({ total: 1234, sorted: false })
  })

  it('search_market describes the price range without claiming its currency', () => {
    const t = marketFeature.mcpTools!(mcpDeps(routes).deps).find((x) => x.name === 'search_market')!
    expect(t.description).not.toMatch(/seller's currency/)
    expect(t.description).toContain('the currency the range is compared in is not documented')
  })

  it('descriptions say what the tools really do: all of Etsy, live, API key only', () => {
    const tools = marketFeature.mcpTools!(mcpDeps(routes).deps)
    const d = Object.fromEntries(tools.map((t) => [t.name, t.description]))
    expect(d.search_market).toContain('all of Etsy')
    expect(d.search_market).toContain('findAllListingsActive')
    expect(d.search_market).toContain('not only the shops the user tracks')
    expect(d.search_market).toMatch(/live call \(1 API request, API key only, no sign-in\)/)
    expect(d.search_market).toContain('default 25')
    expect(d.search_market).toContain('url')
    expect(d.list_market_categories).toContain('once per app run')
    expect(d.get_market_category_properties).toMatch(/live Etsy API call/)
    for (const t of tools) expect(`${t.title} ${t.description}`).not.toMatch(/marketplace/i)
    // Etsy's own relevance search decides what matches — no claim that results contain the keywords
    expect(d.search_market).not.toMatch(/must contain/)
    expect(d.search_market).toContain("Etsy's own search decides which listings match — it is not an exact-text filter")
    const kw = tools.find((t) => t.name === 'search_market')!.inputSchema.properties!.keywords
    expect(kw.description).toBe("Search term or phrase, matched by Etsy's own search.")
    // every market tool reaches Etsy (list_market_categories at least on its first call per run)
    for (const t of tools) expect({ tool: t.name, openWorld: t.openWorld }).toEqual({ tool: t.name, openWorld: true })
  })

  it.each([
    [{}, 'Give at least one of'],
    [{ keywords: '  ' }, 'Give at least one of'],
    [{ keywords: 'a', min_price: 5, max_price: 1 }, 'min_price is greater than max_price.'],
    [{ keywords: 'a', limit: 101 }, 'must be ≤ 100'],
    [{ keywords: 'a', offset: 12001 }, 'must be ≤ 12000'],
    [{ keywords: 'a', min_price: -1 }, 'must be ≥ 0'],
    [{ keywords: 'a', sort: 'cheap' }, 'must be one of'],
    [{ keywords: 'a', shop: 'x' }, 'Unknown argument "shop"'],
    [{ category_id: 0 }, 'must be ≥ 1']
  ])('search_market bad args %j → tool error, nothing sent', async (args, msg) => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(marketFeature, deps, 'search_market', args)
    expect(r.isError).toBe(true)
    expect(r.text).toContain(msg)
    expect(fetch.calls).toHaveLength(0)
  })

  it('list_market_categories: matches with their paths; defaults to the top level', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(marketFeature, deps, 'list_market_categories', { query: 'kitchen', limit: 1 })
    expect(r.json).toEqual({ total: 2, categories: [{ id: 11, path: 'Home & Living › Kitchen', level: 1 }] })
    const roots = await callTool(marketFeature, deps, 'list_market_categories')
    expect(roots.json.categories.map((c: any) => c.id)).toEqual([1, 2])
    expect(fetch.calls).toHaveLength(1)
    expect((await callTool(marketFeature, deps, 'list_market_categories', { limit: 0 })).isError).toBe(true)
  })

  it('get_market_category_properties: the property list as Etsy sent it; 404 → an Etsy error with its detail', async () => {
    const { deps, fetch } = mcpDeps(routes)
    const r = await callTool(marketFeature, deps, 'get_market_category_properties', { category_id: 111 })
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/buyer-taxonomy/nodes/111/properties')
    expect(r.json).toEqual({
      category_id: 111,
      properties: [
        {
          id: 200,
          name: 'primary_color',
          display_name: 'Primary color',
          required: false,
          multivalued: true,
          max_values: 2,
          scales: [{ id: 5, name: 'Inches', description: 'Length & width' }],
          values: [
            { id: 1, name: 'Red', scale_id: null },
            { id: null, name: 'Etsy blue', scale_id: 5 }
          ]
        }
      ]
    })
    expect((await callTool(marketFeature, deps, 'get_market_category_properties', {})).text).toContain('Missing required argument "category_id"')
    const nf = mcpDeps({ 'GET /v3/application/buyer-taxonomy/nodes/{id}/properties': { status: 404, body: { error: 'No etsy taxonomy https://www.etsy.com/x' } } })
    const e = await callTool(marketFeature, nf.deps, 'get_market_category_properties', { category_id: 9 })
    expect(e.isError).toBe(true)
    expect(e.text).toBe('Not found on Etsy (HTTP 404): No etsy taxonomy https://www.etsy.com/x.')
  })

  it('public reads: work signed out and with changes switched off; no client → "Not available"', async () => {
    const { deps } = mcpDeps(routes, { status: signedOut, writes: false })
    expect((await callTool(marketFeature, deps, 'search_market', { keywords: 'mug' })).isError).toBe(false)
    expect((await callTool(marketFeature, deps, 'list_market_categories', { query: 'art' })).isError).toBe(false)
    expect((await callTool(marketFeature, deps, 'get_market_category_properties', { category_id: 1 })).isError).toBe(false)
    const none = mcpDeps(routes, { client: null }).deps
    for (const [name, args] of [
      ['search_market', { keywords: 'mug' }],
      ['list_market_categories', {}],
      ['get_market_category_properties', { category_id: 1 }]
    ] as const) {
      const r = await callTool(marketFeature, none, name, args)
      expect(r.isError).toBe(true)
      expect(r.text).toMatch(/^Not available/)
    }
  })

  it('server errors say it was Etsy', async () => {
    const { deps } = mcpDeps({ 'GET /v3/application/listings/active': { status: 500, body: { error: 'Etsy is down' } } })
    const r = await callTool(marketFeature, deps, 'search_market', { keywords: 'mug' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('Etsy')
    expect(r.text).toContain('HTTP 500')
  })

  it('honesty sweep: text from Etsy reaches the client unchanged; no CDN URL, raw JSON or key anywhere', async () => {
    const title = 'Etsy best seller — see https://www.etsy.com/shop/X'
    const leaky = {
      ...routes,
      'GET /v3/application/listings/active': {
        body: {
          count: 1,
          results: [pageItem(3, { title, tags: ['etsy gift', 'etsy.me/abc'], images: [mkEtsyImage(3, 1)] })]
        }
      },
      'GET /v3/application/buyer-taxonomy/nodes': {
        body: { count: 1, results: [{ id: 5, level: 0, name: 'Etsy picks', parent_id: null, children: [] }] }
      },
      'GET /v3/application/buyer-taxonomy/nodes/{id}/properties': {
        body: {
          count: 1,
          results: [{ ...PROPS.results[0], display_name: 'Etsy color (https://www.etsy.com/c)', possible_values: [{ value_id: 1, name: 'Etsy orange', scale_id: null }] }]
        }
      }
    }
    const { deps } = mcpDeps(leaky)
    const tools = marketFeature.mcpTools!(deps)
    const texts: string[] = tools.flatMap((t) => [t.name, t.title, t.description, JSON.stringify(t.inputSchema)])
    const results: Record<string, any> = {}
    for (const [name, args] of [
      ['search_market', { keywords: 'gift' }],
      ['search_market', {}],
      ['search_market', { min_price: 1 }],
      ['list_market_categories', { query: 'picks' }],
      ['get_market_category_properties', { category_id: 5 }]
    ] as const) {
      const r = await callTool(marketFeature, deps, name, args)
      results[name] ??= r.json
      texts.push(...r.result.content.map((c) => (c.type === 'text' ? c.text : '')))
    }
    texts.push((await callTool(marketFeature, mcpDeps(routes, { client: null }).deps, 'search_market', { keywords: 'a' })).text)

    // (a) unchanged
    expect(results.search_market.products[0]).toMatchObject({
      title,
      tags: ['etsy gift', 'etsy.me/abc'],
      url: 'https://www.etsy.com/listing/3/item'
    })
    expect(results.list_market_categories.categories).toEqual([{ id: 5, path: 'Etsy picks', level: 0 }])
    expect(results.get_market_category_properties.properties[0]).toMatchObject({
      display_name: 'Etsy color (https://www.etsy.com/c)',
      values: [{ id: 1, name: 'Etsy orange', scale_id: null }]
    })
    // (b) nothing that must stay inside the app
    for (const t of texts) {
      expect(t).not.toMatch(/etsystatic\.com/i)
      expect(t).not.toContain('raw_json')
      expect(t).not.toContain('keystring')
      expect(t).not.toContain('secret')
      expect(t).not.toContain('"tok"')
      expect(t).not.toMatch(/Bearer/)
    }
  })
})
