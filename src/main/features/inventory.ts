// Feature "inventory": the own listings' price, quantity, SKU and variations
// (getListingInventory, updateListingInventory, getListingsInventoryByListingIds,
// getListingProduct, getListingOffering) and variation images
// (getListingVariationImages, updateVariationImages). Calls and mapping in
// inventory/api.ts, MCP tools in inventory/mcp.ts.

import { parsePrice } from '../../shared/myShop'
import { INV_MAX_QUANTITY } from '../../shared/features/inventory'
import { FeatureError, idArg, ownShop, strArg } from './common'
import {
  READ_SCOPES,
  WRITE_SCOPES,
  getInventory,
  getOffering,
  getProduct,
  overviewPage,
  parseVariationItems,
  parseWrite,
  putInventory,
  setVariationImages,
  updateSingle,
  variationImagesData,
  type SingleChange
} from './inventory/api'
import { inventoryMcpTools } from './inventory/mcp'
import type { Feature } from './types'

/** quickUpdate's optional price / quantity / SKU (at least one). */
export function singleChangeArgs(args: Record<string, unknown>): SingleChange {
  const c: SingleChange = {}
  if (args.price != null) {
    const p = typeof args.price === 'number' ? args.price : parsePrice(String(args.price))
    if (p == null || !(p > 0)) throw new FeatureError('Ціна — додатне число, напр. 5.99.')
    c.price = p
  }
  if (args.quantity != null) {
    const q = Number(args.quantity)
    if (!Number.isSafeInteger(q) || q < 0 || q > INV_MAX_QUANTITY) {
      throw new FeatureError(`Кількість — ціле число від 0 до ${INV_MAX_QUANTITY}.`)
    }
    c.quantity = q
  }
  if (args.sku != null) c.sku = strArg(args, 'sku', { max: 255 })
  if (!Object.keys(c).length) throw new FeatureError('Нічого не змінено.')
  return c
}

const offsetArg = (args: Record<string, unknown>): number => {
  const n = Number(args.offset ?? 0)
  if (!Number.isSafeInteger(n) || n < 0) throw new FeatureError('Некоректний offset.')
  return n
}

export const inventoryFeature: Feature = {
  id: 'inventory',
  actions: {
    get: (args, ctx) => {
      ownShop(ctx.authStatus, READ_SCOPES)
      return getInventory(ctx.client, idArg(args, 'listingId'))
    },
    update: (args, ctx) => {
      ownShop(ctx.authStatus, WRITE_SCOPES)
      const listingId = idArg(args, 'listingId')
      return putInventory(ctx.client, listingId, parseWrite(args.inventory))
    },
    product: (args, ctx) => {
      ownShop(ctx.authStatus, READ_SCOPES)
      return getProduct(ctx.client, idArg(args, 'listingId'), idArg(args, 'productId'))
    },
    offering: (args, ctx) => {
      ownShop(ctx.authStatus)
      return getOffering(ctx.client, idArg(args, 'listingId'), idArg(args, 'productId'), idArg(args, 'offeringId'))
    },
    overview: (args, ctx) => {
      const shopId = ownShop(ctx.authStatus, READ_SCOPES)
      return overviewPage(ctx.client, shopId, offsetArg(args))
    },
    quickUpdate: (args, ctx) => {
      ownShop(ctx.authStatus, [...READ_SCOPES, ...WRITE_SCOPES])
      const listingId = idArg(args, 'listingId')
      return updateSingle(ctx.client, listingId, singleChangeArgs(args))
    },
    variationImages: (args, ctx) => {
      const shopId = ownShop(ctx.authStatus, READ_SCOPES)
      return variationImagesData(ctx.client, shopId, idArg(args, 'listingId'))
    },
    saveVariationImages: (args, ctx) => {
      const shopId = ownShop(ctx.authStatus, WRITE_SCOPES)
      const listingId = idArg(args, 'listingId')
      return setVariationImages(ctx.client, shopId, listingId, parseVariationItems(args.items))
    }
  },
  mcpTools: inventoryMcpTools
}
