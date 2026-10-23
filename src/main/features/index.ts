// Every feature (see types.ts). Order = order of their MCP tools.

import type { Feature, FeatureMcpDeps } from './types'
import type { McpTool } from '../mcpProtocol'
import { accountFeature } from './account'
import { marketFeature } from './market'
import { competeFeature } from './compete'
import { inventoryFeature } from './inventory'
import { mediaFeature } from './media'
import { listingMetaFeature } from './listingMeta'
import { shopConfigFeature } from './shopConfig'
import { ordersFeature } from './orders'

export const FEATURES: readonly Feature[] = [
  marketFeature,
  competeFeature,
  inventoryFeature,
  mediaFeature,
  listingMetaFeature,
  shopConfigFeature,
  ordersFeature,
  accountFeature
]

export function featureMcpTools(deps: FeatureMcpDeps): McpTool[] {
  return FEATURES.flatMap((f) => f.mcpTools?.(deps) ?? [])
}
