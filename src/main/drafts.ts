// Drafts kept in the app ("📝 Чернетки", or prepared by Claude over MCP): stored
// with their media, sent to Etsy as a new listing, and — once linked to that
// Etsy listing (sent_listing_id) — edited and sent again as an update of it,
// unlinked, or deleted on both sides. Pulling Etsy's own drafts is draftImport.ts.

import type {
  CreateListingProgress,
  CreateListingResult,
  DraftEtsyState,
  DraftFields,
  DraftMedia,
  ListingDraft,
  MyShopResult,
  SendDraftOptions
} from '../shared/types'
import {
  IMAGE_EXTENSIONS,
  MAX_DIGITAL_FILES,
  MAX_DIGITAL_FILE_BYTES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  SCOPE_LABEL,
  draftInput,
  draftUpdateForm,
  etsyListingEditUrl,
  etsyListingUrl,
  missingScopes,
  newListingProblems,
  normalizeDraftFields,
  parsePrice
} from '../shared/myShop'
import { formatDateTime } from '../shared/format'
import { inventorySummary, inventoryToWrite, type InventoryWrite } from '../shared/features/inventory'
import { type Db, completeDraftMarks, transaction } from './db'
import { EtsyApiError, type EtsyClient, type EtsyListing } from './etsyApi'
import {
  type MyShopDeps,
  MyShopError,
  answerId,
  createFileRegistry,
  createMyListing,
  mimeOf,
  myShopErrorMessage
} from './myShop'
import { getInventory, putInventory } from './features/inventory/api'
import { deleteFile, deletePhoto, getFiles, getPhotos, movePhotoUp } from './features/media/ops'
import { deleteListing } from './features/listingMeta/api'

/** A Ukrainian message for a refused draft operation. */
export class DraftError extends Error {}

/** The draft changed after the caller read it (expectedUpdatedAt): nothing was written. */
export class StaleDraftError extends DraftError {}

export const DRAFT_STALE =
  'Поки чернетка була відкрита, її змінили (наприклад, синхронізація з Etsy підтягнула зміни або її змінив Claude).'
export const DRAFT_BUSY = 'Цю чернетку саме надсилають на Etsy — зачекайте, доки надсилання закінчиться.'

/** What the last pull couldn't fetch of a linked listing (kept on Etsy by an update): photo ids or all; all files. */
export interface EtsyGaps {
  photos?: number[] | 'all'
  files?: 'all'
}

export function parseGaps(json: string | null): EtsyGaps | null {
  if (!json) return null
  try {
    const g = JSON.parse(json) as EtsyGaps
    const out: EtsyGaps = {}
    if (g?.photos === 'all') out.photos = 'all'
    else if (Array.isArray(g?.photos)) {
      const ids = g.photos.filter((x) => Number.isSafeInteger(x) && x > 0)
      if (ids.length) out.photos = ids
    }
    if (g?.files === 'all') out.files = 'all'
    return out.photos || out.files ? out : null
  } catch {
    return null
  }
}

const gapsJson = (g: EtsyGaps | null | undefined): string | null => {
  if (!g) return null
  const photos = g.photos === 'all' ? 'all' : g.photos?.length ? g.photos : undefined
  return photos || g.files ? JSON.stringify({ ...(photos ? { photos } : {}), ...(g.files ? { files: g.files } : {}) }) : null
}

/** Drafts being sent, per database: one send per draft at a time, and no save meanwhile. */
const sending = new WeakMap<Db, Set<number>>()

/** A send of this draft is running (a save or a pull must wait). */
export function isDraftSending(db: Db, id: number): boolean {
  return sending.get(db)?.has(id) ?? false
}

/** New media for a draft: the bytes, read from a picked file or sent over MCP (or downloaded from Etsy). */
export interface DraftMediaInput {
  name: string
  data: Uint8Array
  /** Already on the linked Etsy listing under this id (a pulled photo/file). */
  etsyId?: number
}

/** A buyer file that exists only on Etsy (pulled from an Etsy draft): no bytes, Etsy's size. */
export interface DraftRemoteFile {
  remote: true
  name: string
  size: number
  etsyId: number
}

export type DraftMediaSlot = { mediaId: number } | DraftMediaInput | DraftRemoteFile

/** Link a draft to an Etsy listing as in sync (a pull): not dirty, Etsy's state and time. */
export interface DraftLinkInput {
  listingId: number
  state: DraftEtsyState | null
  /** Etsy's updated_timestamp (s). */
  etsyUpdatedAt: number | null
  /** The Etsy shop the listing belongs to (kept when null). */
  shopId?: number | null
  /** What this pull couldn't fetch (null = everything). */
  gaps?: EtsyGaps | null
}

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
  imported: number
  etsy_state: string | null
  etsy_updated_at: number | null
  synced_at: number | null
  dirty: number
  etsy_changed_at: number | null
  etsy_shop_id: number | null
  unverified: number
  etsy_gaps: string | null
}

interface MediaRow {
  id: number
  draft_id: number
  kind: 'photo' | 'file'
  position: number
  name: string
  mime: string
  size: number
  etsy_id: number | null
  remote: number
}

const MEDIA_COLS = 'id, draft_id, kind, position, name, mime, size, etsy_id, remote'

const ETSY_STATES: readonly DraftEtsyState[] = ['draft', 'active', 'inactive', 'expired', 'sold_out', 'removed']

/** An Etsy listing state as a DraftEtsyState (unknown → null). */
export function normalizeEtsyState(v: unknown): DraftEtsyState | null {
  return typeof v === 'string' && (ETSY_STATES as readonly string[]).includes(v) ? (v as DraftEtsyState) : null
}

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
  size: m.size,
  onEtsy: m.etsy_id != null,
  remote: m.remote === 1
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
  const listingId = r.sent_listing_id
  const state = normalizeEtsyState(r.etsy_state)
  const dirty = r.dirty === 1
  return {
    id: r.id,
    source: r.imported === 1 ? 'etsy' : r.source,
    status: r.last_error ? 'error' : listingId != null ? (dirty ? 'changed' : 'sent') : 'draft',
    fields,
    photos,
    files,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.sent_at,
    sentListingId: listingId,
    sentPublished: r.sent_published == null ? null : r.sent_published === 1,
    lastError: r.last_error,
    problems: draftProblems(fields, photos.length, fields.type === 'download' ? files.length : 0),
    etsy:
      listingId == null
        ? null
        : {
            listingId,
            state,
            url: state === 'active' ? etsyListingUrl(listingId) : null,
            editUrl: etsyListingEditUrl(listingId),
            dirty,
            syncedAt: r.synced_at,
            etsyUpdatedAt: r.etsy_updated_at,
            changedOnEtsy: r.etsy_changed_at != null,
            removed: state === 'removed',
            shopId: r.etsy_shop_id,
            unverified: r.unverified === 1,
            incomplete: parseGaps(r.etsy_gaps) != null
          }
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

/** The draft linked to this Etsy listing, if any. */
export function getDraftByListing(db: Db, listingId: number): ListingDraft | null {
  const r = db.prepare('SELECT id FROM listing_drafts WHERE sent_listing_id = ? ORDER BY id LIMIT 1').get(listingId) as
    | { id: number }
    | undefined
  return r ? getDraft(db, r.id) : null
}

/** A stored photo/file with its bytes (etsyimg://draft/{id}, sending). A remote file has empty data. */
export function getDraftMediaData(db: Db, mediaId: number): (MediaRow & { data: Uint8Array }) | null {
  const r = db.prepare('SELECT * FROM listing_draft_media WHERE id = ?').get(mediaId) as
    | (MediaRow & { data: Uint8Array })
    | undefined
  return r ?? null
}

/** The Etsy id (listing_image_id / listing_file_id) of a draft's media; null = not uploaded. */
export function getDraftMediaEtsyIds(db: Db, draftId: number, kind: 'photo' | 'file'): Array<{ id: number; etsyId: number | null }> {
  return (
    db
      .prepare('SELECT id, etsy_id FROM listing_draft_media WHERE draft_id = ? AND kind = ? ORDER BY position')
      .all(draftId, kind) as Array<{ id: number; etsy_id: number | null }>
  ).map((r) => ({ id: r.id, etsyId: r.etsy_id }))
}

/** Record (or clear) where a draft's photo/file lives on Etsy — right after each upload. */
export function setDraftMediaEtsyId(db: Db, mediaId: number, etsyId: number | null): void {
  db.prepare('UPDATE listing_draft_media SET etsy_id = ? WHERE id = ?').run(etsyId, mediaId)
}

const ext = (name: string): string => (name.split('.').pop() ?? '').toLowerCase()

function checkNew(kind: 'photo' | 'file', m: DraftMediaInput | DraftRemoteFile): void {
  if ('remote' in m) {
    if (kind !== 'file') throw new DraftError('Лише файл для покупця може бути тільки на Etsy.')
    if (!m.name || !Number.isSafeInteger(m.etsyId) || m.etsyId <= 0) throw new DraftError(`Некоректний файл з Etsy «${m.name || '?'}».`)
    return
  }
  if (!m.name || !m.data?.length) throw new DraftError(`Порожній файл «${m.name || '?'}».`)
  if (kind === 'photo' && !IMAGE_EXTENSIONS.includes(ext(m.name))) {
    throw new DraftError(`«${m.name}»: фото має бути JPG, PNG або GIF.`)
  }
  const max = kind === 'photo' ? MAX_IMAGE_BYTES : MAX_DIGITAL_FILE_BYTES
  if (m.data.length > max) throw new DraftError(`«${m.name}» більший за ${Math.round(max / 1024 / 1024)} МБ.`)
}

/**
 * Create (no id) or update a draft: the fields, and the media as the full
 * ordered list (stored ones by id — they keep their Etsy id; others of this
 * draft are removed — and new ones with their bytes). Saving a draft linked to
 * an Etsy listing marks it dirty (local edits not yet on Etsy) — unless `link`
 * is given (a pull from Etsy: the draft is then in sync with that listing).
 * Throws DraftError.
 */
export function saveDraft(
  db: Db,
  input: {
    id?: number
    source: 'app' | 'mcp'
    fields: DraftFields
    photos?: DraftMediaSlot[]
    files?: DraftMediaSlot[]
    /** A new draft pulled from an Etsy draft made on the site (source then reads 'etsy'). */
    imported?: boolean
    /** Pulled from Etsy: link the draft to this listing as in sync (not dirty). */
    link?: DraftLinkInput
    /** The updatedAt the caller read: the draft changed since → StaleDraftError, nothing written. */
    expectedUpdatedAt?: number
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

  // A send reads the media and finally marks the draft in sync: an edit meanwhile would be lost.
  if (input.id != null && isDraftSending(db, input.id)) throw new DraftError(DRAFT_BUSY)

  const id = transaction(db, () => {
    let draftId = input.id
    if (draftId != null) {
      const cur = db.prepare('SELECT id, updated_at FROM listing_drafts WHERE id = ?').get(draftId) as
        | { id: number; updated_at: number }
        | undefined
      if (!cur) throw new DraftError(`Чернетки #${draftId} немає.`)
      if (input.expectedUpdatedAt != null && cur.updated_at !== input.expectedUpdatedAt) throw new StaleDraftError(DRAFT_STALE)
      db.prepare(
        `UPDATE listing_drafts SET fields_json = ?, updated_at = ?, last_error = NULL,
           dirty = CASE WHEN sent_listing_id IS NOT NULL THEN 1 ELSE dirty END WHERE id = ?`
      ).run(JSON.stringify(fields), now, draftId)
    } else {
      draftId = Number(
        db
          .prepare('INSERT INTO listing_drafts (source, fields_json, created_at, updated_at, imported) VALUES (?, ?, ?, ?, ?)')
          .run(input.source, JSON.stringify(fields), now, now, input.imported ? 1 : 0).lastInsertRowid
      )
    }
    if (input.link) {
      db.prepare(
        `UPDATE listing_drafts SET sent_listing_id = ?, sent_at = COALESCE(sent_at, ?), sent_published = ?, etsy_state = ?,
           etsy_updated_at = ?, synced_at = ?, dirty = 0, etsy_changed_at = NULL, unverified = 0,
           etsy_shop_id = COALESCE(?, etsy_shop_id), etsy_gaps = ? WHERE id = ?`
      ).run(
        input.link.listingId,
        now,
        input.link.state === 'active' ? 1 : 0,
        input.link.state,
        input.link.etsyUpdatedAt,
        now,
        input.link.shopId ?? null,
        gapsJson(input.link.gaps),
        draftId
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
        } else if ('remote' in m) {
          db.prepare(
            'INSERT INTO listing_draft_media (draft_id, kind, position, name, mime, size, data, etsy_id, remote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
          ).run(draftId!, kind, i + 1, m.name, mimeOf(m.name), Math.max(0, Math.round(m.size) || 0), new Uint8Array(), m.etsyId)
        } else {
          db.prepare(
            'INSERT INTO listing_draft_media (draft_id, kind, position, name, mime, size, data, etsy_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(draftId!, kind, i + 1, m.name, mimeOf(m.name), m.data.length, m.data, m.etsyId ?? null)
        }
      })
    }
    return draftId
  })
  return getDraft(db, id)!
}

/** Delete a draft from the app only (the Etsy listing, if any, stays). */
export function deleteDraft(db: Db, id: number): boolean {
  return Number(db.prepare('DELETE FROM listing_drafts WHERE id = ?').run(id).changes) > 0
}

/**
 * Forget the Etsy listing a draft is linked to, so it can be sent as a new
 * listing (e.g. after it was deleted on Etsy). Buyer files that exist only on
 * Etsy can't be uploaded again: they leave the draft (the returned draft's
 * `notes` say which). Throws DraftError.
 */
export function unlinkDraft(db: Db, id: number, now: number = Date.now()): ListingDraft {
  const d = getDraft(db, id)
  if (!d) throw new DraftError(`Чернетки #${id} немає.`)
  if (!d.etsy) return d
  if (isDraftSending(db, id)) throw new DraftError(DRAFT_BUSY)
  const remote = d.files.filter((f) => f.remote)
  transaction(db, () => {
    db.prepare('DELETE FROM listing_draft_media WHERE draft_id = ? AND remote = 1').run(id)
    const left = db.prepare("SELECT id FROM listing_draft_media WHERE draft_id = ? AND kind = 'file' ORDER BY position").all(id) as Array<{
      id: number
    }>
    left.forEach((r, i) => db.prepare('UPDATE listing_draft_media SET position = ? WHERE id = ?').run(i + 1, r.id))
    db.prepare('UPDATE listing_draft_media SET etsy_id = NULL WHERE draft_id = ?').run(id)
    db.prepare(
      `UPDATE listing_drafts SET sent_listing_id = NULL, sent_at = NULL, sent_published = NULL, etsy_state = NULL,
         etsy_updated_at = NULL, synced_at = NULL, dirty = 0, etsy_changed_at = NULL, last_error = NULL,
         etsy_shop_id = NULL, unverified = 0, etsy_gaps = NULL, updated_at = ? WHERE id = ?`
    ).run(now, id)
  })
  const out = getDraft(db, id)!
  if (remote.length) {
    out.notes = [
      `Файли, що були лише на Etsy, прибрано з чернетки (Etsy не дає їх завантажити, тож надіслати їх знову не вийде): ${remote
        .map((f) => `«${f.name}»`)
        .join(', ')}. Додайте їх ще раз зі свого комп’ютера.`
    ]
  }
  return out
}

export interface SendDeps extends MyShopDeps {
  db: Db
  now?: () => number
  onProgress?: (p: CreateListingProgress) => void
  describe?: (e: unknown) => string
  /** Marks of these example listings turned "done" (the send published the draft they point at). */
  onMarksChanged?: (listingIds: number[]) => void
}

/** The signed-in user's shop id with the OAuth scopes `scopes` (else a Ukrainian refusal). */
function ownShopWith(deps: MyShopDeps, scopes: readonly string[]): number {
  const st = deps.auth.status()
  if (!st.loggedIn) throw new EtsyApiError('not_signed_in', 'Увійдіть в Etsy («Мій магазин» → «Увійти через Etsy»), щоб змінювати свій магазин.')
  if (!st.shopId) throw new MyShopError('У цього акаунта Etsy немає магазину.')
  const missing = missingScopes(st.scopes, scopes)
  if (missing.length) {
    throw new MyShopError(
      `Для цього потрібен дозвіл: ${missing.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}. Вийдіть і увійдіть в Etsy ще раз («Керувати» у шапці вашого магазину → «Вийти»).`
    )
  }
  return st.shopId
}

const isNotFound = (e: unknown): boolean => e instanceof EtsyApiError && e.status === 404

/** getListing as the owner (OAuth — drafts/inactive listings too); null = Etsy answered 404. */
export async function readOwnListing(client: EtsyClient, listingId: number): Promise<EtsyListing | null> {
  try {
    return await client.call<EtsyListing>(`/v3/application/listings/${listingId}`, { oauth: true })
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}

const etsyTime = (l: EtsyListing | null | undefined): number | null => {
  const t = l?.updated_timestamp ?? l?.last_modified_timestamp
  return typeof t === 'number' && Number.isFinite(t) ? t : null
}

export const REMOVED_ON_ETSY =
  'Цей товар видалено на Etsy, тож оновити його не вийде. Щоб надіслати чернетку як новий товар, спершу від’єднайте її від Etsy.'

/**
 * Send a draft to Etsy. Not linked yet: a new listing (an Etsy draft, or
 * published) with the stored media — the listing id is recorded as soon as it
 * exists and each photo/file's Etsy id right after its upload, so a failure
 * part-way leaves a linked draft whose retry updates that listing instead of
 * creating another. Linked: the Etsy listing is updated to match the draft
 * (see pushLinked); `overwrite` replaces changes made on Etsy since the last sync.
 */
export async function sendDraft(
  deps: SendDeps,
  id: number,
  publish: boolean,
  opts: SendDraftOptions = {}
): Promise<CreateListingResult> {
  const d = getDraft(deps.db, id)
  if (!d) return { ok: false, error: `Чернетки #${id} немає.` }
  // One send per draft at a time: two concurrent first sends would create two listings.
  const busy = sending.get(deps.db) ?? new Set<number>()
  sending.set(deps.db, busy)
  if (busy.has(id)) return { ok: false, listingId: d.sentListingId ?? undefined, error: 'Цю чернетку вже надсилають на Etsy — зачекайте.' }
  // The sender (an open editor) saw an older version — e.g. a pull refreshed it meanwhile: never send what it didn't see.
  if (opts.expectedUpdatedAt != null && d.updatedAt !== opts.expectedUpdatedAt) {
    return { ok: false, listingId: d.sentListingId ?? undefined, stale: true, error: `${DRAFT_STALE} Нічого не надіслано — перегляньте чернетку й надішліть ще раз.` }
  }
  busy.add(id)
  try {
    const res = await (d.etsy ? pushLinked(deps, d, publish, opts) : createFromDraft(deps, d, publish))
    return withCompletedMarks(deps, id, res)
  } finally {
    busy.delete(id)
  }
}

/**
 * A send that left the listing published (active) completes the example marks
 * made from this draft ("В роботі" → "Реалізовано", our listing = this one).
 * A failed or draft-only send touches no mark.
 */
function withCompletedMarks(deps: SendDeps, draftId: number, res: CreateListingResult): CreateListingResult {
  if (!res.ok || !res.published) return res
  const done = completeDraftMarks(deps.db, draftId, res.listingId, (deps.now ?? Date.now)())
  if (!done.length) return res
  deps.onMarksChanged?.(done)
  return { ...res, marksCompleted: done }
}

async function createFromDraft(deps: SendDeps, d: ListingDraft, publish: boolean): Promise<CreateListingResult> {
  const now = deps.now ?? Date.now
  const db = deps.db
  const id = d.id
  const startedAt = d.updatedAt
  let shopId: number | null = null
  try {
    shopId = deps.auth.status().shopId ?? null
  } catch {
    // createMyListing says what's wrong with the sign-in
  }
  const files = createFileRegistry()
  const token = (m: DraftMedia): string => files.add(`draft:${m.id}`, m.name, m.size).token
  // A file only on Etsy can't be sent (no bytes) — only an unlinked pulled draft could have one.
  const sendable = d.files.filter((f) => !f.remote)
  const notes = d.files.some((f) => f.remote)
    ? ['Файли, що є лише на Etsy, не надіслано — додайте їх у чернетку ще раз.']
    : []
  const photoIds = d.photos.map((m) => m.id)
  const fileIds = sendable.map((m) => m.id)
  const input = draftInput(d.fields, d.photos.map(token), sendable.map(token), publish)
  const res = await createMyListing(
    {
      client: deps.client,
      auth: deps.auth,
      files,
      describe: deps.describe,
      onProgress: deps.onProgress,
      readFile: async (path) => {
        const row = getDraftMediaData(db, Number(path.slice('draft:'.length)))
        if (!row) throw new DraftError('Файл чернетки зник.')
        return new Uint8Array(row.data) as Uint8Array<ArrayBuffer>
      },
      // Linked (and dirty until everything is done) the moment the listing exists.
      onCreated: (listingId) =>
        db
          .prepare(
            `UPDATE listing_drafts SET sent_at = ?, sent_listing_id = ?, sent_published = 0, etsy_state = 'draft',
               etsy_updated_at = NULL, synced_at = NULL, dirty = 1, etsy_changed_at = NULL, etsy_shop_id = ?,
               unverified = 0, etsy_gaps = NULL WHERE id = ?`
          )
          .run(now(), listingId, shopId, id),
      onUploaded: (kind, index, etsyId) => {
        const mediaId = kind === 'image' ? photoIds[index] : fileIds[index]
        if (mediaId != null) setDraftMediaEtsyId(db, mediaId, etsyId)
      }
    },
    input
  )
  if (res.ok) {
    // An upload answer without its id: the fresh listing's photos are in upload
    // order and its files carry our names — map what's left, so a later update
    // doesn't upload them again (and delete Etsy's as extra).
    if (shopId != null && hasUnmapped(db, id, d.fields.type === 'download')) {
      try {
        await adoptFromEtsy(deps.client, db, id, shopId, res.listingId, d.fields.type === 'download', true)
      } catch {
        // stays unmapped; an update maps the files by name and size
      }
    }
    // Etsy's updated_timestamp moves with every upload: the baseline for later
    // conflict checks is the listing as it is after the last step.
    let after: EtsyListing | null = null
    try {
      after = await readOwnListing(deps.client, res.listingId)
    } catch {
      // the listing exists; only the baseline time stays unknown (no conflict check next time)
    }
    const state = normalizeEtsyState(after?.state) ?? (res.published ? 'active' : 'draft')
    // An edit saved meanwhile (it can't be: saves wait for the send — but never mark it sent) stays dirty.
    db.prepare(
      `UPDATE listing_drafts SET sent_at = COALESCE(sent_at, ?), sent_listing_id = ?, sent_published = ?, etsy_state = ?,
         etsy_updated_at = ?, synced_at = ?, dirty = CASE WHEN updated_at = ? THEN 0 ELSE 1 END, etsy_changed_at = NULL,
         last_error = NULL, etsy_shop_id = COALESCE(?, etsy_shop_id), updated_at = ? WHERE id = ?`
    ).run(now(), res.listingId, state === 'active' ? 1 : 0, state, etsyTime(after), now(), startedAt, shopId, now(), id)
    const out: CreateListingResult = { ...res, state }
    return notes.length ? { ...out, notes } : out
  }
  db.prepare('UPDATE listing_drafts SET last_error = ?, updated_at = ? WHERE id = ?').run(res.error, now(), id)
  return notes.length ? { ...res, notes } : res
}

/** A step of an update that failed: what it was, and why. */
class StepError extends Error {
  constructor(
    public what: string,
    public cause: unknown
  ) {
    super(what)
  }
}

const step = async <T>(what: string, f: () => Promise<T>): Promise<T> => {
  try {
    return await f()
  } catch (e) {
    if (e instanceof StepError) throw e
    throw new StepError(what, e)
  }
}

export const VARIATIONS_NOTE = 'Ціна й кількість у цього товару задані у варіаціях — змініть їх у «Ціни й залишки».'

/** Problems of a linked draft's send; `strict` = the publish rules (a photo; a file for digital). */
function linkedProblems(d: ListingDraft, strict: boolean): string[] {
  const files = d.fields.type === 'download' ? d.files : []
  return newListingProblems(
    draftInput(
      d.fields,
      d.photos.map((p) => `p${p.id}`),
      files.map((f) => `f${f.id}`),
      strict
    )
  )
}

export const unverifiedConflict = (listingId: number): string =>
  `Цю чернетку надіслали на Etsy старішою версією програми, тож невідомо, чи товар № ${listingId} змінювали на Etsy відтоді. Надіслати все одно й перезаписати товар на Etsy тим, що в чернетці?`

export const otherShopError = (shopId: number): string =>
  `Цей товар належить іншому магазину Etsy (№ ${shopId}), ніж той, у який ви зараз увійшли. Щоб оновити чи видалити його на Etsy, увійдіть в акаунт того магазину.`

export const BOTH_TYPE_NOTE =
  'На Etsy це товар «фізичний + цифровий»: його тип не змінено, а файли для покупця лишились такими, як на Etsy (програма їх не змінює).'

/**
 * Update the linked Etsy listing to match the draft:
 * 0. validate like a send (the publish rules when publishing or already active);
 * 1. read the listing: changed on Etsy after the last sync and no `overwrite` →
 *    a conflict, nothing written; 404 → marked removed; a link never compared
 *    with Etsy (sent before v6) first maps Etsy's media to the draft's
 *    (photos by rank, files by name and size) and asks too;
 * 2. updateListing with every field it takes (draftUpdateForm; a "both"
 *    listing keeps its type);
 * 3. price + quantity (+ processing profile) through the inventory — only for
 *    a listing without variations (else a note);
 * 4. photos: the draft's list is the truth — new ones uploaded (Etsy id stored
 *    right away), Etsy's others deleted (never those a pull couldn't fetch),
 *    then re-ranked to the draft's order; never more than 10 at once and never
 *    none on the way;
 * 5. buyer files the same (≤ 5; files only on Etsy kept while listed);
 * 6. publish → state=active when it isn't;
 * 7. in sync (dirty 0) with Etsy's new updated_timestamp.
 * A failure keeps the error and the Etsy ids already recorded — a retry
 * never uploads twice.
 */
async function pushLinked(deps: SendDeps, d: ListingDraft, publish: boolean, opts: SendDraftOptions): Promise<CreateListingResult> {
  const now = deps.now ?? Date.now
  const describe = deps.describe ?? myShopErrorMessage
  const { db, client } = deps
  const link = d.etsy!
  const listingId = link.listingId
  const progress = (s: CreateListingProgress['step'], done: number, total: number, label: string): void =>
    deps.onProgress?.({ step: s, done, total, label })
  const notes: string[] = []
  const fail = (error: string): CreateListingResult => {
    db.prepare('UPDATE listing_drafts SET last_error = ?, updated_at = ? WHERE id = ?').run(error, now(), d.id)
    return { ok: false, listingId, error, ...(notes.length ? { notes } : {}) }
  }
  const markRemoved = (): CreateListingResult => {
    db.prepare("UPDATE listing_drafts SET etsy_state = 'removed', last_error = ?, updated_at = ? WHERE id = ?").run(
      REMOVED_ON_ETSY,
      now(),
      d.id
    )
    return { ok: false, listingId, removedOnEtsy: true, error: REMOVED_ON_ETSY }
  }
  if (link.removed) return { ok: false, listingId, removedOnEtsy: true, error: REMOVED_ON_ETSY }

  let shopId: number
  try {
    shopId = ownShopWith(deps, ['listings_r', 'listings_w'])
  } catch (e) {
    return { ok: false, listingId, error: describe(e) }
  }
  // Another account's listing: its reads would 404 here — never taken as "deleted".
  if (link.shopId != null && link.shopId !== shopId) return { ok: false, listingId, error: otherShopError(link.shopId) }
  const strict = publish || link.state === 'active'
  const problems = linkedProblems(d, strict)
  if (problems.length) return fail(problems.join(' '))
  const startedAt = d.updatedAt
  const gaps = parseGaps(
    (db.prepare('SELECT etsy_gaps FROM listing_drafts WHERE id = ?').get(d.id) as { etsy_gaps: string | null } | undefined)?.etsy_gaps ?? null
  )

  let wrote = false
  try {
    // (1) Is it still there, and unchanged since the last sync?
    progress('draft', 0, 1, 'Перевіряю товар на Etsy…')
    const cur = await step('не вдалося прочитати товар', () => readOwnListing(client, listingId))
    if (!cur) return markRemoved()
    if (cur.shop_id != null && cur.shop_id !== shopId) {
      return fail(`Товар #${listingId} належить іншому магазину Etsy — від’єднайте чернетку й надішліть її як новий товар.`)
    }
    if (cur.shop_id === shopId && link.shopId == null) db.prepare('UPDATE listing_drafts SET etsy_shop_id = ? WHERE id = ?').run(shopId, d.id)
    const state = normalizeEtsyState(cur.state)
    const changedAt = etsyTime(cur)
    const digital = d.fields.type === 'download'
    if (link.unverified) {
      // Sent before links were kept: which Etsy photo/file is which is unknown, and so is
      // whether it changed there. Map them first (the photos were uploaded in the draft's
      // order; files keep their names), so the update doesn't upload everything again.
      await step('не вдалося прочитати фото й файли товару', () => adoptFromEtsy(client, db, d.id, shopId, listingId, digital, true))
      if (!opts.overwrite) {
        db.prepare('UPDATE listing_drafts SET etsy_state = COALESCE(?, etsy_state) WHERE id = ?').run(state, d.id)
        return { ok: false, listingId, conflict: true, error: unverifiedConflict(listingId) }
      }
    }
    const base = link.etsyUpdatedAt
    if (!opts.overwrite && base != null && changedAt != null && changedAt > base) {
      db.prepare('UPDATE listing_drafts SET etsy_changed_at = ?, etsy_state = COALESCE(?, etsy_state) WHERE id = ?').run(
        changedAt,
        state,
        d.id
      )
      return {
        ok: false,
        listingId,
        conflict: true,
        error: `На Etsy цей товар змінили після останньої синхронізації (${formatDateTime(changedAt * 1000)}). Надіслати все одно й перезаписати ті зміни?`
      }
    }
    if (!strict && state === 'active') {
      const more = linkedProblems(d, true)
      if (more.length) return fail(more.join(' '))
    }

    // (2) The texts and settings. A "both" listing (physical + digital) can't be said by
    // a draft (physical | digital): its type is left alone, and so are its files.
    const both = cur.listing_type === 'both' && d.fields.type === 'physical'
    const form = draftUpdateForm(d.fields)
    if (both) {
      delete form.type
      notes.push(BOTH_TYPE_NOTE)
    }
    wrote = true
    progress('draft', 0, 1, 'Оновлюю назву, опис і налаштування…')
    await step('не вдалося оновити назву, опис і налаштування', () => client.updateListing(shopId, listingId, form))

    // (3) Price and quantity (they live on the inventory's offering).
    progress('draft', 0, 1, 'Оновлюю ціну й кількість…')
    const invNote = await step('не вдалося оновити ціну й кількість', () => syncInventory(client, listingId, d.fields))
    if (invNote) notes.push(invNote)

    // (4) Photos, (5) buyer files.
    const ctx: SyncCtx = { db, client, shopId, listingId, draftId: d.id, progress, notes, gaps }
    await syncPhotos(ctx)
    if (digital) await syncFiles(ctx)

    // (6) Publish.
    let finalState = state
    if (publish && state !== 'active') {
      progress('publish', 0, 1, 'Публікую…')
      await step('опублікувати не вдалося', () => client.updateListing(shopId, listingId, { state: 'active' }))
      finalState = 'active'
    }

    // (7) In sync with Etsy as it is now — unless the draft was edited meanwhile (then it stays changed).
    let after: EtsyListing | null = null
    try {
      after = await readOwnListing(client, listingId)
    } catch {
      // updated; only the baseline time stays unknown
    }
    finalState = normalizeEtsyState(after?.state) ?? finalState
    db.prepare(
      `UPDATE listing_drafts SET dirty = CASE WHEN updated_at = ? THEN 0 ELSE 1 END, etsy_changed_at = NULL, synced_at = ?,
         etsy_state = ?, etsy_updated_at = ?, sent_published = ?, last_error = NULL, unverified = 0, etsy_shop_id = ?,
         updated_at = ? WHERE id = ?`
    ).run(startedAt, now(), finalState, etsyTime(after), finalState === 'active' ? 1 : 0, shopId, now(), d.id)
    return {
      ok: true,
      listingId,
      published: finalState === 'active',
      state: finalState,
      warnings: [],
      updated: true,
      ...(notes.length ? { notes } : {})
    }
  } catch (e) {
    // Our own writes moved Etsy's updated_timestamp: take it as the new baseline
    // (unknown → no conflict check), so the retry isn't refused as a conflict.
    if (wrote) {
      let after: EtsyListing | null = null
      try {
        after = await readOwnListing(client, listingId)
      } catch {
        // keep it unknown
      }
      db.prepare('UPDATE listing_drafts SET etsy_updated_at = ?, unverified = 0 WHERE id = ?').run(etsyTime(after), d.id)
    }
    if (e instanceof StepError) {
      if (isNotFound(e.cause) && e.what === 'не вдалося прочитати товар') return markRemoved()
      return fail(
        `Товар на Etsy (#${listingId}) оновлено не повністю — ${e.what}: ${describe(e.cause)} Надішліть ще раз — уже зроблене не повториться.`
      )
    }
    return fail(describe(e))
  }
}

/** Price/quantity (+ the processing profile of a physical listing) on a listing without variations; a note otherwise. */
async function syncInventory(client: EtsyClient, listingId: number, f: DraftFields): Promise<string | null> {
  const price = parsePrice(f.price)!
  const readiness = f.type === 'physical' ? f.readinessStateId : null
  const inv = await getInventory(client, listingId)
  if (!inv.products.length) {
    const w: InventoryWrite = {
      products: [{ sku: '', propertyValues: [], offerings: [{ price, quantity: f.quantity, isEnabled: true, readinessStateId: readiness }] }],
      priceOnProperty: [],
      quantityOnProperty: [],
      skuOnProperty: [],
      readinessStateOnProperty: []
    }
    await putInventory(client, listingId, w)
    return null
  }
  if (!inventorySummary(inv).single) return VARIATIONS_NOTE
  const w = inventoryToWrite(inv)
  const o = w.products[0].offerings[0]
  const same =
    Math.abs(o.price - price) < 1e-9 && o.quantity === f.quantity && (readiness == null || o.readinessStateId === readiness)
  if (same) return null
  o.price = price
  o.quantity = f.quantity
  if (readiness != null) o.readinessStateId = readiness
  await putInventory(client, listingId, w)
  return null
}

interface SyncCtx {
  db: Db
  client: EtsyClient
  shopId: number
  listingId: number
  draftId: number
  progress: (s: CreateListingProgress['step'], done: number, total: number, label: string) => void
  notes: string[]
  /** What the last pull couldn't fetch: those Etsy photos/files are never deleted. */
  gaps: EtsyGaps | null
}

const mediaRows = (db: Db, draftId: number, kind: 'photo' | 'file'): MediaRow[] =>
  db
    .prepare(`SELECT ${MEDIA_COLS} FROM listing_draft_media WHERE draft_id = ? AND kind = ? ORDER BY position`)
    .all(draftId, kind) as unknown as MediaRow[]

const bytesOf = (db: Db, m: MediaRow): Uint8Array<ArrayBuffer> => {
  const row = getDraftMediaData(db, m.id)
  if (!row || !row.data?.length) throw new DraftError(`Файл чернетки «${m.name}» зник.`)
  return new Uint8Array(row.data) as Uint8Array<ArrayBuffer>
}

const sameOrder = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** A photo/file of the Etsy listing, for mapping it to the draft's media. */
export interface EtsyMediaItem {
  id: number
  /** Files: Etsy's file name. */
  name?: string | null
  /** Files: bytes, when Etsy says. */
  size?: number | null
}

/**
 * Map the draft's media that has no Etsy id yet (and isn't only on Etsy) to the
 * listing's media no other row of the draft is mapped to: `byOrder` pairs them
 * in order (photos uploaded in the draft's order), else by the same name and
 * size (files keep the name they were uploaded with). Records the Etsy ids;
 * nothing is sent. Returns how many it mapped.
 */
export function adoptEtsyMedia(db: Db, draftId: number, kind: 'photo' | 'file', etsy: EtsyMediaItem[], byOrder: boolean): number {
  const rows = mediaRows(db, draftId, kind)
  const mapped = new Set(rows.map((r) => r.etsy_id).filter((x): x is number => x != null))
  const free = etsy.filter((e, i) => !mapped.has(e.id) && etsy.findIndex((x) => x.id === e.id) === i)
  let n = 0
  for (const r of rows) {
    if (r.etsy_id != null || r.remote === 1 || !free.length) continue
    const i = byOrder ? 0 : free.findIndex((e) => e.name != null && e.name === r.name && (e.size == null || e.size === r.size))
    if (i < 0) continue
    setDraftMediaEtsyId(db, r.id, free[i].id)
    free.splice(i, 1)
    n++
  }
  return n
}

/** Some photo (or, digital, a file with bytes) of the draft has no Etsy id. */
function hasUnmapped(db: Db, draftId: number, digital: boolean): boolean {
  return (
    mediaRows(db, draftId, 'photo').some((r) => r.etsy_id == null) ||
    (digital && mediaRows(db, draftId, 'file').some((r) => r.etsy_id == null && r.remote !== 1))
  )
}

/** Read the listing's photos (and files, digital) and map the draft's unmapped media to them (adoptEtsyMedia). */
async function adoptFromEtsy(
  client: EtsyClient,
  db: Db,
  draftId: number,
  shopId: number,
  listingId: number,
  digital: boolean,
  photosByOrder: boolean
): Promise<void> {
  if (photosByOrder) adoptEtsyMedia(db, draftId, 'photo', (await getPhotos(client, listingId)).map((p) => ({ id: p.id })), true)
  if (digital) {
    const files = await getFiles(client, shopId, listingId)
    adoptEtsyMedia(db, draftId, 'file', files.map((f) => ({ id: f.id, name: f.name, size: f.sizeBytes })), false)
  }
}

/**
 * Upload `uploads` while deleting `deletable` so the listing never has more
 * than `max` items and never none: an item is deleted only when the next
 * upload wouldn't fit (so ≥ max − 1 stay), the rest after every upload.
 */
async function swapMedia<T extends { id: number }>(o: {
  count: number
  max: number
  uploads: MediaRow[]
  deletable: T[]
  upload: (m: MediaRow, i: number) => Promise<void>
  remove: (item: T) => Promise<void>
}): Promise<void> {
  let count = o.count
  const left = [...o.deletable]
  for (const [i, m] of o.uploads.entries()) {
    if (count >= o.max) {
      const item = left.shift()
      if (!item) throw new DraftError(`На Etsy уже ${o.max} — більше не вміщається.`)
      await o.remove(item)
      count--
    }
    await o.upload(m, i)
    count++
  }
  for (const item of left) await o.remove(item)
}

/** Etsy's ids the last pull couldn't fetch (or all of `ids` when it couldn't read the list). */
const gapIds = (g: EtsyGaps | null, kind: 'photos' | 'files', ids: number[]): Set<number> => {
  const v = g?.[kind]
  return new Set(v === 'all' ? ids : Array.isArray(v) ? v : [])
}

/** The draft's photos onto the listing: upload the missing, delete the extra, then Etsy's order = the draft's. */
async function syncPhotos(c: SyncCtx): Promise<void> {
  const { db, client, shopId, listingId } = c
  const readPhotos = () => step('не вдалося прочитати фото товару', () => getPhotos(client, listingId))
  const local = mediaRows(db, c.draftId, 'photo')
  const etsy = await readPhotos()
  const onEtsy = new Set(etsy.map((p) => p.id))
  const keep = new Set<number>()
  const uploads: MediaRow[] = []
  for (const m of local) {
    if (m.etsy_id != null && onEtsy.has(m.etsy_id) && !keep.has(m.etsy_id)) keep.add(m.etsy_id)
    else uploads.push(m)
  }
  // Photos a pull couldn't download aren't in the draft — but they are wanted: kept on Etsy, after the draft's.
  const unpulled = gapIds(
    c.gaps,
    'photos',
    etsy.map((p) => p.id)
  )
  const held = etsy.filter((p) => !keep.has(p.id) && unpulled.has(p.id))
  const deletable = etsy.filter((p) => !keep.has(p.id) && !unpulled.has(p.id))
  if (local.length + held.length > MAX_IMAGES) {
    throw new StepError(
      'фото не вміщаються',
      new DraftError(
        `На Etsy в товарі є фото, яких програма ще не підтягнула (${held.length}), і разом із фото чернетки їх більше за ${MAX_IMAGES}. Синхронізуйте чернетки з Etsy або приберіть зайві фото з чернетки.`
      )
    )
  }
  if (held.length) c.notes.push(`Фото з Etsy, яких програма ще не підтягнула (${held.length}), лишились у товарі — після фото чернетки.`)
  let rank = etsy.reduce((m, p) => Math.max(m, p.rank), 0)
  await swapMedia({
    count: etsy.length,
    max: MAX_IMAGES,
    uploads,
    deletable,
    remove: (p) =>
      step(`фото #${p.id} не вдалося видалити з Etsy`, async () => {
        try {
          await deletePhoto(client, shopId, listingId, p.id)
        } catch (e) {
          if (!isNotFound(e)) throw e
        }
      }),
    upload: async (m, i) => {
      c.progress('images', i, uploads.length, `Фото ${i + 1} з ${uploads.length}…`)
      await step(`фото «${m.name}» не завантажилось`, async () => {
        const img = await client.uploadListingImage(shopId, listingId, {
          data: bytesOf(db, m),
          name: m.name,
          type: m.mime || mimeOf(m.name),
          rank: ++rank
        })
        let etsyId = answerId(img, 'listing_image_id')
        if (etsyId == null) {
          // No id in the answer: the one photo Etsy has now that we didn't know.
          const known = new Set([...etsy.map((p) => p.id), ...mediaRows(db, c.draftId, 'photo').map((r) => r.etsy_id)])
          const fresh = (await getPhotos(client, listingId)).filter((p) => !known.has(p.id))
          if (fresh.length !== 1) throw new DraftError('Etsy не повідомив, під яким номером зберіг фото.')
          etsyId = fresh[0].id
        }
        setDraftMediaEtsyId(db, m.id, etsyId)
      })
    }
  })

  // Re-rank: the OAS has no reorder call — movePhotoUp re-attaches a photo at
  // the rank of the one at its target position (insertion order, 1 = main).
  const desired = [...mediaRows(db, c.draftId, 'photo').map((r) => r.etsy_id!), ...held.map((p) => p.id)]
  let ordered = false
  for (let i = 0; i < desired.length; i++) {
    const nowIds = (await readPhotos()).map((p) => p.id)
    if (sameOrder(nowIds, desired)) {
      ordered = true
      break
    }
    if (nowIds[i] === desired[i]) continue
    const at = nowIds.indexOf(desired[i])
    if (at < i) break // not where it can move up from — leave it, the note below says so
    c.progress('images', i, desired.length, 'Упорядковую фото…')
    await step('не вдалося змінити порядок фото', () => movePhotoUp(client, shopId, listingId, desired[i], i + 1))
  }
  if (!ordered && desired.length > 1) {
    const final = (await readPhotos()).map((p) => p.id)
    if (!sameOrder(final, desired)) {
      c.notes.push('Etsy не прийняв новий порядок фото повністю — перевірте його в редакторі товару на Etsy.')
    }
  }
}

/** The draft's buyer files onto the listing: upload the missing, delete the extra (≤ 5 at a time, never none). */
async function syncFiles(c: SyncCtx): Promise<void> {
  const { db, client, shopId, listingId } = c
  const etsy = await step('не вдалося прочитати файли товару', () => getFiles(client, shopId, listingId))
  const onEtsy = new Set(etsy.map((f) => f.id))
  // A file the draft holds whose upload answer carried no id: the same name and size on Etsy is it.
  adoptEtsyMedia(db, c.draftId, 'file', etsy.map((f) => ({ id: f.id, name: f.name, size: f.sizeBytes })), false)
  let local = mediaRows(db, c.draftId, 'file')
  // A file only on Etsy that Etsy no longer has can't come back: it leaves the draft.
  const lost = local.filter((m) => m.remote === 1 && (m.etsy_id == null || !onEtsy.has(m.etsy_id)))
  if (lost.length) {
    transaction(db, () => {
      for (const m of lost) db.prepare('DELETE FROM listing_draft_media WHERE id = ?').run(m.id)
      mediaRows(db, c.draftId, 'file').forEach((r, i) => db.prepare('UPDATE listing_draft_media SET position = ? WHERE id = ?').run(i + 1, r.id))
    })
    c.notes.push(`Файлів ${lost.map((m) => `«${m.name}»`).join(', ')} на Etsy вже немає — їх прибрано з чернетки.`)
    local = mediaRows(db, c.draftId, 'file')
  }
  const keep = new Set<number>()
  const uploads: MediaRow[] = []
  for (const m of local) {
    if (m.etsy_id != null && onEtsy.has(m.etsy_id) && !keep.has(m.etsy_id)) keep.add(m.etsy_id)
    else uploads.push(m)
  }
  // The last pull couldn't read the listing's files: none of Etsy's is deleted (the draft may just not know them).
  const unread = gapIds(
    c.gaps,
    'files',
    etsy.map((f) => f.id)
  )
  let deletable = etsy.filter((f) => !keep.has(f.id) && !unread.has(f.id))
  const held = etsy.filter((f) => !keep.has(f.id) && unread.has(f.id))
  if (held.length) {
    c.notes.push('Програма ще не підтягнула з Etsy список файлів цього товару, тож файли на Etsy, яких немає в чернетці, не видалено.')
    if (local.length + held.length > MAX_DIGITAL_FILES) {
      throw new StepError(
        'файли не вміщаються',
        new DraftError(`Разом із файлами на Etsy їх більше за ${MAX_DIGITAL_FILES}. Синхронізуйте чернетки з Etsy і спробуйте ще раз.`)
      )
    }
  }
  if (!local.length && deletable.length) {
    // Deleting a digital listing's last file turns it physical on Etsy.
    c.notes.push('У чернетці немає файлів для покупця, але Etsy не дозволяє цифровому товару лишитися без файлів — файли на Etsy не видалено.')
    deletable = []
  }
  let rank = etsy.reduce((m, f) => Math.max(m, f.rank), 0)
  await swapMedia({
    count: etsy.length,
    max: MAX_DIGITAL_FILES,
    uploads,
    deletable,
    remove: (f) =>
      step(`файл «${f.name}» не вдалося видалити з Etsy`, async () => {
        try {
          await deleteFile(client, shopId, listingId, f.id)
        } catch (e) {
          if (!isNotFound(e)) throw e
        }
      }),
    upload: async (m, i) => {
      c.progress('files', i, uploads.length, `Файл ${i + 1} з ${uploads.length}…`)
      await step(`файл «${m.name}» не завантажився`, async () => {
        const res = await client.uploadListingFile(shopId, listingId, {
          data: bytesOf(db, m),
          name: m.name,
          type: m.mime || mimeOf(m.name),
          rank: ++rank
        })
        let etsyId = answerId(res, 'listing_file_id')
        if (etsyId == null) {
          const known = new Set([...etsy.map((f) => f.id), ...mediaRows(db, c.draftId, 'file').map((r) => r.etsy_id)])
          const fresh = (await getFiles(client, shopId, listingId)).filter((f) => !known.has(f.id))
          if (fresh.length !== 1) throw new DraftError('Etsy не повідомив, під яким номером зберіг файл.')
          etsyId = fresh[0].id
        }
        setDraftMediaEtsyId(db, m.id, etsyId)
      })
    }
  })
}

/**
 * Delete a draft in the app and — when it is linked to an Etsy listing that
 * still exists — that listing on Etsy too (OAuth listings_d). Etsy answering
 * 404 (already gone) still deletes the draft; any other failure keeps it. A
 * listing of another shop than the signed-in one is refused (its 404 would
 * mean nothing).
 */
export async function deleteDraftEverywhere(
  deps: MyShopDeps & { db: Db },
  id: number
): Promise<MyShopResult<{ deletedOnEtsy: boolean }>> {
  const d = getDraft(deps.db, id)
  if (!d) return { ok: false, error: `Чернетки #${id} немає.` }
  if (isDraftSending(deps.db, id)) return { ok: false, error: DRAFT_BUSY }
  let deletedOnEtsy = false
  if (d.etsy && !d.etsy.removed) {
    try {
      const shopId = ownShopWith(deps, ['listings_d'])
      if (d.etsy.shopId != null && d.etsy.shopId !== shopId) return { ok: false, error: `Товар на Etsy не видалено: ${otherShopError(d.etsy.shopId)}` }
      await deleteListing(deps.client, d.etsy.listingId)
      deletedOnEtsy = true
    } catch (e) {
      if (!isNotFound(e)) return { ok: false, error: `Товар на Etsy не видалено: ${myShopErrorMessage(e)}` }
    }
  }
  deleteDraft(deps.db, id)
  return { ok: true, value: { deletedOnEtsy } }
}
