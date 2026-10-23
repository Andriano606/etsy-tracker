// MCP tools for the user's OWN store (signed in via "Мій магазин"): read its
// products in any state, find categories, and — only while the MCP modal's
// "Дозволити Claude змінювати мій магазин" is on — create and edit products,
// add photos/files, and edit the store texts. Same neutral vocabulary as
// mcpTools.ts: "store", "product", never the marketplace's name or links.

import { randomBytes } from 'crypto'
import { readFile, stat } from 'fs/promises'
import { basename, isAbsolute } from 'path'
import type {
  DraftFields,
  EtsyAuthStatus,
  ListingDraft,
  MyListing,
  MyListingPatch,
  MyListingState,
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
  normalizeDraftFields
} from '../shared/myShop'
import { priceValue } from '../shared/format'
import { EtsyApiError, type EtsyClient } from './etsyApi'
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
import { neutralText } from './neutral'
import type { Db } from './db'
import { type DraftMediaInput, deleteDraft, getDraft, listDrafts, saveDraft, sendDraft } from './drafts'

/** Drafts kept in the app: prepared over MCP, reviewed and sent by the user there. */
export interface DraftDeps {
  db: Db
  now?: () => number
  /** A draft changed (the app refreshes its list). */
  onChanged?: () => void
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
  'The user has not connected their own store in the app. Ask them to sign in: sidebar → "✏️ Мій магазин" → sign in.'
export const WRITES_OFF =
  'Changes to the store are switched off. Ask the user to enable "Дозволити Claude змінювати мій магазин" in the app (sidebar → MCP), then try again.'

/** Any error as a neutral English (or neutralized) text for the client. */
export function neutralError(e: unknown): string {
  if (e instanceof ToolInputError) return e.message
  if (e instanceof EtsyApiError) {
    const detail = e.detail ? `: ${neutralText(e.detail)}` : ''
    switch (e.kind) {
      case 'not_signed_in':
        return NOT_SIGNED_IN
      case 'oauth':
        return 'The sign-in to the user’s store has expired. Ask the user to sign in again in the app ("✏️ Мій магазин").'
      case 'forbidden':
        return `The store refused this action (HTTP 403)${detail}.`
      case 'bad_request':
        return `The store rejected the request as invalid (HTTP 400)${detail}.`
      case 'not_found':
        return `Not found (HTTP 404)${detail}.`
      case 'rate_limit':
        return 'Too many requests right now — try again in a minute.'
      case 'network':
        return 'No connection to the store service — try again.'
      case 'no_key':
        return 'The app has no API key configured.'
      default:
        return neutralText(e.message)
    }
  }
  return neutralText(e instanceof Error ? e.message : String(e))
}

const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: neutralError(e) }], isError: true })

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
    title: neutralText(l.title),
    description: neutralText(l.description),
    tags: l.tags.map((t) => neutralText(t)),
    materials: l.materials.map((m) => neutralText(m)),
    auto_renew: l.shouldAutoRenew,
    product_type: l.type === 'download' ? 'digital' : l.type,
    price: l.priceAmount != null && l.priceDivisor ? priceValue(l.priceAmount, l.priceDivisor) : null,
    currency: l.currency,
    quantity: l.quantity,
    updated_at: l.updatedAt != null ? new Date(l.updatedAt * 1000).toISOString() : null,
    expires_at: l.endingAt != null ? new Date(l.endingAt * 1000).toISOString() : null
  }
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
    'Either an absolute local file path ({"path": "/home/me/cover.jpg"}) or the content ({"data_base64": "…", "name": "cover.jpg"}).',
  properties: {
    path: { type: 'string', description: 'Absolute path of a local file.' },
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

const WRITE_NOTE = 'Changes the user’s live store — only call it when the user asked for this change.'

function draftOut(d: ListingDraft) {
  const f = d.fields
  return {
    draft_id: d.id,
    status: d.status === 'draft' ? 'waiting_for_review' : d.status === 'sent' ? 'sent' : 'send_failed',
    prepared_by: d.source === 'mcp' ? 'assistant' : 'user',
    type: f.type === 'download' ? 'digital' : 'physical',
    title: neutralText(f.title),
    description: neutralText(f.description),
    price: f.price,
    quantity: f.quantity,
    category_id: f.taxonomyId,
    category: neutralText(f.taxonomyPath),
    made_by: f.whoMade,
    made_when: f.whenMade,
    is_supply: f.isSupply,
    tags: f.tags.map((t) => neutralText(t)),
    materials: f.materials.map((m) => neutralText(m)),
    auto_renew: f.shouldAutoRenew,
    shipping_profile_id: f.shippingProfileId,
    processing_profile_id: f.readinessStateId,
    photos: d.photos.map((p) => p.name),
    files: d.files.map((p) => p.name),
    problems: d.problems.map((p) => neutralText(p)),
    sent_product_id: d.sentListingId,
    sent_published: d.sentPublished,
    last_error: neutralText(d.lastError),
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

const DRAFT_FIELD_PROPS: Record<string, JsonSchema> = {
  type: { type: 'string', enum: ['digital', 'physical'] },
  title: { type: 'string', maxLength: TITLE_MAX },
  description: { type: 'string' },
  price: { type: 'number', description: "In the store's currency, e.g. 5.99 (at most 2 decimals)." },
  quantity: { type: 'integer', minimum: 1, maximum: 999 },
  category_id: { type: 'integer', minimum: 1, description: 'From find_categories.' },
  made_by: { type: 'string', enum: WHO_MADE.map((w) => w.value) },
  made_when: { type: 'string', enum: WHEN_MADE.map((w) => w.value) },
  is_supply: { type: 'boolean' },
  tags: { type: 'array', items: { type: 'string' } },
  materials: { type: 'array', items: { type: 'string' } },
  auto_renew: { type: 'boolean' },
  shipping_profile_id: { type: 'integer', minimum: 1 },
  processing_profile_id: { type: 'integer', minimum: 1 },
  photos: { type: 'array', items: MEDIA_ITEM, description: `Up to ${MAX_IMAGES} JPG/PNG/GIF; replaces the draft's photos when given.` },
  files: { type: 'array', items: MEDIA_ITEM, description: `Digital products: up to ${MAX_DIGITAL_FILES}; replaces the draft's files when given.` }
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
  return [
    {
      name: 'prepare_product',
      title: 'Prepare a product for review',
      readOnly: false,
      description:
        "Prepares a product as a DRAFT INSIDE THE USER'S APP — nothing reaches the live store. The user reviews and edits it in the app (\"📝 Чернетки\") and sends it themselves; this is the preferred way to propose a new product. Without draft_id it creates a new draft; with draft_id it updates that one (only the given fields change; photos/files, when given, replace the lists). Takes the same fields as create_product (incomplete drafts are fine — the answer lists what is still missing). Works without the 'allow changes' switch.",
      inputSchema: {
        type: 'object',
        properties: { draft_id: { type: 'integer', minimum: 1, description: 'Update this draft instead of creating one.' }, ...DRAFT_FIELD_PROPS },
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = need()
          const existing = a.draft_id != null ? getDraft(d.db, Number(a.draft_id)) : null
          if (a.draft_id != null && !existing) throw new ToolInputError(`No draft ${String(a.draft_id)}.`)
          const fields = fieldsFrom(a, existing?.fields ?? normalizeDraftFields({}))
          if (a.category_id != null) fields.taxonomyPath = await categoryPath(fields.taxonomyId)
          let photos: DraftMediaInput[] | undefined
          let files: DraftMediaInput[] | undefined
          if (a.photos != null || a.files != null) {
            const media = await resolveMedia(own ?? ({} as OwnStoreDeps), a.photos, a.files)
            const read = async (tokens: string[]) =>
              Promise.all(
                tokens.map(async (t) => {
                  const f = media.registry.get(t)!
                  return { name: f.name, data: await media.readFile(f.path) }
                })
              )
            if (a.photos != null) photos = await read(media.photos)
            if (a.files != null) files = await read(media.files)
          }
          const saved = saveDraft(
            d.db,
            { id: existing?.id, source: existing?.source ?? 'mcp', fields, photos, files },
            (d.now ?? Date.now)()
          )
          changed()
          return textResult({
            ...draftOut(saved),
            note: 'Saved in the app as a draft for the user to review. Nothing was sent to the store.'
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'list_prepared_products',
      title: 'Drafts waiting for review',
      description:
        "The product drafts kept in the user's app (prepared by the user or by the assistant), newest first: their fields, photo/file names, what is still missing, and whether they were already sent to the store.",
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
      name: 'delete_prepared_product',
      title: 'Delete a draft',
      readOnly: false,
      description: "Deletes a draft kept in the user's app (it never touches the live store). Only when the user asked.",
      inputSchema: {
        type: 'object',
        properties: { draft_id: { type: 'integer', minimum: 1 } },
        required: ['draft_id'],
        additionalProperties: false
      },
      run: (a) => {
        try {
          if (!deleteDraft(need().db, Number(a.draft_id))) throw new ToolInputError(`No draft ${String(a.draft_id)}.`)
          changed()
          return textResult({ deleted: Number(a.draft_id) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'send_prepared_product',
      title: 'Send a draft to the store',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Sends a draft from the app to the user's store: as a store draft (publish=false, default) or published (a listing fee applies — ask first). Usually the user sends drafts themselves after reviewing them; call this only when they ask you to.`,
      inputSchema: {
        type: 'object',
        properties: { draft_id: { type: 'integer', minimum: 1 }, publish: { type: 'boolean', default: false } },
        required: ['draft_id'],
        additionalProperties: false
      },
      run: async (a) => {
        try {
          const d = need()
          const w = writable(own)
          const res = await sendDraft(
            { client: w.client, auth: { status: w.status }, db: d.db, now: d.now, describe: neutralError },
            Number(a.draft_id),
            !!a.publish
          )
          changed()
          if (!res.ok) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: neutralText(res.error), product_id: res.listingId ?? null }) }],
              isError: true
            }
          }
          return textResult({ draft_id: Number(a.draft_id), product_id: res.listingId, status: res.published ? 'active' : 'draft' })
        } catch (e) {
          return fail(e)
        }
      }
    }
  ]
}

export function createStoreTools(deps: OwnStoreDeps | undefined): McpTool[] {
  return [
    {
      name: 'list_my_products',
      title: 'My store: products',
      description:
        "The user's OWN store (the one marked is_mine in list_stores), read live: its products in one status — active, draft, inactive, expired or sold_out — with title, description, tags, materials, price, quantity, product type. Drafts and inactive products exist only here (snapshots cover active products).",
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS_VALUES, default: 'active' },
          offset: { type: 'integer', minimum: 0, default: 0, description: 'Products to skip (pages of up to 100).' }
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
      title: 'Find product categories',
      description:
        'Search the product category tree by words (e.g. "planner", "wall art") → category ids with their full path. create_product needs a category_id; pick the most specific matching one.',
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
            categories: hits.slice(0, Number(a.limit ?? 30)).map((t) => ({ category_id: t.id, path: neutralText(t.path) }))
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'get_product_options',
      title: 'Options for new products',
      description:
        "What create_product accepts: the made_by and made_when values, the limits (title length, tags, photos, files), and the user's store shipping profiles and processing profiles (physical products need a shipping profile). Also says whether changes are currently allowed.",
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
              'Publishing needs at least one photo; a digital product also needs at least one file. A listing fee applies when publishing.'
            ],
            shipping_profiles: shipping?.map((s) => ({ id: s.id, label: neutralText(s.label) })) ?? null,
            processing_profiles: processing?.map((s) => ({ id: s.id, label: neutralText(s.label) })) ?? null
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'create_product',
      title: 'Create a product',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Creates a product in the user's own store: a draft with the given texts, price and category, then uploads the photos (first = main photo) and, for a digital product, the files the buyer receives; publish=true makes it live right away (a listing fee applies — ask the user before publishing). Use find_categories for category_id and get_product_options for the allowed values. If something fails after the draft was created, the error says the draft's product_id; finish it with add_product_media / update_my_product.`,
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['digital', 'physical'], default: 'digital' },
          title: { type: 'string', minLength: 1, maxLength: TITLE_MAX },
          description: { type: 'string', minLength: 1 },
          price: { type: 'number', description: "In the store's currency, e.g. 5.99 (at most 2 decimals)." },
          quantity: { type: 'integer', minimum: 1, maximum: 999, description: 'Default: 999 for digital, 1 for physical.' },
          category_id: { type: 'integer', minimum: 1, description: 'From find_categories.' },
          made_by: { type: 'string', enum: WHO_MADE.map((w) => w.value), default: 'i_did' },
          made_when: { type: 'string', enum: WHEN_MADE.map((w) => w.value), default: 'made_to_order' },
          is_supply: { type: 'boolean', default: false, description: 'A craft supply or tool rather than a finished product.' },
          tags: { type: 'array', items: { type: 'string' }, description: `Up to ${MAX_TAGS}, each ≤ ${TAG_MAX} chars.` },
          materials: { type: 'array', items: { type: 'string' } },
          auto_renew: { type: 'boolean', default: true },
          shipping_profile_id: { type: 'integer', minimum: 1, description: 'Required for physical products (get_product_options).' },
          processing_profile_id: { type: 'integer', minimum: 1, description: 'Physical products (get_product_options).' },
          photos: { type: 'array', items: MEDIA_ITEM, description: `Up to ${MAX_IMAGES} JPG/PNG/GIF.` },
          files: { type: 'array', items: MEDIA_ITEM, description: `Digital products: up to ${MAX_DIGITAL_FILES} files the buyer downloads.` },
          publish: { type: 'boolean', default: false, description: 'false = leave a draft (default); true = publish now (listing fee).' }
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
            { ...myDeps(d), files: media.registry, readFile: media.readFile, describe: neutralError },
            input
          )
          if (!res.ok) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: neutralText(res.error), product_id: res.listingId ?? null })
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
              ? 'Published. It appears in the snapshot data after the next snapshot of the store.'
              : 'Saved as a draft (not visible to buyers). Publish it with update_my_product status="active".'
          })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'update_my_product',
      title: 'Edit a product',
      readOnly: false,
      destructive: true,
      description: `${WRITE_NOTE} Changes a product of the user's own store: only the given fields change. status "active" publishes a draft / reactivates (a listing fee may apply — ask the user first), "inactive" hides it from buyers. tags/materials replace the whole list. Price and quantity can't be changed here.`,
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
          return textResult({ updated: Object.keys(patch), product: myProduct(l) })
        } catch (e) {
          return fail(e)
        }
      }
    },
    {
      name: 'add_product_media',
      title: 'Add photos or files to a product',
      readOnly: false,
      description: `${WRITE_NOTE} Uploads photos (JPG/PNG/GIF, appended after the existing ones) and/or buyer files (digital products) to a product of the user's own store — e.g. to finish a draft.`,
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
          const done: string[] = []
          for (const [kind, tokens] of [['photo', media.photos], ['file', media.files]] as const) {
            for (const t of tokens) {
              const f = media.registry.get(t)!
              if (kind === 'photo' && !/\.(jpe?g|png|gif)$/i.test(f.name)) throw new ToolInputError(`"${f.name}": photos must be JPG, PNG or GIF.`)
              const max = kind === 'photo' ? MAX_IMAGE_BYTES : MAX_DIGITAL_FILE_BYTES
              if (f.size > max) throw new ToolInputError(`"${f.name}" is larger than ${max / 1024 / 1024} MB.`)
              try {
                const data = await media.readFile(f.path)
                const up = { data, name: f.name, type: mimeOf(f.name) }
                if (kind === 'photo') await d.client.uploadListingImage(d.shopId, id, up)
                else await d.client.uploadListingFile(d.shopId, id, up)
                done.push(f.name)
              } catch (e) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({ error: `${kind} "${f.name}" failed: ${neutralError(e)}`, uploaded: done })
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
      title: 'Edit store texts',
      readOnly: false,
      description: `${WRITE_NOTE} Changes the texts of the user's own store: title (headline), announcement, sale_message (to buyers of physical products), digital_sale_message, additional_policies (allowed only for stores located in the EU). Only the given fields change. The logo and banner can't be changed this way.`,
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
              title: neutralText(p.title),
              announcement: neutralText(p.announcement),
              sale_message: neutralText(p.saleMessage),
              digital_sale_message: neutralText(p.digitalSaleMessage),
              additional_policies: neutralText(p.policyAdditional)
            }
          })
        } catch (e) {
          return fail(e)
        }
      }
    }
  ]
}
