import { describe, expect, it, vi } from 'vitest'
import { EtsyApiError, type EtsyClient } from '../../src/main/etsyApi'
import {
  MyShopError,
  listMyListings,
  loadMyShop,
  myShopErrorMessage,
  saveMyListing,
  saveMyShop,
  toMyListing,
  toMyShopProfile
} from '../../src/main/myShop'
import type { EtsyAuthStatus } from '../../src/shared/types'
import shopFx from '../fixtures/shop.json'
import { mkEtsyListing } from '../helpers/fakeEtsy'

const signedIn: EtsyAuthStatus = {
  loggedIn: true,
  redirectUri: 'https://localhost:3003/callback',
  pending: false,
  encrypted: true,
  userId: 555,
  shopId: 77,
  shopName: 'TidyFoxSheets'
}

function deps(over: Partial<Record<keyof EtsyClient, unknown>> = {}, st: EtsyAuthStatus = signedIn) {
  const client = {
    getShop: vi.fn(async (id: number) => ({ ...shopFx, shop_id: id, shop_name: 'TidyFoxSheets' })),
    updateShop: vi.fn(async (id: number, form: Record<string, string>) => ({ ...shopFx, shop_id: id, shop_name: 'TidyFoxSheets', ...form })),
    getShopListingsByState: vi.fn(async () => ({ count: 3, results: [mkEtsyListing(1), mkEtsyListing(2)] })),
    updateListing: vi.fn(async (_s: number, id: number, form: Record<string, unknown>) => ({ ...mkEtsyListing(id), ...form })),
    ...over
  } as unknown as EtsyClient
  return { client, auth: { status: () => st } }
}

describe('mapping', () => {
  it('toMyListing: entities decoded, the first image by rank as a CDN thumbnail, money exact', () => {
    const l = toMyListing({
      ...mkEtsyListing(5, { title: 'Mug &amp; cup', tags: ['a&amp;b'], should_auto_renew: false }),
      state: 'draft'
    })
    expect(l).toMatchObject({
      listingId: 5,
      state: 'draft',
      title: 'Mug & cup',
      tags: ['a&b'],
      shouldAutoRenew: false,
      priceAmount: 1005,
      priceDivisor: 100,
      currency: 'UAH'
    })
    expect(l.imageUrl).toMatch(/^https:\/\/i\.etsystatic\.com\/.*170x135/)
    // the same first photo at full size, for the image viewer
    expect(l.imageFullUrl).toBe(l.imageUrl!.replace('170x135', 'fullxfull'))
  })

  it('the full-size URL: first by rank, validated, 570xN when there is no fullxfull', () => {
    const l = mkEtsyListing(2)
    const [a, b] = l.images!
    l.images = [{ ...b, rank: 2 }, { ...a, rank: 1 }]
    expect(toMyListing(l).imageFullUrl).toBe(a.url_fullxfull)
    l.images = [{ ...a, url_fullxfull: 'https://evil.example/full.jpg' }]
    expect(toMyListing(l).imageFullUrl).toBeNull()
    l.images = [{ ...a, url_fullxfull: undefined as never }]
    expect(toMyListing(l).imageFullUrl).toBe(a.url_570xN)
    expect(toMyListing({ ...mkEtsyListing(1), images: [] }).imageFullUrl).toBeNull()
  })

  it('no images / a non-CDN image URL → no thumbnail', () => {
    expect(toMyListing({ ...mkEtsyListing(1), images: [] }).imageUrl).toBeNull()
    const bad = mkEtsyListing(1)
    bad.images = [{ ...bad.images![0], url_170x135: 'https://evil.example/x.jpg' }]
    expect(toMyListing(bad).imageUrl).toBeNull()
  })

  it('toMyShopProfile: texts decoded; EU or not from the shop country', () => {
    const p = toMyShopProfile({ ...shopFx, shop_location_country_iso: 'DE' } as never)
    expect(p).toMatchObject({ title: 'Handmade ceramics from Lviv & more', inEu: true, countryIso: 'DE' })
    expect(toMyShopProfile({ ...shopFx, shop_location_country_iso: 'UA' } as never).inEu).toBe(false)
  })
})

describe('own shop calls', () => {
  it('signed out: the "sign in" message, nothing called', async () => {
    const d = deps({}, { loggedIn: false, redirectUri: '', pending: false, encrypted: false })
    const e = await loadMyShop(d).catch((x) => x)
    expect(e).toBeInstanceOf(EtsyApiError)
    expect(myShopErrorMessage(e)).toContain('Увійдіть в Etsy')
    expect(d.client.getShop).not.toHaveBeenCalled()
  })

  it('an account without a shop', async () => {
    await expect(loadMyShop(deps({}, { ...signedIn, shopId: null }))).rejects.toThrow('немає магазину')
  })

  it('loadMyShop / listMyListings use the signed-in shop', async () => {
    const d = deps()
    expect((await loadMyShop(d)).shopId).toBe(77)
    const page = await listMyListings(d, 'draft', 100)
    expect(d.client.getShopListingsByState).toHaveBeenCalledWith(77, 'draft', 100)
    expect(page).toMatchObject({ state: 'draft', total: 3, offset: 100 })
    expect(page.listings.map((l) => l.listingId)).toEqual([1, 2])
  })

  it('saveMyListing sends only the patch, in Etsy’s names, and returns the updated listing', async () => {
    const d = deps()
    const l = await saveMyListing(d, 9, { title: 'New', tags: ['a', 'b'], shouldAutoRenew: false })
    expect(d.client.updateListing).toHaveBeenCalledWith(77, 9, { title: 'New', tags: ['a', 'b'], should_auto_renew: false })
    expect(l).toMatchObject({ listingId: 9, title: 'New', tags: ['a', 'b'] })
  })

  it('saveMyListing refuses invalid or empty patches before calling Etsy', async () => {
    const d = deps()
    await expect(saveMyListing(d, 9, { tags: ['bad/tag'] })).rejects.toBeInstanceOf(MyShopError)
    await expect(saveMyListing(d, 9, {})).rejects.toThrow('Нічого не змінено.')
    expect(d.client.updateListing).not.toHaveBeenCalled()
  })

  it('saveMyShop: only changed texts; additional policies refused outside the EU; no-op without changes', async () => {
    const d = deps()
    const p = await saveMyShop(d, { announcement: 'Sale!' })
    expect(d.client.updateShop).toHaveBeenCalledWith(77, { announcement: 'Sale!' })
    expect(p.announcement).toBe('Sale!')
    await expect(saveMyShop(d, { policyAdditional: 'x' })).rejects.toThrow('ЄС')
    ;(d.client.updateShop as ReturnType<typeof vi.fn>).mockClear()
    await saveMyShop(d, {})
    expect(d.client.updateShop).not.toHaveBeenCalled()
  })

  it('Etsy errors pass through as their Ukrainian message', async () => {
    const d = deps({
      updateListing: vi.fn(async () => {
        throw new EtsyApiError('forbidden', 'Etsy не дозволив цю дію (HTTP 403)', 403)
      })
    })
    const e = await saveMyListing(d, 9, { title: 'X' }).catch((x) => x)
    expect(myShopErrorMessage(e)).toBe('Etsy не дозволив цю дію (HTTP 403)')
    expect(myShopErrorMessage('plain')).toBe('plain')
  })
})

import {
  createFileRegistry,
  createMyListing,
  createTaxonomyCache,
  flattenTaxonomy,
  loadProcessingOptions,
  loadShippingOptions,
  mimeOf
} from '../../src/main/myShop'
import type { NewListingInput } from '../../src/shared/types'

const newInput = (over: Partial<NewListingInput> = {}): NewListingInput => ({
  type: 'download',
  title: 'Budget Planner',
  description: 'A planner',
  price: '5.99',
  quantity: 999,
  taxonomyId: 2,
  whoMade: 'i_did',
  whenMade: 'made_to_order',
  isSupply: false,
  tags: ['budget'],
  materials: [],
  shouldAutoRenew: true,
  shippingProfileId: null,
  readinessStateId: null,
  images: [],
  files: [],
  publish: false,
  ...over
})

function creating(over: Partial<Record<keyof EtsyClient, unknown>> = {}) {
  const calls: string[] = []
  const d = deps({
    createDraftListing: vi.fn(async (_s: number, form: Record<string, unknown>) => {
      calls.push(`draft:${form.title}`)
      return { listing_id: 4242 }
    }),
    uploadListingImage: vi.fn(async (_s: number, _l: number, f: { name: string; rank: number; type: string }) => {
      calls.push(`image:${f.name}:${f.rank}:${f.type}`)
      return {}
    }),
    uploadListingFile: vi.fn(async (_s: number, _l: number, f: { name: string; rank: number }) => {
      calls.push(`file:${f.name}:${f.rank}`)
      return {}
    }),
    updateListing: vi.fn(async (_s: number, id: number, form: Record<string, unknown>) => {
      calls.push(`update:${id}:${JSON.stringify(form)}`)
      return mkEtsyListing(id)
    }),
    ...over
  })
  const files = createFileRegistry()
  const progress: string[] = []
  const readFile = vi.fn(async (p: string) => new Uint8Array(Buffer.from(`bytes:${p}`)) as Uint8Array<ArrayBuffer>)
  return { d: { ...d, files, readFile, onProgress: (p: { label: string }) => progress.push(p.label) }, calls, files, progress, readFile }
}

describe('createMyListing', () => {
  it('draft → photos in order → files → publish, with progress', async () => {
    const t = creating()
    const a = t.files.add('/x/a.jpg', 'a.jpg', 1000)
    const b = t.files.add('/x/b.png', 'b.png', 1000)
    const f = t.files.add('/x/plan.xlsx', 'plan.xlsx', 5000)
    const res = await createMyListing(t.d, newInput({ images: [b.token, a.token], files: [f.token], publish: true }))
    expect(res).toEqual({ ok: true, listingId: 4242, published: true, warnings: [] })
    expect(t.calls).toEqual([
      'draft:Budget Planner',
      'image:b.png:1:image/png',
      'image:a.jpg:2:image/jpeg',
      'file:plan.xlsx:1',
      'update:4242:{"state":"active"}'
    ])
    expect(t.readFile).toHaveBeenCalledWith('/x/plan.xlsx')
    expect(t.progress).toEqual(['Створюю чернетку…', 'Фото 1 з 2…', 'Фото 2 з 2…', 'Файл 1 з 1…', 'Публікую…'])
    expect((t.d.client.createDraftListing as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      77,
      expect.objectContaining({ title: 'Budget Planner', price: 5.99, type: 'download', taxonomy_id: 2 })
    ])
  })

  it('a draft without photos is fine and is not published', async () => {
    const t = creating()
    expect(await createMyListing(t.d, newInput())).toEqual({ ok: true, listingId: 4242, published: false, warnings: [] })
    expect(t.calls).toEqual(['draft:Budget Planner'])
  })

  it('invalid input or unknown/oversized/wrong-type files: nothing is sent', async () => {
    const t = creating()
    expect((await createMyListing(t.d, newInput({ title: '' }))).ok).toBe(false)
    expect(await createMyListing(t.d, newInput({ images: ['forged-token'] }))).toEqual({
      ok: false,
      error: 'Вибраний файл більше недоступний — виберіть його ще раз.'
    })
    const pdf = t.files.add('/x/a.pdf', 'a.pdf', 10)
    expect((await createMyListing(t.d, newInput({ images: [pdf.token] }))) as { error: string }).toMatchObject({
      error: expect.stringContaining('JPG, PNG або GIF')
    })
    const huge = t.files.add('/x/big.zip', 'big.zip', 21 * 1024 * 1024)
    expect((await createMyListing(t.d, newInput({ files: [huge.token] }))) as { error: string }).toMatchObject({
      error: expect.stringContaining('більший за 20 МБ')
    })
    expect(t.calls).toEqual([])
  })

  it('signed out: the sign-in message', async () => {
    const t = creating()
    const out = { ...t.d, auth: { status: () => ({ loggedIn: false, redirectUri: '', pending: false, encrypted: false }) } }
    expect(await createMyListing(out, newInput())).toEqual({ ok: false, error: expect.stringContaining('Увійдіть в Etsy') })
  })

  it('the draft itself fails: no listing id', async () => {
    const t = creating({
      createDraftListing: vi.fn(async () => {
        throw new EtsyApiError('bad_request', 'Etsy відхилив запит як некоректний (HTTP 400). (Invalid taxonomy)', 400)
      })
    })
    const res = await createMyListing(t.d, newInput())
    expect(res).toEqual({ ok: false, error: expect.stringContaining('Invalid taxonomy') })
    expect(res).not.toHaveProperty('listingId')
  })

  it('a photo fails after the draft: the id is returned, later steps are skipped', async () => {
    const t = creating({
      uploadListingImage: vi.fn(async () => {
        throw new EtsyApiError('bad_request', 'HTTP 400 (image too small)', 400)
      })
    })
    const a = t.files.add('/x/a.jpg', 'a.jpg', 10)
    const f = t.files.add('/x/p.pdf', 'p.pdf', 10)
    const res = await createMyListing(t.d, newInput({ images: [a.token], files: [f.token], publish: true }))
    expect(res).toMatchObject({ ok: false, listingId: 4242, error: expect.stringContaining('Чернетку створено (#4242)') })
    expect(t.d.client.uploadListingFile).not.toHaveBeenCalled()
    expect((res as { error: string }).error).toContain('image too small')
    expect(t.d.client.updateListing).not.toHaveBeenCalled()
  })

  it('publishing fails: the draft with its photos stays', async () => {
    const t = creating({
      updateListing: vi.fn(async () => {
        throw new EtsyApiError('bad_request', 'HTTP 400 (needs a shipping profile)', 400)
      })
    })
    const a = t.files.add('/x/a.jpg', 'a.jpg', 10)
    const f = t.files.add('/x/p.pdf', 'p.pdf', 10)
    const res = await createMyListing(t.d, newInput({ images: [a.token], files: [f.token], publish: true }))
    expect(res).toMatchObject({ ok: false, listingId: 4242, error: expect.stringContaining('опублікувати не вдалося') })
  })
})

describe('categories, shipping and processing', () => {
  it('flattenTaxonomy: every node with its full path, depth-first', () => {
    expect(
      flattenTaxonomy([
        { id: 1, name: 'Paper &amp; Party', children: [{ id: 2, name: 'Planners', children: [{ id: 3, name: 'Weekly' }] }] },
        { id: 4, name: 'Home' }
      ])
    ).toEqual([
      { id: 1, path: 'Paper & Party' },
      { id: 2, path: 'Paper & Party › Planners' },
      { id: 3, path: 'Paper & Party › Planners › Weekly' },
      { id: 4, path: 'Home' }
    ])
  })

  it('the taxonomy is fetched once; a failure is retried next time', async () => {
    const getSellerTaxonomy = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([{ id: 1, name: 'A' }])
    const load = createTaxonomyCache({ getSellerTaxonomy })
    await expect(load()).rejects.toThrow('offline')
    expect(await load()).toEqual([{ id: 1, path: 'A' }])
    await load()
    expect(getSellerTaxonomy).toHaveBeenCalledTimes(2)
  })

  it('shipping profiles (deleted ones hidden) and processing profiles as labels', async () => {
    const d = deps({
      getShippingProfiles: vi.fn(async () => [
        { shipping_profile_id: 1, title: 'Standard', origin_country_iso: 'UA' },
        { shipping_profile_id: 2, title: 'Old', is_deleted: true },
        { shipping_profile_id: 3, title: null }
      ]),
      getProcessingProfiles: vi.fn(async () => [
        { readiness_state_id: 5, processing_days_display_label: '1-3 business days' },
        { readiness_state_id: 6, readiness_state: 'made_to_order', min_processing_days: 3, max_processing_days: 5 },
        { readiness_state_id: 7 }
      ])
    })
    expect(await loadShippingOptions(d)).toEqual([
      { id: 1, label: 'Standard (з UA)' },
      { id: 3, label: 'Профіль 3' }
    ])
    expect(await loadProcessingOptions(d)).toEqual([
      { id: 5, label: '1-3 business days' },
      { id: 6, label: 'на замовлення, 3–5 дн.' },
      { id: 7, label: 'Профіль 7' }
    ])
  })

  it('mimeOf and the file registry', () => {
    expect(mimeOf('A.JPG')).toBe('image/jpeg')
    expect(mimeOf('x.unknown')).toBe('application/octet-stream')
    const r = createFileRegistry()
    const a = r.add('/p/a.jpg', 'a.jpg', 3)
    expect(a).toEqual({ token: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'a.jpg', size: 3 })
    expect(r.get(a.token)).toEqual({ path: '/p/a.jpg', name: 'a.jpg', size: 3 })
    expect(r.get('nope')).toBeNull()
    expect(JSON.stringify(a)).not.toContain('/p/')
  })
})
