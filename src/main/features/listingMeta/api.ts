// The Etsy side of feature "listingMeta" (paths, bodies and answers from the
// OAS): category properties, a listing's properties, personalization,
// translations, deleteListing. Shared by the IPC actions and the MCP tools.

import {
  type CategoryProperty,
  type ListingAttributes,
  type ListingProperty,
  type ListingTranslation,
  type PersonalizationQuestion,
  type PropertyInput,
  type PropertyValueOption,
  type TranslationInput,
  isPersonalizationType,
  personalizationProblems,
  propertyProblems,
  translationProblems
} from '../../../shared/features/listingMeta'
import { priceValue } from '../../../shared/format'
import { decodeHtmlEntities } from '../../../shared/html'
import type { TaxonomyOption } from '../../../shared/types'
import { EtsyApiError, type EtsyClient, type Paged } from '../../etsyApi'
import { FeatureError } from '../common'

const A = '/v3/application'

// ------------------------------------------------------------- Etsy shapes

interface EtsyScale {
  scale_id: number
  display_name?: string | null
  description?: string | null
}

interface EtsyPropertyValue {
  value_id?: number | null
  name?: string | null
  scale_id?: number | null
  equal_to?: number[] | null
}

export interface EtsyTaxonomyProperty {
  property_id: number
  name?: string | null
  display_name?: string | null
  scales?: EtsyScale[] | null
  is_required?: boolean
  supports_attributes?: boolean
  supports_variations?: boolean
  is_multivalued?: boolean
  max_values_allowed?: number | null
  possible_values?: EtsyPropertyValue[] | null
  selected_values?: EtsyPropertyValue[] | null
}

export interface EtsyListingPropertyValue {
  property_id: number
  property_name?: string | null
  scale_id?: number | null
  scale_name?: string | null
  value_ids?: number[] | null
  values?: string[] | null
}

interface EtsyMoney {
  amount: number
  divisor: number
  currency_code?: string | null
}

export interface EtsyPersonalizationQuestion {
  question_id?: number | null
  question_text?: string | null
  instructions?: string | null
  question_type?: string | null
  required?: boolean
  max_allowed_characters?: number | null
  max_allowed_files?: number | null
  add_on_price?: EtsyMoney | null
  options?: Array<{ option_id?: number | null; label?: string | null }> | null
}

interface EtsyPersonalization {
  personalization_questions?: EtsyPersonalizationQuestion[] | null
}

export interface EtsyListingTranslation {
  listing_id: number
  language: string
  title?: string | null
  description?: string | null
  tags?: string[] | null
}

// ------------------------------------------------------------------ mapping

const txt = (v: unknown): string | null => (v == null || v === '' ? null : decodeHtmlEntities(String(v)))
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : [])
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((s) => decodeHtmlEntities(String(s))) : [])
const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function toValueOption(v: EtsyPropertyValue): PropertyValueOption {
  return { id: intOrNull(v.value_id), name: txt(v.name) ?? '', scaleId: intOrNull(v.scale_id), equalTo: nums(v.equal_to) }
}

export function toCategoryProperty(p: EtsyTaxonomyProperty): CategoryProperty {
  const name = txt(p.name) ?? `#${p.property_id}`
  return {
    id: p.property_id,
    name,
    displayName: txt(p.display_name) ?? name,
    scales: (p.scales ?? []).map((s) => ({
      id: s.scale_id,
      name: txt(s.display_name) ?? `#${s.scale_id}`,
      description: txt(s.description)
    })),
    isRequired: !!p.is_required,
    supportsAttributes: !!p.supports_attributes,
    supportsVariations: !!p.supports_variations,
    isMultivalued: !!p.is_multivalued,
    maxValuesAllowed: intOrNull(p.max_values_allowed),
    possibleValues: (p.possible_values ?? []).map(toValueOption),
    selectedValues: (p.selected_values ?? []).map(toValueOption)
  }
}

export function toListingProperty(v: EtsyListingPropertyValue): ListingProperty {
  return {
    propertyId: v.property_id,
    name: txt(v.property_name),
    scaleId: intOrNull(v.scale_id),
    scaleName: txt(v.scale_name),
    valueIds: nums(v.value_ids),
    values: strs(v.values)
  }
}

/** An unknown question_type is kept in `unsupportedType` (saving it is refused rather than rewritten). */
export function toQuestion(q: EtsyPersonalizationQuestion): PersonalizationQuestion {
  const price = q.add_on_price
  const type = q.question_type
  const out: PersonalizationQuestion = {
    id: intOrNull(q.question_id),
    text: txt(q.question_text) ?? '',
    instructions: txt(q.instructions),
    type: isPersonalizationType(type) ? type : 'text_input',
    required: !!q.required,
    maxChars: intOrNull(q.max_allowed_characters),
    maxFiles: intOrNull(q.max_allowed_files),
    options: (q.options ?? []).map((o) => ({ id: intOrNull(o.option_id), label: txt(o.label) ?? '' })),
    addOnPrice: price && typeof price.amount === 'number' ? priceValue(price.amount, price.divisor) : null,
    addOnCurrency: price?.currency_code ?? null
  }
  return isPersonalizationType(type) ? out : { ...out, unsupportedType: type || '—' }
}

export function toTranslation(t: EtsyListingTranslation): ListingTranslation {
  return {
    listingId: t.listing_id,
    language: t.language,
    title: txt(t.title),
    description: txt(t.description),
    tags: strs(t.tags)
  }
}

const isNotFound = (e: unknown): boolean => e instanceof EtsyApiError && e.kind === 'not_found'

// --------------------------------------------------------------- attributes

/** getPropertiesByTaxonomyId (API key only): the attributes a seller category supports. */
export async function categoryProperties(client: EtsyClient, taxonomyId: number): Promise<CategoryProperty[]> {
  const page = await client.call<Paged<EtsyTaxonomyProperty>>(`${A}/seller-taxonomy/nodes/${taxonomyId}/properties`, {
    query: { supports_attributes: true }
  })
  return (page?.results ?? []).map(toCategoryProperty)
}

/** getListingProperties (API key only). */
export async function listingProperties(client: EtsyClient, shopId: number, listingId: number): Promise<ListingProperty[]> {
  const page = await client.call<Paged<EtsyListingPropertyValue>>(`${A}/shops/${shopId}/listings/${listingId}/properties`)
  return (page?.results ?? []).map(toListingProperty)
}

/**
 * One property of a listing (null = not set), picked from getListingProperties:
 * the OAS says getListingProperty "will only return a 501 response", and the
 * client retries a 5xx with backoff.
 */
export async function listingProperty(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  propertyId: number
): Promise<ListingProperty | null> {
  return (await listingProperties(client, shopId, listingId)).find((p) => p.propertyId === propertyId) ?? null
}

/** The listing's category (getListing, API key only); null when Etsy doesn't show the listing. */
export async function listingTaxonomyId(client: EtsyClient, listingId: number): Promise<number | null> {
  try {
    const l = await client.call<{ taxonomy_id?: number | null }>(`${A}/listings/${listingId}`)
    return intOrNull(l?.taxonomy_id) || null
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}

/** Everything the "Атрибути" section shows; `taxonomyId` given = that category (skips getListing). */
export async function loadAttributes(
  client: EtsyClient,
  taxonomy: () => Promise<TaxonomyOption[]>,
  shopId: number,
  listingId: number,
  taxonomyId: number | null
): Promise<ListingAttributes> {
  const tax = taxonomyId ?? (await listingTaxonomyId(client, listingId))
  const properties = await listingProperties(client, shopId, listingId)
  if (tax == null) {
    return {
      listingId,
      taxonomyId: null,
      categoryPath: null,
      properties,
      definitions: null,
      note: 'Etsy не показав категорію цього лістингу (можливо, це чернетка) — виберіть категорію вручну.'
    }
  }
  const definitions = await categoryProperties(client, tax)
  const categoryPath = await taxonomy()
    .then((all) => all.find((t) => t.id === tax)?.path ?? null)
    .catch(() => null)
  return { listingId, taxonomyId: tax, categoryPath, properties, definitions, note: null }
}

export function checkProperty(p: PropertyInput): PropertyInput {
  const problems = propertyProblems(p)
  if (problems.length) throw new FeatureError(problems.join(' '))
  return { valueIds: p.valueIds, values: p.values.map((v) => v.trim()), scaleId: p.scaleId }
}

/** updateListingProperty (OAuth listings_w): form body value_ids, values (both required), scale_id. */
export async function saveProperty(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  propertyId: number,
  input: PropertyInput
): Promise<ListingProperty> {
  const p = checkProperty(input)
  const res = await client.call<EtsyListingPropertyValue>(`${A}/shops/${shopId}/listings/${listingId}/properties/${propertyId}`, {
    method: 'PUT',
    oauth: true,
    form: { value_ids: p.valueIds, values: p.values, scale_id: p.scaleId ?? undefined }
  })
  return res ? toListingProperty(res) : { propertyId, name: null, scaleId: p.scaleId, scaleName: null, valueIds: p.valueIds, values: p.values }
}

/** deleteListingProperty (OAuth listings_w). */
export async function removeProperty(client: EtsyClient, shopId: number, listingId: number, propertyId: number): Promise<void> {
  await client.call(`${A}/shops/${shopId}/listings/${listingId}/properties/${propertyId}`, { method: 'DELETE', oauth: true })
}

// ---------------------------------------------------------- personalization

/** getListingPersonalization (API key only). */
export async function loadPersonalization(client: EtsyClient, listingId: number): Promise<PersonalizationQuestion[]> {
  const r = await client.call<EtsyPersonalization>(`${A}/listings/${listingId}/personalization`)
  return (r?.personalization_questions ?? []).map(toQuestion)
}

/** The OAS request item of one question: only the fields its type allows. */
export function questionBody(q: PersonalizationQuestion): Record<string, unknown> {
  const withOptions = q.type === 'dropdown' || q.type === 'labeled_upload'
  const upload = q.type === 'unlabeled_upload' || q.type === 'labeled_upload'
  return {
    question_id: q.id ?? undefined,
    question_text: q.text.trim(),
    instructions: q.type !== 'dropdown' && q.instructions?.trim() ? q.instructions.trim() : undefined,
    question_type: q.type,
    required: q.required,
    max_allowed_characters: q.type === 'text_input' && q.maxChars != null ? q.maxChars : undefined,
    max_allowed_files: upload && q.maxFiles != null ? q.maxFiles : undefined,
    options: withOptions ? q.options.map((o) => ({ option_id: o.id ?? undefined, label: o.label.trim() })) : undefined,
    add_on_price: q.type === 'text_input' && !q.required && q.addOnPrice != null ? q.addOnPrice : undefined
  }
}

/**
 * updateListingPersonalization (OAuth listings_w): JSON body, fully replaces
 * the listing's questions. We send supports_multiple_personalization_questions
 * — this editor handles every type and up to 5 questions, as the OAS requires.
 */
export async function savePersonalization(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  questions: PersonalizationQuestion[]
): Promise<PersonalizationQuestion[]> {
  const problems = personalizationProblems(questions)
  if (problems.length) throw new FeatureError(problems.join(' '))
  const r = await client.call<EtsyPersonalization>(`${A}/shops/${shopId}/listings/${listingId}/personalization`, {
    method: 'POST',
    oauth: true,
    query: { supports_multiple_personalization_questions: true },
    json: { personalization_questions: questions.map(questionBody) }
  })
  return (r?.personalization_questions ?? []).map(toQuestion)
}

/** deleteListingPersonalization (OAuth listings_w). */
export async function removePersonalization(client: EtsyClient, shopId: number, listingId: number): Promise<void> {
  await client.call(`${A}/shops/${shopId}/listings/${listingId}/personalization`, { method: 'DELETE', oauth: true })
}

/** Questions from the renderer (the shared shape), checked field by field. */
export function parseQuestions(raw: unknown): PersonalizationQuestion[] {
  if (!Array.isArray(raw)) throw new FeatureError('Питання мають бути списком.')
  return raw.map((q, i) => {
    if (!q || typeof q !== 'object') throw new FeatureError(`Питання ${i + 1}: некоректні дані.`)
    const o = q as Record<string, unknown>
    const optNum = (k: string): number | null => (o[k] == null ? null : Number(o[k]))
    const optId = (v: unknown): number | null => {
      if (v == null) return null
      const n = Number(v)
      if (!Number.isSafeInteger(n) || n <= 0) throw new FeatureError(`Питання ${i + 1}: некоректний ідентифікатор.`)
      return n
    }
    if (!isPersonalizationType(o.type) || o.unsupportedType != null) throw new FeatureError(`Питання ${i + 1}: невідомий тип.`)
    const options = o.options == null ? [] : o.options
    if (!Array.isArray(options)) throw new FeatureError(`Питання ${i + 1}: варіанти мають бути списком.`)
    return {
      id: optId(o.id),
      text: String(o.text ?? ''),
      instructions: o.instructions == null ? null : String(o.instructions),
      type: o.type,
      required: o.required === true,
      maxChars: optNum('maxChars'),
      maxFiles: optNum('maxFiles'),
      options: options.map((x) => {
        const op = (x ?? {}) as Record<string, unknown>
        return { id: optId(op.id), label: String(op.label ?? '') }
      }),
      addOnPrice: optNum('addOnPrice'),
      addOnCurrency: null
    }
  })
}

// ------------------------------------------------------------- translations

const translationPath = (shopId: number, listingId: number, language: string): string =>
  `${A}/shops/${shopId}/listings/${listingId}/translations/${encodeURIComponent(language)}`

/** getListingTranslation (API key only); null = no translation in that language yet (404). */
export async function loadTranslation(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  language: string
): Promise<ListingTranslation | null> {
  try {
    return toTranslation(await client.call<EtsyListingTranslation>(translationPath(shopId, listingId, language)))
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}

/** The trimmed input, or a FeatureError with every problem. */
export function checkTranslation(input: TranslationInput): TranslationInput {
  const t = { title: input.title.trim(), description: input.description.trim(), tags: input.tags.map((x) => x.trim()) }
  const problems = translationProblems(t)
  if (problems.length) throw new FeatureError(problems.join(' '))
  return t
}

/**
 * createListingTranslation (POST) or updateListingTranslation (PUT), OAuth
 * listings_w, form body title, description, tags. `exists` unknown = read it first.
 */
export async function saveTranslation(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  language: string,
  input: TranslationInput,
  exists?: boolean
): Promise<ListingTranslation> {
  const t = checkTranslation(input)
  const update = exists ?? (await loadTranslation(client, shopId, listingId, language)) != null
  const r = await client.call<EtsyListingTranslation>(translationPath(shopId, listingId, language), {
    method: update ? 'PUT' : 'POST',
    oauth: true,
    // tags are optional: an empty list is left out (the existing tags stay) — the OAS
    // documents no way to clear them, so an empty value is never sent.
    form: { title: t.title, description: t.description, tags: t.tags.length ? t.tags : undefined }
  })
  return r ? toTranslation(r) : { listingId, language, ...t }
}

// ------------------------------------------------------------------- delete

/** deleteListing (OAuth listings_d). */
export async function deleteListing(client: EtsyClient, listingId: number): Promise<void> {
  await client.call(`${A}/listings/${listingId}`, { method: 'DELETE', oauth: true })
}
