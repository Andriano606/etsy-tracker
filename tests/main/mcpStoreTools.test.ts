import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EtsyApiError, type EtsyClient } from '../../src/main/etsyApi'
import { type McpToolResult, handleMcpMessage } from '../../src/main/mcpProtocol'
import { NOT_SIGNED_IN, WRITES_OFF, type DraftDeps, type OwnStoreDeps, createStoreTools, mcpErrorText } from '../../src/main/mcpStoreTools'
import { createMcpTools, mcpServerInfo } from '../../src/main/mcpTools'
import { MyShopError } from '../../src/main/myShop'
import type { EtsyAuthStatus } from '../../src/shared/types'
import shopFx from '../fixtures/shop.json'
import { mkEtsyListing } from '../helpers/fakeEtsy'
import { memDb, seedShop } from '../helpers/db'

// sync_prepared_products without the app's pull runs importEtsyDrafts itself (draftImport.ts is tested on its own).
const importMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../../src/main/draftImport', () => ({ importEtsyDrafts: (...a: unknown[]) => importMock.fn(...a) }))

const SHOP = 68736507
const signedIn: EtsyAuthStatus = {
  loggedIn: true,
  redirectUri: 'https://localhost:3003/callback',
  pending: false,
  encrypted: true,
  userId: 555,
  shopId: SHOP,
  shopName: 'TidyFoxSheets'
}

let dir: string
let photo: string
let sheet: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-store-'))
  photo = join(dir, 'cover.jpg')
  sheet = join(dir, 'Planner.xlsx')
  writeFileSync(photo, 'JPEGDATA')
  writeFileSync(sheet, 'XLSXDATA')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Everything a client got, for the honesty checks. */
const seen: string[] = []
/** The OAuth token the deps can hand out — it must never reach a client. */
const TOKEN = 'oauth-access-token-SECRET-123'
/** Text from Etsy data that mentions Etsy and links to it: passed through as is. */
const ETSY_TEXT = 'Made for Etsy sellers — see https://www.etsy.com/shop/TidyFoxSheets'

function world(
  over: {
    status?: EtsyAuthStatus
    writes?: boolean
    client?: Partial<Record<keyof EtsyClient, unknown>>
    /** The ranks of the listing's photos / files already on Etsy (add_product_media reads them). */
    existing?: { photos?: number[]; files?: number[] }
  } = {}
) {
  const uploads: Array<{ kind: string; name: string; type: string; rank?: number; bytes: string }> = []
  const existing = { photos: over.existing?.photos ?? [], files: over.existing?.files ?? [] }
  const client = {
    call: vi.fn(async (path: string) => {
      const ranks = /\/images$/.test(path) ? existing.photos : /\/files$/.test(path) ? existing.files : null
      if (!ranks) throw new Error(`unexpected call ${path}`)
      return { count: ranks.length, results: ranks.map((rank) => ({ rank })) }
    }),
    getShop: vi.fn(async (id: number) => ({ ...shopFx, shop_id: id, shop_name: 'TidyFoxSheets' })),
    updateShop: vi.fn(async (id: number, form: Record<string, string>) => ({ ...shopFx, shop_id: id, shop_name: 'TidyFoxSheets', ...form })),
    getShopListingsByState: vi.fn(async () => ({
      count: 1,
      results: [
        {
          ...mkEtsyListing(7, { title: 'Etsy best planner', state: 'draft', description: ETSY_TEXT, tags: ['etsy planner'] }),
          listing_type: 'download'
        }
      ]
    })),
    createDraftListing: vi.fn(async () => ({ listing_id: 4242 })),
    uploadListingImage: vi.fn(async (_s: number, _l: number, f: { name: string; type: string; rank?: number; data: Uint8Array }) => {
      uploads.push({ kind: 'photo', name: f.name, type: f.type, rank: f.rank, bytes: Buffer.from(f.data).toString() })
      return {}
    }),
    uploadListingFile: vi.fn(async (_s: number, _l: number, f: { name: string; type: string; rank?: number; data: Uint8Array }) => {
      uploads.push({ kind: 'file', name: f.name, type: f.type, rank: f.rank, bytes: Buffer.from(f.data).toString() })
      return {}
    }),
    updateListing: vi.fn(async (_s: number, id: number, form: Record<string, unknown>) => ({ ...mkEtsyListing(id), ...form })),
    getShippingProfiles: vi.fn(async () => [{ shipping_profile_id: 11, title: 'Standard', origin_country_iso: 'UA' }]),
    getProcessingProfiles: vi.fn(async () => [{ readiness_state_id: 21, processing_days_display_label: '1-3 days' }]),
    ...over.client
  } as unknown as EtsyClient
  let writes = over.writes ?? true
  const own: OwnStoreDeps = {
    client,
    status: () => over.status ?? signedIn,
    writesAllowed: () => writes,
    taxonomy: async () => [
      { id: 1, path: 'Paper & Party Supplies' },
      { id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' },
      { id: 3, path: 'Home & Living › Office › Planners' },
      { id: 4, path: 'Etsy Gift Cards' }
    ],
    accessToken: async () => TOKEN
  }
  const tools = createStoreTools(own)
  async function call(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const res = await handleMcpMessage(
      { info: mcpServerInfo('0.1.0'), tools },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
    )
    if (!res || res.error) throw new Error(JSON.stringify(res))
    const r = res.result as McpToolResult
    for (const c of r.content) if (c.type === 'text') seen.push(c.text)
    return r
  }
  const data = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args)
    if (r.isError) throw new Error((r.content[0] as { text: string }).text)
    return JSON.parse((r.content[0] as { text: string }).text)
  }
  const error = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call(name, args)
    expect(r.isError).toBe(true)
    return (r.content[0] as { text: string }).text
  }
  return { client, uploads, call, data, error, setWrites: (v: boolean) => (writes = v) }
}

const valid = { title: 'Budget Planner', description: 'Track money.', price: 5.99, category_id: 2 }

describe('reading the own store', () => {
  it('list_my_products: any status, Etsy texts unchanged, no listing URL or CDN photo URL', async () => {
    const w = world()
    const d = await w.data('list_my_products', { status: 'draft' })
    expect(w.client.getShopListingsByState).toHaveBeenCalledWith(SHOP, 'draft', 0)
    expect(d).toMatchObject({ store_id: SHOP, status: 'draft', total: 1 })
    expect(d.products[0]).toMatchObject({
      id: 7,
      status: 'draft',
      title: 'Etsy best planner',
      description: ETSY_TEXT,
      tags: ['etsy planner'],
      product_type: 'digital',
      price: 10.07
    })
    expect(Object.keys(d.products[0])).not.toContain('url')
    expect(JSON.stringify(d)).not.toContain('etsystatic.com')
  })

  it('find_categories: every word must match, the most specific first', async () => {
    const w = world()
    const d = await w.data('find_categories', { query: 'planners' })
    // Same depth → alphabetical.
    expect(d.categories).toEqual([
      { category_id: 3, path: 'Home & Living › Office › Planners' },
      { category_id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' }
    ])
    expect((await w.data('find_categories', { query: 'paper' })).categories.map((c: { category_id: number }) => c.category_id)).toEqual([2, 1])
    expect((await w.data('find_categories', { query: 'office planners' })).categories).toHaveLength(1)
    expect((await w.data('find_categories', { query: 'gift cards' })).categories[0].path).toBe('Etsy Gift Cards')
  })

  it('get_product_options: values, limits, profiles, and whether changes are allowed', async () => {
    const w = world({ writes: false })
    const d = await w.data('get_product_options')
    expect(d).toMatchObject({
      changes_allowed: false,
      product_types: ['digital', 'physical'],
      shipping_profiles: [{ id: 11, label: 'Standard (з UA)' }],
      processing_profiles: [{ id: 21, label: '1-3 days' }]
    })
    expect(d.made_by).toContain('i_did')
    expect(d.made_when).toContain('made_to_order')
    expect(d.limits).toMatchObject({ max_photos: 10, max_files: 5, max_file_mb: 20, max_tags: 13 })
  })

  it('reading works without "allow changes"; nothing works while not signed in', async () => {
    const off = world({ writes: false })
    expect((await off.data('list_my_products')).total).toBe(1)
    const out = world({ status: { ...signedIn, loggedIn: false, shopId: null } })
    expect(await out.error('list_my_products')).toBe(NOT_SIGNED_IN)
    expect(await out.error('get_product_options')).toBe(NOT_SIGNED_IN)
    expect(await out.error('create_product', valid)).toBe(NOT_SIGNED_IN)
    expect(await createStoreTools(undefined)[1].run({ query: 'x' })).toMatchObject({ isError: true })
  })
})

describe('changing the own store', () => {
  it('every write tool refuses while "allow changes" is off — and says how to turn it on', async () => {
    const w = world({ writes: false })
    for (const [name, args] of [
      ['create_product', valid],
      ['update_my_product', { product_id: 7, title: 'x' }],
      ['add_product_media', { product_id: 7, photos: [{ path: photo }] }],
      ['update_my_store', { announcement: 'x' }]
    ] as const) {
      expect(await w.error(name, args)).toBe(WRITES_OFF)
    }
    expect(w.client.createDraftListing).not.toHaveBeenCalled()
    expect(w.client.updateListing).not.toHaveBeenCalled()
    expect(w.client.updateShop).not.toHaveBeenCalled()
  })

  it('create_product: a digital draft by default; photos from a path and from base64; files', async () => {
    const w = world()
    const d = await w.data('create_product', {
      ...valid,
      tags: ['budget', 'planner'],
      photos: [{ path: photo }, { data_base64: Buffer.from('PNGDATA').toString('base64'), name: 'inside.png' }],
      files: [{ path: sheet }]
    })
    expect(d).toMatchObject({ product_id: 4242, status: 'draft', photos_uploaded: 2, files_uploaded: 1 })
    expect(d.note).toContain('Etsy draft')
    expect(w.client.createDraftListing).toHaveBeenCalledWith(
      SHOP,
      expect.objectContaining({ title: 'Budget Planner', price: 5.99, type: 'download', quantity: 999, taxonomy_id: 2, tags: ['budget', 'planner'] })
    )
    expect(w.uploads).toEqual([
      { kind: 'photo', name: 'cover.jpg', type: 'image/jpeg', rank: 1, bytes: 'JPEGDATA' },
      { kind: 'photo', name: 'inside.png', type: 'image/png', rank: 2, bytes: 'PNGDATA' },
      {
        kind: 'file',
        name: 'Planner.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        rank: 1,
        bytes: 'XLSXDATA'
      }
    ])
    expect(w.client.updateListing).not.toHaveBeenCalled()
  })

  it('create_product publish=true publishes; physical needs a shipping profile', async () => {
    const w = world()
    const d = await w.data('create_product', { ...valid, photos: [{ path: photo }], files: [{ path: sheet }], publish: true })
    expect(d.status).toBe('active')
    expect(w.client.updateListing).toHaveBeenCalledWith(SHOP, 4242, { state: 'active' })
    expect(await w.error('create_product', { ...valid, type: 'physical' })).toContain('профіль доставки')
    const ok = await w.data('create_product', { ...valid, type: 'physical', shipping_profile_id: 11, processing_profile_id: 21 })
    expect(ok.status).toBe('draft')
    expect(w.client.createDraftListing).toHaveBeenLastCalledWith(
      SHOP,
      expect.objectContaining({ type: 'physical', quantity: 1, shipping_profile_id: 11, readiness_state_id: 21 })
    )
  })

  it('bad media is refused before anything is created', async () => {
    const w = world()
    expect(await w.error('create_product', { ...valid, photos: [{ path: 'relative/cover.jpg' }] })).toContain('must be absolute')
    expect(await w.error('create_product', { ...valid, photos: [{ path: join(dir, 'missing.jpg') }] })).toContain('No such file')
    expect(await w.error('create_product', { ...valid, photos: [{ path: dir }] })).toContain('Not a regular file')
    expect(await w.error('create_product', { ...valid, photos: [{ data_base64: 'AAAA' }] })).toContain('needs a "name"')
    expect(await w.error('create_product', { ...valid, photos: [{}] })).toContain('"path" or "data_base64"')
    expect(await w.error('create_product', { ...valid, photos: [{ path: sheet }] })).toContain('JPG, PNG або GIF')
    expect(await w.error('create_product', { ...valid, price: 5.999 })).toContain('Ціна')
    expect(w.client.createDraftListing).not.toHaveBeenCalled()
  })

  it('a failure after the draft exists returns its product_id', async () => {
    const w = world({
      client: {
        uploadListingImage: vi.fn(async () => {
          throw new EtsyApiError('bad_request', 'Etsy відхилив запит як некоректний (HTTP 400).', 400, undefined, 'Image too small')
        })
      }
    })
    const r = await w.call('create_product', { ...valid, photos: [{ path: photo }] })
    expect(r.isError).toBe(true)
    const body = JSON.parse((r.content[0] as { text: string }).text)
    expect(body.product_id).toBe(4242)
    expect(body.error).toContain('Etsy rejected the request as invalid (HTTP 400): Image too small')
  })

  it('update_my_product: only the given fields, status active/inactive; `updated` names the arguments', async () => {
    const w = world()
    const d = await w.data('update_my_product', { product_id: 7, title: 'New', tags: ['a'], auto_renew: false, status: 'inactive' })
    expect(w.client.updateListing).toHaveBeenCalledWith(SHOP, 7, { title: 'New', tags: ['a'], should_auto_renew: false, state: 'inactive' })
    expect(d.updated).toEqual(['title', 'tags', 'auto_renew', 'status'])
    expect(await w.error('update_my_product', { product_id: 7 })).toContain('Nothing to change')
    expect(await w.error('update_my_product', { product_id: 7, status: 'draft' })).toContain('must be one of')
    expect(await w.error('update_my_product', { product_id: 7, tags: [1] })).toContain('array of strings')
    expect(await w.error('update_my_product', { product_id: 7, tags: ['bad/tag'] })).toContain('недозволений символ')
  })

  it('add_product_media: appended after the existing ones (explicit ranks), photos then files', async () => {
    const w = world({ existing: { photos: [1, 2, 3], files: [1] } })
    const d = await w.data('add_product_media', {
      product_id: 7,
      photos: [{ path: photo }, { data_base64: Buffer.from('PNGDATA').toString('base64'), name: 'inside.png' }],
      files: [{ path: sheet }]
    })
    expect(d).toEqual({ product_id: 7, uploaded: ['cover.jpg', 'inside.png', 'Planner.xlsx'] })
    // The OAS default rank is 1 (= first): every upload gets the next free position.
    expect(w.uploads.map((u) => [u.kind, u.name, u.rank])).toEqual([
      ['photo', 'cover.jpg', 4],
      ['photo', 'inside.png', 5],
      ['file', 'Planner.xlsx', 2]
    ])
    // Photos are read with the API key (public), files with the sign-in.
    expect(w.client.call).toHaveBeenCalledWith('/v3/application/listings/7/images', {})
    expect(w.client.call).toHaveBeenCalledWith(`/v3/application/shops/${SHOP}/listings/7/files`, { oauth: true })
    // A listing without photos/files starts at 1; a kind not uploaded isn't read.
    const empty = world()
    await empty.data('add_product_media', { product_id: 8, photos: [{ path: photo }] })
    expect(empty.uploads.map((u) => u.rank)).toEqual([1])
    expect(empty.client.call).toHaveBeenCalledTimes(1)
  })

  it('add_product_media: bad input and full listings are refused before any upload; a failure lists what was uploaded', async () => {
    const w = world({ existing: { photos: [1, 2, 3, 4, 5, 6, 7, 8, 9], files: [1, 2, 3, 4, 5] } })
    expect(await w.error('add_product_media', { product_id: 7 })).toContain('at least one photo or file')
    expect(await w.error('add_product_media', { product_id: 7, photos: [{ path: photo }, { path: sheet }] })).toContain('JPG, PNG or GIF')
    expect(await w.error('add_product_media', { product_id: 7, photos: [{ path: photo }, { path: photo }] })).toBe(
      'An Etsy listing can have at most 10 photos: this one has 9.'
    )
    expect(await w.error('add_product_media', { product_id: 7, files: [{ path: sheet }] })).toBe(
      'An Etsy listing can have at most 5 files: this one has 5.'
    )
    expect(w.uploads).toEqual([])
    const bad = world({
      client: {
        uploadListingFile: vi.fn(async () => {
          throw new EtsyApiError('forbidden', 'x', 403, undefined, 'Not a digital listing')
        })
      }
    })
    const r = await bad.call('add_product_media', { product_id: 7, photos: [{ path: photo }], files: [{ path: sheet }] })
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({
      error: 'file "Planner.xlsx" failed: Etsy refused this action (HTTP 403): Not a digital listing.',
      uploaded: ['cover.jpg']
    })
  })

  it('update_my_store: shop texts (returned as Etsy answered); additional policies outside the EU are refused', async () => {
    const w = world()
    const d = await w.data('update_my_store', { announcement: ETSY_TEXT })
    expect(w.client.updateShop).toHaveBeenCalledWith(SHOP, { announcement: ETSY_TEXT })
    expect(d.updated).toEqual(['announcement'])
    expect(d.store.announcement).toBe(ETSY_TEXT)
    expect(await w.error('update_my_store', {})).toContain('Nothing to change')
    expect(await w.error('update_my_store', { additional_policies: 'x' })).toContain('ЄС')
  })

  it('an expired sign-in says so (Etsy named)', async () => {
    const w = world({
      client: {
        updateListing: vi.fn(async () => {
          throw new EtsyApiError('oauth', 'Вхід в Etsy більше не дійсний', 401)
        })
      }
    })
    expect(await w.error('update_my_product', { product_id: 7, title: 'x' })).toContain('The Etsy sign-in has expired')
  })
})

describe('mcpErrorText', () => {
  it('maps every kind to English naming Etsy, with Etsy\'s own detail; other texts unchanged', () => {
    expect(mcpErrorText(new EtsyApiError('not_signed_in', 'Увійдіть в Etsy'))).toBe(NOT_SIGNED_IN)
    expect(NOT_SIGNED_IN).toContain('Etsy shop')
    expect(WRITES_OFF).toContain('Etsy shop')
    const expired = mcpErrorText(new EtsyApiError('oauth', 'x', 401))
    expect(expired).toContain('The Etsy sign-in has expired')
    expect(expired).toContain('"Керувати" button in their own shop’s header')
    expect(expired).toContain('"✏️ Мій магазин" button in the sidebar')
    expect(NOT_SIGNED_IN).toContain('"✏️ Мій магазин" button in the app’s sidebar → "Увійти через Etsy"')
    expect(WRITES_OFF).toContain('"Дозволити Claude змінювати мій магазин"')
    expect(WRITES_OFF).toContain('"MCP-сервер для Claude"')
    expect(WRITES_OFF).toContain('"Доступ для Claude"')
    expect(WRITES_OFF).not.toContain('sidebar → MCP')
    expect(mcpErrorText(new EtsyApiError('forbidden', 'x', 403))).toBe('Etsy refused this action (HTTP 403).')
    expect(mcpErrorText(new EtsyApiError('bad_request', 'x', 400, undefined, 'title too long'))).toBe(
      'Etsy rejected the request as invalid (HTTP 400): title too long.'
    )
    const rate = mcpErrorText(new EtsyApiError('rate_limit', 'x', 429))
    expect(rate).toContain('per-second limit')
    expect(rate).toContain('daily quota is used up until it resets')
    expect(rate).not.toContain('in a minute')
    expect(mcpErrorText(new EtsyApiError('network', 'x'))).toBe('No connection to the Etsy API — try again.')
    expect(mcpErrorText(new EtsyApiError('no_key', 'x'))).toBe('The app has no Etsy API key configured (Settings).')
    expect(mcpErrorText(new EtsyApiError('not_found', 'x', 404, undefined, 'Etsy listing gone'))).toBe('Not found on Etsy (HTTP 404): Etsy listing gone.')
    expect(mcpErrorText(new EtsyApiError('server', 'Сервер Etsy повернув помилку', 503))).toBe('Etsy API error (HTTP 503) — try again later.')
    expect(mcpErrorText(new EtsyApiError('auth', 'Etsy відхилив API-ключ', 403, undefined, 'Invalid API key'))).toBe(
      'Etsy rejected the app’s API key (HTTP 403): Invalid API key. Ask the user to check the keystring and shared secret in the app’s Settings.'
    )
    expect(mcpErrorText(new EtsyApiError('bad_response', 'Etsy повернув неочікувану відповідь.'))).toBe(
      'Etsy answered something unexpected — try again later.'
    )
    // Every kind has an English text: no Ukrainian message falls through.
    for (const kind of ['no_key', 'auth', 'not_found', 'bad_request', 'rate_limit', 'server', 'network', 'bad_response', 'not_signed_in', 'oauth', 'forbidden'] as const) {
      expect(mcpErrorText(new EtsyApiError(kind, 'Українською', 400))).not.toContain('Українською')
    }
    expect(mcpErrorText(new MyShopError('У цього акаунта Etsy немає магазину.'))).toBe('У цього акаунта Etsy немає магазину.')
    expect(mcpErrorText('plain')).toBe('plain')
  })
})

describe('in the full tool set', () => {
  it('list_stores marks the own store is_mine; the store tools are listed with write annotations', async () => {
    const db = memDb()
    seedShop(db, { id: SHOP, shopName: 'TidyFoxSheets' })
    seedShop(db, { id: 1, shopName: 'Other' })
    const w = world()
    const tools = createMcpTools({
      db,
      own: { client: w.client, status: () => signedIn, writesAllowed: () => true, taxonomy: async () => [] }
    })
    const list = (await tools.find((t) => t.name === 'list_stores')!.run({})) as McpToolResult
    const stores = JSON.parse((list.content[0] as { text: string }).text).stores as Array<{ id: number; is_mine: boolean }>
    expect(stores.find((s) => s.id === SHOP)!.is_mine).toBe(true)
    expect(stores.find((s) => s.id === 1)!.is_mine).toBe(false)
    const res = await handleMcpMessage({ info: mcpServerInfo('1'), tools }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const listed = (res!.result as { tools: Array<{ name: string; description: string; annotations: { readOnlyHint: boolean } }> }).tools
    // Honest descriptions: each own-shop tool says it works on Etsy; the writes name their OAuth scope.
    const desc = Object.fromEntries(listed.map((t) => [t.name, t.description]))
    for (const name of ['list_my_products', 'find_categories', 'get_product_options', 'create_product', 'update_my_product', 'add_product_media', 'update_my_store']) {
      expect(desc[name]).toContain('Etsy')
    }
    expect(desc.list_my_products).toContain('listings_r')
    for (const name of ['create_product', 'update_my_product', 'add_product_media']) expect(desc[name]).toContain('listings_w')
    expect(desc.update_my_store).toContain('shops_w')
    const ro = Object.fromEntries(listed.map((t) => [t.name, t.annotations.readOnlyHint]))
    expect(ro).toMatchObject({
      list_my_products: true,
      find_categories: true,
      get_product_options: true,
      create_product: false,
      update_my_product: false,
      add_product_media: false,
      update_my_store: false
    })
    const ow = Object.fromEntries(
      listed.map((t) => [t.name, (t.annotations as { openWorldHint?: boolean }).openWorldHint])
    )
    // Every own-store tool talks to the live Etsy API (find_categories fetches the category tree on first use).
    for (const name of ['list_my_products', 'find_categories', 'get_product_options', 'create_product', 'update_my_product', 'add_product_media', 'update_my_store']) {
      expect(ow[name]).toBe(true)
    }
    // The app's own database only.
    expect(ow.list_stores).toBe(false)
    seen.push(JSON.stringify(res))
  })

  it('everything any store tool said (results, errors, tool list): Etsy texts as they are, but no CDN URL, raw JSON or token', () => {
    expect(seen.length).toBeGreaterThan(20)
    const all = seen.join('\n')
    // Text from Etsy data reaches the client unchanged (incl. its etsy.com link).
    expect(all).toContain(ETSY_TEXT)
    expect(all).toContain('Etsy Gift Cards')
    expect(all).not.toContain('etsystatic.com')
    expect(all).not.toContain('raw_json')
    expect(all).not.toContain(TOKEN)
  })
})

import { createDraftTools } from '../../src/main/mcpStoreTools'
import { VARIATIONS_NOTE, getDraft, listDrafts, saveDraft } from '../../src/main/drafts'
import { etsyListingEditUrl, etsyListingUrl, normalizeDraftFields } from '../../src/shared/myShop'

describe('drafts in the app over MCP (prepare → the user reviews → send)', () => {
  function drafts(over: { writes?: boolean; status?: EtsyAuthStatus } = {}) {
    const w = world(over)
    const db = memDb()
    const changed = vi.fn()
    const own: OwnStoreDeps = {
      client: w.client,
      status: () => over.status ?? signedIn,
      writesAllowed: () => over.writes ?? true,
      taxonomy: async () => [{ id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' }],
      accessToken: async () => TOKEN
    }
    const tools = createDraftTools(own, { db, now: () => 1000, onChanged: changed })
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await handleMcpMessage(
        { info: mcpServerInfo('0.1.0'), tools },
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
      )
      const r = res!.result as McpToolResult
      for (const c of r.content) if (c.type === 'text') seen.push(c.text)
      return { isError: !!r.isError, body: (r.content[0] as { text: string }).text }
    }
    return { ...w, db, changed, run }
  }

  it('prepare_product saves a draft in the app — no Etsy call, no "allow changes" needed', async () => {
    const d = drafts({ writes: false })
    const r = await d.run('prepare_product', {
      ...valid,
      description: ETSY_TEXT,
      tags: ['budget'],
      photos: [{ path: photo }],
      files: [{ path: sheet }]
    })
    expect(r.isError).toBe(false)
    const out = JSON.parse(r.body)
    expect(out).toMatchObject({
      draft_id: 1,
      status: 'waiting_for_review',
      prepared_by: 'assistant',
      type: 'digital',
      title: 'Budget Planner',
      description: ETSY_TEXT,
      price: '5.99',
      category: 'Paper & Party Supplies › Paper › Calendars & Planners',
      photos: ['cover.jpg'],
      files: ['Planner.xlsx'],
      problems: []
    })
    expect(out.note).toBe('Saved in the app as a draft for the user to review. Nothing was sent to Etsy.')
    expect(d.client.createDraftListing).not.toHaveBeenCalled()
    expect(d.changed).toHaveBeenCalled()
    expect(getDraft(d.db, 1)).toMatchObject({ source: 'mcp', fields: { taxonomyPath: 'Paper & Party Supplies › Paper › Calendars & Planners' } })
  })

  it('incomplete drafts are kept and say what is missing; updates change only the given fields', async () => {
    const d = drafts()
    const first = JSON.parse((await d.run('prepare_product', { title: 'Idea' })).body)
    expect(first.problems.join(' ')).toContain('категорію')
    const upd = JSON.parse((await d.run('prepare_product', { draft_id: first.draft_id, description: 'Now with text', photos: [{ path: photo }] })).body)
    expect(upd).toMatchObject({ draft_id: first.draft_id, title: 'Idea', description: 'Now with text', photos: ['cover.jpg'] })
    const again = JSON.parse((await d.run('prepare_product', { draft_id: first.draft_id, price: 3 })).body)
    expect(again.photos).toEqual(['cover.jpg']) // photos not given → kept
    expect((await d.run('prepare_product', { draft_id: 99, title: 'x' })).body).toContain('No draft 99')
  })

  it('list_prepared_products and delete_prepared_product (local only)', async () => {
    const d = drafts({ writes: false })
    await d.run('prepare_product', { title: 'A' })
    await d.run('prepare_product', { title: 'B' })
    const list = JSON.parse((await d.run('list_prepared_products')).body)
    expect(list.count).toBe(2)
    expect(list.drafts.map((x: { title: string }) => x.title).sort()).toEqual(['A', 'B'])
    expect(JSON.parse((await d.run('delete_prepared_product', { draft_id: 1 })).body)).toEqual({ deleted: 1, deleted_on_etsy: false })
    expect((await d.run('delete_prepared_product', { draft_id: 1 })).isError).toBe(true)
    expect(listDrafts(d.db)).toHaveLength(1)
  })

  it('send_prepared_product needs "allow changes"; then sends and the draft becomes sent', async () => {
    const off = drafts({ writes: false })
    await off.run('prepare_product', { ...valid })
    expect((await off.run('send_prepared_product', { draft_id: 1 })).body).toBe(WRITES_OFF)
    const on = drafts()
    await on.run('prepare_product', { ...valid })
    const r = JSON.parse((await on.run('send_prepared_product', { draft_id: 1 })).body)
    expect(r).toEqual({
      draft_id: 1,
      action: 'created',
      product_id: 4242,
      status: 'draft',
      url: null,
      edit_url: 'https://www.etsy.com/your/shops/me/listing-editor/edit/4242',
      notes: []
    })
    expect(on.client.createDraftListing).toHaveBeenCalledTimes(1)
    expect(JSON.parse((await on.run('list_prepared_products')).body).drafts[0]).toMatchObject({ status: 'sent', sent_product_id: 4242 })
    // A second send updates the linked Etsy listing (drafts.ts) — never a second listing.
    // (This fake sign-in has no OAuth scopes, so the update is refused here.)
    const again = await on.run('send_prepared_product', { draft_id: 1 })
    expect(again.isError).toBe(true)
    expect(JSON.parse(again.body)).toMatchObject({
      product_id: 4242,
      edit_url: 'https://www.etsy.com/your/shops/me/listing-editor/edit/4242'
    })
    expect(on.client.createDraftListing).toHaveBeenCalledTimes(1)
  })

  it('send_prepared_product with publish=true returns the public page (url) and the editor (edit_url)', async () => {
    const on = drafts()
    await on.run('prepare_product', { ...valid, photos: [{ path: photo }], files: [{ path: sheet }] })
    const r = await on.run('send_prepared_product', { draft_id: 1, publish: true })
    expect(r.isError).toBe(false)
    expect(JSON.parse(r.body)).toEqual({
      draft_id: 1,
      action: 'created',
      product_id: 4242,
      status: 'active',
      url: etsyListingUrl(4242),
      edit_url: etsyListingEditUrl(4242),
      notes: []
    })
    expect(etsyListingUrl(4242)).toBe('https://www.etsy.com/listing/4242')
    expect(on.client.updateListing).toHaveBeenCalledWith(SHOP, 4242, expect.objectContaining({ state: 'active' }))
    expect(JSON.parse((await on.run('list_prepared_products')).body).drafts[0]).toMatchObject({ status: 'sent', sent_product_id: 4242 })
  })

  it('tools/list: drafts in the app are local, sending them reaches Etsy; texts name the real buttons', async () => {
    const tools = createDraftTools(undefined, { db: memDb(), now: () => 1000, onChanged: () => {} })
    const res = await handleMcpMessage({ info: mcpServerInfo('1'), tools }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const listed = (res!.result as { tools: Array<{ name: string; description: string; annotations: Record<string, boolean> }> }).tools
    const ann = Object.fromEntries(listed.map((t) => [t.name, t.annotations]))
    expect(ann.list_prepared_products).toMatchObject({ readOnlyHint: true, openWorldHint: false })
    // Local by default, but also_on_etsy deletes the Etsy listing — permanently.
    expect(ann.delete_prepared_product).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true })
    // Reads Etsy live, writes only the app's drafts — but it overwrites unedited linked drafts with Etsy's version
    // and drops pulled drafts deleted on Etsy (unsent edits are never overwritten).
    expect(ann.sync_prepared_products).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true })
    // The app's database only; the link (and files only on Etsy) can't be restored.
    expect(ann.unlink_prepared_product).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false })
    // A category_id is looked up in Etsy's category tree (fetched on first use).
    expect(ann.prepare_product).toMatchObject({ readOnlyHint: false, openWorldHint: true })
    expect(ann.send_prepared_product).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true })
    const prepare = listed.find((t) => t.name === 'prepare_product')!.description
    expect(prepare).toContain('"Чернетки" button in the header of their own shop')
    expect(prepare).not.toContain('📝')
  })

  it('drafts and their errors: texts as they are, but no CDN URL, raw JSON or token', () => {
    const all = seen.join('\n')
    expect(all).toContain(ETSY_TEXT)
    expect(all).not.toContain('etsystatic.com')
    expect(all).not.toContain('raw_json')
    expect(all).not.toContain(TOKEN)
  })
})

// ------------------------------------------------------------------ linked drafts over MCP

import { ALL_SCOPES, signedIn as ownSignedIn } from '../helpers/features'
import { ownEtsy } from '../helpers/ownEtsy'

describe('drafts linked to Etsy listings over MCP (edit → update the same listing, sync, unlink, delete on Etsy)', () => {
  function linked(over: { writes?: boolean; scopes?: string[]; status?: EtsyAuthStatus; pull?: DraftDeps['pull'] } = {}) {
    const e = ownEtsy()
    const db = memDb()
    const changed = vi.fn()
    const marksChanged = vi.fn()
    let writes = over.writes ?? true
    const own: OwnStoreDeps = {
      client: e.client,
      status: () => over.status ?? ownSignedIn({ scopes: over.scopes ?? ALL_SCOPES }),
      writesAllowed: () => writes,
      taxonomy: async () => [{ id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' }],
      accessToken: async () => TOKEN
    }
    let t = 1000
    const tools = createDraftTools(own, { db, now: () => ++t, onChanged: changed, onMarksChanged: marksChanged, pull: over.pull })
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await handleMcpMessage(
        { info: mcpServerInfo('0.1.0'), tools },
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
      )
      const r = res!.result as McpToolResult
      for (const c of r.content) if (c.type === 'text') seen.push(c.text)
      const body = (r.content[0] as { text: string }).text
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(body)
      } catch {
        // a plain error text
      }
      return { isError: !!r.isError, body, json: json as Record<string, any> }
    }
    /** A digital draft with two photos and a file, sent once (Etsy listing 4242, an Etsy draft). */
    const sent = async (publish = false) => {
      const p = await run('prepare_product', { ...valid, photos: [{ path: photo }, { data_base64: Buffer.from('PNG2').toString('base64'), name: 'b.png' }], files: [{ path: sheet }] })
      const r = await run('send_prepared_product', { draft_id: p.json.draft_id, publish })
      expect(r.json).toMatchObject({ action: 'created', product_id: 4242 })
      return p.json.draft_id as number
    }
    return { ...e, db, changed, marksChanged, run, sent, setWrites: (v: boolean) => (writes = v) }
  }

  it('send_prepared_product that publishes completes the example marks made with that draft (examples_marked_done)', async () => {
    const w = linked()
    const id = await w.sent()
    seedShop(w.db)
    upsertListing(w.db, mkInput(1), 10)
    setListingMark(w.db, 1, { status: 'in_progress', ourDraftId: id, source: 'mcp' }, 20)
    // An update that doesn't publish leaves the mark as it is.
    const r = await w.run('send_prepared_product', { draft_id: id })
    expect(r.json).not.toHaveProperty('examples_marked_done')
    expect(w.marksChanged).not.toHaveBeenCalled()
    const p = await w.run('send_prepared_product', { draft_id: id, publish: true })
    expect(p.json).toMatchObject({ action: 'updated', status: 'active', examples_marked_done: [1] })
    expect(w.marksChanged).toHaveBeenCalledWith([1])
    expect(getListingMark(w.db, 1)).toMatchObject({ status: 'done', ourListingId: 4242 })
  })

  it('list_prepared_products shows the link: product, Etsy state, in sync, editor; the public page only while active', async () => {
    const w = linked()
    const id = await w.sent()
    const d = (await w.run('list_prepared_products')).json.drafts[0]
    expect(d).toMatchObject({
      draft_id: id,
      status: 'sent',
      prepared_by: 'assistant',
      files_only_on_etsy: [],
      sent_product_id: 4242,
      etsy: {
        product_id: 4242,
        state: 'draft',
        unsent_changes: false,
        changed_on_etsy: false,
        removed_on_etsy: false,
        url: null,
        edit_url: etsyListingEditUrl(4242)
      }
    })
    expect(d.etsy.last_synced_at).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(d.etsy.etsy_updated_at).toBe(new Date(w.listings.get(4242)!.updated_timestamp * 1000).toISOString())
    const pub = linked()
    await pub.sent(true)
    expect((await pub.run('list_prepared_products')).json.drafts[0].etsy).toMatchObject({ state: 'active', url: etsyListingUrl(4242) })
    // never sent → no link
    await w.run('prepare_product', { title: 'Idea' })
    expect((await w.run('list_prepared_products')).json.drafts[0]).toMatchObject({ status: 'waiting_for_review', etsy: null })
  })

  it('prepare_product edits a linked draft without touching Etsy (changed_since_sent); {keep: n} keeps photos in a new order', async () => {
    const w = linked({ writes: false })
    w.setWrites(true)
    const id = await w.sent()
    w.setWrites(false)
    const before = w.writes().length
    const r = await w.run('prepare_product', {
      draft_id: id,
      title: 'Budget Planner 2026',
      photos: [{ keep: 2 }, { data_base64: Buffer.from('GIF').toString('base64'), name: 'c.gif' }, { keep: 1 }]
    })
    expect(r.isError).toBe(false)
    expect(r.json).toMatchObject({
      draft_id: id,
      status: 'changed_since_sent',
      title: 'Budget Planner 2026',
      photos: ['b.png', 'c.gif', 'cover.jpg'],
      files: ['Planner.xlsx'],
      etsy: { product_id: 4242, unsent_changes: true }
    })
    expect(r.json.note).toContain('Etsy listing #4242 is unchanged until the draft is sent again')
    expect(w.writes()).toHaveLength(before) // nothing on Etsy
    expect(w.listings.get(4242)!.title).toBe('Budget Planner')
    // the kept photos are still the ones on Etsy (not uploaded again on the next send)
    expect(getDraft(w.db, id)!.photos.map((p) => p.onEtsy)).toEqual([true, false, true])
  })

  it('{keep: n} is checked: a position the draft has, once, not with content, and only with draft_id', async () => {
    const w = linked()
    const id = await w.sent()
    expect((await w.run('prepare_product', { title: 'x', photos: [{ keep: 1 }] })).body).toContain('needs draft_id')
    expect((await w.run('prepare_product', { draft_id: id, photos: [{ keep: 3 }] })).body).toContain('no photo at position 3 (it has 2)')
    expect((await w.run('prepare_product', { draft_id: id, photos: [{ keep: 1 }, { keep: 1 }] })).body).toContain('kept twice')
    expect((await w.run('prepare_product', { draft_id: id, files: [{ keep: 1, path: sheet }] })).body).toContain('not both')
    expect(getDraft(w.db, id)!.photos).toHaveLength(2)
    expect(getDraft(w.db, id)!.etsy!.dirty).toBe(false) // refused before anything was saved
  })

  it('send_prepared_product on a linked draft updates the same Etsy listing (no second one): texts, price, photos in order', async () => {
    const w = linked()
    const id = await w.sent()
    await w.run('prepare_product', { draft_id: id, title: 'Budget Planner 2026', price: 7.5, photos: [{ keep: 2 }, { keep: 1 }] })
    const ids = w.imageIds(4242)
    const r = await w.run('send_prepared_product', { draft_id: id })
    expect(r.isError).toBe(false)
    expect(r.json).toEqual({
      draft_id: id,
      action: 'updated',
      product_id: 4242,
      status: 'draft',
      url: null,
      edit_url: etsyListingEditUrl(4242),
      notes: []
    })
    const l = w.listings.get(4242)!
    expect(l).toMatchObject({ title: 'Budget Planner 2026', price: { amount: 750, divisor: 100 } })
    expect(w.imageIds(4242)).toEqual([ids[1], ids[0]])
    expect(w.writes().filter((x) => x === `POST /v3/application/shops/${SHOP}/listings`)).toHaveLength(1)
    expect((await w.run('list_prepared_products')).json.drafts[0]).toMatchObject({ status: 'sent', etsy: { unsent_changes: false } })
    // publish=true publishes the linked Etsy draft
    const p = await w.run('send_prepared_product', { draft_id: id, publish: true })
    expect(p.json).toMatchObject({ action: 'updated', status: 'active', url: etsyListingUrl(4242) })
    expect(w.listings.get(4242)!.state).toBe('active')
  })

  it('variations: the answer carries the note (Ukrainian) that price and quantity were left alone', async () => {
    const w = linked()
    const id = await w.sent()
    w.listings.get(4242)!.products = [0, 1].map((i) => ({
      product_id: 50 + i,
      sku: '',
      property_values: [{ property_id: 200, property_name: 'Color', value_ids: [i + 1], values: [i ? 'Red' : 'Blue'] }],
      offerings: [{ offering_id: 60 + i, price: { amount: 100, divisor: 100, currency_code: 'USD' }, quantity: 3, is_enabled: true, readiness_state_id: null }]
    }))
    await w.run('prepare_product', { draft_id: id, price: 9.99 })
    const r = await w.run('send_prepared_product', { draft_id: id })
    expect(r.json).toMatchObject({ action: 'updated', notes: [VARIATIONS_NOTE] })
  })

  it('changed on Etsy since the last sync → {conflict: true}, nothing written; overwrite_etsy_changes=true then replaces it', async () => {
    const w = linked()
    const id = await w.sent()
    await w.run('prepare_product', { draft_id: id, title: 'Mine' })
    w.editOnEtsy(4242, (l) => (l.title = 'Edited on Etsy'))
    const before = w.writes().length
    const c = await w.run('send_prepared_product', { draft_id: id })
    expect(c.isError).toBe(true)
    expect(c.json).toMatchObject({ conflict: true, product_id: 4242, edit_url: etsyListingEditUrl(4242) })
    expect(c.json.error).toContain('На Etsy цей товар змінили')
    expect(c.json.what_to_do).toContain('only if they agree')
    expect(c.json.what_to_do).toContain('overwrite_etsy_changes=true')
    expect(w.writes()).toHaveLength(before)
    expect(w.listings.get(4242)!.title).toBe('Edited on Etsy')
    expect((await w.run('list_prepared_products')).json.drafts[0].etsy).toMatchObject({ changed_on_etsy: true, unsent_changes: true })
    const o = await w.run('send_prepared_product', { draft_id: id, overwrite_etsy_changes: true })
    expect(o.json).toMatchObject({ action: 'updated', product_id: 4242 })
    expect(w.listings.get(4242)!.title).toBe('Mine')
    expect((await w.run('list_prepared_products')).json.drafts[0].etsy).toMatchObject({ changed_on_etsy: false, unsent_changes: false })
  })

  it('deleted on Etsy → removed_on_etsy (unlink, then send); unlink_prepared_product makes the next send a new listing', async () => {
    const w = linked()
    const id = await w.sent()
    w.listings.delete(4242)
    const r = await w.run('send_prepared_product', { draft_id: id })
    expect(r.isError).toBe(true)
    expect(r.json).toMatchObject({ removed_on_etsy: true, product_id: 4242, edit_url: null })
    expect(r.json.what_to_do).toContain('unlink_prepared_product, then send_prepared_product')
    expect((await w.run('list_prepared_products')).json.drafts[0].etsy).toMatchObject({ state: 'removed', removed_on_etsy: true, edit_url: null })
    const before = w.writes().length
    const u = await w.run('unlink_prepared_product', { draft_id: id })
    expect(u.isError).toBe(false)
    expect(u.json).toMatchObject({ draft_id: id, status: 'waiting_for_review', etsy: null, unlinked_product_id: 4242, notes: [] })
    expect(u.json.note).toContain('Sending this draft now creates a new Etsy listing')
    expect(w.writes()).toHaveLength(before) // local only
    const again = await w.run('send_prepared_product', { draft_id: id })
    expect(again.json).toMatchObject({ action: 'created', product_id: 4243 })
    expect(w.imageIds(4243)).toHaveLength(2)
  })

  it('unlink_prepared_product: files only on Etsy leave the draft (notes); a draft never sent / unknown is refused', async () => {
    const w = linked()
    const d = saveDraft(
      w.db,
      {
        source: 'app',
        imported: true,
        fields: getDraft(w.db, await w.sent())!.fields,
        files: [{ remote: true, name: 'Big.zip', size: 10, etsyId: 7001 }],
        link: { listingId: 555, state: 'draft', etsyUpdatedAt: 1 }
      },
      5
    )
    expect((await w.run('list_prepared_products')).json.drafts.find((x: { draft_id: number }) => x.draft_id === d.id)).toMatchObject({
      prepared_by: 'etsy_site',
      files_only_on_etsy: ['Big.zip']
    })
    const u = await w.run('unlink_prepared_product', { draft_id: d.id })
    expect(u.json.files).toEqual([])
    expect(u.json.notes[0]).toContain('Big.zip')
    expect((await w.run('unlink_prepared_product', { draft_id: d.id })).body).toContain('is not linked to an Etsy listing')
    expect((await w.run('unlink_prepared_product', { draft_id: 99 })).body).toBe('No draft 99.')
  })

  it('a file only on Etsy can be kept with {keep: n}; new content replaces the list', async () => {
    const w = linked()
    const d = saveDraft(
      w.db,
      {
        source: 'app',
        imported: true,
        fields: normalizeDraftFields({}),
        files: [{ remote: true, name: 'Big.zip', size: 10, etsyId: 7001 }],
        link: { listingId: 555, state: 'draft', etsyUpdatedAt: 1 }
      },
      5
    )
    const r = await w.run('prepare_product', { draft_id: d.id, files: [{ keep: 1 }, { path: sheet }] })
    expect(r.json).toMatchObject({ files: ['Big.zip', 'Planner.xlsx'], files_only_on_etsy: ['Big.zip'], status: 'changed_since_sent' })
  })

  it('send_prepared_product on a linked draft is gated like every store write', async () => {
    const w = linked()
    const id = await w.sent()
    await w.run('prepare_product', { draft_id: id, title: 'Mine' })
    w.setWrites(false)
    expect((await w.run('send_prepared_product', { draft_id: id })).body).toBe(WRITES_OFF)
    const out = linked({ status: { loggedIn: false, redirectUri: '', pending: false, encrypted: true } })
    await out.run('prepare_product', { title: 'x' })
    expect((await out.run('send_prepared_product', { draft_id: 1 })).body).toBe(NOT_SIGNED_IN)
    expect(w.listings.get(4242)!.title).toBe('Budget Planner')
  })

  it('delete_prepared_product: local by default (the Etsy listing stays, the note says a sync pulls an Etsy draft back)', async () => {
    const w = linked({ writes: false })
    w.setWrites(true)
    const id = await w.sent()
    w.setWrites(false)
    const before = w.writes().length
    const r = await w.run('delete_prepared_product', { draft_id: id })
    expect(r.json).toMatchObject({ deleted: id, deleted_on_etsy: false, product_id: 4242 })
    expect(r.json.note).toContain('the next sync pulls it into the app again')
    expect(w.writes()).toHaveLength(before)
    expect(w.listings.has(4242)).toBe(true)
    expect(listDrafts(w.db)).toHaveLength(0)
  })

  it('delete_prepared_product also_on_etsy: needs "allow changes", the sign-in and listings_d; then deletes the listing too', async () => {
    const off = linked()
    const id = await off.sent()
    off.setWrites(false)
    expect((await off.run('delete_prepared_product', { draft_id: id, also_on_etsy: true })).body).toBe(WRITES_OFF)
    expect(listDrafts(off.db)).toHaveLength(1)

    const noScope = linked({ scopes: ALL_SCOPES.filter((x) => x !== 'listings_d') })
    const id2 = await noScope.sent()
    const ns = await noScope.run('delete_prepared_product', { draft_id: id2, also_on_etsy: true })
    expect(ns.isError).toBe(true)
    expect(ns.body).toContain('"listings_d" permission')
    expect(noScope.listings.has(4242)).toBe(true)
    expect(listDrafts(noScope.db)).toHaveLength(1)

    const on = linked()
    const id3 = await on.sent()
    const r = await on.run('delete_prepared_product', { draft_id: id3, also_on_etsy: true })
    expect(r.json).toEqual({ deleted: id3, deleted_on_etsy: true, product_id: 4242 })
    expect(on.listings.has(4242)).toBe(false)
    expect(on.writes()).toContain('DELETE /v3/application/listings/4242')
    expect(listDrafts(on.db)).toHaveLength(0)
    expect(on.changed).toHaveBeenCalled()
  })

  it('delete_prepared_product also_on_etsy: Etsy refusing keeps the draft; already gone counts as deleted; nothing linked = local', async () => {
    const w = linked()
    const id = await w.sent()
    w.failures.push({ match: 'DELETE /v3/application/listings/4242', status: 500, times: 5 })
    const r = await w.run('delete_prepared_product', { draft_id: id, also_on_etsy: true })
    expect(r.isError).toBe(true)
    expect(r.json).toMatchObject({ product_id: 4242, draft_kept: true })
    expect(r.json.error).toContain('Товар на Etsy не видалено')
    expect(listDrafts(w.db)).toHaveLength(1)
    // gone from Etsy meanwhile (404) → the draft goes too
    w.failures.length = 0
    w.listings.delete(4242)
    expect((await w.run('delete_prepared_product', { draft_id: id, also_on_etsy: true })).json).toMatchObject({
      deleted: id,
      deleted_on_etsy: false
    })
    expect(listDrafts(w.db)).toHaveLength(0)
    // never sent: nothing on Etsy — deleted locally, without needing the switch
    const local = linked({ writes: false })
    await local.run('prepare_product', { title: 'x' })
    const l = await local.run('delete_prepared_product', { draft_id: 1, also_on_etsy: true })
    expect(l.json).toMatchObject({ deleted: 1, deleted_on_etsy: false, note: 'The draft was never sent to Etsy — nothing to delete there.' })
  })

  it('sync_prepared_products: the app’s pull (no "allow changes" needed) → the summary; its failure is an error; signed out refused', async () => {
    const summary = { imported: 2, updated: 1, removed: 0, conflicts: 1, errors: ['#5: фото не завантажилось'] }
    const pull = vi.fn(async () => ({ ok: true as const, value: summary }))
    const w = linked({ writes: false, pull })
    const r = await w.run('sync_prepared_products')
    expect(r.isError).toBe(false)
    expect(r.json).toEqual(summary)
    expect(pull).toHaveBeenCalledTimes(1)
    expect(importMock.fn).not.toHaveBeenCalled()
    const bad = linked({ pull: async () => ({ ok: false as const, error: 'Не вдалося синхронізувати чернетки з Etsy: мережа' }) })
    const b = await bad.run('sync_prepared_products')
    expect(b).toMatchObject({ isError: true, body: 'Не вдалося синхронізувати чернетки з Etsy: мережа' })
    const out = linked({ pull, status: { loggedIn: false, redirectUri: '', pending: false, encrypted: true } })
    expect((await out.run('sync_prepared_products')).body).toBe(NOT_SIGNED_IN)
    expect(pull).toHaveBeenCalledTimes(1)
  })

  it('createMcpTools hands the app’s pull (McpToolDeps.pullDrafts) to sync_prepared_products', async () => {
    const summary = { imported: 0, updated: 0, removed: 0, conflicts: 0, errors: [] }
    const pullDrafts = vi.fn(async () => ({ ok: true as const, value: summary }))
    importMock.fn.mockReset()
    const e = ownEtsy()
    const tools = createMcpTools({
      db: memDb(),
      own: {
        client: e.client,
        status: () => ownSignedIn({ scopes: ALL_SCOPES }),
        writesAllowed: () => false,
        taxonomy: async () => [],
        accessToken: async () => TOKEN
      },
      pullDrafts
    })
    const res = await handleMcpMessage(
      { info: mcpServerInfo('0.1.0'), tools },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sync_prepared_products', arguments: {} } }
    )
    const r = res!.result as McpToolResult
    expect(r.isError).toBeFalsy()
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual(summary)
    expect(pullDrafts).toHaveBeenCalledTimes(1)
    expect(importMock.fn).not.toHaveBeenCalled()
  })

  it('sync_prepared_products without the app’s pull runs importEtsyDrafts itself — one at a time, CDN-only photos', async () => {
    let release!: (v: unknown) => void
    importMock.fn.mockReset()
    importMock.fn.mockImplementation(() => new Promise((r) => (release = r)))
    const w = linked({ writes: false })
    const a = w.run('sync_prepared_products')
    const b = w.run('sync_prepared_products')
    await vi.waitFor(() => expect(importMock.fn).toHaveBeenCalledTimes(1))
    release({ imported: 1, updated: 0, removed: 0, conflicts: 0, errors: [] })
    expect((await a).json).toMatchObject({ imported: 1 })
    expect((await b).json).toMatchObject({ imported: 1 })
    expect(importMock.fn).toHaveBeenCalledTimes(1)
    expect(w.changed).toHaveBeenCalled()
    const deps = importMock.fn.mock.calls[0][0] as {
      db: unknown
      client: unknown
      auth: { status: () => EtsyAuthStatus }
      taxonomy: () => Promise<unknown>
      fetchImage: (url: string) => Promise<unknown>
    }
    expect(deps.db).toBe(w.db)
    expect(deps.client).toBe(w.client)
    expect(deps.auth.status()).toMatchObject({ loggedIn: true, shopId: SHOP })
    expect(await deps.taxonomy()).toHaveLength(1)
    await expect(deps.fetchImage('https://evil.example.com/a.jpg')).rejects.toThrow()
    await expect(deps.fetchImage('file:///etc/passwd')).rejects.toThrow()
    // a failing import is an error for the client (English for Etsy errors)
    importMock.fn.mockReset()
    importMock.fn.mockRejectedValue(new EtsyApiError('network', 'x'))
    expect((await w.run('sync_prepared_products')).body).toBe('No connection to the Etsy API — try again.')
  })

  it('tools/list: descriptions name Etsy, the scopes, the gates and the conflict rule', async () => {
    const tools = createDraftTools(undefined, { db: memDb() })
    const res = await handleMcpMessage({ info: mcpServerInfo('1'), tools }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const listed = (res!.result as { tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown> } }> }).tools
    const desc = Object.fromEntries(listed.map((t) => [t.name, t.description]))
    expect(listed.map((t) => t.name)).toEqual([
      'prepare_product',
      'list_prepared_products',
      'sync_prepared_products',
      'unlink_prepared_product',
      'delete_prepared_product',
      'send_prepared_product'
    ])
    expect(desc.send_prepared_product).toContain('UPDATES that listing')
    expect(desc.send_prepared_product).toContain('never a second listing')
    expect(desc.send_prepared_product).toContain('overwrite_etsy_changes=true')
    expect(desc.send_prepared_product).toContain('listings_w')
    expect(desc.sync_prepared_products).toContain('listings_r')
    expect(desc.sync_prepared_products).toContain("not the 'allow changes' switch")
    expect(desc.delete_prepared_product).toContain('listings_d')
    expect(desc.delete_prepared_product).toContain('confirm with the user first')
    expect(desc.unlink_prepared_product).toContain('stays on Etsy')
    expect(desc.prepare_product).not.toContain("can't be changed")
    expect(Object.keys(listed.find((t) => t.name === 'send_prepared_product')!.inputSchema.properties)).toEqual([
      'draft_id',
      'publish',
      'overwrite_etsy_changes'
    ])
    expect(Object.keys(listed.find((t) => t.name === 'delete_prepared_product')!.inputSchema.properties)).toEqual(['draft_id', 'also_on_etsy'])
  })

  it('everything said about linked drafts: no CDN URL, raw JSON or token; every URL an Etsy page', () => {
    const all = seen.join('\n')
    expect(all).not.toContain('etsystatic.com')
    expect(all).not.toContain('raw_json')
    expect(all).not.toContain(TOKEN)
    for (const u of all.match(/https?:\/\/[^\s"\\)]+/g) ?? []) expect(u).toMatch(/^https:\/\/(www\.)?etsy\.com\//)
  })
})

import { getListingMark, setListingMark, upsertListing } from '../../src/main/db'
import { mkInput } from '../helpers/db'
