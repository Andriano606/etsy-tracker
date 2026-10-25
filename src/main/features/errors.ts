// The feature error class on its own (no imports), so the Etsy-side helpers of
// features (inventory/media/listingMeta api) can be reused by drafts.ts without
// pulling in common.ts → mcpStoreTools.ts → drafts.ts (an import cycle).

/** A Ukrainian message for a refused action — shown as is (IPC and MCP). */
export class FeatureError extends Error {}
