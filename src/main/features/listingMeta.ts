// Feature "listingMeta": the own listings' attributes (category properties),
// personalization questions and translations, and deleting a listing. The
// Etsy calls are in listingMeta/api.ts, the MCP tools in listingMeta/mcp.ts.

import { type PropertyInput, isTranslationLanguage } from '../../shared/features/listingMeta'
import {
  categoryProperties,
  deleteListing,
  listingProperty,
  loadAttributes,
  loadPersonalization,
  loadTranslation,
  parseQuestions,
  removePersonalization,
  removeProperty,
  saveProperty,
  savePersonalization,
  saveTranslation
} from './listingMeta/api'
import { listingMetaTools } from './listingMeta/mcp'
import { FeatureError, idArg, optIdArg, ownShop, strArg } from './common'
import type { Feature } from './types'

type Args = Record<string, unknown>

function languageArg(a: Args): string {
  if (!isTranslationLanguage(a.language)) throw new FeatureError('Невідома мова перекладу.')
  return a.language
}

function listArg<T>(a: Args, name: string, ok: (v: unknown) => v is T): T[] {
  const v = a[name] ?? []
  if (!Array.isArray(v) || !v.every(ok)) throw new FeatureError(`Некоректне поле ${name}.`)
  return v
}

const isNum = (v: unknown): v is number => typeof v === 'number'
const isStr = (v: unknown): v is string => typeof v === 'string'

function propertyArg(a: Args): PropertyInput {
  return { valueIds: listArg(a, 'valueIds', isNum), values: listArg(a, 'values', isStr), scaleId: optIdArg(a, 'scaleId') }
}

export const listingMetaFeature: Feature = {
  id: 'listingMeta',
  actions: {
    /** The seller categories as "A › B › C" (to pick one when the listing's is unknown). */
    categories: (_a, ctx) => ctx.taxonomy(),
    categoryAttributes: (a, ctx) => categoryProperties(ctx.client, idArg(a, 'taxonomyId')),
    attributes: (a, ctx) =>
      loadAttributes(ctx.client, ctx.taxonomy, ownShop(ctx.authStatus), idArg(a, 'listingId'), optIdArg(a, 'taxonomyId')),
    attribute: (a, ctx) => listingProperty(ctx.client, ownShop(ctx.authStatus), idArg(a, 'listingId'), idArg(a, 'propertyId')),
    saveAttribute: (a, ctx) =>
      saveProperty(ctx.client, ownShop(ctx.authStatus, ['listings_w']), idArg(a, 'listingId'), idArg(a, 'propertyId'), propertyArg(a)),
    removeAttribute: async (a, ctx) => {
      await removeProperty(ctx.client, ownShop(ctx.authStatus, ['listings_w']), idArg(a, 'listingId'), idArg(a, 'propertyId'))
      return true
    },
    personalization: (a, ctx) => {
      ownShop(ctx.authStatus)
      return loadPersonalization(ctx.client, idArg(a, 'listingId'))
    },
    savePersonalization: (a, ctx) =>
      savePersonalization(ctx.client, ownShop(ctx.authStatus, ['listings_w']), idArg(a, 'listingId'), parseQuestions(a.questions)),
    removePersonalization: async (a, ctx) => {
      await removePersonalization(ctx.client, ownShop(ctx.authStatus, ['listings_w']), idArg(a, 'listingId'))
      return true
    },
    translation: (a, ctx) => loadTranslation(ctx.client, ownShop(ctx.authStatus), idArg(a, 'listingId'), languageArg(a)),
    saveTranslation: (a, ctx) => {
      const shopId = ownShop(ctx.authStatus, ['listings_w'])
      const input = { title: strArg(a, 'title'), description: strArg(a, 'description'), tags: listArg(a, 'tags', isStr) }
      const exists = typeof a.exists === 'boolean' ? a.exists : undefined
      return saveTranslation(ctx.client, shopId, idArg(a, 'listingId'), languageArg(a), input, exists)
    },
    deleteListing: async (a, ctx) => {
      ownShop(ctx.authStatus, ['listings_d'])
      await deleteListing(ctx.client, idArg(a, 'listingId'))
      return true
    }
  },
  mcpTools: listingMetaTools
}
