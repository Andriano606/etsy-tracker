import { describe, expect, it, vi } from 'vitest'
import {
  PULL_NO_SHOP,
  PULL_SIGNED_OUT,
  etsyDraftFields,
  importEtsyDrafts,
  moneyToPrice,
  photoName,
  type DraftImportDeps
} from '../../src/main/draftImport'
import { getDraft, getDraftMediaData, listDrafts, saveDraft, sendDraft } from '../../src/main/drafts'
import type { EtsyListing } from '../../src/main/etsyApi'
import { downloadImage } from '../../src/main/imageSync'
import { EMPTY_DRAFT_FIELDS } from '../../src/shared/myShop'
import type { EtsyAuthStatus, ListingDraft } from '../../src/shared/types'
import { memDb } from '../helpers/db'
import { OWN_SHOP, signedIn } from '../helpers/features'
import { cdnBytes, fakeCdn } from '../helpers/fakeImageStore'
import { type FakeListing, mkFakeListing, ownEtsy } from '../helpers/ownEtsy'

const SHOP_LISTINGS = `GET /v3/application/shops/${OWN_SHOP}/listings`

/** The own shop on a fake Etsy + a real SQLite + the real CDN download over a fake CDN. */
function setup(listings: FakeListing[] = []) {
  const e = ownEtsy({ listings })
  const db = memDb()
  const cdn = fakeCdn()
  let status: EtsyAuthStatus = signedIn()
  let t = 10_000
  const taxonomy = vi.fn(async () => [
    { id: 2, path: 'Paper › Planners' },
    { id: 3, path: 'Art › Prints' }
  ])
  const deps: DraftImportDeps = {
    db,
    client: e.client,
    auth: { status: () => status },
    taxonomy,
    fetchImage: (url) => downloadImage(url, { fetch: cdn, sleep: async () => {}, timeoutMs: 1000, retries: 0 }),
    now: () => ++t
  }
  const run = () => importEtsyDrafts(deps)
  const setStatus = (s: EtsyAuthStatus) => (status = s)
  /** Requests to Etsy's API since the last call of this. */
  let seen = 0
  const newRequests = () => {
    const all = e.requests()
    const out = all.slice(seen)
    seen = all.length
    return out
  }
  const draftOf = (listingId: number): ListingDraft | undefined => listDrafts(db).find((d) => d.sentListingId === listingId)
  const bytesOf = (mediaId: number) => Buffer.from(getDraftMediaData(db, mediaId)!.data).toString()
  return { ...e, db, cdn, deps, run, setStatus, newRequests, draftOf, bytesOf, taxonomy }
}

const empty = { imported: 0, updated: 0, removed: 0, conflicts: 0, errors: [] }
const urlOf = (o: ReturnType<typeof setup>, listingId: number, imageId: number) =>
  o.listings.get(listingId)!.images.find((i) => i.listing_image_id === imageId)!.url_fullxfull

describe('mapping an Etsy listing', () => {
  it('fields: entities decoded, Money → typed price, download → digital, the rest → physical', () => {
    const l = {
      ...mkFakeListing(1),
      title: 'Tom &amp; Jerry&#39;s planner',
      description: 'A &lt;b&gt; text',
      tags: ['to &amp; do'],
      materials: ['paper'],
      is_supply: true,
      should_auto_renew: false
    } as unknown as EtsyListing
    expect(etsyDraftFields(l, 'Paper › Planners')).toEqual({
      ...EMPTY_DRAFT_FIELDS,
      type: 'download',
      title: "Tom & Jerry's planner",
      description: 'A <b> text',
      price: '5.99',
      quantity: 999,
      taxonomyId: 2,
      taxonomyPath: 'Paper › Planners',
      tags: ['to & do'],
      materials: ['paper'],
      isSupply: true,
      shouldAutoRenew: false
    })
    const phys = { ...l, listing_type: 'both', shipping_profile_id: 77, readiness_state_id: 5, taxonomy_id: null } as unknown as EtsyListing
    expect(etsyDraftFields(phys, 'x')).toMatchObject({ type: 'physical', shippingProfileId: 77, readinessStateId: 5, taxonomyId: null, taxonomyPath: null })
    // a digital draft has no shipping/processing profile even when Etsy lists one
    expect(etsyDraftFields({ ...l, shipping_profile_id: 77 } as unknown as EtsyListing, null)).toMatchObject({ shippingProfileId: null })
  })

  it('prices and photo names', () => {
    expect(moneyToPrice({ amount: 599, divisor: 100, currency_code: 'USD' })).toBe('5.99')
    expect(moneyToPrice({ amount: 500, divisor: 100, currency_code: 'USD' })).toBe('5.00')
    expect(moneyToPrice({ amount: 5, divisor: 100, currency_code: 'USD' })).toBe('0.05')
    expect(moneyToPrice({ amount: 12345, divisor: 1000, currency_code: 'USD' })).toBe('12.35')
    expect(moneyToPrice(undefined)).toBe('')
    expect(moneyToPrice({ amount: 1, divisor: 0, currency_code: 'USD' })).toBe('')
    const img = { listing_image_id: 9, url_fullxfull: 'https://i.etsystatic.com/x/il_fullxfull.9.png' }
    expect(photoName(img, 'image/jpeg')).toBe('etsy-9.jpg')
    expect(photoName(img, 'image/png; charset=binary')).toBe('etsy-9.png')
    expect(photoName(img, null)).toBe('etsy-9.png')
    expect(photoName({ ...img, url_fullxfull: 'https://i.etsystatic.com/x/a.jpeg?v=1' }, 'application/octet-stream')).toBe('etsy-9.jpg')
    expect(photoName({ ...img, url_fullxfull: 'https://i.etsystatic.com/x/a.webp' }, 'image/webp')).toBeNull()
  })
})

describe('importEtsyDrafts: drafts made on Etsy’s site', () => {
  it('imports each Etsy draft once: fields, photos (CDN → BLOBs, Etsy order) and buyer files as Etsy-only rows', async () => {
    const o = setup([
      mkFakeListing(501, { title: 'Budget &amp; Bills', tags: ['budget'], taxonomy_id: 2 }),
      mkFakeListing(502, { state: 'active', title: 'Live one' })
    ])
    const [p1, p2] = o.addImages(501, 2)
    o.listings.get(501)!.images.reverse().forEach((i, n) => (i.rank = n + 1)) // Etsy's order: p2, p1
    const f1 = o.addFile(501, 'Planner.pdf')
    const res = await o.run()
    expect(res).toEqual({ ...empty, imported: 1 })
    const d = o.draftOf(501)!
    expect(d).toMatchObject({
      source: 'etsy',
      status: 'sent',
      fields: { title: 'Budget & Bills', price: '5.99', type: 'download', tags: ['budget'], taxonomyId: 2, taxonomyPath: 'Paper › Planners' },
      etsy: { listingId: 501, state: 'draft', dirty: false, changedOnEtsy: false, removed: false, etsyUpdatedAt: o.listings.get(501)!.updated_timestamp, url: null }
    })
    expect(d.photos.map((p) => [p.name, p.onEtsy, p.remote])).toEqual([
      [`etsy-${p2}.jpg`, true, false],
      [`etsy-${p1}.jpg`, true, false]
    ])
    expect(o.bytesOf(d.photos[0].id)).toBe(cdnBytes(urlOf(o, 501, p2)).toString())
    expect(d.files).toEqual([expect.objectContaining({ name: 'Planner.pdf', onEtsy: true, remote: true, size: 10 })])
    expect(getDraftMediaData(o.db, d.files[0].id)!.etsy_id).toBe(f1)
    expect(o.draftOf(502)).toBeUndefined() // only drafts are pulled
    expect(o.writes()).toEqual([]) // a pull never writes to Etsy
  })

  it('is idempotent: a second pull changes nothing, downloads nothing and reads only the draft list', async () => {
    const o = setup([mkFakeListing(501), mkFakeListing(503, { listing_type: 'physical', shipping_profile_id: 8 })])
    o.addImages(501, 2)
    o.addImages(503, 1)
    o.addFile(501, 'a.pdf')
    expect(await o.run()).toMatchObject({ imported: 2 })
    const before = listDrafts(o.db)
    const downloads = o.cdn.calls.length
    expect(downloads).toBe(3)
    o.newRequests()
    expect(await o.run()).toEqual(empty)
    expect(o.cdn.calls.length).toBe(downloads)
    expect(o.newRequests()).toEqual([SHOP_LISTINGS])
    expect(listDrafts(o.db)).toEqual(before)
  })

  it('a physical draft: shipping profile kept, no buyer-file read', async () => {
    const o = setup([mkFakeListing(503, { listing_type: 'physical', shipping_profile_id: 8, quantity: 3 })])
    await o.run()
    expect(o.draftOf(503)!.fields).toMatchObject({ type: 'physical', shippingProfileId: 8, quantity: 3 })
    expect(o.requests().some((r) => r.endsWith('/files'))).toBe(false)
  })

  it('pages through every Etsy draft (100 per page)', async () => {
    const o = setup(Array.from({ length: 230 }, (_, i) => mkFakeListing(1000 + i, { listing_type: 'physical' })))
    expect(await o.run()).toMatchObject({ imported: 230, errors: [] })
    const pages = o.fetch.calls.filter((c) => c.url.pathname === `/v3/application/shops/${OWN_SHOP}/listings`)
    expect(pages.map((c) => [c.url.searchParams.get('state'), c.url.searchParams.get('offset'), c.url.searchParams.get('includes')])).toEqual([
      ['draft', null, 'Images'],
      ['draft', '100', 'Images'],
      ['draft', '200', 'Images']
    ])
    expect(listDrafts(o.db)).toHaveLength(230)
  })

  it('looks the category path up at most once per pull; a failing tree leaves the path empty', async () => {
    const o = setup([mkFakeListing(501), mkFakeListing(502, { taxonomy_id: 3 })])
    await o.run()
    expect(o.taxonomy).toHaveBeenCalledTimes(1)
    expect(o.draftOf(502)!.fields.taxonomyPath).toBe('Art › Prints')
    const q = setup([mkFakeListing(501)])
    q.taxonomy.mockRejectedValue(new Error('down'))
    expect(await q.run()).toMatchObject({ imported: 1, errors: [] })
    expect(q.draftOf(501)!.fields).toMatchObject({ taxonomyId: 2, taxonomyPath: null })
  })

  it('a photo that fails to download doesn’t drop the draft: reported, and fetched by the next pull', async () => {
    const o = setup([mkFakeListing(501)])
    const [a, b] = o.addImages(501, 2)
    o.cdn.opts.status = { [`/${b}/`]: 404 }
    const res = await o.run()
    expect(res.imported).toBe(1)
    expect(res.errors).toEqual([expect.stringMatching(/^«Listing 501»: фото 2 з Etsy не завантажилось \(.*404.*\) — спробуємо ще раз/)])
    let d = o.draftOf(501)!
    expect(d.photos.map((p) => p.name)).toEqual([`etsy-${a}.jpg`])
    // Fields in sync with Etsy's time; the missing photo is a gap → the next pull looks again (and an update keeps it on Etsy).
    expect(d.etsy).toMatchObject({ etsyUpdatedAt: o.listings.get(501)!.updated_timestamp, incomplete: true })
    o.cdn.opts.status = {}
    expect(await o.run()).toEqual({ ...empty, updated: 1 })
    d = o.draftOf(501)!
    expect(d.photos.map((p) => p.name)).toEqual([`etsy-${a}.jpg`, `etsy-${b}.jpg`])
    expect(d.etsy).toMatchObject({ etsyUpdatedAt: o.listings.get(501)!.updated_timestamp, incomplete: false })
    expect(o.cdn.calls.filter((u) => u.includes(`/${a}/`))).toHaveLength(1) // the held photo isn't downloaded again
  })

  it('never downloads a photo URL that isn’t on Etsy’s CDN', async () => {
    const o = setup([mkFakeListing(501)])
    o.addImages(501, 1)
    o.listings.get(501)!.images[0].url_fullxfull = 'https://evil.example/x.jpg'
    const res = await o.run()
    expect(res).toMatchObject({ imported: 1, errors: [expect.stringContaining('CDN Etsy')] })
    expect(o.cdn.calls).toEqual([])
    expect(o.draftOf(501)!.photos).toEqual([])
  })

  it('unreadable buyer files: imported without them (reported), read again by the next pull', async () => {
    const o = setup([mkFakeListing(501)])
    o.addFile(501, 'a.pdf')
    o.failures.push({ match: 'GET .*/files$', status: 500, times: 2 })
    const res = await o.run()
    expect(res).toMatchObject({ imported: 1, errors: [expect.stringContaining('не вдалося прочитати файли для покупця')] })
    expect(o.draftOf(501)!.files).toEqual([])
    expect(await o.run()).toEqual({ ...empty, updated: 1 })
    expect(o.draftOf(501)!.files.map((f) => [f.name, f.remote])).toEqual([['a.pdf', true]])
  })

  it('a failing listing is reported and the rest still runs', async () => {
    const o = setup([mkFakeListing(501), mkFakeListing(502)])
    o.addFile(501, 'a.pdf')
    o.addFile(502, 'b.pdf')
    // an Etsy-only file without a name/id the draft rules accept → saveDraft refuses that one draft
    o.listings.get(501)!.files[0].listing_file_id = 0
    const res = await o.run()
    expect(res.imported).toBe(1)
    expect(res.errors).toEqual([expect.stringMatching(/^«Listing 501»: /)])
    expect(o.draftOf(502)).toBeDefined()
  })

  it('a failing page fails the pull as a whole and changes nothing', async () => {
    const o = setup([mkFakeListing(501)])
    o.failures.push({ match: 'GET .*/shops/\\d+/listings$', status: 500, times: 2 })
    await expect(o.run()).rejects.toThrow()
    expect(listDrafts(o.db)).toEqual([])
  })

  it('never imports another shop’s listing', async () => {
    const o = setup([mkFakeListing(501, { shop_id: 999 })])
    expect(await o.run()).toEqual(empty)
    expect(listDrafts(o.db)).toEqual([])
  })

  it('signed out, no shop or no listings_r: nothing read, the pull fails with the reason (not a per-product note)', async () => {
    const o = setup([mkFakeListing(501)])
    o.setStatus({ loggedIn: false, redirectUri: '', pending: false, encrypted: false })
    await expect(o.run()).rejects.toThrow(PULL_SIGNED_OUT)
    o.setStatus(signedIn({ shopId: undefined }))
    await expect(o.run()).rejects.toThrow(PULL_NO_SHOP)
    o.setStatus(signedIn({ scopes: ['shops_r', 'listings_w'] }))
    await expect(o.run()).rejects.toThrow('читання товарів')
    expect(o.requests()).toEqual([])
    expect(listDrafts(o.db)).toEqual([])
  })
})

describe('importEtsyDrafts: drafts already linked to an Etsy draft', () => {
  it('a draft the app sent is not imported again (the send’s baseline matches)', async () => {
    const o = setup()
    const d = saveDraft(o.db, { source: 'app', fields: { ...EMPTY_DRAFT_FIELDS, title: 'Mine', description: 'Text', price: '3', taxonomyId: 2 } }, 1)
    expect(await sendDraft({ db: o.db, client: o.client, auth: o.deps.auth }, d.id, false)).toMatchObject({ ok: true })
    const sent = getDraft(o.db, d.id)!
    o.newRequests()
    expect(await o.run()).toEqual(empty)
    expect(listDrafts(o.db)).toEqual([sent])
    expect(o.newRequests()).toEqual([SHOP_LISTINGS])
  })

  it('changed on Etsy, no local edits: fields, photos and files refreshed — only new photos downloaded', async () => {
    const o = setup([mkFakeListing(501)])
    const [a, b] = o.addImages(501, 2)
    const fa = o.addFile(501, 'a.pdf')
    await o.run()
    const before = o.draftOf(501)!
    const keptA = before.photos.find((p) => p.name === `etsy-${a}.jpg`)!.id
    // on Etsy's site: a new title, photo b deleted, a new photo c made the main one, a.pdf replaced by b.pdf
    o.editOnEtsy(501, (l) => {
      l.title = 'Renamed on Etsy'
      l.images = l.images.filter((i) => i.listing_image_id !== b)
      l.files = []
    })
    const [c] = o.addImages(501, 1)
    o.editOnEtsy(501, (l) => {
      l.images = [l.images[1], l.images[0]]
      l.images.forEach((i, n) => (i.rank = n + 1))
    })
    o.addFile(501, 'b.pdf')
    const downloads = o.cdn.calls.length
    expect(await o.run()).toEqual({ ...empty, updated: 1 })
    const d = o.draftOf(501)!
    expect(d.id).toBe(before.id)
    expect(d.fields.title).toBe('Renamed on Etsy')
    expect(d.photos.map((p) => p.name)).toEqual([`etsy-${c}.jpg`, `etsy-${a}.jpg`])
    expect(d.photos[1].id).toBe(keptA) // the held photo is the same row
    expect(o.cdn.calls.length).toBe(downloads + 1)
    expect(d.files.map((f) => f.name)).toEqual(['b.pdf'])
    expect(getDraftMediaData(o.db, d.files[0].id)!.etsy_id).not.toBe(fa)
    expect(d).toMatchObject({ status: 'sent', etsy: { dirty: false, etsyUpdatedAt: o.listings.get(501)!.updated_timestamp } })
  })

  it('a draft with local edits is never overwritten: a change on Etsy is flagged as a conflict', async () => {
    const o = setup([mkFakeListing(501)])
    await o.run()
    const d0 = o.draftOf(501)!
    saveDraft(o.db, { id: d0.id, source: 'app', fields: { ...d0.fields, title: 'Edited here' } }, 50)
    // not changed on Etsy → no conflict
    expect(await o.run()).toEqual(empty)
    expect(o.draftOf(501)!.etsy!.changedOnEtsy).toBe(false)
    o.editOnEtsy(501, (l) => (l.title = 'Edited on Etsy'))
    o.addImages(501, 1)
    o.newRequests()
    expect(await o.run()).toEqual({ ...empty, conflicts: 1 })
    const d = o.draftOf(501)!
    expect(d).toMatchObject({ status: 'changed', fields: { title: 'Edited here' }, photos: [], etsy: { dirty: true, changedOnEtsy: true } })
    expect(o.cdn.calls).toEqual([])
    expect(o.newRequests()).toEqual([SHOP_LISTINGS])
    const row = o.db.prepare('SELECT etsy_changed_at, updated_at FROM listing_drafts WHERE id = ?').get(d.id) as { etsy_changed_at: number; updated_at: number }
    expect(row.etsy_changed_at).toBe(o.listings.get(501)!.updated_timestamp)
    // still a conflict on the next pull, nothing else written
    expect(await o.run()).toEqual({ ...empty, conflicts: 1 })
    expect(getDraft(o.db, d.id)).toEqual(d)
  })

  it('a local edit made while the pull downloads is kept (the refresh is skipped)', async () => {
    const o = setup([mkFakeListing(501)])
    await o.run()
    const d0 = o.draftOf(501)!
    o.editOnEtsy(501, (l) => (l.title = 'On Etsy'))
    o.addImages(501, 1)
    const fetchImage = o.deps.fetchImage
    o.deps.fetchImage = async (url) => {
      saveDraft(o.db, { id: d0.id, source: 'app', fields: { ...d0.fields, title: 'Typed meanwhile' } }, 99)
      return fetchImage(url)
    }
    expect(await o.run()).toEqual(empty)
    expect(o.draftOf(501)).toMatchObject({ fields: { title: 'Typed meanwhile' }, photos: [], etsy: { dirty: true } })
  })

  it('left Etsy’s drafts: published / deactivated → its new state (checked once); deleted → removed', async () => {
    const o = setup([mkFakeListing(501), mkFakeListing(502), mkFakeListing(503), mkFakeListing(504)])
    await o.run()
    // an app draft linked to an Etsy draft (sent from the app, never published)
    const app = saveDraft(o.db, { source: 'mcp', fields: { ...EMPTY_DRAFT_FIELDS, title: 'Mine' }, link: { listingId: 505, state: 'draft', etsyUpdatedAt: 1 } }, 5)
    const edited = o.draftOf(503)!
    saveDraft(o.db, { id: edited.id, source: 'app', fields: { ...edited.fields, title: 'Edited' } }, 60)
    o.editOnEtsy(501, (l) => (l.state = 'active'))
    o.editOnEtsy(502, (l) => (l.state = 'inactive'))
    o.listings.delete(503) // deleted on Etsy, edited here → kept, marked removed
    o.listings.delete(504) // deleted on Etsy, imported and unedited → gone from the app too
    // 505 never existed on this fake → 404 → the app's own draft is kept, marked removed
    o.newRequests()
    expect(await o.run()).toEqual({ ...empty, updated: 2, removed: 3 })
    expect(o.draftOf(501)!.etsy).toMatchObject({ state: 'active', url: 'https://www.etsy.com/listing/501' })
    expect(o.draftOf(501)!.sentPublished).toBe(true)
    expect(o.draftOf(502)!.etsy).toMatchObject({ state: 'inactive', url: null })
    expect(o.draftOf(503)).toMatchObject({ fields: { title: 'Edited' }, etsy: { state: 'removed', removed: true, dirty: true } })
    expect(o.draftOf(504)).toBeUndefined()
    expect(getDraft(o.db, app.id)!.etsy).toMatchObject({ state: 'removed', removed: true })
    expect(o.newRequests().sort()).toEqual(
      [SHOP_LISTINGS, ...[501, 502, 503, 504, 505].map((id) => `GET /v3/application/listings/${id}`)].sort()
    )
    // their states are known now: the next pull reads the draft list alone
    expect(await o.run()).toEqual(empty)
    expect(o.newRequests()).toEqual([SHOP_LISTINGS])
  })

  it('a listing of another shop (an earlier sign-in) is left alone; a failed state read is reported', async () => {
    const o = setup([mkFakeListing(601, { shop_id: 999, state: 'active' })])
    const other = saveDraft(o.db, { source: 'app', fields: EMPTY_DRAFT_FIELDS, link: { listingId: 601, state: 'draft', etsyUpdatedAt: 1 } }, 1)
    const broken = saveDraft(o.db, { source: 'app', fields: { ...EMPTY_DRAFT_FIELDS, title: 'Broken' }, link: { listingId: 602, state: 'draft', etsyUpdatedAt: 1 } }, 2)
    o.failures.push({ match: 'GET /v3/application/listings/602$', status: 500, times: 2 })
    const res = await o.run()
    expect(res).toEqual({ ...empty, errors: [expect.stringMatching(/^«Broken»: не вдалося дізнатися стан на Etsy/)] })
    expect(getDraft(o.db, other.id)!.etsy).toMatchObject({ state: 'draft', removed: false })
    expect(getDraft(o.db, broken.id)!.etsy).toMatchObject({ state: 'draft', removed: false })
  })
})

describe('importEtsyDrafts: never losing what the draft holds', () => {
  it('a draft sent by an older version (no Etsy ids): its own buyer files are matched by name and size, not replaced by Etsy-only copies', async () => {
    const o = setup()
    const d = saveDraft(
      o.db,
      {
        source: 'app',
        fields: { ...EMPTY_DRAFT_FIELDS, title: 'Mine', description: 'Text', price: '3', taxonomyId: 2 },
        files: [{ name: 'Plan.pdf', data: new Uint8Array(Buffer.from('MY-BYTES')) }]
      },
      1
    )
    expect(await sendDraft({ db: o.db, client: o.client, auth: o.deps.auth }, d.id, false)).toMatchObject({ ok: true })
    const listingId = getDraft(o.db, d.id)!.sentListingId!
    // What a v5 send left behind after the migrations: no baseline, no media ids.
    o.db.prepare('UPDATE listing_drafts SET etsy_updated_at = NULL, synced_at = NULL, unverified = 1, etsy_shop_id = NULL WHERE id = ?').run(d.id)
    o.db.prepare('UPDATE listing_draft_media SET etsy_id = NULL WHERE draft_id = ?').run(d.id)
    expect(await o.run()).toEqual({ ...empty, updated: 1 })
    const after = getDraft(o.db, d.id)!
    expect(after.files.map((f) => [f.name, f.remote, f.onEtsy])).toEqual([['Plan.pdf', false, true]])
    expect(o.bytesOf(after.files[0].id)).toBe('MY-BYTES')
    expect(after.etsy).toMatchObject({ listingId, unverified: false, shopId: OWN_SHOP, dirty: false })
  })

  it('an answer without the images list keeps the draft’s photos (a gap, retried), never wipes them', async () => {
    const o = setup([mkFakeListing(501)])
    o.addImages(501, 2)
    await o.run()
    const before = o.draftOf(501)!
    expect(before.photos).toHaveLength(2)
    o.editOnEtsy(501, (l) => (l.title = 'Renamed'))
    const page = o.deps.client.getShopListingsByState
    o.deps.client = {
      ...o.deps.client,
      getShopListingsByState: async (...a: Parameters<typeof page>) => {
        const p = await page(...a)
        return { ...p, results: (p.results ?? []).map(({ images: _images, ...rest }) => rest as typeof rest & { images?: never }) }
      }
    } as typeof o.deps.client
    const res = await o.run()
    expect(res).toMatchObject({ updated: 1, errors: [expect.stringContaining('не віддав фото')] })
    const d = o.draftOf(501)!
    expect(d.fields.title).toBe('Renamed')
    expect(d.photos.map((p) => p.id)).toEqual(before.photos.map((p) => p.id))
    expect(d.etsy).toMatchObject({ incomplete: true, dirty: false })
  })

  it('a “both” listing: the draft’s files are kept (the refresh doesn’t drop them)', async () => {
    const o = setup([mkFakeListing(501)])
    o.addFile(501, 'a.pdf')
    await o.run()
    const d0 = o.draftOf(501)!
    expect(d0.files).toHaveLength(1)
    o.editOnEtsy(501, (l) => {
      l.listing_type = 'both'
      l.title = 'Now both'
    })
    expect(await o.run()).toEqual({ ...empty, updated: 1 })
    const d = o.draftOf(501)!
    expect(d.fields).toMatchObject({ type: 'physical', title: 'Now both' })
    expect(d.files.map((f) => f.id)).toEqual(d0.files.map((f) => f.id))
  })

  it('another account signed in: drafts of the old shop are neither read nor marked deleted', async () => {
    const o = setup([mkFakeListing(501)])
    await o.run()
    const d = o.draftOf(501)!
    expect(d.etsy!.shopId).toBe(OWN_SHOP)
    o.listings.delete(501) // not visible to the new account
    o.setStatus(signedIn({ shopId: OWN_SHOP + 1 }))
    o.newRequests()
    expect(await o.run()).toEqual(empty)
    expect(o.newRequests()).toEqual([`GET /v3/application/shops/${OWN_SHOP + 1}/listings`])
    expect(getDraft(o.db, d.id)!.etsy).toMatchObject({ state: 'draft', removed: false })
  })

  it('a pulled draft linked before its shop was recorded is kept (marked) when Etsy answers 404', async () => {
    const o = setup([mkFakeListing(501)])
    await o.run()
    const d = o.draftOf(501)!
    o.db.prepare('UPDATE listing_drafts SET etsy_shop_id = NULL WHERE id = ?').run(d.id)
    o.listings.delete(501)
    expect(await o.run()).toEqual({ ...empty, removed: 1 })
    expect(getDraft(o.db, d.id)!.etsy).toMatchObject({ state: 'removed', removed: true })
  })
})
