// Turn whatever the user pasted (a shop link in any of its shapes, or a bare
// shop name) into an Etsy shop name. Pure — no network; the name is resolved to
// a shop_id later through the API.

export type ShopInputResult = { ok: true; shopName: string } | { ok: false; error: string }

/** Etsy shop names are letters and digits only (Etsy: 4–20 chars; legacy shops may differ). */
const SHOP_NAME = /^[A-Za-z0-9]{2,40}$/

/** Subdomains of etsy.com that are Etsy's own, never `<ShopName>.etsy.com`. */
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'm',
  'help',
  'api',
  'openapi',
  'developers',
  'developer',
  'community',
  'blog',
  'i',
  'img',
  'img0',
  'img1',
  'ads',
  'business',
  'investors',
  'careers',
  'pattern',
  'shop',
  'static'
])

/** Locale prefix such as /uk/, /de/, /en-gb/ in front of /shop/. */
const LOCALE = /^[a-z]{2}(-[a-z]{2,4})?$/i

const ERR_EMPTY = 'Вставте посилання на магазин Etsy або назву магазину.'
const ERR_LISTING =
  'Це посилання на товар, а не на магазин. Відкрийте магазин (клік на назву продавця) і скопіюйте його посилання.'
const ERR_NOT_ETSY = 'Це не посилання на Etsy. Потрібне посилання виду https://www.etsy.com/shop/НазваМагазину'
const ERR_NO_SHOP =
  'Не вдалося знайти назву магазину в посиланні. Потрібне посилання виду https://www.etsy.com/shop/НазваМагазину'
const ERR_BAD_NAME = 'Назва магазину Etsy може містити лише латинські літери та цифри.'

function checkName(raw: string): ShopInputResult {
  let name: string
  try {
    name = decodeURIComponent(raw).trim()
  } catch {
    return { ok: false, error: ERR_BAD_NAME }
  }
  return SHOP_NAME.test(name) ? { ok: true, shopName: name } : { ok: false, error: ERR_BAD_NAME }
}

export function parseShopInput(input: string): ShopInputResult {
  const text = (input ?? '').trim()
  if (!text) return { ok: false, error: ERR_EMPTY }

  // A bare shop name (no dots, slashes or scheme).
  if (!/[./:]/.test(text) && !/\s/.test(text)) return checkName(text)

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { ok: false, error: ERR_NOT_ETSY }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: ERR_NOT_ETSY }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host !== 'etsy.com' && !host.endsWith('.etsy.com')) return { ok: false, error: ERR_NOT_ETSY }

  const segments = url.pathname.split('/').filter(Boolean)
  // Index of the first real segment, behind an optional locale: /uk/shop/<Name>.
  let i = 0
  if (segments.length > 0 && LOCALE.test(segments[0])) i = 1
  // Only /listing/… (or /uk/listing/…) is a listing link — a shop may be named "Listing".
  if (segments[i]?.toLowerCase() === 'listing') return { ok: false, error: ERR_LISTING }

  // <ShopName>.etsy.com (the legacy shop subdomain).
  const sub = host === 'etsy.com' ? '' : host.slice(0, -'.etsy.com'.length)
  if (sub && !sub.includes('.') && !RESERVED_SUBDOMAINS.has(sub)) return checkName(sub)
  if (sub && sub !== 'www' && sub !== 'm') return { ok: false, error: ERR_NO_SHOP }

  // /shop/<Name>, optionally behind one locale segment: /uk/shop/<Name>.
  if (segments[i]?.toLowerCase() === 'shop' && segments[i + 1]) return checkName(segments[i + 1])
  return { ok: false, error: ERR_NO_SHOP }
}

/** The canonical public URL of a shop (used when Etsy omits `url`). */
export function shopUrlFor(shopName: string): string {
  return `https://www.etsy.com/shop/${encodeURIComponent(shopName)}`
}
