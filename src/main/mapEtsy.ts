// Etsy API shapes → our records. Pure.

import type { ListingImage, Shop } from '../shared/types'
import { decodeHtmlEntities } from '../shared/html'
import { shopUrlFor } from '../shared/shopUrl'
import type { ListingInput } from './db'
import type { EtsyListing, EtsyListingImage, EtsyShop } from './etsyApi'

function int(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function optInt(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

export function mapImages(images: EtsyListingImage[] | undefined | null): ListingImage[] {
  if (!Array.isArray(images)) return []
  return [...images]
    .sort((a, b) => int(a.rank, 999) - int(b.rank, 999))
    .map((i) => ({
      id: int(i.listing_image_id),
      rank: int(i.rank),
      url75: i.url_75x75 ?? '',
      url170: i.url_170x135 ?? '',
      url570: i.url_570xN ?? '',
      urlFull: i.url_fullxfull ?? '',
      width: optInt(i.full_width),
      height: optInt(i.full_height),
      alt: i.alt_text ?? null
    }))
}

/**
 * Map an Etsy ShopListing. `images` null = not fetched (keep the stored ones);
 * pass the batch endpoint's `images` when we have them.
 */
export function mapListing(
  l: EtsyListing,
  images: EtsyListingImage[] | null | undefined,
  shopCurrency?: string | null
): ListingInput {
  const price = l.price ?? { amount: 0, divisor: 100, currency_code: shopCurrency ?? '' }
  return {
    listingId: int(l.listing_id),
    shopId: int(l.shop_id),
    title: decodeHtmlEntities(String(l.title ?? '')),
    description: decodeHtmlEntities(String(l.description ?? '')),
    priceAmount: int(price.amount),
    priceDivisor: int(price.divisor, 100) || 100,
    currency: price.currency_code || shopCurrency || '',
    url: String(l.url ?? `https://www.etsy.com/listing/${l.listing_id}`),
    tags: Array.isArray(l.tags) ? l.tags.map((t) => decodeHtmlEntities(String(t))) : [],
    quantity: int(l.quantity),
    etsyCreatedAt: optInt(
      l.created_timestamp ?? l.creation_timestamp ?? l.original_creation_timestamp
    ),
    etsyUpdatedAt: optInt(l.updated_timestamp ?? l.last_modified_timestamp),
    images: images == null ? null : mapImages(images)
  }
}

export function mapShop(s: EtsyShop, addedAt: number): Shop {
  return {
    id: int(s.shop_id),
    shopName: String(s.shop_name),
    title: s.title ? decodeHtmlEntities(s.title) : null,
    url: s.url || shopUrlFor(String(s.shop_name)),
    iconUrl: s.icon_url_fullxfull ?? null,
    currency: s.currency_code ?? null,
    etsyActiveCount: int(s.listing_active_count),
    addedAt
  }
}
