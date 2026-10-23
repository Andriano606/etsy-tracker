// Free text from the marketplace's data with its name and links taken out —
// everything the MCP server sends goes through it (mcpTools.ts, mcpStoreTools.ts).

const MARKET_URL = /(?:https?:\/\/)?(?:[\w-]+\.)*(?:etsy\.com|etsy\.me|etsystatic\.com)(?:\/[^\s<>"')\]]*)?/gi
const MARKET_WORD = /(?<![a-z])etsy/gi
/** The marketplace's own name for the seller dashboard (appears in its error texts). */
const MARKET_TERMS = /\bshop manager\b/gi

/** Free text with the marketplace's links and name taken out. */
export function neutralText(s: string): string
export function neutralText(s: string | null | undefined): string | null
export function neutralText(s: string | null | undefined): string | null {
  if (s == null) return null
  return s.replace(MARKET_URL, '[link]').replace(MARKET_TERMS, 'the store settings').replace(MARKET_WORD, 'marketplace')
}

