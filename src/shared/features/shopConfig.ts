// Feature "shopConfig": the own shop's configuration — sections, shipping
// profiles (with their destinations and upgrades), processing profiles
// ("readiness states"), return policies, holidays and production partners.
//
// Read types are camelCase, mapped from Etsy's JSON in main. Write inputs use
// the OAS request-body field names as they are (snake_case): one field table
// per form (`*_FIELDS`, taken from the OAS) drives the validation here, the
// form body in main and the MCP input schemas — the app's forms and the MCP
// tools send the same objects through the same checks.

import { normalizeCountry } from '../countries'

// ------------------------------------------------------------------ read types

/** Etsy Money as is: value = amount / divisor. */
export interface Money {
  amount: number
  divisor: number
  currency: string
}

export interface ShopSection {
  id: number
  title: string
  rank: number | null
  activeListingCount: number | null
}

export type ShippingRegion = 'eu' | 'non_eu' | 'none'

export interface ShippingDestination {
  id: number
  profileId: number
  originCountry: string | null
  /** null = a region (or "everywhere else" when the region is none too). */
  destinationCountry: string | null
  destinationRegion: ShippingRegion
  primaryCost: Money | null
  secondaryCost: Money | null
  carrierId: number | null
  mailClass: string | null
  minDeliveryDays: number | null
  maxDeliveryDays: number | null
}

export interface ShippingUpgrade {
  id: number
  profileId: number
  name: string
  /** OAS `type`: 0 = domestic, 1 = international. */
  international: boolean
  rank: number | null
  language: string | null
  price: Money | null
  secondaryPrice: Money | null
  carrierId: number | null
  mailClass: string | null
  minDeliveryDays: number | null
  maxDeliveryDays: number | null
}

export interface ShippingProfile {
  id: number
  title: string
  originCountry: string | null
  originPostalCode: string | null
  isDeleted: boolean
  /** manual | calculated */
  profileType: string | null
  domesticHandlingFee: number | null
  internationalHandlingFee: number | null
  destinations: ShippingDestination[]
  upgrades: ShippingUpgrade[]
}

export interface MailClass {
  key: string
  name: string
}

export interface ShippingCarrier {
  id: number
  name: string
  domesticClasses: MailClass[]
  internationalClasses: MailClass[]
}

export type ReadinessState = 'ready_to_ship' | 'made_to_order'

export interface ProcessingProfile {
  id: number
  readinessState: ReadinessState | null
  minDays: number | null
  maxDays: number | null
  /** Etsy's own display text, e.g. "1-3 days". */
  label: string | null
}

export interface ReturnPolicy {
  id: number
  acceptsReturns: boolean
  acceptsExchanges: boolean
  /** Days; null = no returns/exchanges. */
  returnDeadline: number | null
}

/** A listing that uses a return policy (getListingsByShopReturnPolicy). */
export interface PolicyListing {
  listingId: number
  title: string
  state: string
}

export interface HolidayPreference {
  holidayId: number
  countryIso: string | null
  name: string
  /** true = the shop processes orders on that day. */
  isWorking: boolean
}

export interface ProductionPartner {
  id: number
  name: string
  location: string | null
}

/** The own-listing "Розділ магазину" section: the shop's sections + the listing's one. */
export interface ListingSectionInfo {
  sections: ShopSection[]
  sectionId: number | null
  /** false = the listing couldn't be read (e.g. a draft) — its current section is unknown. */
  known: boolean
}

// ------------------------------------------------------------------- labels

export const REGION_LABEL: Record<ShippingRegion, string> = {
  eu: 'Країни ЄС',
  non_eu: 'Європа поза ЄС',
  none: 'Усі інші країни'
}

export const READINESS_LABEL: Record<ReadinessState, string> = {
  ready_to_ship: 'Готовий до відправлення',
  made_to_order: 'Виготовляється на замовлення'
}

/** OAS: return_deadline "must be one of the following: [7, 14, 21, 30, 45, 60, 90]". */
export const RETURN_DEADLINES = [7, 14, 21, 30, 45, 60, 90] as const

/** OAS: holiday_id enum 1…105. */
export const HOLIDAY_ID_MAX = 105

// ------------------------------------------------------------- write fields

export type FieldKind = 'int' | 'money' | 'text' | 'bool' | 'country' | 'enum'

/** One request-body field of the OAS. */
export interface FieldSpec {
  name: string
  /** Ukrainian, for problems in the app. */
  label: string
  /** English, for MCP descriptions and problems. */
  about: string
  kind: FieldKind
  required?: boolean
  /** Text an update may clear: an explicit '' is sent as an empty value instead of being left out. */
  clearable?: boolean
  min?: number
  max?: number
  values?: readonly (string | number)[]
}

export type FormValue = string | number | boolean
export type FormValues = Record<string, FormValue>

/** A problem in both languages: the app shows `uk`, an MCP client gets `en`. */
export interface Problem {
  uk: string
  en: string
}

export interface Checked {
  values: FormValues
  problems: Problem[]
}

const DELIVERY_FIELDS: FieldSpec[] = [
  { name: 'shipping_carrier_id', label: 'перевізник', about: 'Carrier id (list_shipping_carriers); goes with mail_class.', kind: 'int', min: 0 },
  { name: 'mail_class', label: 'клас пошти', about: "The carrier's mail class key; goes with shipping_carrier_id.", kind: 'text' },
  { name: 'min_delivery_days', label: 'мін. днів доставки', about: 'Minimum business days in transit (1-45); goes with max_delivery_days.', kind: 'int', min: 1, max: 45 },
  { name: 'max_delivery_days', label: 'макс. днів доставки', about: 'Maximum business days in transit (1-45); goes with min_delivery_days.', kind: 'int', min: 1, max: 45 }
]

const COST_FIELDS = (required: boolean): FieldSpec[] => [
  { name: 'primary_cost', label: 'вартість доставки', about: "Shipping cost for one item, in the store's currency.", kind: 'money', required },
  { name: 'secondary_cost', label: 'вартість за кожен наступний товар', about: "Cost for each additional item, in the store's currency.", kind: 'money', required }
]

const TARGET_FIELDS: FieldSpec[] = [
  { name: 'destination_country_iso', label: 'країна призначення', about: 'Destination country (2-letter code). Either this or destination_region.', kind: 'country' },
  {
    name: 'destination_region',
    label: 'регіон призначення',
    about: 'Destination region: eu, non_eu (Europe outside the EU) or none. Either this or destination_country_iso.',
    kind: 'enum',
    values: ['eu', 'non_eu', 'none']
  }
]

const PROFILE_PROCESSING_FIELDS: FieldSpec[] = [
  { name: 'min_processing_time', label: 'мін. час обробки', about: 'Minimum processing time (1-10).', kind: 'int', min: 1, max: 10 },
  { name: 'max_processing_time', label: 'макс. час обробки', about: 'Maximum processing time (1-10).', kind: 'int', min: 1, max: 10 },
  {
    name: 'processing_time_unit',
    label: 'одиниця часу обробки',
    about: 'Unit of the processing time: business_days (default) or weeks.',
    kind: 'enum',
    values: ['business_days', 'weeks']
  }
]

const TITLE: FieldSpec = { name: 'title', label: 'назва', about: 'Name of the shipping profile.', kind: 'text', required: true }
const ORIGIN: FieldSpec = { name: 'origin_country_iso', label: 'країна відправлення', about: 'Country the items ship from (2-letter code).', kind: 'country', required: true }
const POSTAL: FieldSpec = {
  name: 'origin_postal_code',
  label: 'поштовий індекс відправлення',
  about: 'Postal code items ship from (required where the country uses postal codes).',
  kind: 'text'
}

/** createShopShippingProfile (the profile + its first destination). */
export const PROFILE_CREATE_FIELDS: FieldSpec[] = [
  TITLE,
  ORIGIN,
  POSTAL,
  ...COST_FIELDS(true),
  ...TARGET_FIELDS,
  ...PROFILE_PROCESSING_FIELDS,
  ...DELIVERY_FIELDS
]

/** updateShopShippingProfile. */
export const PROFILE_UPDATE_FIELDS: FieldSpec[] = [
  { ...TITLE, required: false },
  { ...ORIGIN, required: false },
  { ...POSTAL, clearable: true, about: `${POSTAL.about} An empty string clears it.` },
  ...PROFILE_PROCESSING_FIELDS
]

/** createShopShippingProfileDestination / updateShopShippingProfileDestination (update: all optional). */
export const DESTINATION_FIELDS: FieldSpec[] = [...COST_FIELDS(true), ...TARGET_FIELDS, ...DELIVERY_FIELDS]

/** createShopShippingProfileUpgrade / updateShopShippingProfileUpgrade. */
export const UPGRADE_FIELDS: FieldSpec[] = [
  { name: 'type', label: 'тип', about: '0 = domestic, 1 = international.', kind: 'enum', values: [0, 1], required: true },
  { name: 'upgrade_name', label: 'назва', about: 'Name shown to buyers at checkout, e.g. "Express".', kind: 'text', required: true },
  { name: 'price', label: 'доплата', about: "Extra cost of the upgrade, in the store's currency.", kind: 'money', required: true },
  { name: 'secondary_price', label: 'доплата за кожен наступний товар', about: 'Extra cost for each additional item.', kind: 'money', required: true },
  ...DELIVERY_FIELDS
]

/** createShopReadinessStateDefinition / updateShopReadinessStateDefinition. */
export const PROCESSING_FIELDS: FieldSpec[] = [
  {
    name: 'readiness_state',
    label: 'тип',
    about: 'ready_to_ship (made in advance) or made_to_order.',
    kind: 'enum',
    values: ['ready_to_ship', 'made_to_order'],
    required: true
  },
  { name: 'min_processing_time', label: 'мін. час обробки', about: 'Minimum processing time (1-10).', kind: 'int', min: 1, max: 10, required: true },
  { name: 'max_processing_time', label: 'макс. час обробки', about: 'Maximum processing time (1-10).', kind: 'int', min: 1, max: 10, required: true },
  {
    name: 'processing_time_unit',
    label: 'одиниця',
    about: 'days or weeks; when left out the unit becomes days (also on an update that changes the time). Profiles report their time in days only.',
    kind: 'enum',
    values: ['days', 'weeks']
  }
]

/** createShopReturnPolicy / updateShopReturnPolicy (both require the two flags). */
export const RETURN_POLICY_FIELDS: FieldSpec[] = [
  { name: 'accepts_returns', label: 'приймає повернення', about: 'Whether returns are accepted.', kind: 'bool', required: true },
  { name: 'accepts_exchanges', label: 'приймає обмін', about: 'Whether exchanges are accepted.', kind: 'bool', required: true },
  {
    name: 'return_deadline',
    label: 'строк повернення (днів)',
    about: 'Days the buyer has to return/exchange: 7, 14, 21, 30, 45, 60 or 90. Required when returns or exchanges are accepted.',
    kind: 'enum',
    values: RETURN_DEADLINES
  }
]

/** createShopSection / updateShopSection. */
export const SECTION_FIELDS: FieldSpec[] = [{ name: 'title', label: 'назва розділу', about: 'Section title.', kind: 'text', required: true }]

// --------------------------------------------------------------- validation

const empty = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '')

/** "5,5" / 5.5 → 5.5; null unless a non-negative amount with ≤ 2 decimals. */
export function parseCost(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim().replace(',', '.') : ''
  return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : null
}

function parseInteger(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
  return null
}

function parseOne(spec: FieldSpec, v: unknown): FormValue | Problem {
  const bad = (uk: string, en: string): Problem => ({ uk: `«${spec.label}»: ${uk}`, en: `"${spec.name}" ${en}` })
  switch (spec.kind) {
    case 'int': {
      const n = parseInteger(v)
      if (n == null) return bad('має бути цілим числом.', 'must be a whole number.')
      if ((spec.min != null && n < spec.min) || (spec.max != null && n > spec.max)) {
        return bad(`від ${spec.min ?? 0} до ${spec.max ?? '∞'}.`, `must be between ${spec.min ?? 0} and ${spec.max ?? 'any'}.`)
      }
      return n
    }
    case 'money': {
      const n = parseCost(v)
      return n ?? bad('сума ≥ 0, не більше 2 знаків після коми.', 'must be an amount ≥ 0 with at most 2 decimals.')
    }
    case 'text':
      return typeof v === 'string' ? v.trim() : bad('має бути текстом.', 'must be text.')
    case 'bool':
      return typeof v === 'boolean' ? v : bad('має бути так/ні.', 'must be true or false.')
    case 'country':
      return normalizeCountry(v) ?? bad('невідомий код країни (2 літери, ISO).', 'must be a 2-letter ISO country code.')
    case 'enum': {
      const numeric = typeof spec.values?.[0] === 'number'
      const x = numeric ? parseInteger(v) : v
      if (x == null || !spec.values?.includes(x as string | number)) {
        return bad(`одне з: ${spec.values?.join(', ')}.`, `must be one of: ${spec.values?.join(', ')}.`)
      }
      return x as FormValue
    }
  }
}

const isProblem = (x: FormValue | Problem): x is Problem => typeof x === 'object'

/**
 * Read `raw` against a field table: known fields only, empty = absent (but an
 * explicit '' of a `clearable` field in an update is kept as ''),
 * required ones must be there unless `partial` (an update). Values come out
 * typed (numbers, booleans, trimmed text, uppercase country codes).
 */
export function parseFields(raw: unknown, specs: readonly FieldSpec[], partial = false): Checked {
  const values: FormValues = {}
  const problems: Problem[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { values, problems: [{ uk: 'Немає даних форми.', en: 'The input must be an object.' }] }
  }
  const o = raw as Record<string, unknown>
  for (const spec of specs) {
    const v = o[spec.name]
    if (empty(v)) {
      if (partial && spec.clearable && typeof v === 'string') values[spec.name] = ''
      else if (spec.required && !partial) problems.push({ uk: `Заповніть «${spec.label}».`, en: `"${spec.name}" is required.` })
      continue
    }
    const x = parseOne(spec, v)
    if (isProblem(x)) problems.push(x)
    else values[spec.name] = x
  }
  return { values, problems }
}

function rangeProblem(v: FormValues, min: string, max: string, uk: string): Problem[] {
  const a = v[min]
  const b = v[max]
  return typeof a === 'number' && typeof b === 'number' && a > b
    ? [{ uk: `${uk}: мінімум більший за максимум.`, en: `${min} must not exceed ${max}.` }]
    : []
}

/** Carrier + mail class together, min + max delivery days together; `needOne` = one of the pairs is required. */
function deliveryProblems(v: FormValues, needOne: boolean): Problem[] {
  const out: Problem[] = []
  const carrier = typeof v.shipping_carrier_id === 'number' && v.shipping_carrier_id > 0
  const mail = v.mail_class != null
  const days = [v.min_delivery_days, v.max_delivery_days].filter((x) => x != null).length
  if (carrier !== mail) {
    out.push({ uk: 'Перевізник і клас пошти вказуються разом.', en: 'shipping_carrier_id and mail_class go together.' })
  }
  if (days === 1) {
    out.push({ uk: 'Мін. і макс. днів доставки вказуються разом.', en: 'min_delivery_days and max_delivery_days go together.' })
  }
  out.push(...rangeProblem(v, 'min_delivery_days', 'max_delivery_days', 'Строк доставки'))
  if (needOne && !(carrier && mail) && days < 2) {
    out.push({
      uk: 'Вкажіть перевізника й клас пошти або строк доставки (мін. і макс. днів).',
      en: 'Give either shipping_carrier_id + mail_class, or min_delivery_days + max_delivery_days.'
    })
  }
  return out
}

/**
 * A country or a region, never both (Etsy answers 400 to both — even with the
 * region `none`); `needOne` = one of them is required. `none` alone means
 * "everywhere else", which isn't "one of them".
 */
function targetProblems(v: FormValues, needOne: boolean): Problem[] {
  const region = v.destination_region != null && v.destination_region !== 'none'
  const country = v.destination_country_iso != null
  if (country && v.destination_region != null) {
    return [{ uk: 'Вкажіть або країну, або регіон призначення — не обидва.', en: 'Give destination_country_iso or destination_region, not both.' }]
  }
  if (needOne && !region && !country) {
    return [{ uk: 'Вкажіть країну або регіон призначення.', en: 'Give destination_country_iso or destination_region.' }]
  }
  return []
}

function withRules(c: Checked, rules: (v: FormValues) => Problem[]): Checked {
  return { values: c.values, problems: [...c.problems, ...rules(c.values)] }
}

const nothing = (c: Checked): Checked =>
  c.problems.length || Object.keys(c.values).length ? c : { values: c.values, problems: [{ uk: 'Нічого не змінено.', en: 'Nothing to change.' }] }

export function checkSection(raw: unknown): Checked {
  return parseFields(raw, SECTION_FIELDS)
}

export function checkProfileCreate(raw: unknown): Checked {
  return withRules(parseFields(raw, PROFILE_CREATE_FIELDS), (v) => [
    ...targetProblems(v, true),
    ...deliveryProblems(v, true),
    ...rangeProblem(v, 'min_processing_time', 'max_processing_time', 'Час обробки')
  ])
}

export function checkProfileUpdate(raw: unknown): Checked {
  return nothing(withRules(parseFields(raw, PROFILE_UPDATE_FIELDS, true), (v) => rangeProblem(v, 'min_processing_time', 'max_processing_time', 'Час обробки')))
}

export function checkDestinationCreate(raw: unknown): Checked {
  return withRules(parseFields(raw, DESTINATION_FIELDS), (v) => [...targetProblems(v, false), ...deliveryProblems(v, true)])
}

export function checkDestinationUpdate(raw: unknown): Checked {
  return nothing(withRules(parseFields(raw, DESTINATION_FIELDS, true), (v) => [...targetProblems(v, false), ...deliveryProblems(v, false)]))
}

export function checkUpgradeCreate(raw: unknown): Checked {
  return withRules(parseFields(raw, UPGRADE_FIELDS), (v) => deliveryProblems(v, true))
}

export function checkUpgradeUpdate(raw: unknown): Checked {
  return nothing(withRules(parseFields(raw, UPGRADE_FIELDS, true), (v) => deliveryProblems(v, false)))
}

export function checkProcessingCreate(raw: unknown): Checked {
  return withRules(parseFields(raw, PROCESSING_FIELDS), (v) => rangeProblem(v, 'min_processing_time', 'max_processing_time', 'Час обробки'))
}

export function checkProcessingUpdate(raw: unknown): Checked {
  return nothing(withRules(parseFields(raw, PROCESSING_FIELDS, true), (v) => rangeProblem(v, 'min_processing_time', 'max_processing_time', 'Час обробки')))
}

/** OAS: "if either accepts_returns or accepts_exchanges is true, then a return_deadline is required". */
export function checkReturnPolicy(raw: unknown): Checked {
  const c = parseFields(raw, RETURN_POLICY_FIELDS)
  const accepts = c.values.accepts_returns === true || c.values.accepts_exchanges === true
  if (!accepts) {
    // Nothing to return or exchange: a deadline means nothing.
    const { return_deadline: _drop, ...rest } = c.values
    return { values: rest, problems: c.problems }
  }
  return withRules(c, (v) =>
    v.return_deadline == null
      ? [{ uk: 'Вкажіть строк повернення.', en: 'return_deadline is required when returns or exchanges are accepted.' }]
      : []
  )
}

// ------------------------------------------------------------ display helpers

/** "5,00 USD"-style money for tables (uk-UA, like the rest of the app). */
export function moneyText(m: Money | null): string {
  if (!m) return '—'
  const value = m.divisor > 0 ? m.amount / m.divisor : m.amount
  try {
    return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: m.currency }).format(value)
  } catch {
    return `${value.toFixed(2)} ${m.currency}`.trim()
  }
}

/** Money → the decimal a form shows ("5.5"); '' for none. */
export function moneyInput(m: Money | null): string {
  if (!m) return ''
  return String(m.divisor > 0 ? m.amount / m.divisor : m.amount)
}

/** "1–3 дн." / "2 дн." / "—". */
export function daysText(min: number | null, max: number | null, unit = 'дн.'): string {
  if (min == null && max == null) return '—'
  if (min == null || max == null || min === max) return `${min ?? max} ${unit}`
  return `${min}–${max} ${unit}`
}

// --------------------------------------------------------------- MCP tools

/** The MCP tools of this feature, in Ukrainian for the MCP modal (same names, same order as main). */
export const SHOP_CONFIG_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  { name: 'list_my_sections', text: 'розділи мого магазину з кількістю товарів' },
  { name: 'create_my_section', text: 'створити розділ магазину', write: true },
  { name: 'update_my_section', text: 'перейменувати розділ магазину', write: true },
  { name: 'delete_my_section', text: 'видалити розділ магазину', write: true },
  { name: 'set_my_product_section', text: 'перенести лістинг у розділ', write: true },
  { name: 'list_my_shipping_profiles', text: 'профілі доставки з напрямками й апгрейдами' },
  { name: 'get_my_shipping_profile', text: 'один профіль доставки' },
  { name: 'create_my_shipping_profile', text: 'створити профіль доставки', write: true },
  { name: 'update_my_shipping_profile', text: 'змінити профіль доставки', write: true },
  { name: 'delete_my_shipping_profile', text: 'видалити профіль доставки', write: true },
  { name: 'list_my_shipping_destinations', text: 'напрямки доставки профілю' },
  { name: 'create_my_shipping_destination', text: 'додати напрямок доставки', write: true },
  { name: 'update_my_shipping_destination', text: 'змінити напрямок доставки', write: true },
  { name: 'delete_my_shipping_destination', text: 'видалити напрямок доставки', write: true },
  { name: 'list_my_shipping_upgrades', text: 'апгрейди доставки профілю (експрес тощо)' },
  { name: 'create_my_shipping_upgrade', text: 'додати апгрейд доставки', write: true },
  { name: 'update_my_shipping_upgrade', text: 'змінити апгрейд доставки', write: true },
  { name: 'delete_my_shipping_upgrade', text: 'видалити апгрейд доставки', write: true },
  { name: 'list_my_processing_profiles', text: 'профілі обробки (строки виготовлення)' },
  { name: 'create_my_processing_profile', text: 'створити профіль обробки', write: true },
  { name: 'update_my_processing_profile', text: 'змінити профіль обробки', write: true },
  { name: 'delete_my_processing_profile', text: 'видалити профіль обробки', write: true },
  { name: 'list_my_return_policies', text: 'політики повернення' },
  { name: 'create_my_return_policy', text: 'створити політику повернення', write: true },
  { name: 'update_my_return_policy', text: 'змінити політику повернення', write: true },
  { name: 'delete_my_return_policy', text: 'видалити політику повернення', write: true },
  { name: 'consolidate_my_return_policies', text: 'перенести лістинги з однієї політики в іншу й видалити першу', write: true },
  { name: 'list_products_by_return_policy', text: 'лістинги з цією політикою повернення' },
  { name: 'get_my_holidays', text: 'свята: чи магазин працює в ці дні' },
  { name: 'set_my_holiday', text: 'працювати чи ні у свято', write: true },
  { name: 'list_my_production_partners', text: 'виробничі партнери магазину' }
]
