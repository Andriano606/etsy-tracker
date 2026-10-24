// The MCP tools of the user's own Etsy shop configuration. Every tool calls the
// Etsy API live: reads need the Etsy sign-in (+ the OAuth scope of the
// operation); writes also need the "allow changes" switch. Every
// write here is visible to buyers (sections, shipping costs, processing times,
// return terms, holiday closures), so all of them are marked destructive.
// Inputs reuse the OAS field tables of shared/features/shopConfig. Carriers
// (getShippingCarriers) are the compete feature's `list_shipping_carriers`.

import {
  DESTINATION_FIELDS,
  PROCESSING_FIELDS,
  PROFILE_CREATE_FIELDS,
  PROFILE_UPDATE_FIELDS,
  RETURN_POLICY_FIELDS,
  SECTION_FIELDS,
  UPGRADE_FIELDS,
  HOLIDAY_ID_MAX,
  type FieldSpec,
  type HolidayPreference,
  type Money,
  type PolicyListing,
  type ProcessingProfile,
  type ProductionPartner,
  type ReturnPolicy,
  type ShippingDestination,
  type ShippingProfile,
  type ShippingUpgrade,
  type ShopSection
} from '../../../shared/features/shopConfig'
import { priceValue } from '../../../shared/format'
import { textResult, ToolInputError, type JsonSchema, type McpTool, type McpToolResult } from '../../mcpProtocol'
import { mcpFail, mcpOwnShop, mcpWritable } from '../common'
import type { FeatureMcpDeps } from '../types'
import * as api from './api'
import { ConfigError, SCOPES } from './api'

// ------------------------------------------------------------------ outputs

const money = (m: Money | null) => (m ? { amount: priceValue(m.amount, m.divisor), currency: m.currency } : null)

const sectionOut = (s: ShopSection) => ({
  id: s.id,
  title: s.title,
  position: s.rank,
  active_products: s.activeListingCount
})

const destinationOut = (d: ShippingDestination) => ({
  id: d.id,
  profile_id: d.profileId,
  origin_country: d.originCountry,
  destination_country: d.destinationCountry,
  destination_region: d.destinationRegion,
  cost: money(d.primaryCost),
  additional_item_cost: money(d.secondaryCost),
  carrier_id: d.carrierId,
  mail_class: d.mailClass,
  min_delivery_days: d.minDeliveryDays,
  max_delivery_days: d.maxDeliveryDays
})

const upgradeOut = (u: ShippingUpgrade) => ({
  id: u.id,
  profile_id: u.profileId,
  name: u.name,
  type: u.international ? 'international' : 'domestic',
  position: u.rank,
  price: money(u.price),
  additional_item_price: money(u.secondaryPrice),
  carrier_id: u.carrierId,
  mail_class: u.mailClass,
  min_delivery_days: u.minDeliveryDays,
  max_delivery_days: u.maxDeliveryDays
})

const profileOut = (p: ShippingProfile) => ({
  id: p.id,
  title: p.title,
  origin_country: p.originCountry,
  origin_postal_code: p.originPostalCode,
  is_deleted: p.isDeleted,
  profile_type: p.profileType,
  domestic_handling_fee: p.domesticHandlingFee,
  international_handling_fee: p.internationalHandlingFee,
  destinations: p.destinations.map(destinationOut),
  upgrades: p.upgrades.map(upgradeOut)
})

const processingOut = (p: ProcessingProfile) => ({
  id: p.id,
  readiness_state: p.readinessState,
  min_days: p.minDays,
  max_days: p.maxDays,
  label: p.label
})

const returnOut = (r: ReturnPolicy) => ({
  id: r.id,
  accepts_returns: r.acceptsReturns,
  accepts_exchanges: r.acceptsExchanges,
  return_deadline_days: r.returnDeadline
})

const policyListingOut = (l: PolicyListing) => ({ product_id: l.listingId, title: l.title, state: l.state })

const holidayOut = (h: HolidayPreference) => ({
  holiday_id: h.holidayId,
  country: h.countryIso,
  name: h.name,
  is_working: h.isWorking
})

const partnerOut = (p: ProductionPartner) => ({ id: p.id, name: p.name, location: p.location })

// ------------------------------------------------------------------- inputs

function fieldSchema(f: FieldSpec): JsonSchema {
  const description = f.about
  switch (f.kind) {
    case 'int':
      return { type: 'integer', minimum: f.min, maximum: f.max, description }
    case 'money':
      return { type: 'number', minimum: 0, description }
    case 'text':
      return { type: 'string', minLength: f.clearable ? 0 : 1, description }
    case 'bool':
      return { type: 'boolean', description }
    case 'country':
      return { type: 'string', minLength: 2, maxLength: 2, description }
    case 'enum':
      return { type: typeof f.values?.[0] === 'number' ? 'integer' : 'string', enum: f.values, description }
  }
}

const fieldProps = (specs: readonly FieldSpec[]): Record<string, JsonSchema> =>
  Object.fromEntries(specs.map((f) => [f.name, fieldSchema(f)]))

const requiredOf = (specs: readonly FieldSpec[]): string[] => specs.filter((f) => f.required).map((f) => f.name)

const id = (description: string): JsonSchema => ({ type: 'integer', minimum: 1, description })

const PROFILE_ID = id('Etsy shipping profile id (list_my_shipping_profiles).')

/** The spec fields of `args` (ids and other tool-only arguments left out). */
const fieldsOf = (args: Record<string, unknown>, specs: readonly FieldSpec[]): Record<string, unknown> =>
  Object.fromEntries(specs.filter((f) => args[f.name] !== undefined).map((f) => [f.name, args[f.name]]))

// -------------------------------------------------------------------- tools

const LIVE =
  "This changes the user's live Etsy shop, visible to buyers — only when the user asked; needs the app's \"allow changes\" switch."

/** What the tool needs, from its scopes: every tool here is a live Etsy API call. */
const access = (scopes: readonly string[]): string =>
  scopes.length
    ? `Live Etsy API call (OAuth scope ${scopes.join(', ')}).`
    : "Live Etsy API call (API key; requires the user's Etsy sign-in in the app)."

const fail = (e: unknown): McpToolResult => (e instanceof ConfigError ? mcpFail(new ToolInputError(e.en)) : mcpFail(e))

interface ToolDef {
  name: string
  title: string
  description: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  scopes: readonly string[]
  run: (shopId: number, args: Record<string, unknown>) => Promise<unknown>
}

function tool(deps: FeatureMcpDeps, write: boolean, d: ToolDef): McpTool {
  return {
    name: d.name,
    title: d.title,
    // Every tool here is a live Etsy API call (reads and writes alike).
    openWorld: true,
    description: `${d.description} ${access(d.scopes)}${write ? ` ${LIVE}` : ''}`,
    inputSchema: { type: 'object', properties: d.properties ?? {}, required: d.required ?? [], additionalProperties: false },
    ...(write ? { readOnly: false, destructive: true } : {}),
    run: async (args) => {
      try {
        const shopId = write ? mcpWritable(deps, d.scopes) : mcpOwnShop(deps, d.scopes)
        return textResult(await d.run(shopId, args))
      } catch (e) {
        return fail(e)
      }
    }
  }
}

export function shopConfigTools(deps: FeatureMcpDeps): McpTool[] {
  const c = () => deps.client!
  const read = (d: ToolDef): McpTool => tool(deps, false, d)
  const write = (d: ToolDef): McpTool => tool(deps, true, d)
  const deleted = { deleted: true }
  const R = SCOPES.shopRead
  const W = SCOPES.shopWrite

  return [
    // ------------------------------------------------------------- sections
    read({
      name: 'list_my_sections',
      title: 'My Etsy shop sections',
      description:
        "The sections of the user's own Etsy shop (getShopSections): id, title, position and active_products (the number of active listings in it).",
      scopes: [],
      run: async (shop) => ({ sections: (await api.listSections(c(), shop)).map(sectionOut) })
    }),
    write({
      name: 'create_my_section',
      title: 'Create an Etsy shop section',
      description:
        "Creates a section in the user's Etsy shop (createShopSection) and returns it.",
      properties: fieldProps(SECTION_FIELDS),
      required: ['title'],
      scopes: W,
      run: async (shop, a) => sectionOut(await api.createSection(c(), shop, fieldsOf(a, SECTION_FIELDS)))
    }),
    write({
      name: 'update_my_section',
      title: 'Rename an Etsy shop section',
      description:
        "Renames a section of the user's Etsy shop (updateShopSection) and returns it.",
      properties: { section_id: id('Section id (list_my_sections).'), ...fieldProps(SECTION_FIELDS) },
      required: ['section_id', 'title'],
      scopes: W,
      run: async (shop, a) => sectionOut(await api.updateSection(c(), shop, Number(a.section_id), fieldsOf(a, SECTION_FIELDS)))
    }),
    write({
      name: 'delete_my_section',
      title: 'Delete an Etsy shop section',
      description:
        "Deletes a section of the user's Etsy shop (deleteShopSection); its listings stay, without a section.",
      properties: { section_id: id('Section id (list_my_sections).') },
      required: ['section_id'],
      scopes: W,
      run: async (shop, a) => {
        await api.deleteSection(c(), shop, Number(a.section_id))
        return deleted
      }
    }),
    write({
      name: 'set_my_product_section',
      title: 'Put my Etsy listing into a section',
      description:
        "Moves a listing of the user's Etsy shop into a section (updateListing shop_section_id; section_id 0 = no section). Returns product_id, title, state and section_id (null = none).",
      properties: {
        product_id: id("Etsy listing id of the user's own listing (list_my_products)."),
        section_id: { type: 'integer', minimum: 0, description: 'Section id (list_my_sections), 0 = no section.' }
      },
      required: ['product_id', 'section_id'],
      scopes: SCOPES.listingWrite,
      run: async (shop, a) => {
        const l = await api.setListingSection(c(), shop, Number(a.product_id), Number(a.section_id))
        return { product_id: l.listingId, title: l.title, state: l.state, section_id: Number(a.section_id) || null }
      }
    }),

    // ------------------------------------------------------------- shipping
    read({
      name: 'list_my_shipping_profiles',
      title: 'My Etsy shipping profiles',
      description:
        "The shipping profiles of the user's Etsy shop (getShopShippingProfiles): title, origin country + postal code, profile_type, is_deleted, handling fees, every destination (country or region, cost for one item and for each additional item, carrier + mail class or delivery days) and the upgrades (paid faster options). Money = decimal amount + currency.",
      scopes: R,
      run: async (shop) => ({ profiles: (await api.listShippingProfiles(c(), shop)).map(profileOut) })
    }),
    read({
      name: 'get_my_shipping_profile',
      title: 'One Etsy shipping profile',
      description:
        "One shipping profile of the user's Etsy shop (getShopShippingProfile) with its destinations and upgrades, shaped like list_my_shipping_profiles.",
      properties: { profile_id: PROFILE_ID },
      required: ['profile_id'],
      scopes: R,
      run: async (shop, a) => profileOut(await api.getShippingProfile(c(), shop, Number(a.profile_id)))
    }),
    write({
      name: 'create_my_shipping_profile',
      title: 'Create an Etsy shipping profile',
      description:
        "Creates a shipping profile (createShopShippingProfile) with its first destination: a destination country or a region (not both), the costs, and either a carrier + mail class or min + max delivery days. Returns the profile.",
      properties: fieldProps(PROFILE_CREATE_FIELDS),
      required: requiredOf(PROFILE_CREATE_FIELDS),
      scopes: W,
      run: async (shop, a) => profileOut(await api.createShippingProfile(c(), shop, fieldsOf(a, PROFILE_CREATE_FIELDS)))
    }),
    write({
      name: 'update_my_shipping_profile',
      title: 'Change an Etsy shipping profile',
      description:
        "Changes the title, origin country/postal code or processing time of a shipping profile (updateShopShippingProfile); only the given fields are sent (origin_postal_code \"\" clears it). Returns the profile.",
      properties: { profile_id: PROFILE_ID, ...fieldProps(PROFILE_UPDATE_FIELDS) },
      required: ['profile_id'],
      scopes: W,
      run: async (shop, a) =>
        profileOut(await api.updateShippingProfile(c(), shop, Number(a.profile_id), fieldsOf(a, PROFILE_UPDATE_FIELDS)))
    }),
    write({
      name: 'delete_my_shipping_profile',
      title: 'Delete an Etsy shipping profile',
      description:
        "Deletes a shipping profile of the user's Etsy shop (deleteShopShippingProfile).",
      properties: { profile_id: PROFILE_ID },
      required: ['profile_id'],
      scopes: W,
      run: async (shop, a) => {
        await api.deleteShippingProfile(c(), shop, Number(a.profile_id))
        return deleted
      }
    }),
    read({
      name: 'list_my_shipping_destinations',
      title: 'Destinations of an Etsy shipping profile',
      description:
        "Every destination of one shipping profile (getShopShippingProfileDestinationsByShippingProfile, all pages): where, the costs, carrier + mail class, delivery days.",
      properties: { profile_id: PROFILE_ID },
      required: ['profile_id'],
      scopes: R,
      run: async (shop, a) => ({ destinations: (await api.listDestinations(c(), shop, Number(a.profile_id))).map(destinationOut) })
    }),
    write({
      name: 'create_my_shipping_destination',
      title: 'Add an Etsy shipping destination',
      description:
        "Adds a destination to a shipping profile (createShopShippingProfileDestination): a country or a region (neither = everywhere else), the costs, and either a carrier + mail class or min + max delivery days. Returns it.",
      properties: { profile_id: PROFILE_ID, ...fieldProps(DESTINATION_FIELDS) },
      required: ['profile_id', ...requiredOf(DESTINATION_FIELDS)],
      scopes: W,
      run: async (shop, a) =>
        destinationOut(await api.createDestination(c(), shop, Number(a.profile_id), fieldsOf(a, DESTINATION_FIELDS)))
    }),
    write({
      name: 'update_my_shipping_destination',
      title: 'Change an Etsy shipping destination',
      description:
        "Changes a destination of a shipping profile (updateShopShippingProfileDestination); only the given fields are sent. Returns it.",
      properties: { profile_id: PROFILE_ID, destination_id: id('Destination id.'), ...fieldProps(DESTINATION_FIELDS) },
      required: ['profile_id', 'destination_id'],
      scopes: W,
      run: async (shop, a) =>
        destinationOut(
          await api.updateDestination(c(), shop, Number(a.profile_id), Number(a.destination_id), fieldsOf(a, DESTINATION_FIELDS))
        )
    }),
    write({
      name: 'delete_my_shipping_destination',
      title: 'Delete an Etsy shipping destination',
      description:
        "Deletes a destination of a shipping profile (deleteShopShippingProfileDestination).",
      properties: { profile_id: PROFILE_ID, destination_id: id('Destination id.') },
      required: ['profile_id', 'destination_id'],
      scopes: W,
      run: async (shop, a) => {
        await api.deleteDestination(c(), shop, Number(a.profile_id), Number(a.destination_id))
        return deleted
      }
    }),
    read({
      name: 'list_my_shipping_upgrades',
      title: 'Upgrades of an Etsy shipping profile',
      description:
        "The paid shipping upgrades (e.g. express) of one shipping profile (getShopShippingProfileUpgrades): name, domestic/international, position, extra prices, carrier + mail class or delivery days.",
      properties: { profile_id: PROFILE_ID },
      required: ['profile_id'],
      scopes: R,
      run: async (shop, a) => ({ upgrades: (await api.listUpgrades(c(), shop, Number(a.profile_id))).map(upgradeOut) })
    }),
    write({
      name: 'create_my_shipping_upgrade',
      title: 'Add an Etsy shipping upgrade',
      description:
        "Adds a paid shipping upgrade to a shipping profile (createShopShippingProfileUpgrade): type, the name shown at checkout, extra prices, and either a carrier + mail class or min + max delivery days. Returns it.",
      properties: { profile_id: PROFILE_ID, ...fieldProps(UPGRADE_FIELDS) },
      required: ['profile_id', ...requiredOf(UPGRADE_FIELDS)],
      scopes: W,
      run: async (shop, a) => upgradeOut(await api.createUpgrade(c(), shop, Number(a.profile_id), fieldsOf(a, UPGRADE_FIELDS)))
    }),
    write({
      name: 'update_my_shipping_upgrade',
      title: 'Change an Etsy shipping upgrade',
      description:
        "Changes a shipping upgrade (updateShopShippingProfileUpgrade); only the given fields are sent. Returns it.",
      properties: { profile_id: PROFILE_ID, upgrade_id: id('Upgrade id.'), ...fieldProps(UPGRADE_FIELDS) },
      required: ['profile_id', 'upgrade_id'],
      scopes: W,
      run: async (shop, a) =>
        upgradeOut(await api.updateUpgrade(c(), shop, Number(a.profile_id), Number(a.upgrade_id), fieldsOf(a, UPGRADE_FIELDS)))
    }),
    write({
      name: 'delete_my_shipping_upgrade',
      title: 'Delete an Etsy shipping upgrade',
      description:
        "Deletes a shipping upgrade of a shipping profile (deleteShopShippingProfileUpgrade).",
      properties: { profile_id: PROFILE_ID, upgrade_id: id('Upgrade id.') },
      required: ['profile_id', 'upgrade_id'],
      scopes: W,
      run: async (shop, a) => {
        await api.deleteUpgrade(c(), shop, Number(a.profile_id), Number(a.upgrade_id))
        return deleted
      }
    }),
    // ----------------------------------------------------------- processing
    read({
      name: 'list_my_processing_profiles',
      title: 'My Etsy processing profiles',
      description:
        "The processing profiles of the user's Etsy shop (getShopReadinessStateDefinitions, all pages): id (what a listing uses as processing_profile_id), readiness_state (ready_to_ship | made_to_order), min_days/max_days and Etsy's label.",
      scopes: R,
      run: async (shop) => ({ profiles: (await api.listProcessingProfiles(c(), shop)).map(processingOut) })
    }),
    write({
      name: 'create_my_processing_profile',
      title: 'Create an Etsy processing profile',
      description:
        "Creates a processing profile (createShopReadinessStateDefinition); Etsy refuses one identical to an existing profile. Returns it.",
      properties: fieldProps(PROCESSING_FIELDS),
      required: requiredOf(PROCESSING_FIELDS),
      scopes: W,
      run: async (shop, a) => processingOut(await api.createProcessingProfile(c(), shop, fieldsOf(a, PROCESSING_FIELDS)))
    }),
    write({
      name: 'update_my_processing_profile',
      title: 'Change an Etsy processing profile',
      description:
        "Changes a processing profile (updateShopReadinessStateDefinition); only the given fields are sent. Returns it.",
      properties: { processing_profile_id: id('Processing profile id (list_my_processing_profiles).'), ...fieldProps(PROCESSING_FIELDS) },
      required: ['processing_profile_id'],
      scopes: W,
      run: async (shop, a) =>
        processingOut(await api.updateProcessingProfile(c(), shop, Number(a.processing_profile_id), fieldsOf(a, PROCESSING_FIELDS)))
    }),
    write({
      name: 'delete_my_processing_profile',
      title: 'Delete an Etsy processing profile',
      description:
        "Deletes a processing profile (deleteShopReadinessStateDefinition); Etsy refuses it while active listings use it.",
      properties: { processing_profile_id: id('Processing profile id (list_my_processing_profiles).') },
      required: ['processing_profile_id'],
      scopes: W,
      run: async (shop, a) => {
        await api.deleteProcessingProfile(c(), shop, Number(a.processing_profile_id))
        return deleted
      }
    }),

    // -------------------------------------------------------------- returns
    read({
      name: 'list_my_return_policies',
      title: 'My Etsy return policies',
      description:
        "The return policies of the user's Etsy shop (getShopReturnPolicies): whether returns and exchanges are accepted and the deadline in days.",
      scopes: [],
      run: async (shop) => ({ policies: (await api.listReturnPolicies(c(), shop)).map(returnOut) })
    }),
    write({
      name: 'create_my_return_policy',
      title: 'Create an Etsy return policy',
      description:
        "Creates a return policy (createShopReturnPolicy; a deadline is required when returns or exchanges are accepted). Returns it.",
      properties: fieldProps(RETURN_POLICY_FIELDS),
      required: requiredOf(RETURN_POLICY_FIELDS),
      scopes: W,
      run: async (shop, a) => returnOut(await api.createReturnPolicy(c(), shop, fieldsOf(a, RETURN_POLICY_FIELDS)))
    }),
    write({
      name: 'update_my_return_policy',
      title: 'Change an Etsy return policy',
      description:
        "Replaces the terms of a return policy (updateShopReturnPolicy; both flags are required). Etsy refuses terms that duplicate another policy — merge them with consolidate_my_return_policies then. Returns it.",
      properties: { return_policy_id: id('Return policy id (list_my_return_policies).'), ...fieldProps(RETURN_POLICY_FIELDS) },
      required: ['return_policy_id', ...requiredOf(RETURN_POLICY_FIELDS)],
      scopes: W,
      run: async (shop, a) =>
        returnOut(await api.updateReturnPolicy(c(), shop, Number(a.return_policy_id), fieldsOf(a, RETURN_POLICY_FIELDS)))
    }),
    write({
      name: 'delete_my_return_policy',
      title: 'Delete an Etsy return policy',
      description:
        "Deletes a return policy (deleteShopReturnPolicy); only possible when no listing uses it (move them first, e.g. with consolidate_my_return_policies).",
      properties: { return_policy_id: id('Return policy id (list_my_return_policies).') },
      required: ['return_policy_id'],
      scopes: W,
      run: async (shop, a) => {
        await api.deleteReturnPolicy(c(), shop, Number(a.return_policy_id))
        return deleted
      }
    }),
    write({
      name: 'consolidate_my_return_policies',
      title: 'Merge two Etsy return policies',
      description:
        "Moves every listing of the source return policy to the destination policy and deletes the source policy (consolidateShopReturnPolicies). Returns the destination policy.",
      properties: {
        source_return_policy_id: id('The policy to empty and delete.'),
        destination_return_policy_id: id('The policy that gets its products.')
      },
      required: ['source_return_policy_id', 'destination_return_policy_id'],
      scopes: W,
      run: async (shop, a) =>
        returnOut(
          await api.consolidateReturnPolicies(c(), shop, Number(a.source_return_policy_id), Number(a.destination_return_policy_id))
        )
    }),
    read({
      name: 'list_products_by_return_policy',
      title: 'Listings of an Etsy return policy',
      description:
        "The listings of the user's Etsy shop that use one return policy (getListingsByShopReturnPolicy): product_id, title, state.",
      properties: { return_policy_id: id('Return policy id (list_my_return_policies).') },
      required: ['return_policy_id'],
      scopes: SCOPES.listingRead,
      run: async (shop, a) => ({ products: (await api.listPolicyListings(c(), shop, Number(a.return_policy_id))).map(policyListingOut) })
    }),

    // ------------------------------------------------- holidays, partners
    read({
      name: 'get_my_holidays',
      title: 'My Etsy holiday schedule',
      description:
        "The public holidays of the Etsy shop's country and whether the shop processes orders on each (getHolidayPreferences; is_working). Etsy offers them only for some countries.",
      scopes: R,
      run: async (shop) => ({ holidays: (await api.listHolidays(c(), shop)).map(holidayOut) })
    }),
    write({
      name: 'set_my_holiday',
      title: 'Work on a holiday or not',
      description:
        "Sets whether the user's Etsy shop processes orders on one holiday (updateHolidayPreferences; holiday_id from get_my_holidays). Returns the holiday.",
      properties: {
        holiday_id: { type: 'integer', minimum: 1, maximum: HOLIDAY_ID_MAX, description: 'Holiday id (get_my_holidays).' },
        is_working: { type: 'boolean', description: 'true = the shop processes orders that day.' }
      },
      required: ['holiday_id', 'is_working'],
      scopes: W,
      run: async (shop, a) => holidayOut(await api.setHoliday(c(), shop, Number(a.holiday_id), a.is_working))
    }),
    read({
      name: 'list_my_production_partners',
      title: 'My Etsy production partners',
      description:
        "The production partners (outside makers) the user declared for their Etsy shop (getShopProductionPartners): id, name, location.",
      scopes: R,
      run: async (shop) => ({ partners: (await api.listPartners(c(), shop)).map(partnerOut) })
    })
  ]
}
