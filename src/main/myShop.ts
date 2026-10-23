// "Мій магазин": the signed-in user's own shop, read and edited through the
// OAuth token (etsyAuth.ts). Nothing here touches the tracking database: an
// edit shows up in the tracked data with the next scan of that shop.

import { randomBytes } from 'crypto'
import { extname } from 'path'
import type {
  CreateListingProgress,
  CreateListingResult,
  MyListing,
  MyListingPatch,
  MyListingState,
  MyListingsPage,
  MyShopPatch,
  MyShopProfile,
  NewListingInput,
  PickedFile,
  ShippingOption,
  TaxonomyOption
} from '../shared/types'
import { decodeHtmlEntities } from '../shared/html'
import { isEtsyCdnUrl } from '../shared/externalUrl'
import {
  EU_COUNTRIES,
  IMAGE_EXTENSIONS,
  MAX_DIGITAL_FILE_BYTES,
  MAX_IMAGE_BYTES,
  listingPatchForm,
  newListingForm,
  newListingProblems,
  listingPatchProblems,
  shopPatchForm,
  shopPatchProblems
} from '../shared/myShop'
import { mapMoney } from './mapEtsy'
import {
  EtsyApiError,
  type EtsyClient,
  type EtsyListing,
  type EtsyListingWithAssociations,
  type EtsyShop,
  type EtsyTaxonomyNode
} from './etsyApi'
import type { EtsyAuth } from './etsyAuth'

export interface MyShopDeps {
  client: EtsyClient
  auth: Pick<EtsyAuth, 'status'>
}

/** A Ukrainian message for a refused edit (validation) — shown as is. */
export class MyShopError extends Error {}

const text = (v: unknown): string => (v == null ? '' : decodeHtmlEntities(String(v)))
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => decodeHtmlEntities(String(x))) : [])

function ownShopId(deps: MyShopDeps): number {
  const st = deps.auth.status()
  if (!st.loggedIn) throw new EtsyApiError('not_signed_in', 'Увійдіть в Etsy («Мій магазин» → «Увійти через Etsy»), щоб змінювати свій магазин.')
  if (!st.shopId) throw new MyShopError('У цього акаунта Etsy немає магазину.')
  return st.shopId
}

export function toMyListing(l: EtsyListing | EtsyListingWithAssociations): MyListing {
  const price = mapMoney(l.price)
  const img = (l as EtsyListingWithAssociations).images
  const first = Array.isArray(img) && img.length ? [...img].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0] : null
  const thumb = first ? (first.url_170x135 ?? first.url_570xN ?? null) : null
  return {
    listingId: l.listing_id,
    state: String(l.state ?? ''),
    title: text(l.title),
    description: text(l.description),
    tags: list(l.tags),
    materials: list(l.materials),
    shouldAutoRenew: typeof l.should_auto_renew === 'boolean' ? l.should_auto_renew : null,
    type: l.listing_type ?? null,
    priceAmount: price?.amount ?? null,
    priceDivisor: price?.divisor ?? null,
    currency: l.price?.currency_code ?? null,
    quantity: typeof l.quantity === 'number' ? l.quantity : null,
    url: typeof l.url === 'string' ? l.url : null,
    imageUrl: thumb && isEtsyCdnUrl(thumb) ? thumb : null,
    updatedAt: l.updated_timestamp ?? l.last_modified_timestamp ?? null,
    endingAt: l.ending_timestamp ?? null
  }
}

export function toMyShopProfile(s: EtsyShop): MyShopProfile {
  const country = s.shop_location_country_iso ?? null
  return {
    shopId: s.shop_id,
    shopName: s.shop_name,
    title: text(s.title),
    announcement: text(s.announcement),
    saleMessage: text(s.sale_message),
    digitalSaleMessage: text(s.digital_sale_message),
    policyAdditional: text(s.policy_additional),
    inEu: !!country && EU_COUNTRIES.has(country),
    countryIso: country
  }
}

export async function loadMyShop(deps: MyShopDeps): Promise<MyShopProfile> {
  return toMyShopProfile(await deps.client.getShop(ownShopId(deps)))
}

export async function saveMyShop(deps: MyShopDeps, patch: MyShopPatch): Promise<MyShopProfile> {
  const shopId = ownShopId(deps)
  const current = toMyShopProfile(await deps.client.getShop(shopId))
  const problems = shopPatchProblems(patch, current.inEu)
  if (problems.length) throw new MyShopError(problems.join(' '))
  const form = shopPatchForm(patch)
  if (!Object.keys(form).length) return current
  return toMyShopProfile(await deps.client.updateShop(shopId, form))
}

export async function listMyListings(
  deps: MyShopDeps,
  state: MyListingState,
  offset = 0
): Promise<MyListingsPage> {
  const page = await deps.client.getShopListingsByState(ownShopId(deps), state, offset)
  return { state, total: Number(page.count) || 0, offset, listings: page.results.map(toMyListing) }
}

export async function saveMyListing(deps: MyShopDeps, listingId: number, patch: MyListingPatch): Promise<MyListing> {
  const shopId = ownShopId(deps)
  const problems = listingPatchProblems(patch)
  if (problems.length) throw new MyShopError(problems.join(' '))
  const form = listingPatchForm(patch)
  if (!Object.keys(form).length) throw new MyShopError('Нічого не змінено.')
  return toMyListing(await deps.client.updateListing(shopId, listingId, form))
}

/** A thrown error as the Ukrainian text the editor shows. */
export function myShopErrorMessage(e: unknown): string {
  if (e instanceof EtsyApiError || e instanceof MyShopError) return e.message
  return e instanceof Error ? e.message : String(e)
}

// ---------------------------------------------------------- new listings

/**
 * Files the user picked in the native dialog. The renderer only ever holds a
 * token, so it can't make main read an arbitrary path.
 */
export interface FileRegistry {
  add(path: string, name: string, size: number): PickedFile
  get(token: string): { path: string; name: string; size: number } | null
}

export function createFileRegistry(): FileRegistry {
  const files = new Map<string, { path: string; name: string; size: number }>()
  return {
    add(path, name, size) {
      const token = randomBytes(16).toString('hex')
      files.set(token, { path, name, size })
      return { token, name, size }
    },
    get: (token) => files.get(token) ?? null
  }
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  pdf: 'application/pdf',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv',
  txt: 'text/plain'
}

const extOf = (name: string): string => extname(name).slice(1).toLowerCase()
export const mimeOf = (name: string): string => MIME[extOf(name)] ?? 'application/octet-stream'

export interface CreateDeps extends MyShopDeps {
  files: FileRegistry
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer>>
  onProgress?: (p: CreateListingProgress) => void
  /** How an error reads inside the result's message (default: the UI's Ukrainian text). */
  describe?: (e: unknown) => string
}

/** Check the picked files behind the tokens (exist, type, size). */
function resolveUploads(deps: CreateDeps, input: NewListingInput) {
  const problems: string[] = []
  const pick = (tokens: string[], kind: 'image' | 'file') =>
    tokens.flatMap((t) => {
      const f = deps.files.get(t)
      if (!f) {
        problems.push('Вибраний файл більше недоступний — виберіть його ще раз.')
        return []
      }
      if (kind === 'image' && !IMAGE_EXTENSIONS.includes(extOf(f.name))) {
        problems.push(`«${f.name}»: фото має бути JPG, PNG або GIF.`)
      }
      const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_DIGITAL_FILE_BYTES
      if (f.size > max) problems.push(`«${f.name}» більший за ${Math.round(max / 1024 / 1024)} МБ.`)
      return [f]
    })
  return { images: pick(input.images, 'image'), files: pick(input.files, 'file'), problems }
}

/**
 * Create a listing: draft → photos → files → (optionally) publish. Each step is
 * one Etsy call; a failure after the draft exists still returns its id.
 */
export async function createMyListing(deps: CreateDeps, input: NewListingInput): Promise<CreateListingResult> {
  const describe = deps.describe ?? myShopErrorMessage
  let shopId: number
  try {
    shopId = ownShopId(deps)
  } catch (e) {
    return { ok: false, error: describe(e) }
  }
  const up = resolveUploads(deps, input)
  const problems = [...newListingProblems(input), ...up.problems]
  if (problems.length) return { ok: false, error: problems.join(' ') }

  const progress = (step: CreateListingProgress['step'], done: number, total: number, label: string): void =>
    deps.onProgress?.({ step, done, total, label })

  progress('draft', 0, 1, 'Створюю чернетку…')
  let listingId: number
  try {
    listingId = (await deps.client.createDraftListing(shopId, newListingForm(input))).listing_id
  } catch (e) {
    return { ok: false, error: `Не вдалося створити лістинг: ${describe(e)}` }
  }
  const failed = (what: string, e: unknown): CreateListingResult => ({
    ok: false,
    listingId,
    error: `Чернетку створено (#${listingId}), але ${what}: ${describe(e)} Допрацюйте її у «Керувати» → «Чернетки» або на Etsy.`
  })

  for (const [i, f] of up.images.entries()) {
    progress('images', i, up.images.length, `Фото ${i + 1} з ${up.images.length}…`)
    try {
      const data = await deps.readFile(f.path)
      await deps.client.uploadListingImage(shopId, listingId, { data, name: f.name, type: mimeOf(f.name), rank: i + 1 })
    } catch (e) {
      return failed(`фото «${f.name}» не завантажилось`, e)
    }
  }
  for (const [i, f] of up.files.entries()) {
    progress('files', i, up.files.length, `Файл ${i + 1} з ${up.files.length}…`)
    try {
      const data = await deps.readFile(f.path)
      await deps.client.uploadListingFile(shopId, listingId, { data, name: f.name, type: mimeOf(f.name), rank: i + 1 })
    } catch (e) {
      return failed(`файл «${f.name}» не завантажився`, e)
    }
  }
  if (input.publish) {
    progress('publish', 0, 1, 'Публікую…')
    try {
      await deps.client.updateListing(shopId, listingId, { state: 'active' })
    } catch (e) {
      return failed('опублікувати не вдалося', e)
    }
  }
  return { ok: true, listingId, published: input.publish, warnings: [] }
}

/** The category tree as searchable "A › B › C" paths, depth-first. */
export function flattenTaxonomy(nodes: EtsyTaxonomyNode[], prefix: string[] = []): TaxonomyOption[] {
  const out: TaxonomyOption[] = []
  for (const n of nodes) {
    const path = [...prefix, decodeHtmlEntities(String(n.name ?? ''))]
    out.push({ id: n.id, path: path.join(' › ') })
    if (Array.isArray(n.children) && n.children.length) out.push(...flattenTaxonomy(n.children, path))
  }
  return out
}

export function createTaxonomyCache(client: Pick<EtsyClient, 'getSellerTaxonomy'>): () => Promise<TaxonomyOption[]> {
  let cached: Promise<TaxonomyOption[]> | null = null
  return () => {
    if (!cached) {
      cached = client.getSellerTaxonomy().then((n) => flattenTaxonomy(n))
      cached.catch(() => {
        cached = null
      })
    }
    return cached
  }
}

export async function loadShippingOptions(deps: MyShopDeps): Promise<ShippingOption[]> {
  const list = await deps.client.getShippingProfiles(ownShopId(deps))
  return list
    .filter((p) => !p.is_deleted)
    .map((p) => ({
      id: p.shipping_profile_id,
      label: `${text(p.title) || `Профіль ${p.shipping_profile_id}`}${p.origin_country_iso ? ` (з ${p.origin_country_iso})` : ''}`
    }))
}

export async function loadProcessingOptions(deps: MyShopDeps): Promise<ShippingOption[]> {
  const list = await deps.client.getProcessingProfiles(ownShopId(deps))
  return list.map((p) => {
    const days =
      p.min_processing_days != null && p.max_processing_days != null
        ? `${p.min_processing_days}–${p.max_processing_days} дн.`
        : ''
    const kind = p.readiness_state === 'made_to_order' ? 'на замовлення' : p.readiness_state === 'ready_to_ship' ? 'готовий до відправки' : ''
    return {
      id: p.readiness_state_id,
      label: text(p.processing_days_display_label) || [kind, days].filter(Boolean).join(', ') || `Профіль ${p.readiness_state_id}`
    }
  })
}
