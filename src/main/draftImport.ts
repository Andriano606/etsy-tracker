// Pull the user's own Etsy drafts into the app ("Чернетки"): drafts made on
// Etsy's site become drafts here (imported = 1, files only on Etsy as remote
// rows), drafts already linked to an Etsy listing are refreshed from it while
// they have no local edits, and linked drafts that left Etsy's draft list get
// their new state (published, deactivated, deleted …). Reads only — never a
// write to Etsy.
//
// Cost per pull: ⌈Etsy drafts / 100⌉ pages (GET /shops/{id}/listings?state=draft
// &includes=Images — images included), + one getAllListingFiles per digital
// draft that is new or changed on Etsy, + one GET /listings/{id} per linked
// draft that left the draft list since the last pull, + CDN downloads (no API
// quota) only for photos the app doesn't hold yet. A pull with nothing changed
// costs the pages alone and downloads nothing.

import type { DraftEtsyState, DraftFields, DraftPullSummary, ListingDraft, TaxonomyOption } from '../shared/types'
import { decodeHtmlEntities } from '../shared/html'
import {
  EMPTY_DRAFT_FIELDS,
  IMAGE_EXTENSIONS,
  MAX_DIGITAL_FILES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  SCOPE_LABEL,
  missingScopes
} from '../shared/myShop'
import type { Db } from './db'
import type { EtsyClient, EtsyListing, EtsyListingImage, EtsyListingWithAssociations, EtsyMoney } from './etsyApi'
import type { EtsyAuth } from './etsyAuth'
import type { Downloaded } from './imageSync'
import {
  type DraftMediaSlot,
  type EtsyGaps,
  adoptEtsyMedia,
  deleteDraft,
  getDraft,
  getDraftByListing,
  isDraftSending,
  listDrafts,
  normalizeEtsyState,
  readOwnListing,
  saveDraft
} from './drafts'
import { getFiles } from './features/media/ops'
import { MyShopError, myShopErrorMessage } from './myShop'

export interface DraftImportDeps {
  db: Db
  client: EtsyClient
  /** The Etsy sign-in (own shop id + OAuth scopes; listings_r is needed). */
  auth: Pick<EtsyAuth, 'status'>
  /** The seller category tree as "A › B › C" paths (createTaxonomyCache), for the drafts' category names. */
  taxonomy?: () => Promise<TaxonomyOption[]>
  /** Download a listing photo from Etsy's CDN (imageSync downloadImage: only isEtsyCdnUrl URLs). */
  fetchImage: (url: string) => Promise<Downloaded>
  now: () => number
}

/** OAS: getListingsByShop with state=draft and getAllListingFiles need listings_r. */
export const PULL_SCOPES = ['listings_r'] as const
/** Etsy's page size and offset cap (v3). */
const PAGE = 100
const MAX_OFFSET = 12_000

export const PULL_SIGNED_OUT = 'Увійдіть в Etsy («Мій магазин» → «Увійти через Etsy»), щоб підтягувати чернетки з Etsy.'
export const PULL_NO_SHOP = 'У цього акаунта Etsy немає магазину — чернетки підтягувати нізвідки.'
export const pullMissingScopes = (missing: string[]): string =>
  `Щоб підтягувати чернетки з Etsy, потрібен дозвіл: ${missing
    .map((s) => SCOPE_LABEL[s] ?? s)
    .join(', ')}. Вийдіть і увійдіть в Etsy ще раз («Керувати» у шапці вашого магазину → «Вийти»).`

/** Etsy's updated_timestamp (s) — the same reading drafts.ts compares against. */
export function etsyTime(l: Pick<EtsyListing, 'updated_timestamp' | 'last_modified_timestamp'> | null | undefined): number | null {
  const t = l?.updated_timestamp ?? l?.last_modified_timestamp
  return typeof t === 'number' && Number.isFinite(t) ? t : null
}

/** A Money as the draft's typed price ("5.99"); '' when unknown. */
export function moneyToPrice(m: EtsyMoney | null | undefined): string {
  if (!m || typeof m.amount !== 'number' || typeof m.divisor !== 'number' || !(m.divisor > 0) || !Number.isFinite(m.amount)) return ''
  if (m.divisor === 100 && Number.isInteger(m.amount)) {
    const sign = m.amount < 0 ? '-' : ''
    const a = Math.abs(m.amount)
    return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
  }
  return (Math.round((m.amount * 100) / m.divisor) / 100).toFixed(2)
}

const text = (v: unknown): string => (typeof v === 'string' ? decodeHtmlEntities(v) : '')
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(decodeHtmlEntities) : [])
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null)

/**
 * An Etsy listing as DraftFields (entities decoded). listing_type download →
 * a digital draft, anything else (physical, both) → physical — a draft can't
 * say "both": sending such a draft leaves Etsy's type and files alone
 * (drafts.ts). `taxonomyPath` is the category's display path when known.
 */
export function etsyDraftFields(l: EtsyListing, taxonomyPath: string | null): DraftFields {
  const d = EMPTY_DRAFT_FIELDS
  const type = l.listing_type === 'download' ? 'download' : 'physical'
  return {
    type,
    title: text(l.title),
    description: text(l.description),
    price: moneyToPrice(l.price),
    quantity: typeof l.quantity === 'number' && Number.isFinite(l.quantity) ? l.quantity : d.quantity,
    taxonomyId: posInt(l.taxonomy_id),
    taxonomyPath: posInt(l.taxonomy_id) != null ? taxonomyPath : null,
    whoMade: typeof l.who_made === 'string' && l.who_made ? l.who_made : d.whoMade,
    whenMade: typeof l.when_made === 'string' && l.when_made ? l.when_made : d.whenMade,
    isSupply: l.is_supply === true,
    tags: texts(l.tags),
    materials: texts(l.materials),
    shouldAutoRenew: l.should_auto_renew !== false,
    shippingProfileId: type === 'physical' ? posInt(l.shipping_profile_id) : null,
    readinessStateId: type === 'physical' ? posInt(l.readiness_state_id) : null
  }
}

const IMAGE_EXT_BY_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }

/** The file name a downloaded photo is stored under (the extension the draft rules accept), or null. */
export function photoName(img: Pick<EtsyListingImage, 'listing_image_id' | 'url_fullxfull'>, contentType: string | null): string | null {
  const byType = IMAGE_EXT_BY_TYPE[(contentType ?? '').split(';')[0].trim().toLowerCase()]
  const byUrl = (/\.([a-z0-9]+)(?:$|[?#])/i.exec(img.url_fullxfull ?? '')?.[1] ?? '').toLowerCase()
  const ext = byType ?? (IMAGE_EXTENSIONS.includes(byUrl) ? (byUrl === 'jpeg' ? 'jpg' : byUrl) : null)
  return ext ? `etsy-${img.listing_image_id}.${ext}` : null
}

/** "«Title»" (or "#id") for messages about one Etsy listing. */
const label = (title: string, id: number): string => (title.trim() ? `«${title.trim()}»` : `#${id}`)

/** The draft is still as it was read (no save, send or pull touched it meanwhile). */
function unchanged(db: Db, before: ListingDraft): boolean {
  const cur = getDraft(db, before.id)
  return (
    cur != null &&
    cur.updatedAt === before.updatedAt &&
    cur.sentListingId === before.sentListingId &&
    (cur.etsy?.dirty ?? false) === (before.etsy?.dirty ?? false) &&
    (cur.etsy?.etsyUpdatedAt ?? null) === (before.etsy?.etsyUpdatedAt ?? null) &&
    (cur.etsy?.state ?? null) === (before.etsy?.state ?? null)
  )
}

function setEtsyState(db: Db, draftId: number, state: DraftEtsyState): void {
  db.prepare(
    `UPDATE listing_drafts SET etsy_state = ?, sent_published = CASE WHEN ? = 'active' THEN 1 ELSE sent_published END WHERE id = ?`
  ).run(state, state, draftId)
}

/**
 * Pull the own shop's Etsy drafts into the app (see the header). Never writes
 * to Etsy. A sign-in that can't read drafts throws a MyShopError (signed out,
 * no shop, a missing permission — nothing was pulled); a failing page throws
 * (removals can't be judged from a partial list); a failing listing is an
 * `errors` entry and the rest goes on. What a pull couldn't fetch (a photo
 * download, the files list) is kept as the draft's gaps: the next pull tries
 * again, and an update never deletes those on Etsy.
 */
export async function importEtsyDrafts(deps: DraftImportDeps): Promise<DraftPullSummary> {
  const { db, client } = deps
  const out: DraftPullSummary = { imported: 0, updated: 0, removed: 0, conflicts: 0, errors: [] }
  const st = deps.auth.status()
  if (!st.loggedIn) throw new MyShopError(PULL_SIGNED_OUT)
  if (!st.shopId) throw new MyShopError(PULL_NO_SHOP)
  const missing = missingScopes(st.scopes, PULL_SCOPES)
  if (missing.length) throw new MyShopError(pullMissingScopes(missing))
  const shopId = st.shopId

  // 1. Every Etsy draft of the shop (images included).
  const etsyDrafts: EtsyListingWithAssociations[] = []
  const seen = new Set<number>()
  for (let offset = 0; offset <= MAX_OFFSET; ) {
    const page = await client.getShopListingsByState(shopId, 'draft', offset, PAGE)
    const results = page.results ?? []
    for (const l of results) {
      if (!posInt(l?.listing_id) || seen.has(l.listing_id)) continue
      if (l.shop_id != null && l.shop_id !== shopId) continue // never another shop's listing
      seen.add(l.listing_id)
      etsyDrafts.push(l)
    }
    offset += results.length
    if (results.length === 0 || offset >= (page.count ?? 0)) break
  }

  // The category paths, fetched at most once per pull and only when a new category shows up.
  let paths: Promise<Map<number, string> | null> | null = null
  const pathOf = async (taxonomyId: number | null): Promise<string | null> => {
    if (taxonomyId == null || !deps.taxonomy) return null
    paths ??= deps.taxonomy().then(
      (list) => new Map(list.map((t) => [t.id, t.path])),
      () => null
    )
    return (await paths)?.get(taxonomyId) ?? null
  }

  /**
   * The listing's photos as the draft's list, Etsy's order (rank 1 = main):
   * one the draft already holds (same Etsy id) is kept, others downloaded.
   * `missing` = the Etsy ids that couldn't be had ('all': the answer carried
   * no images list — then `slots` is undefined: keep the draft's photos).
   */
  const photosOf = async (
    l: EtsyListingWithAssociations,
    have: Map<number, number>,
    title: string
  ): Promise<{ slots: DraftMediaSlot[] | undefined; missing: number[] | 'all' }> => {
    if (!Array.isArray(l.images)) {
      out.errors.push(`${title}: Etsy не віддав фото товару — спробуємо ще раз під час наступної синхронізації.`)
      return { slots: undefined, missing: 'all' }
    }
    const images = l.images
      .filter((i) => posInt(i?.listing_image_id))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .slice(0, MAX_IMAGES)
    const slots: DraftMediaSlot[] = []
    const missing: number[] = []
    for (const [n, img] of images.entries()) {
      const mediaId = have.get(img.listing_image_id)
      if (mediaId != null) {
        slots.push({ mediaId })
        continue
      }
      try {
        const got = await deps.fetchImage(img.url_fullxfull)
        const name = photoName(img, got.contentType)
        if (!name) throw new Error('формат фото не JPG, PNG чи GIF')
        if (!got.body.length) throw new Error('порожній файл')
        if (got.body.length > MAX_IMAGE_BYTES) throw new Error(`більше ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} МБ`)
        slots.push({ name, data: new Uint8Array(got.body), etsyId: img.listing_image_id })
      } catch (e) {
        missing.push(img.listing_image_id)
        out.errors.push(`${title}: фото ${n + 1} з Etsy не завантажилось (${myShopErrorMessage(e)}) — спробуємо ще раз під час наступної синхронізації.`)
      }
    }
    return { slots, missing }
  }

  /**
   * The buyer files (digital listings only) as remote rows — or the draft's own
   * copy when it has one (the same Etsy id, or — not mapped yet, e.g. sent by an
   * older version — the same name and size). `slots` undefined = keep the
   * draft's files: not a digital listing ("both" keeps its files on Etsy and
   * in the draft), or the list couldn't be read (`unread`).
   */
  const filesOf = async (
    l: EtsyListing,
    draftId: number | null,
    title: string
  ): Promise<{ slots: DraftMediaSlot[] | undefined; unread: boolean }> => {
    if (l.listing_type !== 'download') return { slots: undefined, unread: false }
    try {
      const files = (await getFiles(client, shopId, l.listing_id)).slice(0, MAX_DIGITAL_FILES)
      if (draftId != null) adoptEtsyMedia(db, draftId, 'file', files.map((f) => ({ id: f.id, name: f.name, size: f.sizeBytes })), false)
      const have = draftId != null ? etsyIds(draftId, 'file') : new Map<number, number>()
      const slots: DraftMediaSlot[] = files.map((f) => {
        const mediaId = have.get(f.id)
        return mediaId != null ? { mediaId } : { remote: true, name: f.name || `file-${f.id}`, size: f.sizeBytes ?? 0, etsyId: f.id }
      })
      return { slots, unread: false }
    } catch (e) {
      out.errors.push(`${title}: не вдалося прочитати файли для покупця (${myShopErrorMessage(e)}) — спробуємо ще раз під час наступної синхронізації.`)
      return { slots: undefined, unread: true }
    }
  }

  const etsyIds = (draftId: number, kind: 'photo' | 'file'): Map<number, number> => {
    const m = new Map<number, number>()
    const rows = db
      .prepare('SELECT id, etsy_id FROM listing_draft_media WHERE draft_id = ? AND kind = ? AND etsy_id IS NOT NULL')
      .all(draftId, kind) as Array<{ id: number; etsy_id: number }>
    for (const r of rows) if (!m.has(r.etsy_id)) m.set(r.etsy_id, r.id)
    return m
  }

  const gapsOf = (photos: number[] | 'all', filesUnread: boolean): EtsyGaps | null =>
    (photos === 'all' || photos.length) || filesUnread
      ? { ...(photos === 'all' || photos.length ? { photos } : {}), ...(filesUnread ? { files: 'all' as const } : {}) }
      : null

  const linked = new Map<number, ListingDraft>()
  for (const d of listDrafts(db)) if (d.etsy && !linked.has(d.etsy.listingId)) linked.set(d.etsy.listingId, d)

  // 2. Each Etsy draft: refresh the linked draft, flag a conflict, or import it.
  for (const l of etsyDrafts) {
    const title = label(text(l.title), l.listing_id)
    const t = etsyTime(l)
    const local = linked.get(l.listing_id)
    try {
      if (local && isDraftSending(db, local.id)) continue // a send in progress owns it; the next pull looks again
      if (local) {
        const link = local.etsy!
        if (link.shopId == null) db.prepare('UPDATE listing_drafts SET etsy_shop_id = ? WHERE id = ? AND etsy_shop_id IS NULL').run(shopId, local.id)
        if (t != null && link.etsyUpdatedAt === t && !link.incomplete) {
          if (link.state !== 'draft') setEtsyState(db, local.id, 'draft')
          continue
        }
        if (link.dirty) {
          // Local edits not on Etsy yet: never overwritten. A change on Etsy since the
          // last sync is a conflict to show (unknown baseline → nothing to compare).
          if (t != null && link.etsyUpdatedAt != null && t !== link.etsyUpdatedAt) {
            out.conflicts++
            db.prepare('UPDATE listing_drafts SET etsy_changed_at = ? WHERE id = ? AND (etsy_changed_at IS NULL OR etsy_changed_at != ?)').run(
              t,
              local.id,
              t
            )
          }
          continue
        }
        const photos = await photosOf(l, etsyIds(local.id, 'photo'), title)
        const files = await filesOf(l, local.id, title)
        const taxonomyId = posInt(l.taxonomy_id)
        const path = taxonomyId != null && taxonomyId === local.fields.taxonomyId ? local.fields.taxonomyPath : await pathOf(taxonomyId)
        if (!unchanged(db, local) || isDraftSending(db, local.id)) continue // edited/sent meanwhile — the next pull looks again
        saveDraft(
          db,
          {
            id: local.id,
            source: local.source === 'mcp' ? 'mcp' : 'app',
            fields: etsyDraftFields(l, path),
            photos: photos.slots,
            files: files.slots,
            link: { listingId: l.listing_id, state: 'draft', etsyUpdatedAt: t, shopId, gaps: gapsOf(photos.missing, files.unread) }
          },
          deps.now()
        )
        out.updated++
        continue
      }
      // A draft made on Etsy's site: a new draft here.
      const photos = await photosOf(l, new Map(), title)
      const files = await filesOf(l, null, title)
      const path = await pathOf(posInt(l.taxonomy_id))
      if (getDraftByListing(db, l.listing_id)) continue // linked meanwhile (a send) — not a second copy
      saveDraft(
        db,
        {
          source: 'app',
          imported: true,
          fields: etsyDraftFields(l, path),
          photos: photos.slots ?? [],
          files: files.slots ?? [],
          link: { listingId: l.listing_id, state: 'draft', etsyUpdatedAt: t, shopId, gaps: gapsOf(photos.missing, files.unread) }
        },
        deps.now()
      )
      out.imported++
    } catch (e) {
      out.errors.push(`${title}: ${myShopErrorMessage(e)}`)
    }
  }

  // 3. Linked drafts that were Etsy drafts but aren't any more: published, deactivated … or deleted.
  for (const d of linked.values()) {
    const link = d.etsy!
    if (link.state !== 'draft' || seen.has(link.listingId)) continue
    // Another shop's listing (signed in with another account now): its reads would 404 — not ours to judge.
    if (link.shopId != null && link.shopId !== shopId) continue
    if (isDraftSending(db, d.id)) continue
    const title = label(d.fields.title, link.listingId)
    try {
      const l = await readOwnListing(client, link.listingId)
      if (!unchanged(db, d) || isDraftSending(db, d.id)) continue
      if (l == null) {
        out.removed++
        // Only a draft known to be this shop's goes away; one linked before the shop was
        // recorded (an older version) is kept and marked — the 404 could be another account's.
        if (d.source === 'etsy' && !link.dirty && link.shopId === shopId) deleteDraft(db, d.id)
        else setEtsyState(db, d.id, 'removed')
        continue
      }
      if (l.shop_id != null && l.shop_id !== shopId) continue // another shop's listing (an earlier sign-in): not ours to judge
      if (l.shop_id === shopId && link.shopId == null) db.prepare('UPDATE listing_drafts SET etsy_shop_id = ? WHERE id = ?').run(shopId, d.id)
      const state = normalizeEtsyState(l.state)
      if (state && state !== link.state) {
        setEtsyState(db, d.id, state)
        out.updated++
      }
    } catch (e) {
      out.errors.push(`${title}: не вдалося дізнатися стан на Etsy (${myShopErrorMessage(e)}).`)
    }
  }
  return out
}
