// Editing the signed-in user's own shop: Etsy's field rules (from the OAS
// updateListing / updateShop descriptions) checked before anything is sent,
// and "only what changed" patches. Shared by the editor (renderer) and main,
// which validates again before calling Etsy.

import type { DraftFields, MyListing, MyListingPatch, MyListingState, MyShopPatch, MyShopProfile, NewListingInput } from './types'

export const TITLE_MAX = 140
export const MAX_TAGS = 13
export const TAG_MAX = 20
export const MAX_MATERIALS = 13

export const MY_LISTING_STATES: ReadonlyArray<{ value: MyListingState; label: string }> = [
  { value: 'active', label: 'Активні' },
  { value: 'draft', label: 'Чернетки' },
  { value: 'inactive', label: 'Неактивні' },
  { value: 'expired', label: 'Прострочені' },
  { value: 'sold_out', label: 'Розпродані' }
]

export const STATE_LABEL: Record<string, string> = {
  active: 'активний',
  draft: 'чернетка',
  inactive: 'неактивний',
  expired: 'прострочений',
  sold_out: 'розпроданий',
  removed: 'видалений',
  edit: 'редагується'
}

export function isMyListingState(v: unknown): v is MyListingState {
  return MY_LISTING_STATES.some((s) => s.value === v)
}

/** "a, b ,, c" → ['a', 'b', 'c'] (trimmed, empty dropped, duplicates dropped case-insensitively). */
export function splitList(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const v = part.trim().replace(/\s+/g, ' ')
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  return out
}

// Etsy: title — letters, numbers, punctuation, math symbols, spaces, ™©®; %, :, & and + once each.
const TITLE_BAD = /[^\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]/u
// tags — letters, numbers, spaces, -, ', ™, ©, ®
const TAG_BAD = /[^\p{L}\p{Nd}\p{Zs}\-'™©®]/u
// materials — letters, numbers, spaces
const MATERIAL_BAD = /[^\p{L}\p{Nd}\p{Zs}]/u

/** Problems with a title, in Ukrainian; [] = fine. */
export function titleProblems(title: string): string[] {
  const t = title.trim()
  const out: string[] = []
  if (!t) out.push('Назва не може бути порожньою.')
  if (t.length > TITLE_MAX) out.push(`Назва довша за ${TITLE_MAX} символів (${t.length}).`)
  const bad = t.match(TITLE_BAD)
  if (bad) out.push(`Назва містить недозволений символ «${bad[0]}».`)
  for (const c of ['%', ':', '&', '+']) {
    if (t.split(c).length - 1 > 1) out.push(`Символ «${c}» у назві можна використати лише один раз.`)
  }
  return out
}

export function tagProblems(tags: string[]): string[] {
  const out: string[] = []
  if (tags.length > MAX_TAGS) out.push(`Тегів може бути не більше ${MAX_TAGS} (зараз ${tags.length}).`)
  for (const t of tags) {
    if (t.length > TAG_MAX) out.push(`Тег «${t}» довший за ${TAG_MAX} символів.`)
    const bad = t.match(TAG_BAD)
    if (bad) out.push(`Тег «${t}» містить недозволений символ «${bad[0]}».`)
  }
  return out
}

export function materialProblems(materials: string[]): string[] {
  const out: string[] = []
  if (materials.length > MAX_MATERIALS) out.push(`Матеріалів може бути не більше ${MAX_MATERIALS}.`)
  for (const m of materials) {
    const bad = m.match(MATERIAL_BAD)
    if (bad) out.push(`Матеріал «${m}» містить недозволений символ «${bad[0]}» (лише літери, цифри й пробіли).`)
  }
  return out
}

/** Every problem of a patch (what main checks before calling Etsy). */
export function listingPatchProblems(p: MyListingPatch): string[] {
  return [
    ...(p.title !== undefined ? titleProblems(p.title) : []),
    ...(p.tags !== undefined ? tagProblems(p.tags) : []),
    ...(p.materials !== undefined ? materialProblems(p.materials) : []),
    ...(p.description !== undefined && !p.description.trim() ? ['Опис не може бути порожнім.'] : []),
    ...(p.state !== undefined && p.state !== 'active' && p.state !== 'inactive'
      ? ['Стан можна змінити лише на «активний» або «неактивний».']
      : [])
  ]
}

const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** What the editor's form changes compared with the listing: only those fields. */
export function listingPatch(
  l: MyListing,
  form: { title: string; description: string; tags: string; materials: string; shouldAutoRenew: boolean; state: string }
): MyListingPatch {
  const p: MyListingPatch = {}
  const title = form.title.trim()
  if (title !== l.title) p.title = title
  if (form.description !== l.description) p.description = form.description
  const tags = splitList(form.tags)
  if (!sameList(tags, l.tags)) p.tags = tags
  const materials = splitList(form.materials)
  if (!sameList(materials, l.materials)) p.materials = materials
  if (form.shouldAutoRenew !== (l.shouldAutoRenew ?? false)) p.shouldAutoRenew = form.shouldAutoRenew
  if (form.state !== l.state && (form.state === 'active' || form.state === 'inactive')) p.state = form.state
  return p
}

/** The updateListing form fields of a patch (Etsy's names). */
export function listingPatchForm(p: MyListingPatch): Record<string, string | boolean | string[]> {
  const f: Record<string, string | boolean | string[]> = {}
  if (p.title !== undefined) f.title = p.title
  if (p.description !== undefined) f.description = p.description
  if (p.tags !== undefined) f.tags = p.tags
  if (p.materials !== undefined) f.materials = p.materials
  if (p.shouldAutoRenew !== undefined) f.should_auto_renew = p.shouldAutoRenew
  if (p.state !== undefined) f.state = p.state
  return f
}

export const SHOP_FIELDS: ReadonlyArray<{ key: keyof MyShopPatch; form: string; label: string; multiline: boolean }> = [
  { key: 'title', form: 'title', label: 'Заголовок магазину', multiline: false },
  { key: 'announcement', form: 'announcement', label: 'Оголошення', multiline: true },
  { key: 'saleMessage', form: 'sale_message', label: 'Повідомлення покупцям (фізичні товари)', multiline: true },
  { key: 'digitalSaleMessage', form: 'digital_sale_message', label: 'Повідомлення покупцям (цифрові товари)', multiline: true },
  { key: 'policyAdditional', form: 'policy_additional', label: 'Додаткові політики (лише для магазинів у ЄС)', multiline: true }
]

/** Changed shop texts only; policy_additional never for shops outside the EU (Etsy errors). */
export function shopPatch(p: MyShopProfile, form: Record<keyof MyShopPatch, string>): MyShopPatch {
  const out: MyShopPatch = {}
  for (const f of SHOP_FIELDS) {
    if (f.key === 'policyAdditional' && !p.inEu) continue
    const v = f.key === 'title' ? form[f.key].trim() : form[f.key]
    if (v !== p[f.key]) out[f.key] = v
  }
  return out
}

export function shopPatchForm(p: MyShopPatch): Record<string, string> {
  const f: Record<string, string> = {}
  for (const s of SHOP_FIELDS) if (p[s.key] !== undefined) f[s.form] = p[s.key] as string
  return f
}

export function shopPatchProblems(p: MyShopPatch, inEu: boolean): string[] {
  const out: string[] = []
  if (p.policyAdditional !== undefined && !inEu) out.push('Додаткові політики Etsy дозволяє лише магазинам у ЄС.')
  return out
}

/** ISO 3166-1 alpha-2 codes of the EU member states. */
export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
])

// ------------------------------------------------------------- new listings

export const MAX_IMAGES = 10
export const MAX_DIGITAL_FILES = 5
/** Etsy's limit per digital file. */
export const MAX_DIGITAL_FILE_BYTES = 20 * 1024 * 1024
/** A sane cap for photos (Etsy recommends ~2000 px; bigger files only slow the upload). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif']
/** Video files the picker offers (listing videos; Etsy converts them). */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv']

export const WHO_MADE: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'i_did', label: 'Я' },
  { value: 'collective', label: 'Член моєї команди' },
  { value: 'someone_else', label: 'Інша компанія чи людина' }
]

/** Etsy's when_made values (OAS enum), newest first. */
export const WHEN_MADE: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'made_to_order', label: 'Виготовляю на замовлення' },
  { value: '2020_2026', label: '2020–2026' },
  { value: '2010_2019', label: '2010–2019' },
  { value: '2007_2009', label: '2007–2009' },
  { value: 'before_2007', label: 'До 2007' },
  { value: '2000_2006', label: '2000–2006' },
  { value: '1990s', label: '1990-ті' },
  { value: '1980s', label: '1980-ті' },
  { value: '1970s', label: '1970-ті' },
  { value: '1960s', label: '1960-ті' },
  { value: '1950s', label: '1950-ті' },
  { value: '1940s', label: '1940-ві' },
  { value: '1930s', label: '1930-ті' },
  { value: '1920s', label: '1920-ті' },
  { value: '1910s', label: '1910-ті' },
  { value: '1900s', label: '1900-ні' },
  { value: '1800s', label: '1800-ті' },
  { value: '1700s', label: '1700-ті' },
  { value: 'before_1700', label: 'До 1700' }
]

/** "5,99" / " 5.99 " → 5.99; null when it isn't a positive amount with ≤ 2 decimals. */
export function parsePrice(raw: string): number | null {
  const v = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  const n = Number(v)
  return n > 0 ? n : null
}

/** Every problem of a new listing (the form shows them; main checks again). */
export function newListingProblems(i: NewListingInput): string[] {
  const out = [...titleProblems(i.title), ...tagProblems(i.tags), ...materialProblems(i.materials)]
  if (!i.description.trim()) out.push('Опис не може бути порожнім.')
  if (parsePrice(i.price) == null) out.push('Ціна — додатне число, напр. 5,99 (можна з комою або крапкою).')
  if (!Number.isSafeInteger(i.quantity) || i.quantity < 1 || i.quantity > 999) out.push('Кількість — ціле число від 1 до 999.')
  if (i.taxonomyId == null) out.push('Виберіть категорію.')
  if (!WHO_MADE.some((w) => w.value === i.whoMade)) out.push('Виберіть, хто виготовив товар.')
  if (!WHEN_MADE.some((w) => w.value === i.whenMade)) out.push('Виберіть, коли виготовлено товар.')
  if (i.type === 'physical' && i.shippingProfileId == null) out.push('Фізичному товару потрібен профіль доставки.')
  if (i.type === 'download' && i.files.length === 0 && i.publish) {
    out.push('Щоб опублікувати цифровий товар, додайте хоча б один файл для покупця.')
  }
  if (i.type !== 'download' && i.files.length) out.push('Файли можна додати лише до цифрового товару.')
  if (i.files.length > MAX_DIGITAL_FILES) out.push(`Файлів може бути не більше ${MAX_DIGITAL_FILES}.`)
  if (i.images.length > MAX_IMAGES) out.push(`Фото може бути не більше ${MAX_IMAGES}.`)
  if (i.publish && i.images.length === 0) out.push('Щоб опублікувати, додайте хоча б одне фото (можна зберегти чернетку без фото).')
  return out
}

/** The createDraftListing form (Etsy's names). */
export function newListingForm(i: NewListingInput): Record<string, string | number | boolean | string[]> {
  const f: Record<string, string | number | boolean | string[]> = {
    title: i.title.trim(),
    description: i.description,
    price: parsePrice(i.price) ?? 0,
    quantity: i.quantity,
    who_made: i.whoMade,
    when_made: i.whenMade,
    is_supply: i.isSupply,
    taxonomy_id: i.taxonomyId ?? 0,
    type: i.type,
    should_auto_renew: i.shouldAutoRenew
  }
  if (i.tags.length) f.tags = i.tags
  if (i.materials.length) f.materials = i.materials
  if (i.type === 'physical' && i.shippingProfileId != null) f.shipping_profile_id = i.shippingProfileId
  if (i.type === 'physical' && i.readinessStateId != null) f.readiness_state_id = i.readinessStateId
  return f
}

// ------------------------------------------------------- drafts in the app

/**
 * updateListing's form for a draft linked to an Etsy listing (Etsy's names):
 * every DraftFields field updateListing takes. Price, quantity and the
 * processing profile (readiness_state_id) aren't among them — the OAS keeps
 * those on the inventory's offerings (updateListingInventory).
 */
export function draftUpdateForm(f: DraftFields): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {
    title: f.title.trim(),
    description: f.description,
    tags: f.tags,
    materials: f.materials,
    who_made: f.whoMade,
    when_made: f.whenMade,
    is_supply: f.isSupply,
    should_auto_renew: f.shouldAutoRenew,
    type: f.type
  }
  if (f.taxonomyId != null) out.taxonomy_id = f.taxonomyId
  if (f.type === 'physical' && f.shippingProfileId != null) out.shipping_profile_id = f.shippingProfileId
  return out
}

export const EMPTY_DRAFT_FIELDS: DraftFields = {
  type: 'download',
  title: '',
  description: '',
  price: '',
  quantity: 999,
  taxonomyId: null,
  taxonomyPath: null,
  whoMade: 'i_did',
  whenMade: 'made_to_order',
  isSupply: false,
  tags: [],
  materials: [],
  shouldAutoRenew: true,
  shippingProfileId: null,
  readinessStateId: null
}

/** A draft's fields + media as a NewListingInput (media as given tokens). */
export function draftInput(f: DraftFields, images: string[], files: string[], publish: boolean): NewListingInput {
  return {
    type: f.type,
    title: f.title,
    description: f.description,
    price: f.price,
    quantity: f.quantity,
    taxonomyId: f.taxonomyId,
    whoMade: f.whoMade,
    whenMade: f.whenMade,
    isSupply: f.isSupply,
    tags: f.tags,
    materials: f.materials,
    shouldAutoRenew: f.shouldAutoRenew,
    shippingProfileId: f.type === 'physical' ? f.shippingProfileId : null,
    readinessStateId: f.type === 'physical' ? f.readinessStateId : null,
    images,
    files: f.type === 'download' ? files : [],
    publish
  }
}

/** Stored fields of any age/shape → complete DraftFields (unknown keys dropped). */
export function normalizeDraftFields(raw: unknown): DraftFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DraftFields, unknown>>
  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const d = EMPTY_DRAFT_FIELDS
  return {
    type: r.type === 'physical' ? 'physical' : 'download',
    title: str(r.title),
    description: str(r.description),
    price: typeof r.price === 'number' ? String(r.price) : str(r.price),
    quantity: num(r.quantity) ?? d.quantity,
    taxonomyId: num(r.taxonomyId),
    taxonomyPath: typeof r.taxonomyPath === 'string' ? r.taxonomyPath : null,
    whoMade: str(r.whoMade, d.whoMade),
    whenMade: str(r.whenMade, d.whenMade),
    isSupply: r.isSupply === true,
    tags: list(r.tags),
    materials: list(r.materials),
    shouldAutoRenew: r.shouldAutoRenew !== false,
    shippingProfileId: num(r.shippingProfileId),
    readinessStateId: num(r.readinessStateId)
  }
}

// --------------------------------------------------------------- scopes

/** Ukrainian names of the OAuth scopes, for "sign in again to allow: …". */
export const SCOPE_LABEL: Record<string, string> = {
  listings_r: 'читання товарів',
  listings_w: 'редагування товарів',
  listings_d: 'видалення товарів',
  shops_r: 'читання налаштувань магазину',
  shops_w: 'зміну налаштувань магазину',
  transactions_r: 'замовлення й фінанси',
  transactions_w: 'позначення замовлень відправленими',
  email_r: 'email акаунта',
  address_r: 'адреси акаунта'
}

/** The scopes of `need` the sign-in lacks (empty = all there). */
export function missingScopes(have: readonly string[] | null | undefined, need: readonly string[]): string[] {
  const h = new Set(have ?? [])
  return need.filter((s) => !h.has(s))
}

/** A listing's public page on Etsy (only works once it is published). */
export function etsyListingUrl(listingId: number): string {
  return `https://www.etsy.com/listing/${listingId}`
}

/** A listing in the seller's own Etsy listing editor (drafts too) — opens for the signed-in owner. */
export function etsyListingEditUrl(listingId: number): string {
  return `https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`
}
