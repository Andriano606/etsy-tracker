// The only URLs the app will hand to the system browser: https pages on etsy.com
// (the shops, listings and the developer portal). Everything else is refused.

export function isAllowedExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return host === 'etsy.com' || host.endsWith('.etsy.com')
}

/**
 * An image URL main may fetch: `https:` on etsystatic.com or a subdomain, no
 * credentials. Everything image-related that came from Etsy JSON goes through
 * this before Electron's `net.fetch` (which would also read `file:` URLs and
 * custom protocols such as our own `etsyimg:`).
 */
export function isEtsyCdnUrl(raw: string | null | undefined): boolean {
  if (!raw) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return host === 'etsystatic.com' || host.endsWith('.etsystatic.com')
}
