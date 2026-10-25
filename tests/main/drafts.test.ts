import { describe, expect, it, vi } from 'vitest'
import { EMPTY_DRAFT_FIELDS } from '../../src/shared/myShop'
import type { DraftFields, EtsyAuthStatus } from '../../src/shared/types'
import {
  DraftError,
  deleteDraft,
  draftProblems,
  getDraft,
  getDraftMediaData,
  listDrafts,
  saveDraft,
  sendDraft
} from '../../src/main/drafts'
import { EtsyApiError, type EtsyClient } from '../../src/main/etsyApi'
import { createImageProtocolHandler, parseDraftImageUrl } from '../../src/main/imageProtocol'
import { memDb } from '../helpers/db'

const fields = (over: Partial<DraftFields> = {}): DraftFields => ({
  ...EMPTY_DRAFT_FIELDS,
  title: 'Budget Planner',
  description: 'Track money.',
  price: '5.99',
  taxonomyId: 2,
  taxonomyPath: 'Paper › Planners',
  tags: ['budget'],
  ...over
})

const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s))
const photo = (name: string, s = `PHOTO:${name}`) => ({ name, data: bytes(s) })

describe('saving drafts', () => {
  it('creates a draft with its photos and files, in order', () => {
    const db = memDb()
    const d = saveDraft(
      db,
      { source: 'app', fields: fields(), photos: [photo('a.jpg'), photo('b.png')], files: [{ name: 'Plan.xlsx', data: bytes('X') }] },
      1000
    )
    expect(d).toMatchObject({ id: 1, source: 'app', status: 'draft', createdAt: 1000, updatedAt: 1000, problems: [] })
    expect(d.fields.title).toBe('Budget Planner')
    expect(d.photos.map((p) => [p.name, p.position, p.mime, p.size])).toEqual([
      ['a.jpg', 1, 'image/jpeg', 11],
      ['b.png', 2, 'image/png', 11]
    ])
    expect(d.files.map((f) => f.name)).toEqual(['Plan.xlsx'])
    expect(Buffer.from(getDraftMediaData(db, d.photos[1].id)!.data).toString()).toBe('PHOTO:b.png')
  })

  it('updates: kept media by id (reordered), removed ones deleted, new ones added; undefined keeps a kind', () => {
    const db = memDb()
    const d = saveDraft(db, { source: 'mcp', fields: fields(), photos: [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')], files: [] }, 1)
    const [a, b, c] = d.photos
    const u = saveDraft(
      db,
      { id: d.id, source: 'app', fields: fields({ title: 'New' }), photos: [{ mediaId: c.id }, photo('d.gif'), { mediaId: a.id }] },
      2
    )
    expect(u.source).toBe('mcp') // the creator is kept
    expect(u.fields.title).toBe('New')
    expect(u.photos.map((p) => p.name)).toEqual(['c.jpg', 'd.gif', 'a.jpg'])
    expect(getDraftMediaData(db, b.id)).toBeNull()
    expect(u.updatedAt).toBe(2)
    const kept = saveDraft(db, { id: d.id, source: 'app', fields: fields({ title: 'Again' }) }, 3)
    expect(kept.photos.map((p) => p.name)).toEqual(['c.jpg', 'd.gif', 'a.jpg'])
  })

  it('refuses another draft’s media, bad photos, too many, an unknown id', () => {
    const db = memDb()
    const one = saveDraft(db, { source: 'app', fields: fields(), photos: [photo('a.jpg')] }, 1)
    const two = saveDraft(db, { source: 'app', fields: fields() }, 1)
    expect(() => saveDraft(db, { id: two.id, source: 'app', fields: fields(), photos: [{ mediaId: one.photos[0].id }] }, 2)).toThrow(
      'не належить до чернетки'
    )
    expect(() => saveDraft(db, { source: 'app', fields: fields(), photos: [photo('a.pdf')] }, 1)).toThrow('JPG, PNG або GIF')
    expect(() => saveDraft(db, { source: 'app', fields: fields(), photos: [{ name: 'e.jpg', data: new Uint8Array() }] }, 1)).toThrow(
      'Порожній'
    )
    expect(() =>
      saveDraft(db, { source: 'app', fields: fields(), photos: Array.from({ length: 11 }, (_, i) => photo(`${i}.jpg`)) }, 1)
    ).toThrow('не більше 10')
    expect(() =>
      saveDraft(db, { source: 'app', fields: fields(), files: Array.from({ length: 6 }, (_, i) => photo(`${i}.pdf`)) }, 1)
    ).toThrow('не більше 5')
    expect(() => saveDraft(db, { id: 99, source: 'app', fields: fields() }, 1)).toThrow(DraftError)
    // A refused save changes nothing.
    expect(getDraft(db, two.id)!.photos).toEqual([])
  })

  it('incomplete drafts are fine; problems say what blocks sending', () => {
    const db = memDb()
    const d = saveDraft(db, { source: 'mcp', fields: { ...EMPTY_DRAFT_FIELDS, title: 'Idea' } }, 1)
    expect(d.problems.join(' ')).toContain('Опис')
    expect(d.problems.join(' ')).toContain('категорію')
    expect(draftProblems(fields(), 0, 0)).toEqual([])
  })

  it('lists newest first; deleting removes the media too; corrupt stored fields read as defaults', () => {
    const db = memDb()
    const a = saveDraft(db, { source: 'app', fields: fields({ title: 'A' }), photos: [photo('a.jpg')] }, 1)
    saveDraft(db, { source: 'app', fields: fields({ title: 'B' }) }, 5)
    expect(listDrafts(db).map((d) => d.fields.title)).toEqual(['B', 'A'])
    expect(deleteDraft(db, a.id)).toBe(true)
    expect(deleteDraft(db, a.id)).toBe(false)
    expect(getDraftMediaData(db, a.photos[0].id)).toBeNull()
    db.prepare("UPDATE listing_drafts SET fields_json = '{oops' WHERE id = 2").run()
    expect(getDraft(db, 2)!.fields).toEqual(EMPTY_DRAFT_FIELDS)
  })
})

const signedIn: EtsyAuthStatus = { loggedIn: true, redirectUri: '', pending: false, encrypted: true, userId: 1, shopId: 77, shopName: 'Mine' }

function sender(over: Partial<Record<keyof EtsyClient, unknown>> = {}) {
  const uploads: string[] = []
  const client = {
    createDraftListing: vi.fn(async () => ({ listing_id: 4242 })),
    uploadListingImage: vi.fn(async (_s: number, _l: number, f: { name: string; rank: number; data: Uint8Array }) => {
      uploads.push(`photo:${f.name}:${f.rank}:${Buffer.from(f.data).toString()}`)
      return {}
    }),
    uploadListingFile: vi.fn(async (_s: number, _l: number, f: { name: string; rank: number }) => {
      uploads.push(`file:${f.name}:${f.rank}`)
      return {}
    }),
    updateListing: vi.fn(async () => ({ listing_id: 4242 })),
    ...over
  } as unknown as EtsyClient
  return { client, uploads, auth: { status: () => signedIn } }
}

describe('sending drafts', () => {
  it('a refused draft (nothing created) keeps the error and stays editable/sendable', async () => {
    const db = memDb()
    const d = saveDraft(db, { source: 'app', fields: fields() }, 1)
    const s = sender({
      createDraftListing: vi.fn(async () => {
        throw new EtsyApiError('bad_request', 'Etsy відхилив запит як некоректний (HTTP 400).', 400)
      })
    })
    const res = await sendDraft({ db, client: s.client, auth: s.auth }, d.id, false)
    expect(res.ok).toBe(false)
    expect(getDraft(db, d.id)).toMatchObject({ status: 'error', sentListingId: null, lastError: expect.stringContaining('HTTP 400') })
    expect(saveDraft(db, { id: d.id, source: 'app', fields: fields({ title: 'Fixed' }) }, 2)).toMatchObject({ status: 'draft', lastError: null })
  })

  it('an unknown draft, or signed out', async () => {
    const db = memDb()
    const s = sender()
    expect(await sendDraft({ db, client: s.client, auth: s.auth }, 5, false)).toEqual({ ok: false, error: 'Чернетки #5 немає.' })
    const d = saveDraft(db, { source: 'app', fields: fields() }, 1)
    const out = await sendDraft(
      { db, client: s.client, auth: { status: () => ({ ...signedIn, loggedIn: false }) } },
      d.id,
      false
    )
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('Увійдіть') })
  })
})

describe('draft photos in the app (etsyimg://draft/{id})', () => {
  it('parses only that shape', () => {
    expect(parseDraftImageUrl('etsyimg://draft/12')).toBe(12)
    for (const bad of ['etsyimg://draft/x', 'etsyimg://draft/1/2', 'etsyimg://img/1/570xN', 'https://draft/1']) {
      expect(parseDraftImageUrl(bad)).toBeNull()
    }
  })

  it('serves a stored photo from the db; files and unknown ids are 404', async () => {
    const db = memDb()
    const d = saveDraft(db, { source: 'app', fields: fields(), photos: [photo('a.png', 'PNGBYTES')], files: [{ name: 'f.pdf', data: bytes('F') }] }, 1)
    const handler = createImageProtocolHandler({ db, getStore: async () => null, fetch: vi.fn() as unknown as typeof fetch })
    const res = await handler(new Request(`etsyimg://draft/${d.photos[0].id}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('PNGBYTES')
    expect((await handler(new Request(`etsyimg://draft/${d.files[0].id}`))).status).toBe(404)
    expect((await handler(new Request('etsyimg://draft/999'))).status).toBe(404)
  })
})

// ------------------------------------------------------------------ linked drafts

import { OWN_SHOP, signedIn as ownSignedIn } from '../helpers/features'
import { mkFakeListing, ownEtsy } from '../helpers/ownEtsy'
import {
  BOTH_TYPE_NOTE,
  DRAFT_BUSY,
  REMOVED_ON_ETSY,
  StaleDraftError,
  VARIATIONS_NOTE,
  deleteDraftEverywhere,
  getDraftByListing,
  getDraftMediaEtsyIds,
  otherShopError,
  unlinkDraft,
  unverifiedConflict
} from '../../src/main/drafts'

function own(opts: Parameters<typeof ownEtsy>[0] & { scopes?: string[] } = {}) {
  const e = ownEtsy(opts)
  const db = memDb()
  const auth = { status: () => ownSignedIn(opts.scopes ? { scopes: opts.scopes } : {}) }
  let t = 1000
  const deps = { db, client: e.client, auth, now: () => ++t }
  const send = (id: number, publish = false, o: { overwrite?: boolean } = {}) => sendDraft(deps, id, publish, o)
  return { ...e, db, auth, deps, send }
}

/** A draft sent once (an Etsy draft with two photos and a file), in sync. */
async function sentDraft(o: ReturnType<typeof own>, extra: Partial<DraftFields> = {}) {
  const d = saveDraft(
    o.db,
    { source: 'app', fields: fields(extra), photos: [photo('a.jpg'), photo('b.jpg')], files: [{ name: 'P.pdf', data: bytes('PDF') }] },
    1
  )
  const res = await o.send(d.id)
  expect(res).toMatchObject({ ok: true, listingId: 4242 })
  return getDraft(o.db, d.id)!
}

describe('saving a linked draft', () => {
  it('is editable now (no longer read-only): a save marks it changed; kept media keep their Etsy id', async () => {
    const o = own()
    const d = await sentDraft(o)
    expect(d).toMatchObject({ status: 'sent', etsy: { listingId: 4242, dirty: false } })
    const [a, b] = d.photos
    const u = saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'Edited' }), photos: [{ mediaId: b.id }, photo('c.jpg'), { mediaId: a.id }] }, 50)
    expect(u).toMatchObject({ status: 'changed', fields: { title: 'Edited' }, etsy: { listingId: 4242, dirty: true } })
    expect(u.photos.map((p) => [p.name, p.onEtsy])).toEqual([['b.jpg', true], ['c.jpg', false], ['a.jpg', true]])
    expect(u.files[0]).toMatchObject({ name: 'P.pdf', onEtsy: true, remote: false })
  })

  it('stores files that exist only on Etsy (no bytes) and links a pulled draft as in sync', () => {
    const db = memDb()
    const d = saveDraft(
      db,
      {
        source: 'app',
        imported: true,
        fields: fields(),
        photos: [{ ...photo('p.jpg'), etsyId: 9001 }],
        files: [{ remote: true, name: 'Big.zip', size: 12345, etsyId: 7001 }],
        link: { listingId: 555, state: 'draft', etsyUpdatedAt: 1_800_000_000 }
      },
      7
    )
    expect(d).toMatchObject({
      source: 'etsy',
      status: 'sent',
      etsy: { listingId: 555, state: 'draft', dirty: false, syncedAt: 7, etsyUpdatedAt: 1_800_000_000, url: null }
    })
    expect(d.files[0]).toMatchObject({ name: 'Big.zip', size: 12345, onEtsy: true, remote: true })
    expect(d.photos[0]).toMatchObject({ onEtsy: true, remote: false })
    expect(getDraftMediaData(db, d.files[0].id)!.data.length).toBe(0)
    expect(getDraftByListing(db, 555)?.id).toBe(d.id)
    expect(getDraftByListing(db, 556)).toBeNull()
    expect(() => saveDraft(db, { source: 'app', fields: fields(), photos: [{ remote: true, name: 'x.jpg', size: 1, etsyId: 1 }] }, 1)).toThrow(
      'файл для покупця'
    )
  })
})

describe('sending a new draft (create)', () => {
  it('creates the listing; records it and every upload’s Etsy id; in sync with Etsy’s time afterwards', async () => {
    const o = own()
    const d = saveDraft(
      o.db,
      { source: 'app', fields: fields(), photos: [photo('a.jpg'), photo('b.jpg')], files: [{ name: 'P.xlsx', data: bytes('X') }] },
      1
    )
    const res = await o.send(d.id, true)
    expect(res).toEqual({ ok: true, listingId: 4242, published: true, state: 'active', warnings: [] })
    const l = o.listings.get(4242)!
    expect(l).toMatchObject({ state: 'active', title: 'Budget Planner' })
    expect(l.images.map((i) => i.listing_image_id)).toEqual([9001, 9002])
    expect(l.files.map((f) => f.filename)).toEqual(['P.xlsx'])
    const after = getDraft(o.db, d.id)!
    expect(after).toMatchObject({
      status: 'sent',
      sentListingId: 4242,
      sentPublished: true,
      lastError: null,
      etsy: { listingId: 4242, state: 'active', url: 'https://www.etsy.com/listing/4242', dirty: false, etsyUpdatedAt: l.updated_timestamp, changedOnEtsy: false }
    })
    expect(after.photos.every((p) => p.onEtsy) && after.files.every((f) => f.onEtsy)).toBe(true)
  })

  it('a failure after the listing exists leaves a linked draft; the retry updates it (no second listing, no duplicate photo)', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: [photo('a.jpg'), photo('b.jpg')] }, 1)
    // The 2nd photo upload fails (a POST is never retried).
    o.failures.push({ match: 'POST .*/images$', status: 400, times: 0 })
    let n = 0
    const up = o.deps.client.uploadListingImage
    o.deps.client = {
      ...o.deps.client,
      uploadListingImage: async (...a: Parameters<typeof up>) => {
        if (++n === 2) o.failures[0].times = 1
        return up(...a)
      }
    }
    const res1 = await o.send(d.id)
    expect(res1).toMatchObject({ ok: false, listingId: 4242 })
    const half = getDraft(o.db, d.id)!
    expect(half).toMatchObject({ status: 'error', sentListingId: 4242, etsy: { listingId: 4242, state: 'draft', dirty: true, etsyUpdatedAt: null } })
    expect(half.photos.map((p) => p.onEtsy)).toEqual([true, false])
    expect(o.imageIds(4242)).toEqual([9001])
    const res2 = await o.send(d.id)
    expect(res2).toMatchObject({ ok: true, listingId: 4242, updated: true })
    expect(o.requests().filter((r) => r === `POST /v3/application/shops/${OWN_SHOP}/listings`)).toHaveLength(1)
    expect(o.imageIds(4242)).toEqual([9001, 9002])
    expect(n).toBe(3)
    expect(getDraft(o.db, d.id)).toMatchObject({ status: 'sent', lastError: null, etsy: { dirty: false } })
  })
})

describe('sending a linked draft again (update of the Etsy listing)', () => {
  it('updates the texts/settings, price and quantity, photos (add/remove/reorder) and files to match the draft', async () => {
    const o = own()
    const d = await sentDraft(o)
    const [a, b] = d.photos
    saveDraft(
      o.db,
      {
        id: d.id,
        source: 'app',
        fields: fields({ title: 'Better Planner', description: 'New text', price: '7,50', quantity: 50, tags: ['money', 'plan'], materials: ['paper'], isSupply: true, shouldAutoRenew: false }),
        photos: [photo('c.jpg'), { mediaId: b.id }], // a.jpg removed
        files: [{ mediaId: d.files[0].id }, { name: 'Extra.pdf', data: bytes('E') }]
      },
      60
    )
    expect(a.onEtsy).toBe(true)
    const res = await o.send(d.id)
    expect(res).toEqual({ ok: true, listingId: 4242, published: false, state: 'draft', warnings: [], updated: true })
    const l = o.listings.get(4242)!
    expect(l).toMatchObject({
      state: 'draft',
      title: 'Better Planner',
      description: 'New text',
      tags: ['money', 'plan'],
      materials: ['paper'],
      is_supply: true,
      should_auto_renew: false,
      taxonomy_id: 2,
      listing_type: 'download',
      quantity: 50,
      price: { amount: 750, divisor: 100 }
    })
    // c.jpg uploaded and put first; a.jpg (9001) deleted; b.jpg (9002) kept.
    expect(o.imageIds(4242)).toEqual([9003, 9002])
    expect(l.files.map((f) => f.filename)).toEqual(['P.pdf', 'Extra.pdf'])
    const after = getDraft(o.db, d.id)!
    expect(after).toMatchObject({ status: 'sent', etsy: { dirty: false, state: 'draft', etsyUpdatedAt: l.updated_timestamp, changedOnEtsy: false } })
    expect(after.photos.every((p) => p.onEtsy)).toBe(true)
    // Nothing new: a second send writes the texts again but uploads/deletes nothing and keeps the inventory.
    const before = o.writes().length
    expect(await o.send(d.id)).toMatchObject({ ok: true, updated: true })
    expect(o.writes().slice(before)).toEqual([`PATCH /v3/application/shops/${OWN_SHOP}/listings/4242`])
  })

  it('uploads before deleting while there is room (an active listing never drops to no photo)', async () => {
    const o = own()
    const d = await sentDraft(o)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), photos: [photo('new.jpg')] }, 5)
    const before = o.writes().length
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    const w = o.writes().slice(before).filter((r) => r.includes('/images'))
    expect(w[0]).toMatch(/^POST .*\/images$/)
    expect(w.slice(1)).toEqual([
      `DELETE /v3/application/shops/${OWN_SHOP}/listings/4242/images/9001`,
      `DELETE /v3/application/shops/${OWN_SHOP}/listings/4242/images/9002`
    ])
    expect(o.imageIds(4242)).toEqual([9003])
  })

  it('never more than 10 photos at a time: a removed one goes only when the next new one wouldn’t fit', async () => {
    const o = own()
    const ten = Array.from({ length: 10 }, (_, i) => photo(`${i}.jpg`))
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: ten }, 1)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    expect(o.imageIds(4242)).toHaveLength(10)
    const kept = getDraft(o.db, d.id)!.photos.slice(2).map((p) => ({ mediaId: p.id }))
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), photos: [photo('x.jpg'), ...kept, photo('y.jpg')] }, 2)
    const before = o.writes().length
    o.watch(4242)
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: true })
    const w = o.writes().slice(before).filter((r) => r.includes('/images'))
    // One out, one in — twice (never 11, never fewer than 9).
    expect(w.slice(0, 4).map((r) => r.split(' ')[0])).toEqual(['DELETE', 'POST', 'DELETE', 'POST'])
    expect(o.lowest(4242)!.images).toBe(9)
    const ids = o.imageIds(4242)
    expect(ids).toHaveLength(10)
    // x first, then the 8 kept ones in order, then y — the draft's order, every photo mapped.
    expect(ids).toEqual([9011, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010, 9012])
    expect(getDraftMediaEtsyIds(o.db, d.id, 'photo').map((m) => m.etsyId)).toEqual(ids)
  })

  it('re-ranks Etsy’s photos to the draft’s order (1 = main)', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')] }, 1)
    await o.send(d.id)
    const [a, b, c] = getDraft(o.db, d.id)!.photos
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), photos: [{ mediaId: c.id }, { mediaId: a.id }, { mediaId: b.id }] }, 2)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    expect(o.imageIds(4242)).toEqual([9003, 9001, 9002])
    expect(o.writes().filter((r) => r.startsWith('DELETE'))).toEqual([])
  })

  it('a photo deleted on Etsy (but still in the draft) is uploaded again', async () => {
    const o = own()
    const d = await sentDraft(o)
    o.editOnEtsy(4242, (l) => (l.images = l.images.filter((i) => i.listing_image_id !== 9001)))
    const res = await o.send(d.id, false, { overwrite: true })
    expect(res).toMatchObject({ ok: true })
    expect(o.imageIds(4242)).toEqual([9003, 9002])
  })

  it('changed on Etsy since the last sync → a conflict, nothing written; overwrite sends it anyway', async () => {
    const o = own()
    const d = await sentDraft(o)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'Mine' }) }, 5)
    o.editOnEtsy(4242, (l) => (l.title = 'Changed on Etsy'))
    const before = o.writes().length
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: false, listingId: 4242, conflict: true })
    expect(!res.ok && res.error).toMatch(/^На Etsy цей товар змінили після останньої синхронізації \(.+\)\. Надіслати все одно й перезаписати ті зміни\?$/)
    expect(o.writes().slice(before)).toEqual([])
    expect(getDraft(o.db, d.id)).toMatchObject({ status: 'changed', lastError: null, etsy: { changedOnEtsy: true, dirty: true } })
    const forced = await o.send(d.id, false, { overwrite: true })
    expect(forced).toMatchObject({ ok: true, updated: true })
    expect(o.listings.get(4242)!.title).toBe('Mine')
    expect(getDraft(o.db, d.id)).toMatchObject({ status: 'sent', etsy: { changedOnEtsy: false, dirty: false } })
  })

  it('no Etsy time known (the read after the last send failed) is updated without a conflict check', async () => {
    const o = own()
    const d = await sentDraft(o)
    o.db.prepare('UPDATE listing_drafts SET etsy_updated_at = NULL WHERE id = ?').run(d.id)
    o.editOnEtsy(4242, (l) => (l.title = 'Changed on Etsy'))
    expect(await o.send(d.id)).toMatchObject({ ok: true, updated: true })
    expect(o.listings.get(4242)!.title).toBe('Budget Planner')
  })

  it('deleted on Etsy (404) → marked removed; no more requests; unlinking lets it go out as a new listing', async () => {
    const o = own()
    const d = await sentDraft(o)
    o.listings.delete(4242)
    const res = await o.send(d.id)
    expect(res).toEqual({ ok: false, listingId: 4242, removedOnEtsy: true, error: REMOVED_ON_ETSY })
    expect(getDraft(o.db, d.id)).toMatchObject({ status: 'error', etsy: { state: 'removed', removed: true, url: null } })
    const n = o.requests().length
    expect(await o.send(d.id)).toMatchObject({ ok: false, removedOnEtsy: true })
    expect(o.requests().length).toBe(n)
    const u = unlinkDraft(o.db, d.id, 77)
    expect(u).toMatchObject({ status: 'draft', etsy: null, sentListingId: null, lastError: null })
    expect(u.notes).toBeUndefined()
    expect(u.photos.every((p) => !p.onEtsy)).toBe(true)
    const again = await o.send(d.id)
    expect(again).toMatchObject({ ok: true, listingId: 4243 })
    expect(o.imageIds(4243)).toHaveLength(2)
  })

  it('variations: price/quantity are left alone with a note; the rest is updated', async () => {
    const o = own()
    const d = await sentDraft(o)
    const l = o.listings.get(4242)!
    l.products = [0, 1].map((i) => ({
      product_id: 50 + i,
      sku: '',
      property_values: [{ property_id: 200, property_name: 'Color', value_ids: [i + 1], values: [i ? 'Red' : 'Blue'] }],
      offerings: [{ offering_id: 60 + i, price: { amount: 100 + i, divisor: 100, currency_code: 'USD' }, quantity: 3, is_enabled: true, readiness_state_id: null }]
    }))
    const ts = l.updated_timestamp
    o.db.prepare('UPDATE listing_drafts SET etsy_updated_at = ? WHERE id = ?').run(ts, d.id)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'T2', price: '9.99' }) }, 5)
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: true, notes: [VARIATIONS_NOTE] })
    expect(o.writes().some((r) => r.startsWith('PUT'))).toBe(false)
    expect(o.listings.get(4242)!.title).toBe('T2')
  })

  it('physical: the shipping profile goes to updateListing, the processing profile onto the offering', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'app', fields: fields({ type: 'physical', quantity: 3, shippingProfileId: 11, readinessStateId: 21 }), photos: [photo('a.jpg')] }, 1)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ type: 'physical', quantity: 4, shippingProfileId: 12, readinessStateId: 22 }) }, 2)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    const l = o.listings.get(4242)!
    expect(l).toMatchObject({ listing_type: 'physical', shipping_profile_id: 12, quantity: 4 })
    expect(l.products[0].offerings[0]).toMatchObject({ quantity: 4, readiness_state_id: 22 })
    // A physical draft leaves Etsy's buyer files alone.
    expect(o.requests().some((r) => r.endsWith('/files'))).toBe(false)
  })

  it('publish: an Etsy draft/inactive listing is activated; an active one is not touched', async () => {
    const o = own()
    const d = await sentDraft(o)
    expect(await o.send(d.id, true)).toMatchObject({ ok: true, published: true, updated: true })
    expect(o.listings.get(4242)!.state).toBe('active')
    expect(getDraft(o.db, d.id)).toMatchObject({ sentPublished: true, etsy: { state: 'active', url: 'https://www.etsy.com/listing/4242' } })
    const before = o.writes().length
    expect(await o.send(d.id, true)).toMatchObject({ ok: true, published: true })
    expect(o.writes().slice(before)).toEqual([`PATCH /v3/application/shops/${OWN_SHOP}/listings/4242`])
    o.editOnEtsy(4242, (l) => (l.state = 'inactive'))
    expect(await o.send(d.id, true, { overwrite: true })).toMatchObject({ ok: true, published: true })
    expect(o.listings.get(4242)!.state).toBe('active')
  })

  it('validates first: publishing (or an active listing) needs a photo and a file; nothing is sent', async () => {
    const o = own()
    const d = await sentDraft(o)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), photos: [] }, 5)
    const n = o.requests().length
    const res = await o.send(d.id, true)
    expect(res).toMatchObject({ ok: false, listingId: 4242, error: expect.stringContaining('хоча б одне фото') })
    expect(o.requests().length).toBe(n)
    expect(getDraft(o.db, d.id)).toMatchObject({ status: 'error', etsy: { dirty: true } })
    // As an Etsy draft it may have no photos: they are deleted there.
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    expect(o.imageIds(4242)).toEqual([])
    // Active on Etsy: the publish rules apply even without publish.
    o.editOnEtsy(4242, (l) => (l.state = 'active'))
    expect(await o.send(d.id, false, { overwrite: true })).toMatchObject({ ok: false, error: expect.stringContaining('хоча б одне фото') })
  })

  it('a failure part-way keeps the error and the ids already uploaded; the retry doesn’t upload them again', async () => {
    const o = own()
    const d = await sentDraft(o)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), photos: [...getDraft(o.db, d.id)!.photos.map((p) => ({ mediaId: p.id })), photo('c.jpg'), photo('d.jpg')] }, 5)
    let n = 0
    const up = o.deps.client.uploadListingImage
    o.deps.client = {
      ...o.deps.client,
      uploadListingImage: async (...a: Parameters<typeof up>) => {
        if (++n === 2) throw new EtsyApiError('server', 'Etsy тимчасово не відповідає (HTTP 503).', 503)
        return up(...a)
      }
    }
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: false, listingId: 4242 })
    expect(!res.ok && res.error).toContain('оновлено не повністю — фото «d.jpg» не завантажилось')
    expect(getDraft(o.db, d.id)).toMatchObject({ status: 'error', etsy: { dirty: true } })
    expect(getDraft(o.db, d.id)!.photos.map((p) => p.onEtsy)).toEqual([true, true, true, false])
    const res2 = await o.send(d.id)
    expect(res2).toMatchObject({ ok: true })
    expect(n).toBe(3) // c.jpg once, d.jpg failed once, then once
    expect(o.imageIds(4242)).toEqual([9001, 9002, 9003, 9004])
    expect(getDraft(o.db, d.id)).toMatchObject({ status: 'sent', lastError: null })
  })

  it('buyer files: Etsy-only files are kept while listed; a removed one is deleted; one gone on Etsy leaves the draft', async () => {
    const o = own({ listings: [mkFakeListing(800)] })
    const keep = o.addFile(800, 'Keep.zip')
    const drop = o.addFile(800, 'Drop.zip')
    const gone = o.addFile(800, 'Gone.zip')
    o.addImages(800, 1)
    const ts = o.listings.get(800)!.updated_timestamp
    const d = saveDraft(
      o.db,
      {
        source: 'app',
        imported: true,
        fields: fields(),
        photos: [{ ...photo('p.jpg'), etsyId: 9001 }],
        files: [
          { remote: true, name: 'Keep.zip', size: 10, etsyId: keep },
          { remote: true, name: 'Drop.zip', size: 10, etsyId: drop },
          { remote: true, name: 'Gone.zip', size: 10, etsyId: gone }
        ],
        link: { listingId: 800, state: 'draft', etsyUpdatedAt: ts }
      },
      1
    )
    const files = getDraft(o.db, d.id)!.files
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), files: [{ mediaId: files[0].id }, { mediaId: files[2].id }, { name: 'New.pdf', data: bytes('N') }] }, 2)
    o.listings.get(800)!.files = o.listings.get(800)!.files.filter((f) => f.listing_file_id !== gone) // deleted on Etsy, not a content change
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: true, notes: ['Файлів «Gone.zip» на Etsy вже немає — їх прибрано з чернетки.'] })
    expect(o.listings.get(800)!.files.map((f) => f.filename)).toEqual(['Keep.zip', 'New.pdf'])
    expect(getDraft(o.db, d.id)!.files.map((f) => [f.name, f.position, f.remote, f.onEtsy])).toEqual([
      ['Keep.zip', 1, true, true],
      ['New.pdf', 2, false, true]
    ])
  })

  it('never deletes a digital listing’s last file (Etsy would turn it physical)', async () => {
    const o = own()
    const d = await sentDraft(o)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), files: [] }, 5)
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: true, notes: [expect.stringContaining('не дозволяє цифровому товару лишитися без файлів')] })
    expect(o.listings.get(4242)!.files).toHaveLength(1)
  })

  it('needs the sign-in’s listings_r + listings_w; signed out is refused too', async () => {
    const o = own({ scopes: ['listings_w'] })
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: [photo('a.jpg')] }, 1)
    o.db.prepare("UPDATE listing_drafts SET sent_listing_id = 4242, etsy_state = 'draft' WHERE id = ?").run(d.id)
    expect(await o.send(d.id)).toMatchObject({ ok: false, listingId: 4242, error: expect.stringContaining('читання товарів') })
    expect(o.requests()).toEqual([])
    const out = await sendDraft({ ...o.deps, auth: { status: () => ({ ...signedIn, loggedIn: false }) } }, d.id, false)
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('Увійдіть') })
  })

  it('reports progress for each step', async () => {
    const o = own()
    const d = await sentDraft(o)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), photos: [photo('z.jpg')] }, 5)
    const seen: string[] = []
    await sendDraft({ ...o.deps, onProgress: (p) => seen.push(`${p.step}:${p.label}`) }, d.id, true)
    expect(seen).toEqual([
      'draft:Перевіряю товар на Etsy…',
      'draft:Оновлюю назву, опис і налаштування…',
      'draft:Оновлюю ціну й кількість…',
      'images:Фото 1 з 1…',
      'publish:Публікую…'
    ])
  })
})

describe('one send per draft at a time', () => {
  it('a second send while the first runs is refused (two first sends would make two listings)', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'app', fields: fields() }, 1)
    const first = o.send(d.id)
    expect(await o.send(d.id)).toEqual({ ok: false, error: 'Цю чернетку вже надсилають на Etsy — зачекайте.' })
    expect(await first).toMatchObject({ ok: true, listingId: 4242 })
    expect(await o.send(d.id)).toMatchObject({ ok: true, updated: true })
    expect(o.requests().filter((r) => r === `POST /v3/application/shops/${OWN_SHOP}/listings`)).toHaveLength(1)
  })
})

describe('unlinking a draft', () => {
  it('forgets the listing and the media’s Etsy ids; Etsy-only files leave the draft with a note', () => {
    const db = memDb()
    const d = saveDraft(
      db,
      {
        source: 'app',
        fields: fields(),
        photos: [{ ...photo('p.jpg'), etsyId: 9001 }],
        files: [{ remote: true, name: 'Big.zip', size: 5, etsyId: 7001 }, { name: 'Mine.pdf', data: bytes('M'), etsyId: 7002 }],
        link: { listingId: 4242, state: 'active', etsyUpdatedAt: 5 }
      },
      1
    )
    const u = unlinkDraft(db, d.id, 9)
    expect(u).toMatchObject({ status: 'draft', etsy: null, sentListingId: null, sentAt: null, sentPublished: null, updatedAt: 9 })
    expect(u.files.map((f) => [f.name, f.position, f.onEtsy])).toEqual([['Mine.pdf', 1, false]])
    expect(u.photos[0].onEtsy).toBe(false)
    expect(u.notes).toEqual([expect.stringContaining('«Big.zip»')])
    expect(unlinkDraft(db, d.id).notes).toBeUndefined() // not linked: nothing to do
    expect(() => unlinkDraft(db, 99)).toThrow(DraftError)
  })
})

describe('deleting a draft everywhere', () => {
  it('deletes the linked Etsy listing, then the draft', async () => {
    const o = own()
    const d = await sentDraft(o)
    expect(await deleteDraftEverywhere(o.deps, d.id)).toEqual({ ok: true, value: { deletedOnEtsy: true } })
    expect(o.listings.has(4242)).toBe(false)
    expect(o.writes().at(-1)).toBe('DELETE /v3/application/listings/4242')
    expect(getDraft(o.db, d.id)).toBeNull()
  })

  it('already gone on Etsy (404) still deletes the draft; another failure keeps it', async () => {
    const o = own()
    const d = await sentDraft(o)
    o.failures.push({ match: 'DELETE /v3/application/listings/', status: 403, error: 'nope' })
    const r = await deleteDraftEverywhere(o.deps, d.id)
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Товар на Etsy не видалено') })
    expect(getDraft(o.db, d.id)).not.toBeNull()
    o.listings.delete(4242)
    expect(await deleteDraftEverywhere(o.deps, d.id)).toEqual({ ok: true, value: { deletedOnEtsy: false } })
    expect(getDraft(o.db, d.id)).toBeNull()
  })

  it('not linked, or removed on Etsy: only the draft, no request; without listings_d it is kept', async () => {
    const o = own()
    const local = saveDraft(o.db, { source: 'app', fields: fields() }, 1)
    expect(await deleteDraftEverywhere(o.deps, local.id)).toEqual({ ok: true, value: { deletedOnEtsy: false } })
    const gone = saveDraft(o.db, { source: 'app', fields: fields(), link: { listingId: 1, state: 'removed', etsyUpdatedAt: null } }, 1)
    expect(await deleteDraftEverywhere(o.deps, gone.id)).toEqual({ ok: true, value: { deletedOnEtsy: false } })
    expect(o.requests()).toEqual([])
    expect(await deleteDraftEverywhere(o.deps, 999)).toEqual({ ok: false, error: 'Чернетки #999 немає.' })
    const noScope = own({ scopes: ['listings_r', 'listings_w'] })
    const linked = saveDraft(noScope.db, { source: 'app', fields: fields(), link: { listingId: 4242, state: 'draft', etsyUpdatedAt: null } }, 1)
    expect(await deleteDraftEverywhere(noScope.deps, linked.id)).toMatchObject({ ok: false, error: expect.stringContaining('видалення товарів') })
    expect(getDraft(noScope.db, linked.id)).not.toBeNull()
  })
})

describe('updating a linked listing safely', () => {
  const imagesPosts = (o: ReturnType<typeof own>, from: number) => o.writes().slice(from).filter((r) => /^POST .*\/images$/.test(r))
  const filePosts = (o: ReturnType<typeof own>, from: number) => o.writes().slice(from).filter((r) => /^POST .*\/files$/.test(r))

  it('replacing every photo of a live listing: it never has fewer than its photos on the way', async () => {
    const o = own()
    const six = Array.from({ length: 6 }, (_, i) => photo(`${i}.jpg`))
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: six, files: [{ name: 'P.pdf', data: bytes('PDF') }] }, 1)
    expect(await o.send(d.id, true)).toMatchObject({ ok: true, published: true })
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), photos: Array.from({ length: 6 }, (_, i) => photo(`new${i}.jpg`)) }, 2)
    o.watch(4242)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    expect(o.lowest(4242)!.images).toBeGreaterThanOrEqual(6)
    expect(o.imageIds(4242)).toEqual([9007, 9008, 9009, 9010, 9011, 9012])
  })

  it('a failed upload while replacing every photo leaves the old ones on the listing', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: Array.from({ length: 6 }, (_, i) => photo(`${i}.jpg`)), files: [{ name: 'P.pdf', data: bytes('PDF') }] }, 1)
    expect(await o.send(d.id, true)).toMatchObject({ ok: true })
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), photos: Array.from({ length: 6 }, (_, i) => photo(`new${i}.jpg`)) }, 2)
    o.watch(4242)
    let n = 0
    const up = o.deps.client.uploadListingImage
    o.deps.client = {
      ...o.deps.client,
      uploadListingImage: async (...a: Parameters<typeof up>) => {
        if (++n === 5) throw new EtsyApiError('server', 'Etsy тимчасово не відповідає (HTTP 503).', 503)
        return up(...a)
      }
    }
    expect(await o.send(d.id)).toMatchObject({ ok: false })
    expect(o.lowest(4242)!.images).toBeGreaterThanOrEqual(6)
    expect(o.imageIds(4242).length).toBeGreaterThanOrEqual(6)
  })

  it('replacing every buyer file of a live digital listing: it never has none on the way', async () => {
    const o = own()
    const three = ['A.pdf', 'B.pdf', 'C.pdf'].map((name) => ({ name, data: bytes(name) }))
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: [photo('a.jpg')], files: three }, 1)
    expect(await o.send(d.id, true)).toMatchObject({ ok: true })
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields(), files: ['X.pdf', 'Y.pdf', 'Z.pdf'].map((name) => ({ name, data: bytes(name) })) }, 2)
    o.watch(4242)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    expect(o.lowest(4242)!.files).toBeGreaterThanOrEqual(3)
    expect(o.listings.get(4242)!.files.map((f) => f.filename)).toEqual(['X.pdf', 'Y.pdf', 'Z.pdf'])
  })

  it('a link sent by an older version (never compared with Etsy): Etsy’s media are adopted, the update asks first, then uploads nothing twice', async () => {
    const o = own()
    const three = ['A.pdf', 'B.pdf', 'C.pdf'].map((name) => ({ name, data: bytes(name) }))
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: [photo('a.jpg'), photo('b.jpg')], files: three }, 1)
    expect(await o.send(d.id, true)).toMatchObject({ ok: true })
    // What v5 left and v6/v7 migrated: linked, no baseline, no media ids.
    o.db.prepare('UPDATE listing_drafts SET etsy_updated_at = NULL, synced_at = NULL, unverified = 1, etsy_shop_id = NULL WHERE id = ?').run(d.id)
    o.db.prepare('UPDATE listing_draft_media SET etsy_id = NULL WHERE draft_id = ?').run(d.id)
    expect(getDraft(o.db, d.id)!.etsy).toMatchObject({ unverified: true })
    o.editOnEtsy(4242, (l) => (l.title = 'Edited on Etsy'))
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'Mine' }) }, 5)
    const before = o.writes().length
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: false, conflict: true, error: unverifiedConflict(4242) })
    expect(o.writes().slice(before)).toEqual([])
    expect(o.listings.get(4242)!.title).toBe('Edited on Etsy')
    // Mapped meanwhile: photos by rank, files by name and size.
    expect(getDraftMediaEtsyIds(o.db, d.id, 'photo').map((m) => m.etsyId)).toEqual([9001, 9002])
    expect(getDraftMediaEtsyIds(o.db, d.id, 'file').map((m) => m.etsyId)).toEqual([7001, 7002, 7003])
    expect(await o.send(d.id)).toMatchObject({ ok: false, conflict: true }) // still asks until the user agrees
    o.watch(4242)
    expect(await o.send(d.id, false, { overwrite: true })).toMatchObject({ ok: true, updated: true })
    expect(o.listings.get(4242)!.title).toBe('Mine')
    expect(imagesPosts(o, before)).toEqual([])
    expect(filePosts(o, before)).toEqual([])
    expect(o.writes().slice(before).filter((r) => r.startsWith('DELETE'))).toEqual([])
    expect(o.listings.get(4242)!.files).toHaveLength(3)
    expect(getDraft(o.db, d.id)!.etsy).toMatchObject({ unverified: false, shopId: OWN_SHOP, dirty: false })
  })

  it('an upload answer without the file id: the file is mapped by name and size, never uploaded again', async () => {
    const o = own()
    const upFile = o.deps.client.uploadListingFile
    o.deps.client = {
      ...o.deps.client,
      uploadListingFile: async (...a: Parameters<typeof upFile>) => {
        const r = (await upFile(...a)) as unknown as Record<string, unknown>
        return { ...r, listing_file_id: undefined } as unknown as Awaited<ReturnType<typeof upFile>>
      }
    }
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: [photo('a.jpg')], files: [{ name: 'P.pdf', data: bytes('PDF') }] }, 1)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    expect(getDraft(o.db, d.id)!.files[0].onEtsy).toBe(true)
    const before = o.writes().length
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'T2' }) }, 2)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    expect(filePosts(o, before)).toEqual([])
    expect(o.listings.get(4242)!.files).toHaveLength(1)
  })

  it('photos and files a pull couldn’t fetch are never deleted on Etsy by an update', async () => {
    const o = own()
    const d = await sentDraft(o)
    const [extra] = o.addImages(4242, 1)
    o.addFile(4242, 'Unknown.zip')
    const ts = o.listings.get(4242)!.updated_timestamp
    o.db.prepare('UPDATE listing_drafts SET etsy_updated_at = ?, etsy_gaps = ? WHERE id = ?').run(ts, JSON.stringify({ photos: [extra], files: 'all' }), d.id)
    expect(getDraft(o.db, d.id)!.etsy!.incomplete).toBe(true)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'T2' }) }, 5)
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: true })
    expect(o.imageIds(4242)).toEqual([9001, 9002, extra])
    expect(o.listings.get(4242)!.files.map((f) => f.filename)).toEqual(['P.pdf', 'Unknown.zip'])
    expect(res.ok && res.notes).toEqual([expect.stringContaining('ще не підтягнула (1)'), expect.stringContaining('файли на Etsy, яких немає в чернетці, не видалено')])
  })

  it('a “both” listing (physical + digital) keeps its type and files', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'app', fields: fields({ type: 'physical', quantity: 2, shippingProfileId: 11 }), photos: [photo('a.jpg')] }, 1)
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    const l = o.listings.get(4242)!
    l.listing_type = 'both' // set on Etsy's site (not a content change the test cares about)
    o.addFile(4242, 'Digital.pdf')
    o.db.prepare('UPDATE listing_drafts SET etsy_updated_at = ? WHERE id = ?').run(l.updated_timestamp, d.id)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ type: 'physical', title: 'T2', quantity: 2, shippingProfileId: 11 }) }, 2)
    const before = o.fetch.calls.length
    const res = await o.send(d.id)
    expect(res).toMatchObject({ ok: true, notes: [BOTH_TYPE_NOTE] })
    const patch = o.fetch.calls.slice(before).find((c) => c.method === 'PATCH')!
    expect(new URLSearchParams(String(patch.body)).has('type')).toBe(false)
    expect(o.listings.get(4242)).toMatchObject({ listing_type: 'both', title: 'T2' })
    expect(o.listings.get(4242)!.files.map((f) => f.filename)).toEqual(['Digital.pdf'])
  })

  it('reads the listing’s photos with the sign-in (drafts and inactive listings aren’t public)', async () => {
    const o = own()
    const d = await sentDraft(o)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'T2' }) }, 5)
    const before = o.fetch.calls.length
    await o.send(d.id)
    const reads = o.fetch.calls.slice(before).filter((c) => c.method === 'GET' && c.url.pathname.endsWith('/images'))
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((c) => c.headers.authorization === 'Bearer tok')).toBe(true)
  })

  it('a listing of another shop (signed in with another account): neither updated nor deleted, nothing read', async () => {
    const o = own()
    const d = await sentDraft(o)
    o.db.prepare('UPDATE listing_drafts SET etsy_shop_id = 999 WHERE id = ?').run(d.id)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'T2' }) }, 5)
    const n = o.requests().length
    expect(await o.send(d.id)).toMatchObject({ ok: false, error: otherShopError(999) })
    expect(await deleteDraftEverywhere(o.deps, d.id)).toMatchObject({ ok: false, error: expect.stringContaining('іншому магазину Etsy') })
    expect(o.requests().length).toBe(n)
    expect(getDraft(o.db, d.id)).toMatchObject({ etsy: { removed: false, shopId: 999 } })
    expect(o.listings.has(4242)).toBe(true)
  })

  it('a sent draft records its shop', async () => {
    const o = own()
    const d = await sentDraft(o)
    expect(d.etsy).toMatchObject({ shopId: OWN_SHOP, unverified: false, incomplete: false })
  })
})

describe('a draft changed while someone looks at it', () => {
  it('saving with an older updatedAt is refused (nothing written); without it, it saves', () => {
    const db = memDb()
    const d = saveDraft(db, { source: 'app', fields: fields() }, 1)
    saveDraft(db, { id: d.id, source: 'app', fields: fields({ title: 'Pulled' }) }, 2)
    expect(() => saveDraft(db, { id: d.id, source: 'app', fields: fields({ title: 'Stale form' }), expectedUpdatedAt: 1 }, 3)).toThrow(StaleDraftError)
    expect(getDraft(db, d.id)!.fields.title).toBe('Pulled')
    expect(saveDraft(db, { id: d.id, source: 'app', fields: fields({ title: 'Mine' }), expectedUpdatedAt: 2 }, 4).fields.title).toBe('Mine')
  })

  it('sending with an older updatedAt is refused before any request', async () => {
    const o = own()
    const d = await sentDraft(o)
    const n = o.requests().length
    const res = await o.send(d.id, false, { expectedUpdatedAt: d.updatedAt - 1 } as never)
    expect(res).toMatchObject({ ok: false, stale: true })
    expect(o.requests().length).toBe(n)
    expect(await sendDraft(o.deps, d.id, false, { expectedUpdatedAt: d.updatedAt })).toMatchObject({ ok: true })
  })

  it('no save while a send runs; an edit that slips in anyway stays “changed”', async () => {
    const o = own()
    const d = await sentDraft(o)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'T2' }), photos: [...d.photos.map((p) => ({ mediaId: p.id })), photo('c.jpg')] }, 5)
    const up = o.deps.client.uploadListingImage
    let refused: unknown = null
    o.deps.client = {
      ...o.deps.client,
      uploadListingImage: async (...a: Parameters<typeof up>) => {
        try {
          saveDraft(o.db, { id: d.id, source: 'mcp', fields: fields({ title: 'Edited during the send' }) }, 6)
        } catch (e) {
          refused = e
        }
        expect(() => unlinkDraft(o.db, d.id)).toThrow(DRAFT_BUSY)
        // Something writing behind saveDraft's back (it can't, but the send must not hide it).
        o.db.prepare('UPDATE listing_drafts SET updated_at = 777 WHERE id = ?').run(d.id)
        return up(...a)
      }
    }
    expect(await o.send(d.id)).toMatchObject({ ok: true })
    expect((refused as Error)?.message).toBe(DRAFT_BUSY)
    expect(getDraft(o.db, d.id)).toMatchObject({ status: 'changed', etsy: { dirty: true } })
  })
})

import { getListingMark, setListingMark, upsertListing } from '../../src/main/db'
import { mkInput, seedShop } from '../helpers/db'

describe('marks made from a draft ("В роботі" → "Реалізовано" on publishing)', () => {
  /** A tracked competitor's listing (the example) marked in progress with draft `draftId`. */
  function example(o: ReturnType<typeof own>, draftId: number, listingId = 1): void {
    seedShop(o.db)
    upsertListing(o.db, mkInput(listingId), 10)
    setListingMark(o.db, listingId, { status: 'in_progress', note: 'our version', ourDraftId: draftId, source: 'mcp' }, 20)
  }

  it('publishing a new draft turns its example’s mark done with our listing; the caller hears which', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'mcp', fields: fields(), photos: [photo('a.jpg')], files: [{ name: 'P.pdf', data: bytes('P') }] }, 1)
    example(o, d.id)
    const heard: number[][] = []
    const res = await sendDraft({ ...o.deps, onMarksChanged: (ids) => heard.push(ids) }, d.id, true)
    expect(res).toMatchObject({ ok: true, listingId: 4242, published: true, marksCompleted: [1] })
    expect(heard).toEqual([[1]])
    expect(getListingMark(o.db, 1)).toMatchObject({ status: 'done', ourListingId: 4242, ourDraftId: d.id, note: 'our version', source: 'mcp' })
  })

  it('sending as an Etsy draft (not published) leaves the mark in progress', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: [photo('a.jpg')] }, 1)
    example(o, d.id)
    const res = await o.send(d.id, false)
    expect(res).toMatchObject({ ok: true, published: false })
    expect(res).not.toHaveProperty('marksCompleted')
    expect(getListingMark(o.db, 1)).toMatchObject({ status: 'in_progress', ourListingId: null })
  })

  it('a linked draft updated with publish completes the mark too', async () => {
    const o = own()
    const d = await sentDraft(o)
    example(o, d.id)
    saveDraft(o.db, { id: d.id, source: 'app', fields: fields({ title: 'Ready' }), photos: d.photos.map((p) => ({ mediaId: p.id })), files: d.files.map((f) => ({ mediaId: f.id })) }, 60)
    const res = await o.send(d.id, true)
    expect(res).toMatchObject({ ok: true, updated: true, published: true, marksCompleted: [1] })
    expect(getListingMark(o.db, 1)).toMatchObject({ status: 'done', ourListingId: 4242 })
  })

  it('a failed send touches no mark', async () => {
    const o = own()
    const d = saveDraft(o.db, { source: 'app', fields: fields(), photos: [photo('a.jpg')], files: [{ name: 'P.pdf', data: bytes('P') }] }, 1)
    example(o, d.id)
    o.failures.push({ match: `POST .*/shops/${OWN_SHOP}/listings$`, status: 400, times: 1 })
    const heard = vi.fn()
    const res = await sendDraft({ ...o.deps, onMarksChanged: heard }, d.id, true)
    expect(res.ok).toBe(false)
    expect(heard).not.toHaveBeenCalled()
    expect(getListingMark(o.db, 1)).toMatchObject({ status: 'in_progress', ourListingId: null, updatedAt: 20 })
  })
})
