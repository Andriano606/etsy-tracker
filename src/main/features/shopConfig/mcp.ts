// The neutral MCP tools of the shop configuration: reads need the user's store
// signed in (+ the scope); writes also need the "allow changes" switch. Every
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
import { neutralText } from '../../neutral'
import { mcpFail, mcpOwnShop, mcpWritable } from '../common'
import type { FeatureMcpDeps } from '../types'
import * as api from './api'
import { ConfigError, SCOPES } from './api'

// ------------------------------------------------------------------ outputs

const money = (m: Money | null) => (m ? { amount: priceValue(m.amount, m.divisor), currency: m.currency } : null)

const sectionOut = (s: ShopSection) => ({
  id: s.id,
  title: neutralText(s.title),
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
  name: neutralText(u.name),
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
  title: neutralText(p.title),
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
  label: neutralText(p.label)
})

const returnOut = (r: ReturnPolicy) => ({
  id: r.id,
  accepts_returns: r.acceptsReturns,
  accepts_exchanges: r.acceptsExchanges,
  return_deadline_days: r.returnDeadline
})

const policyListingOut = (l: PolicyListing) => ({ product_id: l.listingId, title: neutralText(l.title), state: l.state })

const holidayOut = (h: HolidayPreference) => ({
  holiday_id: h.holidayId,
  country: h.countryIso,
  name: neutralText(h.name),
  is_working: h.isWorking
})

const partnerOut = (p: ProductionPartner) => ({ id: p.id, name: neutralText(p.name), location: neutralText(p.location) })

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

const PROFILE_ID = id('Shipping profile id (list_my_shipping_profiles).')

/** The spec fields of `args` (ids and other tool-only arguments left out). */
const fieldsOf = (args: Record<string, unknown>, specs: readonly FieldSpec[]): Record<string, unknown> =>
  Object.fromEntries(specs.filter((f) => args[f.name] !== undefined).map((f) => [f.name, args[f.name]]))

// -------------------------------------------------------------------- tools

const LIVE = "changes the user's live store, visible to buyers — only when the user asked"

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
    description: write ? `${d.description} This ${LIVE}.` : d.description,
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
      title: 'My store sections',
      description: "The sections (shelves) of the user's own store: id, title, position and how many active products each has.",
      scopes: [],
      run: async (shop) => ({ sections: (await api.listSections(c(), shop)).map(sectionOut) })
    }),
    write({
      name: 'create_my_section',
      title: 'Create a store section',
      description: "Creates a section in the user's store and returns it.",
      properties: fieldProps(SECTION_FIELDS),
      required: ['title'],
      scopes: W,
      run: async (shop, a) => sectionOut(await api.createSection(c(), shop, fieldsOf(a, SECTION_FIELDS)))
    }),
    write({
      name: 'update_my_section',
      title: 'Rename a store section',
      description: 'Renames a section of the user\'s store and returns it.',
      properties: { section_id: id('Section id (list_my_sections).'), ...fieldProps(SECTION_FIELDS) },
      required: ['section_id', 'title'],
      scopes: W,
      run: async (shop, a) => sectionOut(await api.updateSection(c(), shop, Number(a.section_id), fieldsOf(a, SECTION_FIELDS)))
    }),
    write({
      name: 'delete_my_section',
      title: 'Delete a store section',
      description: 'Deletes a section of the user\'s store (its products stay, without a section).',
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
      title: 'Put a product into a section',
      description: "Moves one of the user's products into a section of their store (section_id 0 = no section). Returns the product id, title and state.",
      properties: {
        product_id: id("The user's product id (list_my_products)."),
        section_id: { type: 'integer', minimum: 0, description: 'Section id (list_my_sections), 0 = no section.' }
      },
      required: ['product_id', 'section_id'],
      scopes: SCOPES.listingWrite,
      run: async (shop, a) => {
        const l = await api.setListingSection(c(), shop, Number(a.product_id), Number(a.section_id))
        return { product_id: l.listingId, title: neutralText(l.title), state: l.state, section_id: Number(a.section_id) || null }
      }
    }),

    // ------------------------------------------------------------- shipping
    read({
      name: 'list_my_shipping_profiles',
      title: 'My shipping profiles',
      description:
        "The user's shipping profiles: origin, handling fees, every destination (country or region, cost for one item and each additional item, carrier/mail class or delivery days) and upgrades (paid faster options). Money amounts are in the store's currency.",
      scopes: R,
      run: async (shop) => ({ profiles: (await api.listShippingProfiles(c(), shop)).map(profileOut) })
    }),
    read({
      name: 'get_my_shipping_profile',
      title: 'One shipping profile',
      description: 'One shipping profile of the user with its destinations and upgrades.',
      properties: { profile_id: PROFILE_ID },
      required: ['profile_id'],
      scopes: R,
      run: async (shop, a) => profileOut(await api.getShippingProfile(c(), shop, Number(a.profile_id)))
    }),
    write({
      name: 'create_my_shipping_profile',
      title: 'Create a shipping profile',
      description:
        'Creates a shipping profile with its first destination: a destination country or a region (not both), the costs, and either a carrier + mail class or min + max delivery days. Returns the profile.',
      properties: fieldProps(PROFILE_CREATE_FIELDS),
      required: requiredOf(PROFILE_CREATE_FIELDS),
      scopes: W,
      run: async (shop, a) => profileOut(await api.createShippingProfile(c(), shop, fieldsOf(a, PROFILE_CREATE_FIELDS)))
    }),
    write({
      name: 'update_my_shipping_profile',
      title: 'Change a shipping profile',
      description: 'Changes the title, origin or processing time of a shipping profile; only the given fields change. Returns the profile.',
      properties: { profile_id: PROFILE_ID, ...fieldProps(PROFILE_UPDATE_FIELDS) },
      required: ['profile_id'],
      scopes: W,
      run: async (shop, a) =>
        profileOut(await api.updateShippingProfile(c(), shop, Number(a.profile_id), fieldsOf(a, PROFILE_UPDATE_FIELDS)))
    }),
    write({
      name: 'delete_my_shipping_profile',
      title: 'Delete a shipping profile',
      description: 'Deletes a shipping profile of the user.',
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
      title: 'Destinations of a shipping profile',
      description: 'Every destination of one shipping profile: where, the costs, carrier/mail class, delivery days.',
      properties: { profile_id: PROFILE_ID },
      required: ['profile_id'],
      scopes: R,
      run: async (shop, a) => ({ destinations: (await api.listDestinations(c(), shop, Number(a.profile_id))).map(destinationOut) })
    }),
    write({
      name: 'create_my_shipping_destination',
      title: 'Add a shipping destination',
      description:
        'Adds a destination to a shipping profile: a country or a region (neither = everywhere else), the costs, and either a carrier + mail class or min + max delivery days. Returns it.',
      properties: { profile_id: PROFILE_ID, ...fieldProps(DESTINATION_FIELDS) },
      required: ['profile_id', ...requiredOf(DESTINATION_FIELDS)],
      scopes: W,
      run: async (shop, a) =>
        destinationOut(await api.createDestination(c(), shop, Number(a.profile_id), fieldsOf(a, DESTINATION_FIELDS)))
    }),
    write({
      name: 'update_my_shipping_destination',
      title: 'Change a shipping destination',
      description: 'Changes a destination of a shipping profile; only the given fields change. Returns it.',
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
      title: 'Delete a shipping destination',
      description: 'Deletes a destination of a shipping profile.',
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
      title: 'Upgrades of a shipping profile',
      description: 'The paid shipping upgrades (e.g. express) of one shipping profile: name, domestic/international, extra prices, carrier or delivery days.',
      properties: { profile_id: PROFILE_ID },
      required: ['profile_id'],
      scopes: R,
      run: async (shop, a) => ({ upgrades: (await api.listUpgrades(c(), shop, Number(a.profile_id))).map(upgradeOut) })
    }),
    write({
      name: 'create_my_shipping_upgrade',
      title: 'Add a shipping upgrade',
      description:
        'Adds a paid shipping upgrade to a shipping profile: type, name, extra prices, and either a carrier + mail class or min + max delivery days. Returns it.',
      properties: { profile_id: PROFILE_ID, ...fieldProps(UPGRADE_FIELDS) },
      required: ['profile_id', ...requiredOf(UPGRADE_FIELDS)],
      scopes: W,
      run: async (shop, a) => upgradeOut(await api.createUpgrade(c(), shop, Number(a.profile_id), fieldsOf(a, UPGRADE_FIELDS)))
    }),
    write({
      name: 'update_my_shipping_upgrade',
      title: 'Change a shipping upgrade',
      description: 'Changes a shipping upgrade; only the given fields change. Returns it.',
      properties: { profile_id: PROFILE_ID, upgrade_id: id('Upgrade id.'), ...fieldProps(UPGRADE_FIELDS) },
      required: ['profile_id', 'upgrade_id'],
      scopes: W,
      run: async (shop, a) =>
        upgradeOut(await api.updateUpgrade(c(), shop, Number(a.profile_id), Number(a.upgrade_id), fieldsOf(a, UPGRADE_FIELDS)))
    }),
    write({
      name: 'delete_my_shipping_upgrade',
      title: 'Delete a shipping upgrade',
      description: 'Deletes a shipping upgrade of a shipping profile.',
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
      title: 'My processing profiles',
      description: "The user's processing profiles: ready_to_ship or made_to_order, and the processing time range in days.",
      scopes: R,
      run: async (shop) => ({ profiles: (await api.listProcessingProfiles(c(), shop)).map(processingOut) })
    }),
    write({
      name: 'create_my_processing_profile',
      title: 'Create a processing profile',
      description: 'Creates a processing profile (an identical one is refused). Returns it.',
      properties: fieldProps(PROCESSING_FIELDS),
      required: requiredOf(PROCESSING_FIELDS),
      scopes: W,
      run: async (shop, a) => processingOut(await api.createProcessingProfile(c(), shop, fieldsOf(a, PROCESSING_FIELDS)))
    }),
    write({
      name: 'update_my_processing_profile',
      title: 'Change a processing profile',
      description: 'Changes a processing profile; only the given fields change. Returns it.',
      properties: { processing_profile_id: id('Processing profile id (list_my_processing_profiles).'), ...fieldProps(PROCESSING_FIELDS) },
      required: ['processing_profile_id'],
      scopes: W,
      run: async (shop, a) =>
        processingOut(await api.updateProcessingProfile(c(), shop, Number(a.processing_profile_id), fieldsOf(a, PROCESSING_FIELDS)))
    }),
    write({
      name: 'delete_my_processing_profile',
      title: 'Delete a processing profile',
      description: 'Deletes a processing profile (refused while active products use it).',
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
      title: 'My return policies',
      description: "The user's return policies: whether returns and exchanges are accepted and the deadline in days.",
      scopes: [],
      run: async (shop) => ({ policies: (await api.listReturnPolicies(c(), shop)).map(returnOut) })
    }),
    write({
      name: 'create_my_return_policy',
      title: 'Create a return policy',
      description: 'Creates a return policy (a deadline is required when returns or exchanges are accepted). Returns it.',
      properties: fieldProps(RETURN_POLICY_FIELDS),
      required: requiredOf(RETURN_POLICY_FIELDS),
      scopes: W,
      run: async (shop, a) => returnOut(await api.createReturnPolicy(c(), shop, fieldsOf(a, RETURN_POLICY_FIELDS)))
    }),
    write({
      name: 'update_my_return_policy',
      title: 'Change a return policy',
      description:
        'Replaces the terms of a return policy (both flags are required; a duplicate of another policy is refused — use consolidate_my_return_policies then). Returns it.',
      properties: { return_policy_id: id('Return policy id (list_my_return_policies).'), ...fieldProps(RETURN_POLICY_FIELDS) },
      required: ['return_policy_id', ...requiredOf(RETURN_POLICY_FIELDS)],
      scopes: W,
      run: async (shop, a) =>
        returnOut(await api.updateReturnPolicy(c(), shop, Number(a.return_policy_id), fieldsOf(a, RETURN_POLICY_FIELDS)))
    }),
    write({
      name: 'delete_my_return_policy',
      title: 'Delete a return policy',
      description: 'Deletes a return policy; only possible when no product uses it (move them first, e.g. with consolidate_my_return_policies).',
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
      title: 'Merge two return policies',
      description: 'Moves every product of the source return policy to the destination policy and deletes the source policy. Returns the destination policy.',
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
      title: 'Products of a return policy',
      description: "The user's products that use one return policy: product id, title, state.",
      properties: { return_policy_id: id('Return policy id (list_my_return_policies).') },
      required: ['return_policy_id'],
      scopes: SCOPES.listingRead,
      run: async (shop, a) => ({ products: (await api.listPolicyListings(c(), shop, Number(a.return_policy_id))).map(policyListingOut) })
    }),

    // ------------------------------------------------- holidays, partners
    read({
      name: 'get_my_holidays',
      title: 'My holiday schedule',
      description: "The public holidays of the user's store country and whether the store processes orders on each (is_working). Only some countries have them.",
      scopes: R,
      run: async (shop) => ({ holidays: (await api.listHolidays(c(), shop)).map(holidayOut) })
    }),
    write({
      name: 'set_my_holiday',
      title: 'Work on a holiday or not',
      description: 'Sets whether the user\'s store processes orders on one holiday (get_my_holidays). Returns the holiday.',
      properties: {
        holiday_id: { type: 'integer', minimum: 1, maximum: HOLIDAY_ID_MAX, description: 'Holiday id (get_my_holidays).' },
        is_working: { type: 'boolean', description: 'true = the store processes orders that day.' }
      },
      required: ['holiday_id', 'is_working'],
      scopes: W,
      run: async (shop, a) => holidayOut(await api.setHoliday(c(), shop, Number(a.holiday_id), a.is_working))
    }),
    read({
      name: 'list_my_production_partners',
      title: 'My production partners',
      description: 'The production partners (outside makers) the user listed for their store: id, name, location.',
      scopes: R,
      run: async (shop) => ({ partners: (await api.listPartners(c(), shop)).map(partnerOut) })
    })
  ]
}
