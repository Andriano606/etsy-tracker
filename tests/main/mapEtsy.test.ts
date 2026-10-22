import { describe, expect, it } from 'vitest'
import { mapImages, mapListing, mapShop } from '../../src/main/mapEtsy'
import type { EtsyListing, EtsyShop } from '../../src/main/etsyApi'
import listingFx from '../fixtures/listing.json'
import imageFx from '../fixtures/listingImage.json'
import shopFx from '../fixtures/shop.json'

describe('mapListing', () => {
  it('maps the fixture ShopListing, decoding entities', () => {
    const l = mapListing(listingFx as unknown as EtsyListing, [imageFx as never])
    expect(l).toMatchObject({
      listingId: 1801234567,
      shopId: 20987654,
      title: `Handmade "Sunflower" ceramic mug 'Lviv' & saucer`,
      description: 'Hand-thrown stoneware mug.\nCapacity: 350 ml.\n\nDishwasher safe & microwave safe.',
      priceAmount: 125000,
      priceDivisor: 100,
      currency: 'UAH',
      url: 'https://www.etsy.com/listing/1801234567/handmade-sunflower-ceramic-mug',
      quantity: 5,
      etsyCreatedAt: 1760000000,
      etsyUpdatedAt: 1760500000
    })
    expect(l.images).toEqual([
      {
        id: 6012345678,
        rank: 1,
        url75: imageFx.url_75x75,
        url170: imageFx.url_170x135,
        url570: imageFx.url_570xN,
        urlFull: imageFx.url_fullxfull,
        width: 2000,
        height: 2000,
        alt: 'Sunflower mug on a wooden table'
      }
    ])
  })

  it('null images = not fetched; missing fields fall back safely', () => {
    const l = mapListing({ listing_id: 5, shop_id: 1 } as unknown as EtsyListing, null, 'EUR')
    expect(l.images).toBeNull()
    expect(l).toMatchObject({ title: '', description: '', priceAmount: 0, priceDivisor: 100, currency: 'EUR', tags: [] })
    expect(l.url).toBe('https://www.etsy.com/listing/5')
  })
})

describe('mapImages', () => {
  it('orders by rank', () => {
    const imgs = [3, 1, 2].map((rank) => ({ ...imageFx, listing_image_id: rank, rank }))
    expect(mapImages(imgs as never).map((i) => i.rank)).toEqual([1, 2, 3])
  })
  it('tolerates a missing array', () => {
    expect(mapImages(undefined)).toEqual([])
  })
})

describe('mapShop', () => {
  it('maps the fixture Shop', () => {
    expect(mapShop(shopFx as unknown as EtsyShop, 5)).toEqual({
      id: 20987654,
      shopName: 'CeramicStudioUA',
      title: 'Handmade ceramics from Lviv & more',
      url: shopFx.url,
      iconUrl: shopFx.icon_url_fullxfull,
      currency: 'UAH',
      etsyActiveCount: 3,
      addedAt: 5
    })
  })
  it('builds the URL when Etsy omits it', () => {
    const s = mapShop({ ...(shopFx as unknown as EtsyShop), url: '' }, 0)
    expect(s.url).toBe('https://www.etsy.com/shop/CeramicStudioUA')
  })
})
