// A stateful fake of the user's own Etsy shop for the draft send/update/delete
// paths (and pulling Etsy drafts): listings with their images, buyer files and
// inventory, behind the real OAS paths, through the real client (testClient).

import { testClient, routedFetch, OWN_SHOP } from './features'

export interface FakeImage {
  listing_image_id: number
  rank: number
  url_fullxfull: string
  url_570xN: string
  url_170x135: string
}

export interface FakeFile {
  listing_file_id: number
  rank: number
  filename: string
  size_bytes: number
  filesize: string
}

export interface FakeOffering {
  offering_id: number
  price: { amount: number; divisor: number; currency_code: string }
  quantity: number
  is_enabled: boolean
  readiness_state_id: number | null
}

export interface FakeProduct {
  product_id: number
  sku: string
  property_values: Array<{ property_id: number; property_name: string; value_ids: number[]; values: string[] }>
  offerings: FakeOffering[]
}

export interface FakeListing {
  listing_id: number
  shop_id: number
  state: string
  title: string
  description: string
  tags: string[]
  materials: string[]
  who_made: string
  when_made: string
  is_supply: boolean
  taxonomy_id: number
  should_auto_renew: boolean
  listing_type: string
  shipping_profile_id: number | null
  price: { amount: number; divisor: number; currency_code: string }
  quantity: number
  updated_timestamp: number
  url: string
  /** The listing's photos, in display order (rank = index + 1). */
  images: FakeImage[]
  files: FakeFile[]
  products: FakeProduct[]
}

const img = (id: number): FakeImage => ({
  listing_image_id: id,
  rank: 0,
  url_fullxfull: `https://i.etsystatic.com/1/r/il/x/${id}/il_fullxfull.${id}.jpg`,
  url_570xN: `https://i.etsystatic.com/1/r/il/x/${id}/il_570xN.${id}.jpg`,
  url_170x135: `https://i.etsystatic.com/1/r/il/x/${id}/il_170x135.${id}.jpg`
})

const rerank = <T extends { rank: number }>(list: T[]): T[] => {
  list.forEach((x, i) => (x.rank = i + 1))
  return list
}

export function mkFakeListing(id: number, over: Partial<FakeListing> = {}): FakeListing {
  return {
    listing_id: id,
    shop_id: OWN_SHOP,
    state: 'draft',
    title: `Listing ${id}`,
    description: 'Desc',
    tags: [],
    materials: [],
    who_made: 'i_did',
    when_made: 'made_to_order',
    is_supply: false,
    taxonomy_id: 2,
    should_auto_renew: true,
    listing_type: 'download',
    shipping_profile_id: null,
    price: { amount: 599, divisor: 100, currency_code: 'USD' },
    quantity: 999,
    updated_timestamp: 1_700_000_000,
    url: `https://www.etsy.com/listing/${id}`,
    images: [],
    files: [],
    products: [
      {
        product_id: id * 10,
        sku: '',
        property_values: [],
        offerings: [
          { offering_id: id * 100, price: { amount: 599, divisor: 100, currency_code: 'USD' }, quantity: 999, is_enabled: true, readiness_state_id: null }
        ]
      }
    ],
    ...over
  }
}

/** Fail the next `times` requests matching `METHOD /path-regex` with `status`. */
export interface FakeFailure {
  match: string
  status: number
  times?: number
  error?: string
}

export function ownEtsy(opts: { listings?: FakeListing[]; scopes?: string[] } = {}) {
  const listings = new Map<number, FakeListing>((opts.listings ?? []).map((l) => [l.listing_id, l]))
  let clock = 1_800_000_000
  let nextListing = 4242
  let nextImage = 9001
  let nextFile = 7001
  const failures: FakeFailure[] = []
  const touch = (l: FakeListing) => (l.updated_timestamp = ++clock)
  // The fewest photos/files each listing had after any photo/file write (a live listing must never drop to none).
  const lows = new Map<number, { images: number; files: number }>()
  const track = (l: FakeListing) => {
    const cur = lows.get(l.listing_id) ?? { images: l.images.length, files: l.files.length }
    lows.set(l.listing_id, { images: Math.min(cur.images, l.images.length), files: Math.min(cur.files, l.files.length) })
  }
  const get = (url: URL, at: number): FakeListing | undefined => listings.get(Number(url.pathname.split('/')[at]))
  const notFound = { status: 404, body: { error: 'Listing not found' } }
  const out = (l: FakeListing) => {
    const { images, files, products, ...rest } = l
    void files
    void products
    return { ...rest, images: images.map((i) => ({ ...i })) }
  }
  const failing = (method: string, url: URL) => {
    const f = failures.find((x) => (x.times ?? 1) > 0 && new RegExp(x.match).test(`${method} ${url.pathname}`))
    if (!f) return null
    f.times = (f.times ?? 1) - 1
    return { status: f.status, body: { error: f.error ?? `failed ${f.status}` } }
  }
  const route = (key: string, h: (url: URL, init?: RequestInit) => { status?: number; body?: unknown }) => ({
    [key]: (url: URL, init?: RequestInit) => failing(key.split(' ')[0], url) ?? h(url, init)
  })
  const form = (init?: RequestInit) => new URLSearchParams(String(init?.body ?? ''))
  const fetch = routedFetch({
    ...route('POST /v3/application/shops/{shop}/listings', (_u, init) => {
      const f = form(init)
      const id = nextListing++
      const l = mkFakeListing(id, {
        title: f.get('title') ?? '',
        description: f.get('description') ?? '',
        listing_type: f.get('type') ?? 'download',
        quantity: Number(f.get('quantity') ?? 1),
        price: { amount: Math.round(Number(f.get('price') ?? 0) * 100), divisor: 100, currency_code: 'USD' }
      })
      touch(l)
      listings.set(id, l)
      return { status: 201, body: out(l) }
    }),
    ...route('GET /v3/application/shops/{shop}/listings', (url) => {
      const state = url.searchParams.get('state') ?? 'active'
      const all = [...listings.values()].filter((l) => l.state === state)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 25)
      return { body: { count: all.length, results: all.slice(offset, offset + limit).map(out) } }
    }),
    ...route('GET /v3/application/listings/{id}', (url) => {
      const l = get(url, 4)
      return l ? { body: out(l) } : notFound
    }),
    ...route('DELETE /v3/application/listings/{id}', (url) => {
      const l = get(url, 4)
      if (!l) return notFound
      listings.delete(l.listing_id)
      return { body: {} }
    }),
    ...route('PATCH /v3/application/shops/{shop}/listings/{id}', (url, init) => {
      const l = get(url, 6)
      if (!l) return notFound
      const f = form(init)
      const list = (k: string) => (f.get(k) ? f.get(k)!.split(',') : [])
      if (f.has('title')) l.title = f.get('title')!
      if (f.has('description')) l.description = f.get('description')!
      if (f.has('tags')) l.tags = list('tags')
      if (f.has('materials')) l.materials = list('materials')
      if (f.has('who_made')) l.who_made = f.get('who_made')!
      if (f.has('when_made')) l.when_made = f.get('when_made')!
      if (f.has('is_supply')) l.is_supply = f.get('is_supply') === 'true'
      if (f.has('should_auto_renew')) l.should_auto_renew = f.get('should_auto_renew') === 'true'
      if (f.has('taxonomy_id')) l.taxonomy_id = Number(f.get('taxonomy_id'))
      if (f.has('type')) l.listing_type = f.get('type')!
      if (f.has('shipping_profile_id')) l.shipping_profile_id = Number(f.get('shipping_profile_id'))
      if (f.has('state')) l.state = f.get('state')!
      touch(l)
      return { body: out(l) }
    }),
    ...route('GET /v3/application/listings/{id}/inventory', (url) => {
      const l = get(url, 4)
      return l ? { body: { products: l.products, price_on_property: [], quantity_on_property: [], sku_on_property: [], readiness_state_on_property: [] } } : notFound
    }),
    ...route('PUT /v3/application/listings/{id}/inventory', (url, init) => {
      const l = get(url, 4)
      if (!l) return notFound
      const body = JSON.parse(String(init?.body)) as {
        products: Array<{ sku: string; property_values: FakeProduct['property_values']; offerings: Array<{ price: number; quantity: number; is_enabled: boolean; readiness_state_id: number | null }> }>
      }
      l.products = body.products.map((p, i) => ({
        product_id: l.listing_id * 10 + i,
        sku: p.sku,
        property_values: p.property_values,
        offerings: p.offerings.map((o, j) => ({
          offering_id: l.listing_id * 100 + i * 10 + j,
          price: { amount: Math.round(o.price * 100), divisor: 100, currency_code: 'USD' },
          quantity: o.quantity,
          is_enabled: o.is_enabled,
          readiness_state_id: o.readiness_state_id
        }))
      }))
      if (l.products.length === 1 && l.products[0].offerings.length === 1) {
        l.price = l.products[0].offerings[0].price
        l.quantity = l.products[0].offerings[0].quantity
      }
      touch(l)
      return { body: { products: l.products } }
    }),
    ...route('GET /v3/application/listings/{id}/images', (url) => {
      const l = get(url, 4)
      return l ? { body: { count: l.images.length, results: l.images.map((i) => ({ ...i })) } } : notFound
    }),
    // uploadListingImage: a new `image` is inserted at `rank`; `listing_image_id`
    // re-attaches (moves) an image there; `overwrite` takes the one at that rank off.
    ...route('POST /v3/application/shops/{shop}/listings/{id}/images', (url, init) => {
      const l = get(url, 6)
      if (!l) return notFound
      const fd = init?.body as FormData
      const rank = Number(fd.get('rank') ?? 1)
      const reId = fd.get('listing_image_id') ? Number(fd.get('listing_image_id')) : null
      const image = fd.get('image') ? img(nextImage++) : reId != null ? img(reId) : null
      if (!image) return { status: 400, body: { error: 'no image' } }
      if (!fd.get('image') && reId != null) l.images = l.images.filter((i) => i.listing_image_id !== reId)
      const at = Math.min(Math.max(rank - 1, 0), l.images.length)
      if (fd.get('overwrite') === 'true' && l.images[at]) l.images.splice(at, 1, image)
      else l.images.splice(at, 0, image)
      if (l.images.length > 10) return { status: 400, body: { error: 'too many images' } }
      rerank(l.images)
      touch(l)
      track(l)
      return { status: 201, body: { ...image } }
    }),
    ...route('DELETE /v3/application/shops/{shop}/listings/{id}/images/{img}', (url) => {
      const l = get(url, 6)
      const id = Number(url.pathname.split('/')[8])
      if (!l || !l.images.some((i) => i.listing_image_id === id)) return { status: 404, body: { error: 'no image' } }
      l.images = rerank(l.images.filter((i) => i.listing_image_id !== id))
      touch(l)
      track(l)
      return { body: {} }
    }),
    ...route('GET /v3/application/shops/{shop}/listings/{id}/files', (url) => {
      const l = get(url, 6)
      return l ? { body: { count: l.files.length, results: l.files.map((f) => ({ ...f })) } } : notFound
    }),
    ...route('POST /v3/application/shops/{shop}/listings/{id}/files', (url, init) => {
      const l = get(url, 6)
      if (!l) return notFound
      const fd = init?.body as FormData
      const file = fd.get('file') as File | null
      const f: FakeFile = {
        listing_file_id: nextFile++,
        rank: Number(fd.get('rank') ?? l.files.length + 1),
        filename: String(fd.get('name') ?? file?.name ?? 'file'),
        size_bytes: file?.size ?? 0,
        filesize: `${file?.size ?? 0} B`
      }
      l.files.push(f)
      if (l.files.length > 5) return { status: 400, body: { error: 'too many files' } }
      touch(l)
      track(l)
      return { status: 201, body: { ...f } }
    }),
    ...route('DELETE /v3/application/shops/{shop}/listings/{id}/files/{file}', (url) => {
      const l = get(url, 6)
      const id = Number(url.pathname.split('/')[8])
      if (!l || !l.files.some((f) => f.listing_file_id === id)) return { status: 404, body: { error: 'no file' } }
      l.files = l.files.filter((f) => f.listing_file_id !== id)
      touch(l)
      track(l)
      return { body: {} }
    })
  })
  const client = testClient(fetch)
  /** The listing as the seller changed it on Etsy's site (bumps updated_timestamp). */
  const editOnEtsy = (id: number, change: (l: FakeListing) => void) => {
    const l = listings.get(id)!
    change(l)
    touch(l)
  }
  /** Requests as "METHOD /path" (no query), in order. */
  const requests = () => fetch.calls.map((c) => `${c.method} ${c.url.pathname}`)
  const writes = () => requests().filter((r) => !r.startsWith('GET '))
  /** Photos already on a listing (e.g. added on Etsy's site): their new ids. */
  const addImages = (id: number, n: number): number[] => {
    const l = listings.get(id)!
    const ids = Array.from({ length: n }, () => {
      const i = img(nextImage++)
      l.images.push(i)
      return i.listing_image_id
    })
    rerank(l.images)
    return ids
  }
  const addFile = (id: number, filename: string): number => {
    const l = listings.get(id)!
    const f: FakeFile = { listing_file_id: nextFile++, rank: l.files.length + 1, filename, size_bytes: 10, filesize: '10 B' }
    l.files.push(f)
    return f.listing_file_id
  }
  const imageIds = (id: number): number[] => listings.get(id)!.images.map((i) => i.listing_image_id)
  /** Start watching how few photos/files the listing has from now on (see `lowest`). */
  const watch = (id: number) => lows.delete(id)
  /** The fewest photos/files the listing had after a photo/file write since `watch` (null = no write). */
  const lowest = (id: number) => lows.get(id) ?? null
  return { fetch, client, listings, failures, editOnEtsy, requests, writes, addImages, addFile, imageIds, watch, lowest }
}
