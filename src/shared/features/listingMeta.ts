// Feature "listingMeta": the own listings' attributes (category properties),
// personalization questions, translations, and deleting a listing. Shared
// types, the rules checked before anything is sent (from the OAS request
// bodies), and the Ukrainian tool list for the MCP modal.

import { TITLE_MAX, tagProblems } from '../myShop'

// ------------------------------------------------------------- attributes

/** A measurement scale of a category property (e.g. shoe size "US/Canada"). */
export interface PropertyScale {
  id: number
  name: string
  description: string | null
}

/** One allowed value of a category property. */
export interface PropertyValueOption {
  /** null: Etsy lists the value without an id. */
  id: number | null
  name: string
  scaleId: number | null
  /** Ids of values this one equals (other scales). */
  equalTo: number[]
}

/** getPropertiesByTaxonomyId: an attribute a seller category supports. */
export interface CategoryProperty {
  id: number
  name: string
  displayName: string
  scales: PropertyScale[]
  isRequired: boolean
  supportsAttributes: boolean
  supportsVariations: boolean
  isMultivalued: boolean
  maxValuesAllowed: number | null
  possibleValues: PropertyValueOption[]
  /** Values Etsy always selects for this property. */
  selectedValues: PropertyValueOption[]
}

/** getListingProperties: an attribute set on a listing. */
export interface ListingProperty {
  propertyId: number
  name: string | null
  scaleId: number | null
  scaleName: string | null
  valueIds: number[]
  values: string[]
}

/** The "Атрибути" section: what is set + what the listing's category offers. */
export interface ListingAttributes {
  listingId: number
  /** null = the category couldn't be read (pick one by hand). */
  taxonomyId: number | null
  /** "A › B › C", null when unknown. */
  categoryPath: string | null
  properties: ListingProperty[]
  /** null = no category known. */
  definitions: CategoryProperty[] | null
  /** Why something is missing, in Ukrainian. */
  note: string | null
}

/** updateListingProperty body. */
export interface PropertyInput {
  valueIds: number[]
  values: string[]
  scaleId: number | null
}

/**
 * Problems with an attribute value set, in Ukrainian; [] = fine. `def` adds
 * the category's limits. updateListingProperty requires both value_ids and
 * values ("each offering requires both a value and a value_id"), so they must
 * pair up one by one — the OAS gives no id for a free-text value.
 */
export function propertyProblems(p: PropertyInput, def?: CategoryProperty | null): string[] {
  const out: string[] = []
  if (!p.valueIds.length && !p.values.length) out.push('Виберіть хоча б одне значення.')
  else if (p.valueIds.length !== p.values.length) out.push('Кожне значення потребує і ідентифікатора, і назви зі списку дозволених.')
  if (p.valueIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) out.push('Некоректний ідентифікатор значення.')
  for (const v of p.values) {
    if (!v.trim()) out.push('Значення не може бути порожнім.')
    // Etsy forbids parentheses; a comma would split the value (the form body joins arrays with commas).
    else if (/[(),]/.test(v)) out.push(`Значення «${v}» містить недозволений символ (дужки або кому).`)
  }
  if (p.scaleId != null && (!Number.isSafeInteger(p.scaleId) || p.scaleId <= 0)) out.push('Некоректна шкала.')
  if (def) {
    const n = Math.max(p.valueIds.length, p.values.length)
    if (!def.isMultivalued && n > 1) out.push(`«${def.displayName}» має лише одне значення.`)
    if (def.maxValuesAllowed != null && n > def.maxValuesAllowed) {
      out.push(`«${def.displayName}»: не більше ${def.maxValuesAllowed} значень.`)
    }
    if (def.scales.length && p.scaleId == null) out.push(`«${def.displayName}»: виберіть шкалу.`)
    if (p.scaleId != null && def.scales.length && !def.scales.some((s) => s.id === p.scaleId)) {
      out.push(`«${def.displayName}»: такої шкали немає.`)
    }
  }
  return out
}

// ---------------------------------------------------------- personalization

/** The OAS question_type enum. */
export const PERSONALIZATION_TYPES = [
  { value: 'text_input', label: 'Текст' },
  { value: 'dropdown', label: 'Вибір зі списку' },
  { value: 'unlabeled_upload', label: 'Файли' },
  { value: 'labeled_upload', label: 'Файли з підписами' }
] as const

export type PersonalizationType = (typeof PERSONALIZATION_TYPES)[number]['value']

export const isPersonalizationType = (v: unknown): v is PersonalizationType =>
  PERSONALIZATION_TYPES.some((t) => t.value === v)

/** supports_multiple_personalization_questions: "up to 5 personalization questions". */
export const MAX_QUESTIONS = 5
/** question_text: "between 1 and 45 characters". */
export const QUESTION_TEXT_MAX = 45
/** option label: dropdown ≤ 20, labeled_upload ≤ 45. */
export const DROPDOWN_LABEL_MAX = 20
export const UPLOAD_LABEL_MAX = 45

export interface PersonalizationOption {
  /** Keep it when editing an existing option; null = a new one. */
  id: number | null
  label: string
}

export interface PersonalizationQuestion {
  /** Keep it when editing an existing question; null = a new one. */
  id: number | null
  text: string
  /** Not allowed for dropdown questions. */
  instructions: string | null
  type: PersonalizationType
  required: boolean
  /** text_input only. */
  maxChars: number | null
  /** Upload questions only. */
  maxFiles: number | null
  /** dropdown: the choices; labeled_upload: one label per file. */
  options: PersonalizationOption[]
  /** Optional text_input questions only; in the shop currency. */
  addOnPrice: number | null
  /** Etsy's answer only (the Money's currency). */
  addOnCurrency: string | null
  /** Etsy's answer only: a question_type this editor doesn't know (then `type` is a placeholder and saving is refused). */
  unsupportedType?: string
}

const isUpload = (t: PersonalizationType): boolean => t === 'unlabeled_upload' || t === 'labeled_upload'
const posInt = (n: number): boolean => Number.isSafeInteger(n) && n > 0

/** Problems with the questions to save, in Ukrainian; [] = fine. */
export function personalizationProblems(qs: PersonalizationQuestion[]): string[] {
  const out: string[] = []
  if (!qs.length) out.push('Додайте хоча б одне питання (щоб прибрати персоналізацію — «Прибрати персоналізацію»).')
  if (qs.length > MAX_QUESTIONS) out.push(`Питань може бути не більше ${MAX_QUESTIONS}.`)
  qs.forEach((q, i) => {
    const at = `Питання ${i + 1}`
    if (q.unsupportedType) {
      out.push(`${at}: тип «${q.unsupportedType}» цей редактор не підтримує — виберіть інший тип або видаліть питання.`)
      return
    }
    const text = q.text.trim()
    if (!text) out.push(`${at}: текст не може бути порожнім.`)
    if (text.length > QUESTION_TEXT_MAX) out.push(`${at}: текст довший за ${QUESTION_TEXT_MAX} символів.`)
    if (!isPersonalizationType(q.type)) {
      out.push(`${at}: невідомий тип.`)
      return
    }
    if (q.type === 'dropdown' && q.instructions?.trim()) out.push(`${at}: у питання зі списком не буває інструкцій.`)
    if (q.maxChars != null && (q.type !== 'text_input' || !posInt(q.maxChars))) {
      out.push(`${at}: максимум символів — ціле число > 0, лише для текстового питання.`)
    }
    if (q.maxFiles != null && (!isUpload(q.type) || !posInt(q.maxFiles))) {
      out.push(`${at}: максимум файлів — ціле число > 0, лише для питань із файлами.`)
    }
    const withOptions = q.type === 'dropdown' || q.type === 'labeled_upload'
    if (!withOptions && q.options.length) out.push(`${at}: варіанти бувають лише у списку і файлів з підписами.`)
    if (withOptions && !q.options.length) out.push(`${at}: додайте хоча б одну відповідь.`)
    const labelMax = q.type === 'dropdown' ? DROPDOWN_LABEL_MAX : UPLOAD_LABEL_MAX
    if (q.options.some((o) => !o.label.trim())) out.push(`${at}: варіант не може бути порожнім.`)
    for (const o of q.options) {
      if (o.label.trim().length > labelMax) out.push(`${at}: варіант «${o.label}» довший за ${labelMax} символів.`)
    }
    if (q.type === 'labeled_upload' && q.options.length !== q.maxFiles) {
      out.push(`${at}: кількість підписів має дорівнювати максимуму файлів.`)
    }
    if (q.addOnPrice != null) {
      if (q.type !== 'text_input' || q.required) out.push(`${at}: доплата можлива лише для необов’язкового текстового питання.`)
      else if (!Number.isFinite(q.addOnPrice) || q.addOnPrice <= 0) out.push(`${at}: доплата має бути додатним числом.`)
    }
  })
  return out
}

/** A blank question for the editor. */
export const newQuestion = (): PersonalizationQuestion => ({
  id: null,
  text: '',
  instructions: null,
  type: 'text_input',
  required: false,
  maxChars: null,
  maxFiles: null,
  options: [],
  addOnPrice: null,
  addOnCurrency: null
})

// ------------------------------------------------------------- translations

/** The OAS examples of the translation `language` (+ `ru`, listed for a listing's language). */
export const TRANSLATION_LANGUAGES = [
  { code: 'de', label: 'Німецька' },
  { code: 'en', label: 'Англійська' },
  { code: 'es', label: 'Іспанська' },
  { code: 'fr', label: 'Французька' },
  { code: 'it', label: 'Італійська' },
  { code: 'ja', label: 'Японська' },
  { code: 'nl', label: 'Нідерландська' },
  { code: 'pl', label: 'Польська' },
  { code: 'pt', label: 'Португальська' },
  { code: 'ru', label: 'Російська' }
] as const

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number]['code']

export const isTranslationLanguage = (v: unknown): v is TranslationLanguage =>
  TRANSLATION_LANGUAGES.some((l) => l.code === v)

export interface ListingTranslation {
  listingId: number
  language: string
  title: string | null
  description: string | null
  tags: string[]
}

export interface TranslationInput {
  title: string
  description: string
  tags: string[]
}

export function translationProblems(t: TranslationInput): string[] {
  const out: string[] = []
  const title = t.title.trim()
  if (!title) out.push('Назва не може бути порожньою.')
  if (title.length > TITLE_MAX) out.push(`Назва довша за ${TITLE_MAX} символів (${title.length}).`)
  if (!t.description.trim()) out.push('Опис не може бути порожнім.')
  if (t.tags.some((x) => !x.trim())) out.push('Тег не може бути порожнім.')
  return [...out, ...tagProblems(t.tags)]
}

// ----------------------------------------------------------------- MCP list

/** The MCP tools of this feature, in Ukrainian for the MCP modal (same order as the tools). */
export const LISTING_META_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  { name: 'get_category_attributes', text: 'атрибути категорії: які є, обов’язкові, дозволені значення й шкали' },
  { name: 'get_my_product_attributes', text: 'атрибути мого товару' },
  { name: 'set_my_product_attribute', text: 'задати атрибут мого товару', write: true },
  { name: 'remove_my_product_attribute', text: 'прибрати атрибут мого товару', write: true },
  { name: 'get_my_product_personalization', text: 'питання персоналізації мого товару' },
  { name: 'set_my_product_personalization', text: 'замінити питання персоналізації мого товару', write: true },
  { name: 'remove_my_product_personalization', text: 'прибрати персоналізацію мого товару', write: true },
  { name: 'get_my_product_translation', text: 'переклад мого товару іншою мовою' },
  { name: 'set_my_product_translation', text: 'створити або оновити переклад мого товару', write: true },
  { name: 'delete_my_product', text: 'видалити мій товар назавжди', write: true }
]
