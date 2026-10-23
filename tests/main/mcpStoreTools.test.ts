import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EtsyApiError, type EtsyClient } from '../../src/main/etsyApi'
import { type McpToolResult, handleMcpMessage } from '../../src/main/mcpProtocol'
import { NOT_SIGNED_IN, WRITES_OFF, type OwnStoreDeps, createStoreTools, neutralError } from '../../src/main/mcpStoreTools'
import { createMcpTools, mcpServerInfo } from '../../src/main/mcpTools'
import { MyShopError } from '../../src/main/myShop'
import type { EtsyAuthStatus } from '../../src/shared/types'
import shopFx from '../fixtures/shop.json'
import { mkEtsyListing } from '../helpers/fakeEtsy'
import { memDb, seedShop } from '../helpers/db'

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

/** Everything a client got, for the neutrality checks. */
const seen: string[] = []

function world(over: { status?: EtsyAuthStatus; writes?: boolean; client?: Partial<Record<keyof EtsyClient, unknown>> } = {}) {
  const uploads: Array<{ kind: string; name: string; type: string; rank?: number; bytes: string }> = []
  const client = {
    getShop: vi.fn(async (id: number) => ({ ...shopFx, shop_id: id, shop_name: 'TidyFoxSheets' })),
    updateShop: vi.fn(async (id: number, form: Record<string, string>) => ({ ...shopFx, shop_id: id, shop_name: 'TidyFoxSheets', ...form })),
    getShopListingsByState: vi.fn(async () => ({
      count: 1,
      results: [{ ...mkEtsyListing(7, { title: 'Etsy best planner', state: 'draft' }), listing_type: 'download' }]
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
    ]
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
  it('list_my_products: any status, neutral (no links, the marketplace name taken out)', async () => {
    const w = world()
    const d = await w.data('list_my_products', { status: 'draft' })
    expect(w.client.getShopListingsByState).toHaveBeenCalledWith(SHOP, 'draft', 0)
    expect(d).toMatchObject({ store_id: SHOP, status: 'draft', total: 1 })
    expect(d.products[0]).toMatchObject({ id: 7, status: 'draft', title: 'marketplace best planner', product_type: 'digital', price: 10.07 })
    expect(Object.keys(d.products[0])).not.toContain('url')
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
    expect((await w.data('find_categories', { query: 'gift cards' })).categories[0].path).toBe('marketplace Gift Cards')
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
    expect(body.error).toContain('The store rejected the request as invalid (HTTP 400): Image too small')
    expect(body.error).not.toMatch(/etsy/i)
  })

  it('update_my_product: only the given fields, status active/inactive', async () => {
    const w = world()
    const d = await w.data('update_my_product', { product_id: 7, title: 'New', tags: ['a'], auto_renew: false, status: 'inactive' })
    expect(w.client.updateListing).toHaveBeenCalledWith(SHOP, 7, { title: 'New', tags: ['a'], should_auto_renew: false, state: 'inactive' })
    expect(d.updated).toEqual(['title', 'tags', 'shouldAutoRenew', 'state'])
    expect(await w.error('update_my_product', { product_id: 7 })).toContain('Nothing to change')
    expect(await w.error('update_my_product', { product_id: 7, status: 'draft' })).toContain('must be one of')
    expect(await w.error('update_my_product', { product_id: 7, tags: [1] })).toContain('array of strings')
    expect(await w.error('update_my_product', { product_id: 7, tags: ['bad/tag'] })).toContain('недозволений символ')
  })

  it('add_product_media: appended (no rank), photos then files; a failure lists what was uploaded', async () => {
    const w = world()
    const d = await w.data('add_product_media', { product_id: 7, photos: [{ path: photo }], files: [{ path: sheet }] })
    expect(d).toEqual({ product_id: 7, uploaded: ['cover.jpg', 'Planner.xlsx'] })
    expect(w.uploads.map((u) => [u.kind, u.rank])).toEqual([
      ['photo', undefined],
      ['file', undefined]
    ])
    expect(await w.error('add_product_media', { product_id: 7 })).toContain('at least one photo or file')
    expect(await w.error('add_product_media', { product_id: 7, photos: [{ path: sheet }] })).toContain('JPG, PNG or GIF')
    const bad = world({
      client: {
        uploadListingFile: vi.fn(async () => {
          throw new EtsyApiError('forbidden', 'x', 403, undefined, 'Not a digital listing')
        })
      }
    })
    const r = await bad.call('add_product_media', { product_id: 7, photos: [{ path: photo }], files: [{ path: sheet }] })
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual({
      error: 'file "Planner.xlsx" failed: The store refused this action (HTTP 403): Not a digital listing.',
      uploaded: ['cover.jpg']
    })
  })

  it('update_my_store: store texts; additional policies outside the EU are refused', async () => {
    const w = world()
    const d = await w.data('update_my_store', { announcement: 'Sale!' })
    expect(w.client.updateShop).toHaveBeenCalledWith(SHOP, { announcement: 'Sale!' })
    expect(d.store.announcement).toBe('Sale!')
    expect(await w.error('update_my_store', {})).toContain('Nothing to change')
    expect(await w.error('update_my_store', { additional_policies: 'x' })).toContain('ЄС')
  })

  it('an expired sign-in or a refused action reads neutrally', async () => {
    const w = world({
      client: {
        updateListing: vi.fn(async () => {
          throw new EtsyApiError('oauth', 'Вхід в Etsy більше не дійсний', 401)
        })
      }
    })
    expect(await w.error('update_my_product', { product_id: 7, title: 'x' })).toContain('sign-in to the user’s store has expired')
  })
})

describe('neutralError', () => {
  it('maps every kind to neutral English; other texts are neutralized', () => {
    expect(neutralError(new EtsyApiError('not_signed_in', 'Увійдіть в Etsy'))).toBe(NOT_SIGNED_IN)
    expect(neutralError(new EtsyApiError('rate_limit', 'x', 429))).toContain('Too many requests')
    expect(neutralError(new EtsyApiError('network', 'x'))).toContain('No connection')
    expect(neutralError(new EtsyApiError('not_found', 'x', 404, undefined, 'Etsy listing gone'))).toBe('Not found (HTTP 404): marketplace listing gone.')
    expect(neutralError(new EtsyApiError('server', 'Сервер Etsy повернув помилку', 500))).toBe('Сервер marketplace повернув помилку')
    expect(neutralError(new MyShopError('У цього акаунта Etsy немає магазину.'))).toBe('У цього акаунта marketplace немає магазину.')
    expect(neutralError('plain')).toBe('plain')
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
    const listed = (res!.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> }).tools
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
    seen.push(JSON.stringify(res))
  })

  it('nothing any store tool said (results, errors, tool list) names the marketplace', () => {
    expect(seen.length).toBeGreaterThan(20)
    expect(seen.join('\n')).not.toMatch(/etsy/i)
  })
})

import { createDraftTools } from '../../src/main/mcpStoreTools'
import { getDraft, listDrafts } from '../../src/main/drafts'

describe('drafts in the app over MCP (prepare → the user reviews → send)', () => {
  function drafts(over: { writes?: boolean; status?: EtsyAuthStatus } = {}) {
    const w = world(over)
    const db = memDb()
    const changed = vi.fn()
    const own: OwnStoreDeps = {
      client: w.client,
      status: () => over.status ?? signedIn,
      writesAllowed: () => over.writes ?? true,
      taxonomy: async () => [{ id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' }]
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

  it('prepare_product saves a draft in the app — no store call, no "allow changes" needed', async () => {
    const d = drafts({ writes: false })
    const r = await d.run('prepare_product', { ...valid, tags: ['budget'], photos: [{ path: photo }], files: [{ path: sheet }] })
    expect(r.isError).toBe(false)
    const out = JSON.parse(r.body)
    expect(out).toMatchObject({
      draft_id: 1,
      status: 'waiting_for_review',
      prepared_by: 'assistant',
      type: 'digital',
      title: 'Budget Planner',
      price: '5.99',
      category: 'Paper & Party Supplies › Paper › Calendars & Planners',
      photos: ['cover.jpg'],
      files: ['Planner.xlsx'],
      problems: []
    })
    expect(out.note).toContain('Nothing was sent')
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
    expect(JSON.parse((await d.run('delete_prepared_product', { draft_id: 1 })).body)).toEqual({ deleted: 1 })
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
    expect(r).toEqual({ draft_id: 1, product_id: 4242, status: 'draft' })
    expect(on.client.createDraftListing).toHaveBeenCalledTimes(1)
    expect(JSON.parse((await on.run('list_prepared_products')).body).drafts[0]).toMatchObject({ status: 'sent', sent_product_id: 4242 })
    const again = await on.run('send_prepared_product', { draft_id: 1 })
    expect(again.isError).toBe(true)
    expect(JSON.parse(again.body).product_id).toBe(4242)
    expect(again.body).not.toMatch(/etsy/i)
  })

  it('drafts and their errors never name the marketplace', () => {
    expect(seen.join('\n')).not.toMatch(/etsy/i)
  })
})
