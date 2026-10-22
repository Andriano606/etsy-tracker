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
