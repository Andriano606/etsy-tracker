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
  it('sends the stored fields and media; the draft becomes a read-only record', async () => {
    const db = memDb()
    const d = saveDraft(db, { source: 'app', fields: fields(), photos: [photo('a.jpg'), photo('b.jpg')], files: [{ name: 'P.xlsx', data: bytes('X') }] }, 1)
    const s = sender()
    const res = await sendDraft({ db, client: s.client, auth: s.auth, now: () => 9 }, d.id, true)
    expect(res).toEqual({ ok: true, listingId: 4242, published: true, warnings: [] })
    expect(s.client.createDraftListing).toHaveBeenCalledWith(77, expect.objectContaining({ title: 'Budget Planner', taxonomy_id: 2 }))
    expect(s.uploads).toEqual(['photo:a.jpg:1:PHOTO:a.jpg', 'photo:b.jpg:2:PHOTO:b.jpg', 'file:P.xlsx:1'])
    expect(getDraft(db, d.id)).toMatchObject({ status: 'sent', sentListingId: 4242, sentPublished: true, sentAt: 9, lastError: null })
    // Never twice, and no more edits.
    expect(await sendDraft({ db, client: s.client, auth: s.auth }, d.id, false)).toMatchObject({ ok: false, listingId: 4242 })
    expect(s.client.createDraftListing).toHaveBeenCalledTimes(1)
    expect(() => saveDraft(db, { id: d.id, source: 'app', fields: fields() }, 10)).toThrow('вже надіслано')
  })

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

  it('a failure after the Etsy listing exists records its id (no second listing on retry)', async () => {
    const db = memDb()
    const d = saveDraft(db, { source: 'app', fields: fields(), photos: [photo('a.jpg')] }, 1)
    const s = sender({
      uploadListingImage: vi.fn(async () => {
        throw new EtsyApiError('bad_request', 'x', 400, undefined, 'too small')
      })
    })
    const res = await sendDraft({ db, client: s.client, auth: s.auth }, d.id, false)
    expect(res).toMatchObject({ ok: false, listingId: 4242 })
    expect(getDraft(db, d.id)).toMatchObject({ status: 'error', sentListingId: 4242, sentPublished: false })
    expect(await sendDraft({ db, client: s.client, auth: s.auth }, d.id, false)).toMatchObject({ ok: false, listingId: 4242 })
    expect(s.client.createDraftListing).toHaveBeenCalledTimes(1)
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
