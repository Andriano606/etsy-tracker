// Feature "compete": live data of any shop / listing (public Etsy reads, API
// key only) — sections and their listings, featured listings, return policies,
// listing properties, images, videos, reviews, personalization, translations,
// variation images and shipping carriers — plus listing shipping profiles
// (getListingsShippingByListingIds, OAuth shops_r; Etsy fills the profile only
// for the user's own listings). IPC actions here, MCP tools in compete/mcp.ts.

import { REVIEWS_PAGE, TRANSLATION_CODES } from '../../shared/features/compete'
import { normalizeCountry } from '../../shared/countries'
import { FeatureError, idArg, strArg } from './common'
import {
  SHIPPING_SCOPES,
  featuredListings,
  listingImage,
  listingImages,
  listingPersonalization,
  listingProperties,
  listingProperty,
  listingReviews,
  listingTranslation,
  listingVideo,
  listingVideos,
  listingsShipping,
  requireSignIn,
  returnPolicies,
  returnPolicy,
  sectionListings,
  shippingCarriers,
  shopSection,
  shopSections,
  variationImages
} from './compete/api'
import { competeMcpTools } from './compete/mcp'
import type { Feature } from './types'

/** The v3 offset cap (larger offsets are refused by Etsy). */
export const MAX_OFFSET = 12000

/** An optional integer in [min, max] (absent → `fallback`), else FeatureError. */
export function intArg(args: Record<string, unknown>, name: string, min: number, max: number, fallback: number): number {
  if (args[name] == null) return fallback
  const n = Number(args[name])
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new FeatureError(`Некоректний ${name}.`)
  return n
}

/** 1…`max` distinct positive ids from `name` (an array) or `single` (one id). */
export function idsArg(args: Record<string, unknown>, name: string, single: string, max: number): number[] {
  if (args[name] == null) return [idArg(args, single)]
  const v = args[name]
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw new FeatureError(`Поле ${name}: від 1 до ${max} id.`)
  const ids = v.map((x) => idArg({ id: x }, 'id'))
  return [...new Set(ids)]
}

export function languageArg(args: Record<string, unknown>): string {
  const lang = strArg(args, 'language', { max: 10 })
  if (!TRANSLATION_CODES.includes(lang)) throw new FeatureError('Невідома мова перекладу.')
  return lang
}

export function countryArg(args: Record<string, unknown>): string {
  const c = normalizeCountry(args.country)
  if (!c) throw new FeatureError('Вкажіть країну двома латинськими літерами (наприклад, UA, US, GB).')
  return c
}

export const competeFeature: Feature = {
  id: 'compete',
  actions: {
    sections: (a, ctx) => shopSections(ctx.client, idArg(a, 'shopId')),
    section: (a, ctx) => shopSection(ctx.client, idArg(a, 'shopId'), idArg(a, 'sectionId')),
    sectionListings: (a, ctx) =>
      sectionListings(ctx.client, idArg(a, 'shopId'), idsArg(a, 'sectionIds', 'sectionId', 100), intArg(a, 'offset', 0, MAX_OFFSET, 0)),
    featured: (a, ctx) => featuredListings(ctx.client, idArg(a, 'shopId'), intArg(a, 'offset', 0, MAX_OFFSET, 0)),
    returnPolicies: (a, ctx) => returnPolicies(ctx.client, idArg(a, 'shopId')),
    returnPolicy: (a, ctx) => returnPolicy(ctx.client, idArg(a, 'shopId'), idArg(a, 'policyId')),
    properties: (a, ctx) => listingProperties(ctx.client, idArg(a, 'shopId'), idArg(a, 'listingId')),
    property: (a, ctx) => listingProperty(ctx.client, idArg(a, 'listingId'), idArg(a, 'propertyId')),
    images: (a, ctx) => listingImages(ctx.client, idArg(a, 'listingId')),
    image: (a, ctx) => listingImage(ctx.client, idArg(a, 'listingId'), idArg(a, 'imageId')),
    videos: (a, ctx) => listingVideos(ctx.client, idArg(a, 'listingId')),
    video: (a, ctx) => listingVideo(ctx.client, idArg(a, 'listingId'), idArg(a, 'videoId')),
    reviews: (a, ctx) =>
      listingReviews(ctx.client, idArg(a, 'listingId'), intArg(a, 'offset', 0, MAX_OFFSET, 0), intArg(a, 'limit', 1, 100, REVIEWS_PAGE)),
    personalization: (a, ctx) => listingPersonalization(ctx.client, idArg(a, 'listingId')),
    translation: (a, ctx) => listingTranslation(ctx.client, idArg(a, 'shopId'), idArg(a, 'listingId'), languageArg(a)),
    variationImages: (a, ctx) => variationImages(ctx.client, idArg(a, 'shopId'), idArg(a, 'listingId')),
    shipping: (a, ctx) => {
      const ids = idsArg(a, 'listingIds', 'listingId', 100)
      requireSignIn(ctx.authStatus, SHIPPING_SCOPES)
      return listingsShipping(ctx.client, ids)
    },
    carriers: (a, ctx) => shippingCarriers(ctx.client, countryArg(a))
  },
  mcpTools: competeMcpTools
}
