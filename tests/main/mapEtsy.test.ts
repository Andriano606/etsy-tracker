import { describe, expect, it } from 'vitest'
import {
  listingStats,
  mapImage,
  mapImages,
  mapListing,
  mapListingDetails,
  mapPersonalization,
  mapReview,
  mapShop,
  mapVideos,
  reviewKey,
  shopStats
} from '../../src/main/mapEtsy'
import type { EtsyListing, EtsyListingWithAssociations, EtsyShop, EtsyTransactionReview } from '../../src/main/etsyApi'
import reviewFx from '../fixtures/transactionReview.json'
import listingFx from '../fixtures/listing.json'
import detailsFx from '../fixtures/listingWithAssociations.json'
import imageFx from '../fixtures/listingImage.json'
import shopFx from '../fixtures/shop.json'

const page = listingFx as unknown as EtsyListing
const details = detailsFx as unknown as EtsyListingWithAssociations

describe('mapListing', () => {
  it('maps the page item + details, decoding entities', () => {
    const l = mapListing(page, details)
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
      etsyUpdatedAt: 1760500000,
      state: 'active',
      views: 1342,
      numFavorers: 87,
      featuredRank: 2,
      detailsFetched: true
    })
    // Images ordered by rank, every ListingImage field kept.
    expect(l.images!.map((i) => i.id)).toEqual([6012345678, 6012345679])
    expect(l.images![0]).toEqual({
      id: 6012345678,
      rank: 1,
      url75: imageFx.url_75x75,
      url170: imageFx.url_170x135,
      url570: imageFx.url_570xN,
      urlFull: imageFx.url_fullxfull,
      width: 2000,
      height: 2000,
      alt: 'Sunflower mug on a wooden table',
      hexCode: 'C9A66B',
      red: 201,
      green: 166,
      blue: 107,
      hue: 37,
      saturation: 47,
      brightness: 78,
      isBlackAndWhite: false,
      createdAt: 1760000000
    })
    expect(l.videos).toEqual([
      {
        id: 91234567,
        width: 1920,
        height: 1080,
        thumbnailUrl: 'https://v.etsystatic.com/video/upload/ac_none,so_0/thumb.jpg',
        videoUrl: 'https://v.etsystatic.com/video/upload/ac_none/video.mp4',
        state: 'active'
      }
    ])
    // The whole API object is kept.
    expect(JSON.parse(l.rawJson!)).toEqual(detailsFx)
  })

  it('maps every content field of ShopListingWithAssociations', () => {
    expect(mapListing(page, details).details).toEqual({
      userId: 712345678,
      shopSectionId: 41234567,
      taxonomyId: 1063,
      listingType: 'physical',
      whoMade: 'i_did',
      whenMade: 'made_to_order',
      isSupply: false,
      materials: ['stoneware', 'glaze'],
      styles: ['Rustic', 'Boho'],
      skus: ['MUG-SUN-01'],
      processingMin: 1,
      processingMax: 3,
      isCustomizable: false,
      isPersonalizable: true,
      personalization: [
        {
          questionId: 555001,
          text: 'Name to engrave & date',
          instructions: 'Up to 20 characters',
          type: 'text_input',
          required: true,
          maxChars: 20,
          maxFiles: null,
          options: []
        }
      ],
      hasVariations: false,
      isPrivate: false,
      isTaxable: true,
      nonTaxable: false,
      shouldAutoRenew: true,
      fileData: '',
      language: 'en-US',
      shippingProfileId: 198765432,
      returnPolicyId: 1234567890,
      readinessStateId: 1402336022581,
      itemWeight: 0.4,
      itemWeightUnit: 'kg',
      itemLength: 12.5,
      itemWidth: 9,
      itemHeight: 10,
      itemDimensionsUnit: 'cm',
      originalCreatedAt: 1700000000,
      endingAt: 1770000000,
      stateAt: 1760000000
    })
  })

  it('without details (404 between paging and the batch): page data, images/videos/views unknown', () => {
    const l = mapListing(page, null)
    expect(l.images).toBeNull()
    expect(l.videos).toBeNull()
    expect(l.views).toBeNull()
    expect(l.detailsFetched).toBe(false)
    // ShopListing fields still come through (favorers, featured rank, content).
    expect(l).toMatchObject({ numFavorers: 87, featuredRank: -1, state: 'active' })
    expect(l.details?.materials).toEqual(['stoneware', 'glaze'])
    expect(l.details?.personalization).toBeNull()
    expect(JSON.parse(l.rawJson!)).toEqual(listingFx)
  })

  it('without details, a page item that carries views (as live /listings/active does) keeps them', () => {
    expect(mapListing({ ...page, views: 321 }, null).views).toBe(321)
    // The details value wins when both are there.
    expect(mapListing({ ...page, views: 321 }, { ...page, views: 400 }).views).toBe(400)
  })

  it('details without the Videos association (Images-only fallback) → videos null, not []', () => {
    const { videos: _v, ...noVideos } = details
    expect(mapListing(page, noVideos as EtsyListingWithAssociations).videos).toBeNull()
  })

  it('personalization counts as answered only when the key is there or Personalization was requested', () => {
    const { personalization: _p, ...noPers } = details
    const fallback = noPers as EtsyListingWithAssociations
    // Images-only fallback: no key, not requested → unknown (keep the stored questions).
    expect(mapListing(page, fallback, null, ['Images']).personalizationFetched).toBe(false)
    expect(mapListing(page, fallback).personalizationFetched).toBe(false)
    // Requested (Etsy may omit the key for a listing without questions) → answered: none.
    expect(mapListing(page, fallback, null, ['Images', 'Videos', 'Personalization']).personalizationFetched).toBe(true)
    // Key present → answered whatever the include list says.
    expect(mapListing(page, details, null, ['Images']).personalizationFetched).toBe(true)
    expect(mapListing(page, null).personalizationFetched).toBe(false)
  })

  it('image URLs that are not https on etsystatic.com are dropped', () => {
    const img = mapImage({
      ...imageFx,
      url_75x75: 'file:///etc/hostname',
      url_170x135: 'etsyimg://img/1/570xN',
      url_570xN: 'http://i.etsystatic.com/x.jpg',
      url_fullxfull: 'https://evil.example/x.jpg'
    } as never)
    expect(img).toMatchObject({ url75: '', url170: '', url570: '', urlFull: '' })
    expect(mapImage(imageFx as never).url570).toBe(imageFx.url_570xN)
  })

  it('missing fields fall back safely', () => {
    const l = mapListing({ listing_id: 5, shop_id: 1 } as unknown as EtsyListing, null, 'EUR')
    expect(l.images).toBeNull()
    expect(l).toMatchObject({ title: '', description: '', priceAmount: 0, priceDivisor: 100, currency: 'EUR', tags: [] })
    expect(l.url).toBe('https://www.etsy.com/listing/5')
    expect(l.details).toMatchObject({ materials: [], styles: [], whoMade: null, itemWeight: null })
  })

  it('listingStats takes the popularity numbers', () => {
    expect(listingStats(mapListing(page, details))).toEqual({
      listingId: 1801234567,
      views: 1342,
      numFavorers: 87,
      featuredRank: 2,
      quantity: 5
    })
  })
})

describe('mapImages / mapVideos / mapPersonalization', () => {
  it('orders images by rank, then id', () => {
    const imgs = [3, 1, 2].map((rank) => ({ ...imageFx, listing_image_id: rank, rank }))
    expect(mapImages(imgs as never).map((i) => i.rank)).toEqual([1, 2, 3])
  })
  it('tolerates missing arrays and nulls', () => {
    expect(mapImages(undefined)).toEqual([])
    expect(mapVideos(null)).toEqual([])
    expect(mapPersonalization(null)).toBeNull()
    expect(mapPersonalization({})).toBeNull()
    expect(mapImage({ ...imageFx, hex_code: null, is_black_and_white: null } as never)).toMatchObject({
      hexCode: null,
      isBlackAndWhite: null
    })
  })
  it('personalization options become their labels', () => {
    const q = mapPersonalization({
      personalization_questions: [
        {
          question_text: 'Colour',
          question_type: 'dropdown',
          required: false,
          options: [
            { option_id: 1, label: 'Red &amp; white' },
            { option_id: 2, label: 'Blue' }
          ]
        }
      ]
    })
    expect(q![0]).toMatchObject({ text: 'Colour', options: ['Red & white', 'Blue'], required: false })
  })
  it('mapListingDetails reads a plain ShopListing too', () => {
    expect(mapListingDetails(page)).toMatchObject({ skus: [], personalization: null, whoMade: 'i_did' })
  })
})

describe('mapShop', () => {
  it('maps the fixture Shop: basics, profile, raw JSON', () => {
    const s = mapShop(shopFx as unknown as EtsyShop, 5)
    expect(s).toMatchObject({
      id: 20987654,
      shopName: 'CeramicStudioUA',
      title: 'Handmade ceramics from Lviv & more',
      url: shopFx.url,
      iconUrl: shopFx.icon_url_fullxfull,
      currency: 'UAH',
      etsyActiveCount: 3,
      addedAt: 5
    })
    expect(s.profile).toEqual({
      userId: 712345678,
      loginName: 'ceramicstudio',
      announcement: 'Free shipping over $50',
      saleMessage: 'Thank you for supporting & small studio!',
      digitalSaleMessage: null,
      isVacation: false,
      vacationMessage: null,
      vacationAutoreply: null,
      numFavorers: 1530,
      transactionSoldCount: 2410,
      reviewCount: 512,
      reviewAverage: 4.9,
      digitalListingCount: 0,
      acceptsCustomRequests: true,
      languages: ['en-US', 'uk'],
      countryIso: 'UA',
      shippingFromCountryIso: 'UA',
      bannerUrl: shopFx.image_url_760x100,
      policies: {
        welcome: 'Welcome to our studio.',
        payment: null,
        shipping: 'Ships in 1-3 days.',
        refunds: null,
        additional: null,
        sellerInfo: null,
        privacy: null,
        updatedAt: 1755000000
      },
      etsyCreatedAt: 1550000000,
      etsyUpdatedAt: 1761000000
    })
    expect(JSON.parse(s.rawJson!)).toEqual(shopFx)
  })
  it('builds the URL when Etsy omits it', () => {
    const s = mapShop({ ...(shopFx as unknown as EtsyShop), url: '' }, 0)
    expect(s.url).toBe('https://www.etsy.com/shop/CeramicStudioUA')
  })
  it('shopStats picks the popularity numbers', () => {
    expect(shopStats(shopFx as unknown as EtsyShop)).toEqual({
      numFavorers: 1530,
      transactionSoldCount: 2410,
      reviewCount: 512,
      reviewAverage: 4.9,
      listingActiveCount: 3
    })
  })
})

describe('mapReview (OAS TransactionReview)', () => {
  it('maps every field of the fixture, decodes entities, keys by transaction_id', () => {
    const r = mapReview(reviewFx as EtsyTransactionReview)
    expect(r).toEqual({
      key: 't-3456789012',
      shopId: 20987654,
      listingId: 1801234567,
      transactionId: 3456789012,
      buyerUserId: 987654321,
      rating: 5,
      text: "Beautiful mug, arrived quickly.\nThe glaze is even nicer in person & it's sturdy.",
      language: 'en',
      imageUrl: reviewFx.image_url_fullxfull,
      createTimestamp: 1760000000,
      createdTimestamp: 1760000000,
      updateTimestamp: 1760086400,
      updatedTimestamp: 1760086400,
      rawJson: JSON.stringify(reviewFx)
    })
  })

  it('privacy-absent fields stay null; a non-CDN photo URL is dropped; only create_* still gives created', () => {
    const r = mapReview({
      shop_id: 1,
      listing_id: 2,
      transaction_id: 3,
      rating: 4,
      review: null,
      image_url_fullxfull: 'http://evil.example/x.jpg',
      create_timestamp: 1_750_000_000
    } as EtsyTransactionReview)
    expect(r).toMatchObject({ buyerUserId: null, text: null, imageUrl: null, createdTimestamp: 1_750_000_000, updatedTimestamp: null })
  })

  it('falls back to a deterministic key without transaction_id', () => {
    const base = { shop_id: 1, listing_id: 22, rating: 5, created_timestamp: 1_750_000_000 } as EtsyTransactionReview
    expect(reviewKey(base)).toBe('x-22-0-1750000000')
    expect(reviewKey({ ...base, buyer_user_id: 9 })).toBe('x-22-9-1750000000')
    expect(reviewKey({ ...base, transaction_id: 0 })).toBe('x-22-0-1750000000')
  })
})
