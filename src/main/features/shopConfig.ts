// Feature "shopConfig": the own shop's configuration — sections (+ a listing's
// section), shipping profiles with destinations and upgrades, carriers,
// processing profiles, return policies (+ consolidate, listings per policy),
// holidays and production partners. The calls are in shopConfig/api.ts, the
// MCP tools in shopConfig/mcp.ts; each action checks the sign-in and the OAS
// scopes of its operation first.

import * as api from './shopConfig/api'
import { SCOPES } from './shopConfig/api'
import { shopConfigTools } from './shopConfig/mcp'
import { FeatureError, idArg, ownShop } from './common'
import type { Feature, FeatureAction, FeatureCtx } from './types'

type Scopes = readonly string[]

/** An own-shop action: the shop id (signed in + `scopes`) and the args. */
const own =
  (scopes: Scopes, run: (shopId: number, args: Record<string, unknown>, ctx: FeatureCtx) => unknown): FeatureAction =>
  (args, ctx) =>
    run(ownShop(ctx.authStatus, scopes), args, ctx)

/** A section id, or 0 = "no section" — given explicitly (a number or digits), never a missing/empty value. */
function sectionChoice(args: Record<string, unknown>): number {
  const v = args.sectionId
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN
  if (!Number.isSafeInteger(n) || n < 0) throw new FeatureError('Некоректний sectionId.')
  return n
}

const done = async (p: Promise<void>): Promise<null> => {
  await p
  return null
}

const R = SCOPES.shopRead
const W = SCOPES.shopWrite

export const shopConfigFeature: Feature = {
  id: 'shopConfig',
  actions: {
    // Sections: getShopSections / getShopSection are public (API key); writes need shops_w.
    sections: own([], (shop, _a, ctx) => api.listSections(ctx.client, shop)),
    section: own([], (shop, a, ctx) => api.getSection(ctx.client, shop, idArg(a, 'sectionId'))),
    createSection: own(W, (shop, a, ctx) => api.createSection(ctx.client, shop, a.input)),
    updateSection: own(W, (shop, a, ctx) => api.updateSection(ctx.client, shop, idArg(a, 'sectionId'), a.input)),
    deleteSection: own(W, (shop, a, ctx) => done(api.deleteSection(ctx.client, shop, idArg(a, 'sectionId')))),
    listingSection: own([], (shop, a, ctx) => api.listingSection(ctx.client, shop, idArg(a, 'listingId'))),
    setListingSection: own(SCOPES.listingWrite, (shop, a, ctx) =>
      api.setListingSection(ctx.client, shop, idArg(a, 'listingId'), sectionChoice(a))
    ),

    // Shipping profiles, destinations, upgrades.
    shippingProfiles: own(R, (shop, _a, ctx) => api.listShippingProfiles(ctx.client, shop)),
    shippingProfile: own(R, (shop, a, ctx) => api.getShippingProfile(ctx.client, shop, idArg(a, 'profileId'))),
    createShippingProfile: own(W, (shop, a, ctx) => api.createShippingProfile(ctx.client, shop, a.input)),
    updateShippingProfile: own(W, (shop, a, ctx) => api.updateShippingProfile(ctx.client, shop, idArg(a, 'profileId'), a.input)),
    deleteShippingProfile: own(W, (shop, a, ctx) => done(api.deleteShippingProfile(ctx.client, shop, idArg(a, 'profileId')))),
    destinations: own(R, (shop, a, ctx) => api.listDestinations(ctx.client, shop, idArg(a, 'profileId'))),
    createDestination: own(W, (shop, a, ctx) => api.createDestination(ctx.client, shop, idArg(a, 'profileId'), a.input)),
    updateDestination: own(W, (shop, a, ctx) =>
      api.updateDestination(ctx.client, shop, idArg(a, 'profileId'), idArg(a, 'destinationId'), a.input)
    ),
    deleteDestination: own(W, (shop, a, ctx) =>
      done(api.deleteDestination(ctx.client, shop, idArg(a, 'profileId'), idArg(a, 'destinationId')))
    ),
    upgrades: own(R, (shop, a, ctx) => api.listUpgrades(ctx.client, shop, idArg(a, 'profileId'))),
    createUpgrade: own(W, (shop, a, ctx) => api.createUpgrade(ctx.client, shop, idArg(a, 'profileId'), a.input)),
    updateUpgrade: own(W, (shop, a, ctx) => api.updateUpgrade(ctx.client, shop, idArg(a, 'profileId'), idArg(a, 'upgradeId'), a.input)),
    deleteUpgrade: own(W, (shop, a, ctx) => done(api.deleteUpgrade(ctx.client, shop, idArg(a, 'profileId'), idArg(a, 'upgradeId')))),
    // getShippingCarriers is public (API key): no sign-in needed.
    carriers: (a, ctx) => api.listCarriers(ctx.client, a.country),

    // Processing profiles (readiness state definitions).
    processingProfiles: own(R, (shop, _a, ctx) => api.listProcessingProfiles(ctx.client, shop)),
    processingProfile: own(R, (shop, a, ctx) => api.getProcessingProfile(ctx.client, shop, idArg(a, 'id'))),
    createProcessingProfile: own(W, (shop, a, ctx) => api.createProcessingProfile(ctx.client, shop, a.input)),
    updateProcessingProfile: own(W, (shop, a, ctx) => api.updateProcessingProfile(ctx.client, shop, idArg(a, 'id'), a.input)),
    deleteProcessingProfile: own(W, (shop, a, ctx) => done(api.deleteProcessingProfile(ctx.client, shop, idArg(a, 'id')))),

    // Return policies: the two reads are public (API key).
    returnPolicies: own([], (shop, _a, ctx) => api.listReturnPolicies(ctx.client, shop)),
    returnPolicy: own([], (shop, a, ctx) => api.getReturnPolicy(ctx.client, shop, idArg(a, 'id'))),
    createReturnPolicy: own(W, (shop, a, ctx) => api.createReturnPolicy(ctx.client, shop, a.input)),
    updateReturnPolicy: own(W, (shop, a, ctx) => api.updateReturnPolicy(ctx.client, shop, idArg(a, 'id'), a.input)),
    deleteReturnPolicy: own(W, (shop, a, ctx) => done(api.deleteReturnPolicy(ctx.client, shop, idArg(a, 'id')))),
    consolidateReturnPolicies: own(W, (shop, a, ctx) =>
      api.consolidateReturnPolicies(ctx.client, shop, idArg(a, 'sourceId'), idArg(a, 'destinationId'))
    ),
    returnPolicyListings: own(SCOPES.listingRead, (shop, a, ctx) => api.listPolicyListings(ctx.client, shop, idArg(a, 'id'))),

    // Holidays, production partners.
    holidays: own(R, (shop, _a, ctx) => api.listHolidays(ctx.client, shop)),
    setHoliday: own(W, (shop, a, ctx) => api.setHoliday(ctx.client, shop, idArg(a, 'holidayId'), a.isWorking)),
    partners: own(R, (shop, _a, ctx) => api.listPartners(ctx.client, shop))
  },
  mcpTools: shopConfigTools
}
