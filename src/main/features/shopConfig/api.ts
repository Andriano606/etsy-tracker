// The shop configuration calls, one function per OAS operation. Each takes the
// client and the own shop id (checked by the caller: ownShop / mcpOwnShop) and
// answers clean types. Writes check their input first (shared field tables)
// and send only the given fields, as Etsy's form names.

import {
  checkDestinationCreate,
  checkDestinationUpdate,
  checkProcessingCreate,
  checkProcessingUpdate,
  checkProfileCreate,
  checkProfileUpdate,
  checkReturnPolicy,
  checkSection,
  checkUpgradeCreate,
  checkUpgradeUpdate,
  HOLIDAY_ID_MAX,
  type Checked,
  type FormValues,
  type HolidayPreference,
  type ListingSectionInfo,
  type PolicyListing,
  type ProcessingProfile,
  type ProductionPartner,
  type ReturnPolicy,
  type ShippingCarrier,
  type ShippingDestination,
  type ShippingProfile,
  type ShippingUpgrade,
  type ShopSection
} from '../../../shared/features/shopConfig'
import { normalizeCountry } from '../../../shared/countries'
import type { MyListing } from '../../../shared/types'
import { EtsyApiError, PAGE_LIMIT, type EtsyClient, type EtsyListing, type Paged } from '../../etsyApi'
import { toMyListing } from '../../myShop'
import { FeatureError } from '../common'
import {
  mapCarrier,
  mapDestination,
  mapHoliday,
  mapPartner,
  mapPolicyListing,
  mapProcessing,
  mapProfile,
  mapReturnPolicy,
  mapSection,
  mapUpgrade,
  type EtsyCarrier,
  type EtsyDestination,
  type EtsyHoliday,
  type EtsyPartner,
  type EtsyPolicyListing,
  type EtsyReadiness,
  type EtsyReturnPolicy,
  type EtsySection,
  type EtsyShippingProfileFull,
  type EtsyUpgrade
} from './map'

/** Scopes per kind of call (the OAS `security` of each operation). */
export const SCOPES = {
  shopRead: ['shops_r'],
  shopWrite: ['shops_w'],
  listingRead: ['listings_r'],
  listingWrite: ['listings_w']
} as const

/** A refused input: the app shows `message` (Ukrainian), an MCP client gets `en`. */
export class ConfigError extends FeatureError {
  constructor(
    message: string,
    public en: string
  ) {
    super(message)
  }
}

/** The checked form values, or a ConfigError listing every problem. */
function valid(c: Checked): FormValues {
  if (c.problems.length) {
    throw new ConfigError(c.problems.map((p) => p.uk).join(' '), c.problems.map((p) => p.en).join(' '))
  }
  return c.values
}

const shopPath = (shopId: number): string => `/v3/application/shops/${shopId}`
const profilePath = (shopId: number, profileId: number): string => `${shopPath(shopId)}/shipping-profiles/${profileId}`

const results = <T>(r: Paged<T> | null | undefined): T[] => (Array.isArray(r?.results) ? r.results : [])

/** Every page of a limit/offset list (limit 100 = the OAS maximum). */
async function allPages<T>(client: EtsyClient, path: string, oauth: boolean): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const page = await client.call<Paged<T>>(path, { oauth, query: { limit: PAGE_LIMIT, offset: offset || undefined } })
    const rows = results(page)
    out.push(...rows)
    if (!rows.length || offset + PAGE_LIMIT >= Number(page?.count ?? 0)) return out
  }
}

/** Etsy's 409 (OAS) = the values duplicate another profile/policy of the shop: `conflict` instead. */
async function noConflict<T>(p: Promise<T>, conflict: ConfigError): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof EtsyApiError && e.status === 409) throw conflict
    throw e
  }
}

const processingConflict = (): ConfigError =>
  new ConfigError('Профіль обробки з такими значеннями вже існує.', 'A processing profile with these values already exists.')

// ------------------------------------------------------------------- sections

export async function listSections(client: EtsyClient, shopId: number): Promise<ShopSection[]> {
  return results(await client.call<Paged<EtsySection>>(`${shopPath(shopId)}/sections`)).map(mapSection)
}

export async function getSection(client: EtsyClient, shopId: number, sectionId: number): Promise<ShopSection> {
  return mapSection(await client.call<EtsySection>(`${shopPath(shopId)}/sections/${sectionId}`))
}

export async function createSection(client: EtsyClient, shopId: number, raw: unknown): Promise<ShopSection> {
  const form = valid(checkSection(raw))
  return mapSection(await client.call<EtsySection>(`${shopPath(shopId)}/sections`, { method: 'POST', oauth: true, form }))
}

export async function updateSection(client: EtsyClient, shopId: number, sectionId: number, raw: unknown): Promise<ShopSection> {
  const form = valid(checkSection(raw))
  return mapSection(
    await client.call<EtsySection>(`${shopPath(shopId)}/sections/${sectionId}`, { method: 'PUT', oauth: true, form })
  )
}

export async function deleteSection(client: EtsyClient, shopId: number, sectionId: number): Promise<void> {
  await client.call(`${shopPath(shopId)}/sections/${sectionId}`, { method: 'DELETE', oauth: true })
}

/** The shop's sections + the listing's current one (public getListing; unknown when it can't be read). */
export async function listingSection(client: EtsyClient, shopId: number, listingId: number): Promise<ListingSectionInfo> {
  const sections = await listSections(client, shopId)
  try {
    const l = await client.call<EtsyListing>(`/v3/application/listings/${listingId}`)
    if (l?.shop_id !== shopId) return { sections, sectionId: null, known: false }
    return { sections, sectionId: l.shop_section_id ?? null, known: true }
  } catch (e) {
    if (e instanceof EtsyApiError && e.kind === 'not_found') return { sections, sectionId: null, known: false }
    throw e
  }
}

/**
 * updateListing shop_section_id. 0 = no section: the OAS types the field as a
 * nullable integer with no minimum, and a form body can't carry a null.
 */
export async function setListingSection(client: EtsyClient, shopId: number, listingId: number, sectionId: number): Promise<MyListing> {
  return toMyListing(await client.updateListing(shopId, listingId, { shop_section_id: sectionId }))
}

// ------------------------------------------------------------------- shipping

export async function listShippingProfiles(client: EtsyClient, shopId: number): Promise<ShippingProfile[]> {
  const r = await client.call<Paged<EtsyShippingProfileFull>>(`${shopPath(shopId)}/shipping-profiles`, { oauth: true })
  return results(r).map(mapProfile)
}

export async function getShippingProfile(client: EtsyClient, shopId: number, profileId: number): Promise<ShippingProfile> {
  return mapProfile(await client.call<EtsyShippingProfileFull>(profilePath(shopId, profileId), { oauth: true }))
}

export async function createShippingProfile(client: EtsyClient, shopId: number, raw: unknown): Promise<ShippingProfile> {
  const form = valid(checkProfileCreate(raw))
  return mapProfile(
    await client.call<EtsyShippingProfileFull>(`${shopPath(shopId)}/shipping-profiles`, { method: 'POST', oauth: true, form })
  )
}

export async function updateShippingProfile(client: EtsyClient, shopId: number, profileId: number, raw: unknown): Promise<ShippingProfile> {
  const form = valid(checkProfileUpdate(raw))
  return mapProfile(await client.call<EtsyShippingProfileFull>(profilePath(shopId, profileId), { method: 'PUT', oauth: true, form }))
}

export async function deleteShippingProfile(client: EtsyClient, shopId: number, profileId: number): Promise<void> {
  await client.call(profilePath(shopId, profileId), { method: 'DELETE', oauth: true })
}

export async function listDestinations(client: EtsyClient, shopId: number, profileId: number): Promise<ShippingDestination[]> {
  return (await allPages<EtsyDestination>(client, `${profilePath(shopId, profileId)}/destinations`, true)).map(mapDestination)
}

export async function createDestination(client: EtsyClient, shopId: number, profileId: number, raw: unknown): Promise<ShippingDestination> {
  const form = valid(checkDestinationCreate(raw))
  return mapDestination(
    await client.call<EtsyDestination>(`${profilePath(shopId, profileId)}/destinations`, { method: 'POST', oauth: true, form })
  )
}

export async function updateDestination(
  client: EtsyClient,
  shopId: number,
  profileId: number,
  destinationId: number,
  raw: unknown
): Promise<ShippingDestination> {
  const form = valid(checkDestinationUpdate(raw))
  return mapDestination(
    await client.call<EtsyDestination>(`${profilePath(shopId, profileId)}/destinations/${destinationId}`, {
      method: 'PUT',
      oauth: true,
      form
    })
  )
}

export async function deleteDestination(client: EtsyClient, shopId: number, profileId: number, destinationId: number): Promise<void> {
  await client.call(`${profilePath(shopId, profileId)}/destinations/${destinationId}`, { method: 'DELETE', oauth: true })
}

export async function listUpgrades(client: EtsyClient, shopId: number, profileId: number): Promise<ShippingUpgrade[]> {
  return results(await client.call<Paged<EtsyUpgrade>>(`${profilePath(shopId, profileId)}/upgrades`, { oauth: true })).map(mapUpgrade)
}

export async function createUpgrade(client: EtsyClient, shopId: number, profileId: number, raw: unknown): Promise<ShippingUpgrade> {
  const form = valid(checkUpgradeCreate(raw))
  return mapUpgrade(await client.call<EtsyUpgrade>(`${profilePath(shopId, profileId)}/upgrades`, { method: 'POST', oauth: true, form }))
}

export async function updateUpgrade(
  client: EtsyClient,
  shopId: number,
  profileId: number,
  upgradeId: number,
  raw: unknown
): Promise<ShippingUpgrade> {
  const form = valid(checkUpgradeUpdate(raw))
  return mapUpgrade(
    await client.call<EtsyUpgrade>(`${profilePath(shopId, profileId)}/upgrades/${upgradeId}`, { method: 'PUT', oauth: true, form })
  )
}

export async function deleteUpgrade(client: EtsyClient, shopId: number, profileId: number, upgradeId: number): Promise<void> {
  await client.call(`${profilePath(shopId, profileId)}/upgrades/${upgradeId}`, { method: 'DELETE', oauth: true })
}

/** getShippingCarriers (API key only): carriers + mail classes for an origin country. */
export async function listCarriers(client: EtsyClient, originCountry: unknown): Promise<ShippingCarrier[]> {
  const country = normalizeCountry(originCountry)
  if (!country) throw new ConfigError('Невідомий код країни відправлення.', 'origin_country_iso must be a 2-letter ISO country code.')
  const r = await client.call<Paged<EtsyCarrier>>('/v3/application/shipping-carriers', { query: { origin_country_iso: country } })
  return results(r).map(mapCarrier)
}

// ----------------------------------------------------------------- processing

const readinessPath = (shopId: number): string => `${shopPath(shopId)}/readiness-state-definitions`

export async function listProcessingProfiles(client: EtsyClient, shopId: number): Promise<ProcessingProfile[]> {
  return (await allPages<EtsyReadiness>(client, readinessPath(shopId), true)).map(mapProcessing)
}

export async function getProcessingProfile(client: EtsyClient, shopId: number, id: number): Promise<ProcessingProfile> {
  return mapProcessing(await client.call<EtsyReadiness>(`${readinessPath(shopId)}/${id}`, { oauth: true }))
}

export async function createProcessingProfile(client: EtsyClient, shopId: number, raw: unknown): Promise<ProcessingProfile> {
  const form = valid(checkProcessingCreate(raw))
  return mapProcessing(await noConflict(client.call<EtsyReadiness>(readinessPath(shopId), { method: 'POST', oauth: true, form }), processingConflict()))
}

export async function updateProcessingProfile(client: EtsyClient, shopId: number, id: number, raw: unknown): Promise<ProcessingProfile> {
  const form = valid(checkProcessingUpdate(raw))
  return mapProcessing(
    await noConflict(client.call<EtsyReadiness>(`${readinessPath(shopId)}/${id}`, { method: 'PUT', oauth: true, form }), processingConflict())
  )
}

export async function deleteProcessingProfile(client: EtsyClient, shopId: number, id: number): Promise<void> {
  await client.call(`${readinessPath(shopId)}/${id}`, { method: 'DELETE', oauth: true })
}

// -------------------------------------------------------------------- returns

const returnPath = (shopId: number): string => `${shopPath(shopId)}/policies/return`

export async function listReturnPolicies(client: EtsyClient, shopId: number): Promise<ReturnPolicy[]> {
  return results(await client.call<Paged<EtsyReturnPolicy>>(returnPath(shopId))).map(mapReturnPolicy)
}

export async function getReturnPolicy(client: EtsyClient, shopId: number, id: number): Promise<ReturnPolicy> {
  return mapReturnPolicy(await client.call<EtsyReturnPolicy>(`${returnPath(shopId)}/${id}`))
}

export async function createReturnPolicy(client: EtsyClient, shopId: number, raw: unknown): Promise<ReturnPolicy> {
  const form = valid(checkReturnPolicy(raw))
  return mapReturnPolicy(await client.call<EtsyReturnPolicy>(returnPath(shopId), { method: 'POST', oauth: true, form }))
}

/** A 409 (OAS) = the new terms duplicate another policy, which Etsy prevents: consolidate them instead. */
export async function updateReturnPolicy(client: EtsyClient, shopId: number, id: number, raw: unknown): Promise<ReturnPolicy> {
  const form = valid(checkReturnPolicy(raw))
  const conflict = new ConfigError(
    'Політика з такими умовами вже існує — об’єднайте ці політики («Об’єднати політики»).',
    'A return policy with these terms already exists; use consolidate_my_return_policies to merge them.'
  )
  return mapReturnPolicy(
    await noConflict(client.call<EtsyReturnPolicy>(`${returnPath(shopId)}/${id}`, { method: 'PUT', oauth: true, form }), conflict)
  )
}

export async function deleteReturnPolicy(client: EtsyClient, shopId: number, id: number): Promise<void> {
  await client.call(`${returnPath(shopId)}/${id}`, { method: 'DELETE', oauth: true })
}

/** Moves every listing of `source` to `destination` and deletes `source` (OAS). */
export async function consolidateReturnPolicies(client: EtsyClient, shopId: number, source: number, destination: number): Promise<ReturnPolicy> {
  if (source === destination) {
    throw new ConfigError('Виберіть дві різні політики повернення.', 'The source and destination policies must differ.')
  }
  const form = { source_return_policy_id: source, destination_return_policy_id: destination }
  return mapReturnPolicy(await client.call<EtsyReturnPolicy>(`${returnPath(shopId)}/consolidate`, { method: 'POST', oauth: true, form }))
}

export async function listPolicyListings(client: EtsyClient, shopId: number, id: number): Promise<PolicyListing[]> {
  return results(await client.call<Paged<EtsyPolicyListing>>(`${returnPath(shopId)}/${id}/listings`, { oauth: true })).map(mapPolicyListing)
}

// ----------------------------------------------------------- holidays, partners

export async function listHolidays(client: EtsyClient, shopId: number): Promise<HolidayPreference[]> {
  const r = await client.call<EtsyHoliday[] | Paged<EtsyHoliday>>(`${shopPath(shopId)}/holiday-preferences`, { oauth: true })
  return (Array.isArray(r) ? r : results(r)).map(mapHoliday)
}

export async function setHoliday(client: EtsyClient, shopId: number, holidayId: number, isWorking: unknown): Promise<HolidayPreference> {
  if (holidayId > HOLIDAY_ID_MAX) throw new ConfigError('Невідоме свято.', `holiday_id must be 1-${HOLIDAY_ID_MAX}.`)
  if (typeof isWorking !== 'boolean') throw new ConfigError('Вкажіть, чи магазин працює у це свято.', 'is_working must be true or false.')
  return mapHoliday(
    await client.call<EtsyHoliday>(`${shopPath(shopId)}/holiday-preferences/${holidayId}`, {
      method: 'PUT',
      oauth: true,
      form: { is_working: isWorking }
    })
  )
}

export async function listPartners(client: EtsyClient, shopId: number): Promise<ProductionPartner[]> {
  return results(await client.call<Paged<EtsyPartner>>(`${shopPath(shopId)}/production-partners`, { oauth: true })).map(mapPartner)
}
