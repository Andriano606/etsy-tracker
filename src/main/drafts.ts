// Listing drafts kept in the app (schema v5: listing_drafts + listing_draft_media):
// prepared in "📝 Чернетки" or by Claude over MCP, reviewed and edited here,
// then sent to Etsy (createMyListing: an Etsy draft, or published). Photos and
// files are stored as BLOBs. A sent draft stays as a record and is read-only.

import type {
  CreateListingProgress,
  CreateListingResult,
  DraftFields,
  DraftMedia,
  ListingDraft
} from '../shared/types'
import {
  IMAGE_EXTENSIONS,
  MAX_DIGITAL_FILES,
  MAX_DIGITAL_FILE_BYTES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  draftInput,
  newListingProblems,
  normalizeDraftFields
} from '../shared/myShop'
import { type Db, transaction } from './db'
import { type MyShopDeps, createFileRegistry, createMyListing, mimeOf } from './myShop'

/** A Ukrainian message for a refused draft operation. */
export class DraftError extends Error {}

/** New media for a draft: the bytes, read from a picked file or sent over MCP. */
export interface DraftMediaInput {
  name: string
  data: Uint8Array
}

export type DraftMediaSlot = { mediaId: number } | DraftMediaInput

interface DraftRow {
  id: number
  source: 'app' | 'mcp'
  fields_json: string
  created_at: number
  updated_at: number
  sent_at: number | null
  sent_listing_id: number | null
  sent_published: number | null
  last_error: string | null
}

interface MediaRow {
  id: number
  draft_id: number
  kind: 'photo' | 'file'
  position: number
  name: string
  mime: string
  size: number
}

const MEDIA_COLS = 'id, draft_id, kind, position, name, mime, size'

function parseFields(json: string): DraftFields {
  try {
    return normalizeDraftFields(JSON.parse(json))
  } catch {
    return normalizeDraftFields({})
  }
}

const toMedia = (m: MediaRow): DraftMedia => ({
  id: m.id,
  kind: m.kind,
  position: m.position,
  name: m.name,
  mime: m.mime,
  size: m.size
})

/** What still blocks sending the draft as an Etsy draft. */
export function draftProblems(fields: DraftFields, photos: number, files: number): string[] {
  return newListingProblems(
    draftInput(
      fields,
      Array.from({ length: photos }, (_, i) => `p${i}`),
      Array.from({ length: files }, (_, i) => `f${i}`),
      false
    )
  )
}

function toDraft(r: DraftRow, media: MediaRow[]): ListingDraft {
  const fields = parseFields(r.fields_json)
  const photos = media.filter((m) => m.kind === 'photo').sort((a, b) => a.position - b.position).map(toMedia)
  const files = media.filter((m) => m.kind === 'file').sort((a, b) => a.position - b.position).map(toMedia)
  const sent = r.sent_listing_id != null
  return {
    id: r.id,
    source: r.source,
    status: r.last_error ? 'error' : sent ? 'sent' : 'draft',
    fields,
    photos,
    files,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at,
    sentListingId: r.sent_listing_id,
    sentPublished: r.sent_published == null ? null : r.sent_published === 1,
    lastError: r.last_error,
    problems: draftProblems(fields, photos.length, fields.type === 'download' ? files.length : 0)
  }
}

/** Every draft, the most recently changed first. */
export function listDrafts(db: Db): ListingDraft[] {
  const rows = db.prepare('SELECT * FROM listing_drafts ORDER BY updated_at DESC, id DESC').all() as unknown as DraftRow[]
  const media = db.prepare(`SELECT ${MEDIA_COLS} FROM listing_draft_media`).all() as unknown as MediaRow[]
  return rows.map((r) => toDraft(r, media.filter((m) => m.draft_id === r.id)))
}

export function getDraft(db: Db, id: number): ListingDraft | null {
  const r = db.prepare('SELECT * FROM listing_drafts WHERE id = ?').get(id) as DraftRow | undefined
  if (!r) return null
  const media = db.prepare(`SELECT ${MEDIA_COLS} FROM listing_draft_media WHERE draft_id = ?`).all(id) as unknown as MediaRow[]
  return toDraft(r, media)
}

/** A stored photo/file with its bytes (etsyimg://draft/{id}, sending). */
export function getDraftMediaData(db: Db, mediaId: number): (MediaRow & { data: Uint8Array }) | null {
  const r = db.prepare('SELECT * FROM listing_draft_media WHERE id = ?').get(mediaId) as
    | (MediaRow & { data: Uint8Array })
    | undefined
  return r ?? null
}

const ext = (name: string): string => (name.split('.').pop() ?? '').toLowerCase()

function checkNew(kind: 'photo' | 'file', m: DraftMediaInput): void {
  if (!m.name || !m.data?.length) throw new DraftError(`Порожній файл «${m.name || '?'}».`)
  if (kind === 'photo' && !IMAGE_EXTENSIONS.includes(ext(m.name))) {
    throw new DraftError(`«${m.name}»: фото має бути JPG, PNG або GIF.`)
  }
  const max = kind === 'photo' ? MAX_IMAGE_BYTES : MAX_DIGITAL_FILE_BYTES
  if (m.data.length > max) throw new DraftError(`«${m.name}» більший за ${Math.round(max / 1024 / 1024)} МБ.`)
}

/**
 * Create (no id) or update a draft: the fields, and the media as the full
 * ordered list (stored ones by id — others of this draft are removed — and new
 * ones with their bytes). A sent draft can't change. Throws DraftError.
 */
export function saveDraft(
  db: Db,
  input: {
    id?: number
    source: 'app' | 'mcp'
    fields: DraftFields
    photos?: DraftMediaSlot[]
    files?: DraftMediaSlot[]
  },
  now: number
): ListingDraft {
  const fields = normalizeDraftFields(input.fields)
  const photos = input.photos
  const files = input.files
  if (photos && photos.length > MAX_IMAGES) throw new DraftError(`Фото може бути не більше ${MAX_IMAGES}.`)
  if (files && files.length > MAX_DIGITAL_FILES) throw new DraftError(`Файлів може бути не більше ${MAX_DIGITAL_FILES}.`)
  for (const m of photos ?? []) if (!('mediaId' in m)) checkNew('photo', m)
  for (const m of files ?? []) if (!('mediaId' in m)) checkNew('file', m)

  const id = transaction(db, () => {
    let draftId = input.id
    if (draftId != null) {
      const cur = db.prepare('SELECT sent_listing_id FROM listing_drafts WHERE id = ?').get(draftId) as
        | { sent_listing_id: number | null }
        | undefined
      if (!cur) throw new DraftError(`Чернетки #${draftId} немає.`)
      if (cur.sent_listing_id != null) {
        throw new DraftError(`Чернетку вже надіслано на Etsy (лістинг #${cur.sent_listing_id}) — змінюйте його через «✏️ Керувати».`)
      }
      db.prepare('UPDATE listing_drafts SET fields_json = ?, updated_at = ?, last_error = NULL WHERE id = ?').run(
        JSON.stringify(fields),
        now,
        draftId
      )
    } else {
      draftId = Number(
        db
          .prepare('INSERT INTO listing_drafts (source, fields_json, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(input.source, JSON.stringify(fields), now, now).lastInsertRowid
      )
    }
    for (const [kind, list] of [['photo', photos], ['file', files]] as const) {
      if (!list) continue // undefined = keep this kind as it is
      const own = new Set(
        (db.prepare('SELECT id FROM listing_draft_media WHERE draft_id = ? AND kind = ?').all(draftId, kind) as Array<{ id: number }>).map(
          (r) => r.id
        )
      )
      const keep = new Set<number>()
      for (const m of list) {
        if ('mediaId' in m) {
          if (!own.has(m.mediaId)) throw new DraftError('Цей файл не належить до чернетки — виберіть його ще раз.')
          keep.add(m.mediaId)
        }
      }
      for (const old of own) if (!keep.has(old)) db.prepare('DELETE FROM listing_draft_media WHERE id = ?').run(old)
      list.forEach((m, i) => {
        if ('mediaId' in m) {
          db.prepare('UPDATE listing_draft_media SET position = ? WHERE id = ?').run(i + 1, m.mediaId)
        } else {
          db.prepare(
            'INSERT INTO listing_draft_media (draft_id, kind, position, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(draftId!, kind, i + 1, m.name, mimeOf(m.name), m.data.length, m.data)
        }
      })
    }
    return draftId
  })
  return getDraft(db, id)!
}

export function deleteDraft(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM listing_drafts WHERE id = ?').run(id).changes) > 0
}

export interface SendDeps extends MyShopDeps {
  db: Db
  now?: () => number
  onProgress?: (p: CreateListingProgress) => void
  describe?: (e: unknown) => string
}

/**
 * Send a draft to Etsy (an Etsy draft, or published): the same steps as
 * "Новий лістинг", with the stored media. Success marks it sent; a failure
 * keeps the error (and, once the Etsy listing exists, its id — the draft is
 * then read-only so a retry can't create a second listing).
 */
export async function sendDraft(deps: SendDeps, id: number, publish: boolean): Promise<CreateListingResult> {
  const now = deps.now ?? Date.now
  const d = getDraft(deps.db, id)
  if (!d) return { ok: false, error: `Чернетки #${id} немає.` }
  if (d.sentListingId != null) {
    return { ok: false, listingId: d.sentListingId, error: `Чернетку вже надіслано на Etsy (лістинг #${d.sentListingId}).` }
  }
  const files = createFileRegistry()
  const token = (m: DraftMedia): string => files.add(`draft:${m.id}`, m.name, m.size).token
  const input = draftInput(d.fields, d.photos.map(token), d.files.map(token), publish)
  const res = await createMyListing(
    {
      client: deps.client,
      auth: deps.auth,
      files,
      describe: deps.describe,
      onProgress: deps.onProgress,
      readFile: async (path) => {
        const row = getDraftMediaData(deps.db, Number(path.slice('draft:'.length)))
        if (!row) throw new DraftError('Файл чернетки зник.')
        return new Uint8Array(row.data) as Uint8Array<ArrayBuffer>
      }
    },
    input
  )
  // The draft may have been deleted while sending — then there is nothing to mark.
  if (res.ok) {
    deps.db
      .prepare(
        'UPDATE listing_drafts SET sent_at = ?, sent_listing_id = ?, sent_published = ?, last_error = NULL, updated_at = ? WHERE id = ?'
      )
      .run(now(), res.listingId, res.published ? 1 : 0, now(), id)
  } else {
    deps.db
      .prepare(
        'UPDATE listing_drafts SET last_error = ?, sent_listing_id = COALESCE(?, sent_listing_id), sent_at = CASE WHEN ? IS NULL THEN sent_at ELSE ? END, sent_published = CASE WHEN ? IS NULL THEN sent_published ELSE 0 END, updated_at = ? WHERE id = ?'
      )
      .run(res.error, res.listingId ?? null, res.listingId ?? null, now(), res.listingId ?? null, now(), id)
  }
  return res
}
