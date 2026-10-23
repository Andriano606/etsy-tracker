// The MCP modal's tool list of every feature (see main/features). Same order as FEATURES.

import { ACCOUNT_TOOL_SUMMARY } from './account'
import { MARKET_TOOL_SUMMARY } from './market'
import { COMPETE_TOOL_SUMMARY } from './compete'
import { INVENTORY_TOOL_SUMMARY } from './inventory'
import { MEDIA_TOOL_SUMMARY } from './media'
import { LISTING_META_TOOL_SUMMARY } from './listingMeta'
import { SHOP_CONFIG_TOOL_SUMMARY } from './shopConfig'
import { ORDERS_TOOL_SUMMARY } from './orders'

export const FEATURE_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  ...MARKET_TOOL_SUMMARY,
  ...COMPETE_TOOL_SUMMARY,
  ...INVENTORY_TOOL_SUMMARY,
  ...MEDIA_TOOL_SUMMARY,
  ...LISTING_META_TOOL_SUMMARY,
  ...SHOP_CONFIG_TOOL_SUMMARY,
  ...ORDERS_TOOL_SUMMARY,
  ...ACCOUNT_TOOL_SUMMARY
]
