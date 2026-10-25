// MCP tools for the user's OWN Etsy shop (signed in via "Мій магазин", OAuth):
// read its listings in any state live, find Etsy categories, and — only while
// the MCP modal's "Дозволити Claude змінювати мій магазин" is on — create and
// edit listings, add photos/files, and edit the shop texts through the Etsy
// API. Plus the drafts kept in the app (prepare_product …): saving, listing,
// unlinking and deleting them locally need neither; pulling Etsy drafts in
// (sync_prepared_products) needs the sign-in; sending (create or update the
// linked listing) and deleting the Etsy listing too need both.
// Tool names and JSON keys keep the catalog vocabulary of mcpTools.ts
// ("store" = Etsy shop, "product" = Etsy listing); descriptions say Etsy.

import { randomBytes } from 'crypto'
import { readFile, stat } from 'fs/promises'
import { basename, isAbsolute } from 'path'
import type {
  DraftFields,
  DraftMedia,
  DraftPullSummary,
  EtsyAuthStatus,
  ListingDraft,
  MyListing,
  MyListingPatch,
  MyListingState,
  MyShopResult,
  NewListingInput,
  TaxonomyOption
} from '../shared/types'
import {
  MAX_DIGITAL_FILES,
  MAX_DIGITAL_FILE_BYTES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_MATERIALS,
  MAX_TAGS,
  MY_LISTING_STATES,
  TAG_MAX,
  TITLE_MAX,
  WHEN_MADE,
  WHO_MADE,
  etsyListingEditUrl,
  etsyListingUrl,
  missingScopes,
  normalizeDraftFields
} from '../shared/myShop'
import { priceValue } from '../shared/format'
import { EtsyApiError, type EtsyClient, type Paged } from './etsyApi'
import { type JsonSchema, type McpTool, ToolInputError, textResult } from './mcpProtocol'
import {
  createFileRegistry,
  createMyListing,
  listMyListings,
  loadProcessingOptions,
  loadShippingOptions,
  mimeOf,
  saveMyListing,
  saveMyShop
} from './myShop'
import type { Db } from './db'
import {
  type DraftMediaSlot,
  deleteDraft,
  deleteDraftEverywhere,
  getDraft,
  listDrafts,
  saveDraft,
  sendDraft,
  unlinkDraft
} from './drafts'
import { importEtsyDrafts } from './draftImport'
import { type Downloaded, downloadImage } from './imageSync'

/** Drafts kept in the app: prepared over MCP, reviewed and sent by the user there. */
export interface DraftDeps {
  db: Db
  now?: () => number
  /** A draft changed (the app refreshes its list). */
  onChanged?: () => void
  /**
   * Pull the user's Etsy drafts into the app (ipc.ts pullEtsyDrafts: one pull
   * at a time, shared with the app's own, and the drafts window's progress).
   * Absent: sync_prepared_products runs importEtsyDrafts itself.
   */
  pull?: () => Promise<MyShopResult<DraftPullSummary>>
  /** Only for that direct pull: a photo from Etsy's CDN (default: downloadImage over fetch). */
  fetchImage?: (url: string) => Promise<Downloaded>
}

export interface OwnStoreDeps {
  client: EtsyClient
  /** The sign-in state (etsyAuth.status). */
  status: () => EtsyAuthStatus
  /** The MCP modal's "allow changes" switch, read per call. */
  writesAllowed: () => boolean
  taxonomy: () => Promise<TaxonomyOption[]>
  readFile?: (path: string) => Promise<Uint8Array<ArrayBuffer>>
  statFile?: (path: string) => Promise<{ size: number; isFile: boolean }>
  /** The OAuth access token (features that need the raw value). */
  accessToken?: () => Promise<string | null>
}

export const NOT_SIGNED_IN =
  'The user has not signed in to their own Etsy shop in the app. Ask them to sign in: the "✏️ Мій магазин" button in the app’s sidebar → "Увійти через Etsy".'
export const WRITES_OFF =
  'Changes to the user’s Etsy shop are switched off. Ask the user to enable "Дозволити Claude змінювати мій магазин" in the app (the server icon at the top of the sidebar, "MCP-сервер для Claude"; its tooltip says "Доступ для Claude"), then try again.'

/** Any error as an English text for the client (Etsy API errors with Etsy's own detail). */
export function mcpErrorText(e: unknown): string {
  if (e instanceof ToolInputError) return e.message
  if (e instanceof EtsyApiError) {
    const detail = e.detail ? `: ${e.detail}` : ''
    switch (e.kind) {
      case 'not_signed_in':
        return NOT_SIGNED_IN
      case 'oauth':
        return 'The Etsy sign-in has expired. Ask the user to sign in again in the app: the "Керувати" button in their own shop’s header (or, if the app shows them signed out, the "✏️ Мій магазин" button in the sidebar).'
      case 'forbidden':
        return `Etsy refused this action (HTTP 403)${detail}.`
      case 'bad_request':
        return `Etsy rejected the request as invalid (HTTP 400)${detail}.`
      case 'not_found':
        return `Not found on Etsy (HTTP 404)${detail}.`
      case 'rate_limit':
        return 'Etsy API rate limit reached — either the per-second limit (try again shortly) or the app key’s daily quota. If it keeps failing, the daily quota is used up until it resets.'
      case 'network':
        return 'No connection to the Etsy API — try again.'
      case 'no_key':
        return 'The app has no Etsy API key configured (Settings).'
      case 'auth':
        return `Etsy rejected the app’s API key (HTTP ${e.status ?? 401})${detail}. Ask the user to check the keystring and shared secret in the app’s Settings.`
      case 'server':
        return `Etsy API error (HTTP ${e.status ?? 500})${detail} — try again later.`
      case 'bad_response':
        return 'Etsy answered something unexpected — try again later.'
      default: {
        // Every kind is covered above; a new one must get an English text too.
        const unhandled: never = e.kind
        void unhandled
        return e.message
      }
    }
  }
  return e instanceof Error ? e.message : String(e)
}

const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: mcpErrorText(e) }], isError: true })

function signedIn(deps: OwnStoreDeps | undefined): OwnStoreDeps & { shopId: number } {
  if (!deps) throw new ToolInputError(NOT_SIGNED_IN)
  const st = deps.status()
  if (!st.loggedIn || !st.shopId) throw new ToolInputError(NOT_SIGNED_IN)
  return { ...deps, shopId: st.shopId }
}

function writable(deps: OwnStoreDeps | undefined): OwnStoreDeps & { shopId: number } {
  const d = signedIn(deps)
  if (!d.writesAllowed()) throw new ToolInputError(WRITES_OFF)
  return d
}

const myDeps = (d: OwnStoreDeps) => ({ client: d.client, auth: { status: d.status } })

function myProduct(l: MyListing) {
  return {
    id: l.listingId,
    status: l.state,
    title: l.title,
    description: l.description,
    tags: l.tags,
    materials: l.materials,
    auto_renew: l.shouldAutoRenew,
    product_type: l.type === 'download' ? 'digital' : l.type,
    price: l.priceAmount != null && l.priceDivisor ? priceValue(l.priceAmount, l.priceDivisor) : null,
    currency: l.currency,
    quantity: l.quantity,
    updated_at: l.updatedAt != null ? new Date(l.updatedAt * 1000).toISOString() : null,
    expires_at: l.endingAt != null ? new Date(l.endingAt * 1000).toISOString() : null
  }
}

/** update_my_product's argument name of each patch key. */
const PATCH_ARG: Record<keyof MyListingPatch, string> = {
  title: 'title',
  description: 'description',
  tags: 'tags',
  materials: 'materials',
  shouldAutoRenew: 'auto_renew',
  state: 'status'
}

/**
 * How many photos/files a listing has and the highest Etsy rank among them
 * (0 = none): getListingImages (public) or getAllListingFiles (OAuth listings_r).
 */
async function existingRanks(client: EtsyClient, path: string, oauth: boolean): Promise<{ count: number; last: number }> {
  const page = await client.call<Paged<{ rank?: number }> | undefined>(path, oauth ? { oauth: true } : {})
  const rows = Array.isArray(page?.results) ? page.results : []
  const ranks = rows.map((r, n) => (Number.isInteger(r.rank) && (r.rank as number) >= 1 ? (r.rank as number) : n + 1))
  return { count: rows.length, last: ranks.reduce((m, r) => Math.max(m, r), 0) }
}

const strings = (v: unknown, name: string): string[] | undefined => {
  if (v == null) return undefined
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new ToolInputError(`Argument "${name}" must be an array of strings.`)
  }
  return v as string[]
}

interface MediaItem {
  path?: unknown
  data_base64?: unknown
  name?: unknown
}

export const MEDIA_ITEM: JsonSchema = {
  type: 'object',
  description:
    'Either an absolute path of a file on the computer the app runs on ({"path": "/home/me/cover.jpg"}) or the content ({"data_base64": "…", "name": "cover.jpg"}).',
  properties: {
    path: { type: 'string', description: 'Absolute path of a local regular file (read by the app).' },
    data_base64: { type: 'string', description: 'The file content, base64.' },
    name: { type: 'string', description: 'File name with extension (needed with data_base64).' }
  }
}

/**
 * Turn the media arguments into picked-file tokens for createMyListing (or
 * plain uploads). Paths must be absolute regular files; base64 content needs a
 * name. Photos must be JPG/PNG/GIF; size limits as in the app.
 */
export async function resolveMedia(deps: OwnStoreDeps, photos: unknown, files: unknown) {
  const registry = createFileRegistry()
  const memory = new Map<string, Uint8Array<ArrayBuffer>>()
  const doStat = deps.statFile ?? (async (p: string) => {
    const s = await stat(p)
    return { size: s.size, isFile: s.isFile() }
  })
  async function one(item: unknown, kind: 'photo' | 'file'): Promise<string> {
    const m = (item ?? {}) as MediaItem
    if (typeof m.path === 'string' && m.path) {
      if (!isAbsolute(m.path)) throw new ToolInputError(`The ${kind} path must be absolute: ${m.path}`)
      let st: { size: number; isFile: boolean }
      try {
        st = await doStat(m.path)
      } catch {
        throw new ToolInputError(`No such file: ${m.path}`)
      }
      if (!st.isFile) throw new ToolInputError(`Not a regular file: ${m.path}`)
      return registry.add(m.path, basename(m.path), st.size).token
    }
    if (typeof m.data_base64 === 'string' && m.data_base64) {
      if (typeof m.name !== 'string' || !/\.[a-z0-9]+$/i.test(m.name)) {
        throw new ToolInputError(`A ${kind} sent as data_base64 needs a "name" with an extension.`)
      }
      const data = new Uint8Array(Buffer.from(m.data_base64, 'base64')) as Uint8Array<ArrayBuffer>
      if (!data.length) throw new ToolInputError(`The ${kind} "${m.name}" is empty.`)
      const key = `mem:${randomBytes(8).toString('hex')}`
      memory.set(key, data)
      return registry.add(key, basename(m.name), data.length).token
    }
    throw new ToolInputError(`Each ${kind} needs "path" or "data_base64".`)
  }
  const list = (v: unknown, name: string): unknown[] => {
    if (v == null) return []
    if (!Array.isArray(v)) throw new ToolInputError(`Argument "${name}" must be an array.`)
    return v
  }
  const photoTokens: string[] = []
  for (const p of list(photos, 'photos')) photoTokens.push(await one(p, 'photo'))
  const fileTokens: string[] = []
  for (const f of list(files, 'files')) fileTokens.push(await one(f, 'file'))
  const read = deps.readFile ?? ((p: string) => readFile(p) as Promise<Uint8Array<ArrayBuffer>>)
  const readAny = async (p: string): Promise<Uint8Array<ArrayBuffer>> => memory.get(p) ?? read(p)
  return { registry, readFile: readAny, photos: photoTokens, files: fileTokens }
}

const STATUS_VALUES = MY_LISTING_STATES.map((s) => s.value)

const WRITE_NOTE =
  'Changes the user’s live Etsy shop — only call it when the user asked for this change. Needs the app’s "allow changes" switch.'

/** Etsy's fee for publishing a listing (a draft, or renewing an expired one). */
const FEE = 'Etsy charges a listing fee (USD 0.20) — ask the user first'

/** A draft's status for a client (ListingDraft.status in the app's words). */
const DRAFT_STATUS: Record<ListingDraft['status'], string> = {
  draft: 'waiting_for_review',
  sent: 'sent',
  changed: 'changed_since_sent',
  error: 'send_failed'
}

const PREPARED_BY: Record<ListingDraft['source'], string> = { app: 'user', mcp: 'assistant', etsy: 'etsy_site' }

const iso = (ms: number | null | undefined): string | null => (ms != null ? new Date(ms).toISOString() : null)

/** The Etsy listing a draft is linked to, for a client (null = never sent). */
function etsyLinkOut(d: ListingDraft) {
  const e = d.etsy
  if (!e) return null
  return {
    product_id: e.listingId,
    // draft | active | inactive | expired | sold_out | removed (deleted on Etsy); null = not known yet.
    state: e.state,
    unsent_changes: e.dirty,
    changed_on_etsy: e.changedOnEtsy,
    removed_on_etsy: e.removed,
    url: e.url,
    edit_url: e.removed ? null : e.editUrl,
    last_synced_at: iso(e.syncedAt),
    etsy_updated_at: e.etsyUpdatedAt != null ? new Date(e.etsyUpdatedAt * 1000).toISOString() : null,
    // Sent by an older app version: never compared with Etsy — the next send asks first (a conflict answer).
    never_compared_with_etsy: e.unverified,
    // The last sync couldn't fetch some of its photos/files from Etsy: a send keeps those on Etsy.
    some_media_not_pulled: e.incomplete
  }
}

function draftOut(d: ListingDraft) {
  const f = d.fields
  return {
    draft_id: d.id,
    status: DRAFT_STATUS[d.status] ?? d.status,
    prepared_by: PREPARED_BY[d.source] ?? 'user',
    type: f.type === 'download' ? 'digital' : 'physical',
    title: f.title,
    description: f.description,
    price: f.price,
    quantity: f.quantity,
    category_id: f.taxonomyId,
    category: f.taxonomyPath,
    made_by: f.whoMade,
    made_when: f.whenMade,
    is_supply: f.isSupply,
    tags: f.tags,
    materials: f.materials,
    auto_renew: f.shouldAutoRenew,
    shipping_profile_id: f.shippingProfileId,
    processing_profile_id: f.readinessStateId,
    photos: d.photos.map((p) => p.name),
    files: d.files.map((p) => p.name),
    // Buyer files pulled from an Etsy draft: only on Etsy (Etsy gives no download), kept with { keep: n }.
    files_only_on_etsy: d.files.filter((p) => p.remote).map((p) => p.name),
    problems: d.problems,
    etsy: etsyLinkOut(d),
    sent_product_id: d.sentListingId,
    sent_published: d.sentPublished,
    last_error: d.lastError,
    updated_at: new Date(d.updatedAt).toISOString()
  }
}

/** The fields create_product / prepare_product take, merged over a base. */
function fieldsFrom(a: Record<string, unknown>, base: DraftFields): DraftFields {
  const f = { ...base }
  if (a.type != null) f.type = a.type === 'physical' ? 'physical' : 'download'
  if (a.title != null) f.title = String(a.title)
  if (a.description != null) f.description = String(a.description)
  if (a.price != null) f.price = String(a.price)
  if (a.quantity != null) f.quantity = Number(a.quantity)
  else if (a.type != null && base.quantity === 999 && f.type === 'physical') f.quantity = 1
  if (a.category_id != null) f.taxonomyId = Number(a.category_id)
  if (a.made_by != null) f.whoMade = String(a.made_by)
  if (a.made_when != null) f.whenMade = String(a.made_when)
  if (a.is_supply != null) f.isSupply = !!a.is_supply
  const tags = strings(a.tags, 'tags')
  if (tags) f.tags = tags
  const materials = strings(a.materials, 'materials')
  if (materials) f.materials = materials
  if (a.auto_renew != null) f.shouldAutoRenew = !!a.auto_renew
  if (a.shipping_profile_id != null) f.shippingProfileId = Number(a.shipping_profile_id)
  if (a.processing_profile_id != null) f.readinessStateId = Number(a.processing_profile_id)
  return f
}

/** A photo/file of prepare_product: new content (MEDIA_ITEM), or one the draft already has, kept in place. */
const DRAFT_MEDIA_ITEM: JsonSchema = {
  type: 'object',
  description:
    'New content — {"path": "/home/me/cover.jpg"} or {"data_base64": "…", "name": "cover.jpg"} — or one the draft already has: {"keep": 2} = its photo/file at position 2 (1-based, in the order list_prepared_products shows), which stays as it is (and is not uploaded to Etsy again).',
  properties: {
    ...MEDIA_ITEM.properties,
    keep: { type: 'integer', minimum: 1, description: "1-based position of a photo/file already in this draft (with draft_id) to keep at this place." }
  }
}

const DRAFT_FIELD_PROPS: Record<string, JsonSchema> = {
  type: { type: 'string', enum: ['digital', 'physical'], description: 'Default digital.' },
  title: { type: 'string', maxLength: TITLE_MAX },
  description: { type: 'string' },
  price: { type: 'number', description: "In the Etsy shop's currency, e.g. 5.99 (at most 2 decimals)." },
  quantity: { type: 'integer', minimum: 1, maximum: 999, description: 'Default 999 (digital) / 1 (physical).' },
  category_id: { type: 'integer', minimum: 1, description: 'Etsy category id from find_categories.' },
  made_by: { type: 'string', enum: WHO_MADE.map((w) => w.value) },
  made_when: { type: 'string', enum: WHEN_MADE.map((w) => w.value) },
  is_supply: { type: 'boolean' },
  tags: { type: 'array', items: { type: 'string' } },
  materials: { type: 'array', items: { type: 'string' } },
  auto_renew: { type: 'boolean' },
  shipping_profile_id: { type: 'integer', minimum: 1 },
  processing_profile_id: { type: 'integer', minimum: 1 },
  photos: {
    type: 'array',
    items: DRAFT_MEDIA_ITEM,
    description: `Up to ${MAX_IMAGES} JPG/PNG/GIF (≤ ${MAX_IMAGE_BYTES / 1024 / 1024} MB each), first = main photo. When given, this is the draft's whole new photo list in order: photos of the draft not listed (as {"keep": n}) are removed — and, for a draft linked to an Etsy listing, removed from that listing too on its next send.`
  },
  files: {
    type: 'array',
    items: DRAFT_MEDIA_ITEM,
    description: `Files the buyer downloads (digital only — not sent for a physical listing): up to ${MAX_DIGITAL_FILES}, ≤ ${MAX_DIGITAL_FILE_BYTES / 1024 / 1024} MB each. When given, this is the draft's whole new file list: files not listed (as {"keep": n}) are removed — for a linked draft also on Etsy at its next send. A file that exists only on Etsy (files_only_on_etsy) can only be kept with {"keep": n}.`
  }
}

/** Tools for drafts kept in the app — reviewed and sent by the user there. */
export function createDraftTools(own: OwnStoreDeps | undefined, drafts: DraftDeps | undefined): McpTool[] {
  const need = (): DraftDeps => {
    if (!drafts) throw new ToolInputError('Drafts are not available.')
    return drafts
  }
  const changed = (): void => drafts?.onChanged?.()
  async function categoryPath(id: number | null): Promise<string | null> {
    if (id == null || !own) return null
    try {
      return (await own.taxonomy()).find((t) => t.id === id)?.path ?? null
    } catch {
      return null
    }
  }
  const draftOf = (d: DraftDeps, id: unknown): ListingDraft => {
    const draft = getDraft(d.db, Number(id))
    if (!draft) throw new ToolInputError(`No draft ${String(id)}.`)
    return draft
  }
  /**
   * prepare_product's photos/files argument → the draft's new ordered list:
   * {keep: n} = the draft's current item n (it keeps its Etsy copy), anything
   * else new content (resolveMedia: path or base64).
   */
  async function slots(items: unknown, kind: 'photo' | 'file', current: DraftMedia[] | null): Promise<DraftMediaSlot[]> {
    if (!Array.isArray(items)) throw new ToolInputError(`Argument "${kind}s" must be an array.`)
    const out: Array<DraftMediaSlot | null> = []
    const fresh: unknown[] = []
    const used = new Set<number>()
    for (const item of items) {
      const keep = (item as { keep?: unknown } | null)?.keep
      if (keep == null) {
        out.push(null)
        fresh.push(item)
        continue
      }
      const m = item as Record<string, unknown>
      if (m.path != null || m.data_base64 != null) throw new ToolInputError(`A ${kind} is either {"keep": n} or new content, not both.`)
      if (!current) throw new ToolInputError(`{"keep": n} needs draft_id — a new draft has no ${kind}s to keep.`)
      const n = Number(keep)
      if (!Number.isInteger(n) || n < 1 || n > current.length) {
        throw new ToolInputError(`The draft has no ${kind} at position ${String(keep)} (it has ${current.length}).`)
      }
      if (used.has(n)) throw new ToolInputError(`The draft's ${kind} ${n} is kept twice.`)
      used.add(n)
      out.push({ mediaId: current[n - 1].id })
    }
    if (!fresh.length) return out as DraftMediaSlot[]
    const media = await resolveMedia(own ?? ({} as OwnStoreDeps), kind === 'photo' ? fresh : undefined, kind === 'file' ? fresh : undefined)
    const tokens = kind === 'photo' ? media.photos : media.files
    const read = await Promise.all(
      tokens.map(async (t) => {
        const f = media.registry.get(t)!
        return { name: f.name, data: await media.readFile(f.path) }
      })
    )
    let next = 0
    return out.map((s) => s ?? read[next++])
  }
  /** Pull the user's Etsy drafts into the app: the app's single-flight pull, else directly (one at a time per db). */
  async function pull(d: DraftDeps, o: OwnStoreDeps): Promise<DraftPullSummary> {
    if (d.pull) {
      const res = await d.pull()
      if (!res.ok) throw new Error(res.error)
      return res.value
    }
    const running = directPulls.get(d.db)
    if (running) return running
    const run = importEtsyDrafts({
      db: d.db,
      client: o.client,
      auth: { status: o.status },
      taxonomy: o.taxonomy,
      fetchImage:
        d.fetchImage ??
        ((url) =>
          downloadImage(url, {
            fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            timeoutMs: 30_000,
            retries: 2,
            maxBytes: MAX_IMAGE_BYTES
          })),
      now: d.now ?? Date.now
    }).finally(() => {
      directPulls.delete(d.db)
      changed()
    })
    directPulls.set(d.db, run)
    return run
  }
  /** Refused unless the sign-in has this OAuth scope (English, for the client). */
  const needScope = (o: OwnStoreDeps, scope: string, what: string): void => {
    if (missingScopes(o.status().scopes, [scope]).length) {
      throw new ToolInputError(
        `The user's Etsy sign-in lacks the "${scope}" permission needed to ${what}. Ask them to sign out and sign in to Etsy again in the app (the "Керувати" button in their own shop's header → "Вийти", then "Увійти через Etsy").`
      )
    }
  }

  return [
    {
      name: 'prepare_product',
      // A category_id is looked up in the seller taxonomy, which the cache fetches from Etsy on first use.
      openWorld: true,
      title: 'Prepare an Etsy listing draft in the app',
      readOnly: false,
      description:
        "Saves a listing draft INSIDE THE APP (its local database) — nothing is sent to Etsy. The user reviews and edits it in the app (the \"Чернетки\" button in the header of their own shop — it appears only once the user signed in to Etsy in the app, so ask a signed-out user to sign in via \"✏️ Мій магазин\" to see the draft) and sends it to Etsy themselves; the preferred way to propose a new listing. Without draft_id it creates a draft; with draft_id it updates that one (only the given fields change; photos/files, when given, replace that list — keep existing ones with {\"keep\": n}). A draft linked to an Etsy listing (already sent, or pulled from an Etsy draft — see `etsy` in list_prepared_products) can be edited too: it becomes changed_since_sent, and the Etsy listing changes only when the draft is sent again (send_prepared_product, or the user in the app). Same fields as create_product, all optional (defaults: digital, quantity 999 / 1 for physical, made_by i_did, made_when made_to_order, auto_renew true). Returns the draft; `problems` (Ukrainian) = what still blocks sending it as an Etsy draft — publishing also needs a photo and, for digital, a file. Saving needs neither the Etsy sign-in nor the 'allow changes' switch (only reviewing it in the app needs the sign-in); a category_id is looked up in Etsy's category tree for the `category` path.",
      inputSchema: {
        type: 'object',
        properties: { draft_id: { type: 'integer', minimum: 1, description: 'Update this draft instead of creating one.' }, ...DRAFT_FIELD_PROPS },
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = need()
          const existing = a.draft_id != null ? draftOf(d, a.draft_id) : null
          const fields = fieldsFrom(a, existing?.fields ?? normalizeDraftFields({}))
          if (a.category_id != null) fields.taxonomyPath = await categoryPath(fields.taxonomyId)
          const photos = a.photos != null ? await slots(a.photos, 'photo', existing?.photos ?? null) : undefined
          const files = a.files != null ? await slots(a.files, 'file', existing?.files ?? null) : undefined
          const saved = saveDraft(
            d.db,
            { id: existing?.id, source: existing?.source === 'app' ? 'app' : 'mcp', fields, photos, files },
            (d.now ?? Date.now)()
          )
          changed()
          const link = saved.etsy
          const note = !link
            ? 'Saved in the app as a draft for the user to review. Nothing was sent to Etsy.'
            : link.removed
              ? `Saved in the app only. Its Etsy listing #${link.listingId} was deleted on Etsy, so it can't be updated — to send this draft as a new listing, unlink it first (unlink_prepared_product, when the user wants that).`
              : `Saved in the app only — Etsy listing #${link.listingId} is unchanged until the draft is sent again (by the user in the app, or send_prepared_product when the user asks).`
          return textResult({ ...draftOut(saved), note })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'list_prepared_products',
      title: 'Listing drafts kept in the app',
      description:
        "Every listing draft in the app's local database, most recently changed first, all at once (no Etsy call): prepared_by (user, assistant, or etsy_site = pulled from a draft the user made on Etsy's site), the fields, photo/file names (files_only_on_etsy = buyer files that exist only on Etsy), `problems` (Ukrainian; what still blocks sending it as an Etsy draft) and the status — waiting_for_review (never sent), sent (linked to its Etsy listing and in sync), changed_since_sent (linked, with edits not yet on Etsy) or send_failed (last_error; the draft may be linked anyway). `etsy` is null for a draft never sent, else the linked Etsy listing: product_id, state (draft, active, inactive, expired, sold_out, or removed = deleted on Etsy; null = not known yet), unsent_changes, changed_on_etsy (the listing was changed on Etsy too since the last sync — sending would overwrite that), removed_on_etsy, url (the public page, only while active), edit_url (the user's Etsy listing editor), last_synced_at, etsy_updated_at, never_compared_with_etsy (sent by an older app version: the next send first answers a conflict — ask the user before overwriting), some_media_not_pulled (a sync couldn't fetch some photos/files from Etsy; a send keeps those on Etsy). What's shown is as of the last send or sync (sync_prepared_products refreshes it).",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => {
        try {
          const list = listDrafts(need().db)
          return textResult({ count: list.length, drafts: list.map(draftOut) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'sync_prepared_products',
      openWorld: true,
      title: "Pull the user's Etsy drafts into the app",
      readOnly: false,
      // Local only, but it overwrites unedited linked drafts with Etsy's version and drops pulled drafts deleted on Etsy.
      destructive: true,
      description:
        "Reads the user's own Etsy shop now (Etsy API, OAuth listings_r; needs the Etsy sign-in, not the 'allow changes' switch — nothing on Etsy is changed) and updates the drafts kept in the app: every Etsy draft listing not yet in the app becomes an app draft (prepared_by etsy_site, with its photos; its buyer files stay only on Etsy), linked drafts without unsent edits are refreshed from Etsy, linked drafts with unsent edits whose listing changed on Etsy are only marked changed_on_etsy (never overwritten), and linked drafts whose listing left Etsy's drafts get its current state (removed = deleted on Etsy; an unedited pulled draft is then dropped from the app). The app also does this after every scan of the user's shop. Returns {imported, updated, removed, conflicts, errors (Ukrainian, per listing)}; then see list_prepared_products.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        try {
          const d = need()
          const o = signedIn(own)
          const s = await pull(d, o)
          return textResult({
            imported: s.imported,
            updated: s.updated,
            removed: s.removed,
            conflicts: s.conflicts,
            errors: s.errors
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'unlink_prepared_product',
      title: 'Unlink an app draft from its Etsy listing',
      readOnly: false,
      destructive: true,
      description:
        "Makes the app forget which Etsy listing a draft was sent as (local only — the Etsy listing itself is not changed and stays on Etsy), so the next send_prepared_product creates a NEW Etsy listing instead of updating it — e.g. after the listing was deleted on Etsy (etsy.removed_on_etsy). Buyer files that exist only on Etsy can't be uploaded again, so they leave the draft (`notes` say which; the user must add them again). If the old listing still exists on Etsy, sending afterwards gives the shop two listings, and while it is still an Etsy draft the next sync pulls it into the app again as a separate draft — so only when the user asked. Returns the draft.",
      inputSchema: {
        type: 'object',
        properties: { draft_id: { type: 'integer', minimum: 1 } },
        required: ['draft_id'],
        additionalProperties: false
      },
      run: (a) => {
        try {
          const d = need()
          const draft = draftOf(d, a.draft_id)
          if (!draft.etsy) throw new ToolInputError(`Draft ${draft.id} is not linked to an Etsy listing (it was never sent).`)
          const listingId = draft.etsy.listingId
          const out = unlinkDraft(d.db, draft.id, (d.now ?? Date.now)())
          changed()
          return textResult({
            ...draftOut(out),
            unlinked_product_id: listingId,
            notes: out.notes ?? [],
            note: `Unlinked from Etsy listing #${listingId}, which stays on Etsy unchanged. Sending this draft now creates a new Etsy listing.`
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'delete_prepared_product',
      openWorld: true,
      title: 'Delete a draft kept in the app (and, if asked, its Etsy listing)',
      readOnly: false,
      destructive: true,
      description: `Deletes a draft and its photos/files from the app's local database — only when the user asked. By default Etsy is not touched: a listing already sent stays on Etsy (and if it is still an Etsy draft, the next sync pulls it into the app again as a new draft). also_on_etsy=true also deletes the linked Etsy listing, whatever its state (active ones too) — that can't be undone, so confirm with the user first; it changes the user's live Etsy shop (Etsy API deleteListing, OAuth listings_d) and so needs the Etsy sign-in and the app's "allow changes" switch. If Etsy refuses, the draft stays in the app (the error may be partly Ukrainian); a listing already gone from Etsy counts as deleted. A draft never sent, or whose listing was deleted on Etsy, is just deleted locally.`,
      inputSchema: {
        type: 'object',
        properties: {
          draft_id: { type: 'integer', minimum: 1 },
          also_on_etsy: { type: 'boolean', default: false, description: 'Also delete the linked Etsy listing (permanent).' }
        },
        required: ['draft_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = need()
          const draft = draftOf(d, a.draft_id)
          const link = draft.etsy && !draft.etsy.removed ? draft.etsy : null
          if (a.also_on_etsy && link) {
            const w = writable(own)
            needScope(w, 'listings_d', 'delete listings')
            const res = await deleteDraftEverywhere({ client: w.client, auth: { status: w.status }, db: d.db }, draft.id)
            if (!res.ok) {
              return {
                content: [{ type: 'text', text: JSON.stringify({ error: res.error, product_id: link.listingId, draft_kept: true }) }],
                isError: true
              }
            }
            changed()
            return textResult({ deleted: draft.id, deleted_on_etsy: res.value.deletedOnEtsy, product_id: link.listingId })
          }
          if (!deleteDraft(d.db, draft.id)) throw new ToolInputError(`No draft ${String(a.draft_id)}.`)
          changed()
          return textResult({
            deleted: draft.id,
            deleted_on_etsy: false,
            ...(link
              ? {
                  product_id: link.listingId,
                  note: `Deleted in the app only — Etsy listing #${link.listingId} stays on Etsy${link.state === 'draft' ? ' (still an Etsy draft: the next sync pulls it into the app again)' : ''}.`
                }
              : a.also_on_etsy
                ? {
                    note: draft.etsy
                      ? `Etsy listing #${draft.etsy.listingId} was already deleted on Etsy — nothing left to delete there.`
                      : 'The draft was never sent to Etsy — nothing to delete there.'
                  }
                : {})
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'send_prepared_product',
      openWorld: true,
      title: 'Send an app draft to Etsy (create, or update its listing)',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Sends a draft from the app to the user's own Etsy shop (Etsy API, OAuth listings_r + listings_w). A draft never sent: the same steps as create_product — creates an Etsy draft listing, uploads the draft's photos and files, and with publish=true publishes it. A draft already linked to an Etsy listing (etsy in list_prepared_products): UPDATES that listing to match the draft — never a second listing: title, description, tags, materials, category, who/when made, supply, auto-renew, type, shipping profile; price, quantity and processing profile (only for a listing without variations — otherwise a note says they were left alone); photos in the draft's order (new ones uploaded, ones not in the draft deleted from the listing) and buyer files the same way. A live (active) listing changes for buyers at once. publish=true also publishes a linked listing that isn't active (${FEE} — for an Etsy draft, expired or sold-out listing; an inactive one is reactivated for free); publish=false never deactivates. Publishing — or updating an active listing — needs a photo, and a file for digital. If the listing was changed on Etsy since the app last synced it (or the draft was sent by an older app version and was never compared with Etsy), nothing is written and the answer is {conflict: true, …}: tell the user and only with their agreement send again with overwrite_etsy_changes=true (that replaces the changes made on Etsy). A listing deleted on Etsy answers removed_on_etsy: true (unlink_prepared_product, then send, creates a new one). Success: {draft_id, action (created|updated), product_id (the Etsy listing id), status (its Etsy state), url (the public Etsy page — only when active, else null), edit_url (the listing in the user's Etsy listing editor), notes (Ukrainian; what wasn't or couldn't be done)}. Failure: {error, product_id, edit_url, …} — product_id is set when the Etsy listing exists; the steps already done are kept, so sending again continues without duplicates; the error may be partly Ukrainian. Usually the user sends drafts themselves after reviewing them; call this only when they ask you to.`,
      inputSchema: {
        type: 'object',
        properties: {
          draft_id: { type: 'integer', minimum: 1 },
          publish: { type: 'boolean', default: false },
          overwrite_etsy_changes: {
            type: 'boolean',
            default: false,
            description: 'Only after the user agreed: replace changes made on Etsy since the last sync (after a conflict answer).'
          }
        },
        required: ['draft_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = need()
          const w = writable(own)
          const id = Number(a.draft_id)
          const res = await sendDraft(
            { client: w.client, auth: { status: w.status }, db: d.db, now: d.now, describe: mcpErrorText },
            id,
            !!a.publish,
            { overwrite: a.overwrite_etsy_changes === true }
          )
          changed()
          if (!res.ok) {
            const out: Record<string, unknown> = {
              error: res.error,
              product_id: res.listingId ?? null,
              edit_url: res.listingId != null && !res.removedOnEtsy ? etsyListingEditUrl(res.listingId) : null
            }
            if (res.conflict) {
              out.conflict = true
              out.what_to_do =
                'Nothing was sent. The Etsy listing was changed (on Etsy or elsewhere) after the app last synced this draft. Tell the user; only if they agree to replace those Etsy changes with the draft, call send_prepared_product again with overwrite_etsy_changes=true.'
            }
            if (res.removedOnEtsy) {
              out.removed_on_etsy = true
              out.what_to_do =
                'The Etsy listing was deleted on Etsy, so it cannot be updated. If the user wants it as a new listing: unlink_prepared_product, then send_prepared_product.'
            }
            if (res.notes?.length) out.notes = res.notes
            return { content: [{ type: 'text', text: JSON.stringify(out) }], isError: true }
          }
          const state = getDraft(d.db, id)?.etsy?.state ?? (res.published ? 'active' : 'draft')
          return textResult({
            draft_id: id,
            action: res.updated ? 'updated' : 'created',
            product_id: res.listingId,
            status: state,
            // The public page exists only while active; the editor (drafts too) opens for the signed-in owner.
            url: state === 'active' ? etsyListingUrl(res.listingId) : null,
            edit_url: etsyListingEditUrl(res.listingId),
            notes: [...res.warnings, ...(res.notes ?? [])]
          })
        } catch (e) {
          return fail(e)
        }
      }
    }
  ]
}

/** Direct pulls (no app pull given) per database: one at a time. */
const directPulls = new WeakMap<Db, Promise<DraftPullSummary>>()

export function createStoreTools(deps: OwnStoreDeps | undefined): McpTool[] {
  return [
    {
      name: 'list_my_products',
      openWorld: true,
      title: 'My Etsy shop: listings (live)',
      description:
        "The user's OWN Etsy shop (is_mine in list_stores), read live from the Etsy API (OAuth listings_r; costs API quota): its listings in one status — active (default), draft, inactive, expired or sold_out — up to 100 per call (total = all in that status; page with offset). Each: id (Etsy listing id), status, title, description, tags, materials, auto_renew, product_type (digital / physical / both), price + currency (the seller's base price), quantity, updated_at, expires_at. Drafts and inactive listings are only here — scans store active listings only. Needs the Etsy sign-in.",
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS_VALUES, default: 'active' },
          offset: { type: 'integer', minimum: 0, default: 0, description: 'Listings to skip (pages of up to 100).' }
        },
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = signedIn(deps)
          const page = await listMyListings(myDeps(d), ((a.status as string) ?? 'active') as MyListingState, Number(a.offset ?? 0))
          return textResult({ store_id: d.shopId, status: page.state, total: page.total, offset: page.offset, products: page.listings.map(myProduct) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'find_categories',
      openWorld: true,
      title: 'Find Etsy categories',
      description:
        "Searches Etsy's seller category tree (read once per app run from the Etsy API with the API key, then cached; no sign-in needed) by words, e.g. \"planner\", \"wall art\": every word must occur in the category path (case-insensitive). Returns total and up to limit (default 30) {category_id, path \"A › B › C\"}, the deepest (most specific) first, then alphabetical. create_product / prepare_product need a category_id; pick the most specific match.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2, maxLength: 100 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 }
        },
        required: ['query'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          if (!deps) throw new ToolInputError(NOT_SIGNED_IN)
          const words = String(a.query).toLowerCase().split(/\s+/).filter(Boolean)
          const all = await deps.taxonomy()
          const hits = all.filter((t) => words.every((w) => t.path.toLowerCase().includes(w)))
          // Deeper (more specific) categories first.
          hits.sort((x, y) => y.path.split(' › ').length - x.path.split(' › ').length || x.path.localeCompare(y.path))
          return textResult({
            total: hits.length,
            categories: hits.slice(0, Number(a.limit ?? 30)).map((t) => ({ category_id: t.id, path: t.path }))
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'get_product_options',
      openWorld: true,
      title: 'Options for new Etsy listings',
      description:
        "What create_product / prepare_product accept: product types, the made_by and made_when values, limits (title length, tags, materials, photos, files, sizes) and Etsy's text rules — plus the user's own Etsy shop's shipping profiles and processing profiles, read live from the Etsy API (OAuth shops_r; null when Etsy didn't answer; a physical listing needs a shipping_profile_id). changes_allowed = whether the app's 'allow changes' switch is on (every tool that writes to Etsy needs it). Needs the Etsy sign-in.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        try {
          const d = signedIn(deps)
          const [shipping, processing] = await Promise.all([
            loadShippingOptions(myDeps(d)).catch(() => null),
            loadProcessingOptions(myDeps(d)).catch(() => null)
          ])
          return textResult({
            store_id: d.shopId,
            changes_allowed: d.writesAllowed(),
            product_types: ['digital', 'physical'],
            made_by: WHO_MADE.map((w) => w.value),
            made_when: WHEN_MADE.map((w) => w.value),
            limits: {
              title_max_chars: TITLE_MAX,
              max_tags: MAX_TAGS,
              tag_max_chars: TAG_MAX,
              max_materials: MAX_MATERIALS,
              max_photos: MAX_IMAGES,
              photo_formats: ['jpg', 'png', 'gif'],
              max_photo_mb: MAX_IMAGE_BYTES / 1024 / 1024,
              max_files: MAX_DIGITAL_FILES,
              max_file_mb: MAX_DIGITAL_FILE_BYTES / 1024 / 1024
            },
            rules: [
              'Title: letters, digits, punctuation, spaces; the characters % : & + at most once each.',
              'Tags: letters, digits, spaces, hyphen, apostrophe only.',
              'Materials: letters, digits and spaces only.',
              'Physical listings need a shipping profile and take no files; files are for digital listings only.',
              'Publishing needs at least one photo; a digital listing also needs at least one file. Etsy charges a listing fee (USD 0.20) when publishing.'
            ],
            shipping_profiles: shipping?.map((s) => ({ id: s.id, label: s.label })) ?? null,
            processing_profiles: processing?.map((s) => ({ id: s.id, label: s.label })) ?? null
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'create_product',
      openWorld: true,
      title: 'Create an Etsy listing',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Creates a listing in the user's own Etsy shop through the Etsy API (OAuth listings_w): an Etsy draft listing with the given fields, then the photos in order (first = main photo) and, for a digital listing, the files the buyer downloads; publish=true then publishes it (${FEE}; publishing needs a photo, and a file for digital). Everything is validated before the first call (problems in Ukrainian). Physical listings need shipping_profile_id and take no files. Use find_categories for category_id and get_product_options for the allowed values. Returns product_id (the Etsy listing id) and status; if a step fails after the draft exists, the error result is {error, product_id} — finish it with add_product_media / update_my_product. To propose a listing for the user to review first, use prepare_product instead.`,
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['digital', 'physical'], default: 'digital' },
          title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
          description: { type: 'string', minLength: 1 },
          price: { type: 'number', description: "In the Etsy shop's currency, e.g. 5.99 (at most 2 decimals)." },
          quantity: { type: 'integer', minimum: 1, maximum: 999, description: 'Default: 999 for digital, 1 for physical.' },
          category_id: { type: 'integer', minimum: 1, description: 'Etsy category id from find_categories.' },
          made_by: { type: 'string', enum: WHO_MADE.map((w) => w.value), default: 'i_did' },
          made_when: { type: 'string', enum: WHEN_MADE.map((w) => w.value), default: 'made_to_order' },
          is_supply: { type: 'boolean', default: false, description: 'A craft supply or tool rather than a finished product.' },
          tags: { type: 'array', items: { type: 'string' }, description: `Up to ${MAX_TAGS}, each ≤ ${TAG_MAX} chars.` },
          materials: { type: 'array', items: { type: 'string' }, description: `Up to ${MAX_MATERIALS}.` },
          auto_renew: { type: 'boolean', default: true },
          shipping_profile_id: { type: 'integer', minimum: 1, description: 'Required for physical listings (get_product_options).' },
          processing_profile_id: { type: 'integer', minimum: 1, description: 'Physical listings only, optional (get_product_options).' },
          photos: {
            type: 'array',
            items: MEDIA_ITEM,
            description: `Up to ${MAX_IMAGES} JPG/PNG/GIF, ≤ ${MAX_IMAGE_BYTES / 1024 / 1024} MB each; first = main photo.`
          },
          files: {
            type: 'array',
            items: MEDIA_ITEM,
            description: `Digital listings only: up to ${MAX_DIGITAL_FILES} files the buyer downloads, ≤ ${MAX_DIGITAL_FILE_BYTES / 1024 / 1024} MB each.`
          },
          publish: { type: 'boolean', default: false, description: 'false = leave an Etsy draft (default); true = publish now (listing fee).' }
        },
        required: ['title', 'description', 'price', 'category_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = writable(deps)
          const media = await resolveMedia(d, a.photos, a.files)
          const physical = a.type === 'physical'
          const input: NewListingInput = {
            type: physical ? 'physical' : 'download',
            title: String(a.title),
            description: String(a.description),
            price: String(a.price),
            quantity: a.quantity != null ? Number(a.quantity) : physical ? 1 : 999,
            taxonomyId: Number(a.category_id),
            whoMade: (a.made_by as string) ?? 'i_did',
            whenMade: (a.made_when as string) ?? 'made_to_order',
            isSupply: !!a.is_supply,
            tags: strings(a.tags, 'tags') ?? [],
            materials: strings(a.materials, 'materials') ?? [],
            shouldAutoRenew: a.auto_renew !== false,
            shippingProfileId: a.shipping_profile_id != null ? Number(a.shipping_profile_id) : null,
            readinessStateId: a.processing_profile_id != null ? Number(a.processing_profile_id) : null,
            images: media.photos,
            files: media.files,
            publish: !!a.publish
          }
          const res = await createMyListing(
            { ...myDeps(d), files: media.registry, readFile: media.readFile, describe: mcpErrorText },
            input
          )
          if (!res.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: res.error, product_id: res.listingId ?? null })
                }
              ],
              isError: true
            }
          }
          return textResult({
            product_id: res.listingId,
            status: res.published ? 'active' : 'draft',
            photos_uploaded: media.photos.length,
            files_uploaded: media.files.length,
            note: res.published
              ? "Published on Etsy. The app's scan data (search_products, get_product …) has it after the next scan of the shop."
              : 'Saved as an Etsy draft listing (not visible to buyers). Publish it with update_my_product status="active" (listing fee).'
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'update_my_product',
      openWorld: true,
      title: 'Edit an Etsy listing',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Edits a listing of the user's own Etsy shop through the Etsy API (updateListing, OAuth listings_w): only the given fields change; tags/materials replace the whole list (validated first, problems in Ukrainian). status "active" publishes a draft or reactivates an inactive/expired listing (publishing a draft or renewing an expired one: ${FEE}; a draft needs a photo), "inactive" hides it from buyers. Price and quantity: update_my_product_price / update_my_product_inventory. Returns the changed argument names (updated) and the listing as Etsy answered.`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1 },
          title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
          description: { type: 'string', minLength: 1 },
          tags: { type: 'array', items: { type: 'string' } },
          materials: { type: 'array', items: { type: 'string' } },
          auto_renew: { type: 'boolean' },
          status: { type: 'string', enum: ['active', 'inactive'] }
        },
        required: ['product_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = writable(deps)
          const patch: MyListingPatch = {}
          if (a.title != null) patch.title = String(a.title)
          if (a.description != null) patch.description = String(a.description)
          const tags = strings(a.tags, 'tags')
          if (tags) patch.tags = tags
          const materials = strings(a.materials, 'materials')
          if (materials) patch.materials = materials
          if (a.auto_renew != null) patch.shouldAutoRenew = !!a.auto_renew
          if (a.status != null) patch.state = a.status as 'active' | 'inactive'
          if (!Object.keys(patch).length) throw new ToolInputError('Nothing to change: give at least one field.')
          const l = await saveMyListing(myDeps(d), Number(a.product_id), patch)
          // The argument names the client sent (not our internal patch keys).
          const updated = (Object.keys(patch) as Array<keyof MyListingPatch>).map((k) => PATCH_ARG[k])
          return textResult({ updated, product: myProduct(l) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'add_product_media',
      openWorld: true,
      title: 'Add photos or files to an Etsy listing',
      readOnly: false,
      description: `${WRITE_NOTE} Uploads photos (JPG/PNG/GIF) and/or files the buyer downloads (digital listings only) to a listing of the user's own Etsy shop through the Etsy API (OAuth listings_r + listings_w) — e.g. to finish a draft. They are appended after the existing ones in the given order: it first reads the listing's photos / files to find the next position; at most ${MAX_IMAGES} photos and ${MAX_DIGITAL_FILES} files in total, ≤ ${MAX_IMAGE_BYTES / 1024 / 1024} MB each. Uploads go one by one; a failure stops and returns {error, uploaded} with what already went up. To replace or delete media use the *_my_product_photo / *_my_product_file tools.`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', minimum: 1 },
          photos: { type: 'array', items: MEDIA_ITEM },
          files: { type: 'array', items: MEDIA_ITEM }
        },
        required: ['product_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = writable(deps)
          const media = await resolveMedia(d, a.photos, a.files)
          if (!media.photos.length && !media.files.length) throw new ToolInputError('Give at least one photo or file.')
          const id = Number(a.product_id)
          const batches = [
            ['photo', media.photos.map((t) => media.registry.get(t)!)],
            ['file', media.files.map((t) => media.registry.get(t)!)]
          ] as const
          // Everything is checked before the first upload.
          for (const [kind, list] of batches) {
            for (const f of list) {
              if (kind === 'photo' && !/\.(jpe?g|png|gif)$/i.test(f.name)) throw new ToolInputError(`"${f.name}": photos must be JPG, PNG or GIF.`)
              const max = kind === 'photo' ? MAX_IMAGE_BYTES : MAX_DIGITAL_FILE_BYTES
              if (f.size > max) throw new ToolInputError(`"${f.name}" is larger than ${max / 1024 / 1024} MB.`)
            }
          }
          // Explicit ranks after the existing ones: the OAS default rank is 1,
          // so an upload without one would land first (and a batch reversed).
          const after = { photo: 0, file: 0 }
          if (media.photos.length) {
            const have = await existingRanks(d.client, `/v3/application/listings/${id}/images`, false)
            if (have.count + media.photos.length > MAX_IMAGES) {
              throw new ToolInputError(`An Etsy listing can have at most ${MAX_IMAGES} photos: this one has ${have.count}.`)
            }
            after.photo = have.last
          }
          if (media.files.length) {
            const have = await existingRanks(d.client, `/v3/application/shops/${d.shopId}/listings/${id}/files`, true)
            if (have.count + media.files.length > MAX_DIGITAL_FILES) {
              throw new ToolInputError(`An Etsy listing can have at most ${MAX_DIGITAL_FILES} files: this one has ${have.count}.`)
            }
            after.file = have.last
          }
          const done: string[] = []
          for (const [kind, list] of batches) {
            for (const [i, f] of list.entries()) {
              try {
                const data = await media.readFile(f.path)
                const up = { data, name: f.name, type: mimeOf(f.name), rank: after[kind] + i + 1 }
                if (kind === 'photo') await d.client.uploadListingImage(d.shopId, id, up)
                else await d.client.uploadListingFile(d.shopId, id, up)
                done.push(f.name)
              } catch (e) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ error: `${kind} "${f.name}" failed: ${mcpErrorText(e)}`, uploaded: done })
                    }
                  ],
                  isError: true
                }
              }
            }
          }
          return textResult({ product_id: id, uploaded: done })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'update_my_store',
      openWorld: true,
      title: 'Edit Etsy shop texts',
      readOnly: false,
      description: `${WRITE_NOTE} Changes texts of the user's own Etsy shop through the Etsy API (updateShop, OAuth shops_w): title (the shop's headline), announcement, sale_message (Etsy sends it to buyers after a purchase), digital_sale_message (to buyers of digital items), additional_policies (Etsy allows it only for shops located in the EU — the shop is read first to check). Only the given fields change. Returns these texts as Etsy answered. Logo, banner and other shop settings can't be changed here.`,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          announcement: { type: 'string' },
          sale_message: { type: 'string' },
          digital_sale_message: { type: 'string' },
          additional_policies: { type: 'string' }
        },
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = writable(deps)
          const patch = {
            ...(a.title != null ? { title: String(a.title) } : {}),
            ...(a.announcement != null ? { announcement: String(a.announcement) } : {}),
            ...(a.sale_message != null ? { saleMessage: String(a.sale_message) } : {}),
            ...(a.digital_sale_message != null ? { digitalSaleMessage: String(a.digital_sale_message) } : {}),
            ...(a.additional_policies != null ? { policyAdditional: String(a.additional_policies) } : {})
          }
          if (!Object.keys(patch).length) throw new ToolInputError('Nothing to change: give at least one field.')
          const p = await saveMyShop(myDeps(d), patch)
          return textResult({
            updated: Object.keys(a),
            store: {
              id: p.shopId,
              title: p.title,
              announcement: p.announcement,
              sale_message: p.saleMessage,
              digital_sale_message: p.digitalSaleMessage,
              additional_policies: p.policyAdditional
            }
          })
        } catch (e) {
          return fail(e)
        }
      }
    }
  ]
}
