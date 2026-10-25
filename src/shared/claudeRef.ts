// Short references the user copies from the app and pastes to Claude ("look at
// this photo"), and how the MCP tool `open_link` reads them back. Pure — the
// renderer builds them for its copy buttons, main parses them.
//
//   etsy-tracker://product/1803602196                       a listing
//   etsy-tracker://product/1803602196/photo/6437472477      one of its photos (Etsy listing_image_id)
//   etsy-tracker://product/1803602196/video/768411442       one of its videos (the preview frame)
//   etsy-tracker://review/123/photo                         a review's photo (the app's review id)
//   etsy-tracker://store/39357587                           a shop
//   etsy-tracker://store/39357587/logo                      its logo (…/banner: its banner)
//   etsy-tracker://draft/5                                  a draft kept in the app
//   etsy-tracker://draft/5/photo/77                         one of its photos (the app's media id)
//
// open_link also takes Etsy's own links: https://www.etsy.com/[locale/]listing/<id>[/slug][?…]
// and https://www.etsy.com/[locale/]shop/<Name> (and <Name>.etsy.com).

import { parseShopInput } from './shopUrl'

export const CLAUDE_REF_SCHEME = 'etsy-tracker'

export type ClaudeRef =
  | { kind: 'product'; productId: number }
  | { kind: 'photo'; productId: number; imageId: number }
  | { kind: 'video'; productId: number; videoId: number }
  | { kind: 'reviewPhoto'; reviewId: number }
  | { kind: 'store'; storeId: number }
  | { kind: 'storeImage'; storeId: number; image: 'logo' | 'banner' }
  | { kind: 'storeName'; name: string }
  | { kind: 'draft'; draftId: number }
  | { kind: 'draftPhoto'; draftId: number; mediaId: number }

const base = `${CLAUDE_REF_SCHEME}://`

export const productRef = (productId: number): string => `${base}product/${productId}`
export const photoRef = (productId: number, imageId: number): string => `${base}product/${productId}/photo/${imageId}`
export const videoRef = (productId: number, videoId: number): string => `${base}product/${productId}/video/${videoId}`
export const reviewPhotoRef = (reviewId: number): string => `${base}review/${reviewId}/photo`
export const storeRef = (storeId: number): string => `${base}store/${storeId}`
export const storeImageRef = (storeId: number, image: 'logo' | 'banner' = 'logo'): string => `${base}store/${storeId}/${image}`
export const draftRef = (draftId: number): string => `${base}draft/${draftId}`
export const draftPhotoRef = (draftId: number, mediaId: number): string => `${base}draft/${draftId}/photo/${mediaId}`

const id = (s: string | undefined): number | null => {
  if (!s || !/^\d{1,20}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function parseAppRef(path: string): ClaudeRef | null {
  const p = path.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase().split('/')
  const [what, a, sub, b] = p
  const first = id(a)
  if (first == null) return null
  if (what === 'product') {
    if (p.length === 2) return { kind: 'product', productId: first }
    const second = id(b)
    if (p.length === 4 && second != null && sub === 'photo') return { kind: 'photo', productId: first, imageId: second }
    if (p.length === 4 && second != null && sub === 'video') return { kind: 'video', productId: first, videoId: second }
    return null
  }
  if (what === 'review') return p.length === 3 && sub === 'photo' ? { kind: 'reviewPhoto', reviewId: first } : null
  if (what === 'store') {
    if (p.length === 2) return { kind: 'store', storeId: first }
    if (p.length === 3 && (sub === 'logo' || sub === 'banner')) return { kind: 'storeImage', storeId: first, image: sub }
    return null
  }
  if (what === 'draft') {
    if (p.length === 2) return { kind: 'draft', draftId: first }
    const second = id(b)
    if (p.length === 4 && sub === 'photo' && second != null) return { kind: 'draftPhoto', draftId: first, mediaId: second }
    return null
  }
  return null
}

/**
 * An Etsy listing link → its id: the listing page ("/uk/listing/123/slug?ref=…"
 * too) and the shop owner's editor ("/your/shops/me/listing-editor/edit/123" —
 * the app's "Редагувати на Etsy", MCP edit_url — and "/your/listings/123");
 * null for anything else.
 */
function etsyListingId(url: URL): number | null {
  const host = url.hostname.toLowerCase()
  if (host !== 'etsy.com' && !host.endsWith('.etsy.com')) return null
  const seg = url.pathname.split('/').filter(Boolean)
  const i = seg[0] && /^[a-z]{2}(-[a-z]{2,4})?$/i.test(seg[0]) && seg[1] === 'listing' ? 1 : 0
  if (seg[i] === 'listing') return id(seg[i + 1])
  if (seg[0] === 'your' && seg[1] === 'shops' && seg[3] === 'listing-editor' && seg[4] === 'edit') return id(seg[5])
  if (seg[0] === 'your' && seg[1] === 'listings') return id(seg[2])
  return null
}

/**
 * Characters that end a reference or link pasted into text: whitespace, quotes
 * (also «» “” „ ‘ ’ — Ukrainian text quotes with «»), Markdown's ` and *,
 * brackets and dashes.
 */
const STOP = `\\s"'\`*<>()\\[\\]{}«»“”„‘’—–`
/** Punctuation trimmed off the end of a match ("…/photo/2." in a sentence). */
const TRAILING = /[.,;:!?…]+$/

/** An Etsy app share link (etsy.me/…): it hides the listing id behind a redirect. */
export function hasEtsyShortLink(text: string): boolean {
  return /(?<![\w.-])(?:https?:\/\/)?etsy\.me\/[^\s]/i.test(text ?? '')
}

/**
 * The reference in `text` (the user may paste a whole sentence around it): an
 * etsy-tracker:// reference anywhere in the text wins; else the first Etsy
 * listing or shop link; else the whole text as a bare listing id (6+ digits —
 * only on its own, a number inside a sentence is not taken for an id). null
 * when there is none.
 */
export function parseClaudeRef(text: string): ClaudeRef | null {
  const s = (text ?? '').trim()
  if (!s) return null
  const app = s.match(new RegExp(`${CLAUDE_REF_SCHEME}://([^${STOP}]+)`, 'i'))
  if (app) return parseAppRef(app[1].replace(TRAILING, ''))
  const link = s.match(new RegExp(`(?<![\\w.-])(?:https?://)?(?:[\\w-]+\\.)*etsy\\.com(?:/[^${STOP}]*)?`, 'i'))
  if (link) {
    const raw = link[0].replace(TRAILING, '')
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    } catch {
      return null
    }
    const listing = etsyListingId(url)
    if (listing != null) return { kind: 'product', productId: listing }
    const shop = parseShopInput(raw)
    return shop.ok ? { kind: 'storeName', name: shop.shopName } : null
  }
  const bare = /^\d{6,20}$/.test(s) ? id(s) : null
  return bare != null ? { kind: 'product', productId: bare } : null
}
