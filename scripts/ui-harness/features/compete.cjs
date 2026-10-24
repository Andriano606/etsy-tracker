// UI harness samples for feature "compete" (the "Більше" window and the live
// listing panels), built from the fixtures' real listings/images/reviews.
// A scene can force a state with document.documentElement.dataset.uih =
// 'error' (every action fails) | 'empty' (every list is empty).

const mode = () => globalThis.document?.documentElement?.dataset?.uih ?? ''
const fail = () => ({ ok: false, error: 'Перевищено денний ліміт запитів до Etsy. Спробуйте завтра або зменште кількість сканувань.' })
const usd = (n, currency = 'USD') => ({ amount: Math.round(n * 100), divisor: 100, currency })

const listingOf = (ctx, id) => ctx.allListings.find((l) => l.listingId === id)
const shopListings = (ctx, shopId) => ctx.fx.perShop[shopId]?.listings ?? []

const SECTIONS = ['Budget Spreadsheets', 'Planners & Trackers', 'Bundles — save 60%', 'Business Templates', 'Holiday Calendars', '']

function sections(ctx, shopId) {
  const n = shopListings(ctx, shopId).length
  return SECTIONS.map((title, i) => ({ id: 40948436 + i, title, rank: i + 1, activeListingCount: i === 4 ? 0 : i === 5 ? null : Math.max(1, Math.round(n / (i + 2))) }))
}

function row(l, i, featured) {
  return {
    listingId: l.listingId,
    title: l.title,
    price: { amount: l.priceAmount, divisor: l.priceDivisor, currency: l.currency },
    state: i === 5 ? 'sold_out' : 'active',
    quantity: l.quantity,
    featuredRank: featured ? i + 1 : (l.featuredRank ?? null),
    numFavorers: l.numFavorers,
    shopSectionId: l.details?.shopSectionId ?? null,
    url: l.url
  }
}

function page(list, offset, limit, featured) {
  return { count: list.length, offset, listings: list.slice(offset, offset + limit).map((l, i) => row(l, offset + i, featured)) }
}

function liveImage(im) {
  return {
    id: im.id,
    rank: im.rank,
    url570: `etsyimg://img/${im.id}/570xN`,
    urlFull: `etsyimg://img/${im.id}/fullxfull`,
    width: im.width,
    height: im.height,
    altText: im.alt ?? (im.rank === 2 ? 'Monthly budget tab with income and expense categories' : null),
    hexCode: im.hexCode,
    red: im.red,
    green: im.green,
    blue: im.blue,
    hue: im.hue,
    saturation: im.saturation,
    brightness: im.brightness,
    isBlackAndWhite: im.isBlackAndWhite,
    createdAt: im.createdAt
  }
}

const PROFILE = {
  id: 201451339,
  title: 'Standard from Ukraine',
  originCountry: 'UA',
  originPostalCode: '79000',
  profileType: 'manual',
  isDeleted: false,
  domesticHandlingFee: 0,
  internationalHandlingFee: 0,
  destinations: [
    { id: 1, originCountry: 'UA', destinationCountry: 'UA', destinationRegion: 'none', primaryCost: usd(3), secondaryCost: usd(1), carrierId: 1, mailClass: 'nova_poshta_standard', minDeliveryDays: 1, maxDeliveryDays: 3 },
    { id: 2, originCountry: 'UA', destinationCountry: null, destinationRegion: 'eu', primaryCost: usd(9.5), secondaryCost: usd(3), carrierId: 2, mailClass: 'ukrposhta_tracked', minDeliveryDays: 7, maxDeliveryDays: 14 },
    { id: 3, originCountry: 'UA', destinationCountry: 'US', destinationRegion: 'none', primaryCost: usd(14), secondaryCost: usd(5), carrierId: 2, mailClass: 'ukrposhta_tracked', minDeliveryDays: 10, maxDeliveryDays: 21 },
    { id: 4, originCountry: 'UA', destinationCountry: null, destinationRegion: 'none', primaryCost: usd(16), secondaryCost: usd(6), carrierId: 2, mailClass: null, minDeliveryDays: 14, maxDeliveryDays: 28 }
  ],
  upgrades: [
    { id: 5, name: 'Express (DHL)', type: 1, price: usd(25), secondaryPrice: usd(5), carrierId: 3, mailClass: 'dhl_express_worldwide', minDeliveryDays: 3, maxDeliveryDays: 5 }
  ]
}

/** Carriers by the country the seller ships from (roughly what Etsy lists there). */
const CARRIERS = {
  US: [
    { id: 11, name: 'USPS', domesticClasses: [{ key: 'a', name: 'First Class' }, { key: 'b', name: 'Priority Mail' }, { key: 'c', name: 'Ground Advantage' }], internationalClasses: [{ key: 'd', name: 'First Class International' }, { key: 'e', name: 'Priority Mail International' }] },
    { id: 12, name: 'UPS', domesticClasses: [{ key: 'f', name: 'Ground' }, { key: 'g', name: '2nd Day Air' }], internationalClasses: [{ key: 'h', name: 'Worldwide Expedited' }] },
    { id: 13, name: 'FedEx', domesticClasses: [{ key: 'i', name: 'Home Delivery' }, { key: 'j', name: 'Express Saver' }], internationalClasses: [{ key: 'k', name: 'International Economy' }] },
    { id: 14, name: 'DHL', domesticClasses: [], internationalClasses: [{ key: 'l', name: 'Express Worldwide' }] }
  ],
  UA: [
    { id: 1, name: 'Ukrposhta', domesticClasses: [{ key: 'a', name: 'Standard' }, { key: 'b', name: 'Express' }], internationalClasses: [{ key: 'c', name: 'Registered Small Packet' }, { key: 'd', name: 'EMS' }] },
    { id: 2, name: 'Nova Poshta', domesticClasses: [{ key: 'e', name: 'Warehouse to warehouse' }, { key: 'f', name: 'Courier' }], internationalClasses: [{ key: 'g', name: 'Nova Global' }] },
    { id: 3, name: 'DHL', domesticClasses: [], internationalClasses: [{ key: 'h', name: 'Express Worldwide' }, { key: 'i', name: 'Economy Select' }] },
    { id: 4, name: 'Meest', domesticClasses: [], internationalClasses: [] }
  ],
  other: [
    { id: 21, name: 'DHL', domesticClasses: [{ key: 'a', name: 'Parcel' }], internationalClasses: [{ key: 'b', name: 'Express Worldwide' }] },
    { id: 22, name: 'Local post', domesticClasses: [], internationalClasses: [] }
  ]
}

module.exports = {
  sections: async (a, ctx) => (mode() === 'error' ? fail() : mode() === 'empty' ? [] : sections(ctx, a.shopId)),
  section: async (a, ctx) => (mode() === 'error' ? fail() : sections(ctx, a.shopId).find((s) => s.id === a.sectionId) ?? { ok: false, error: 'Etsy не знайшов цей розділ (HTTP 404).' }),
  sectionListings: async (a, ctx) => {
    if (mode() === 'error') return fail()
    const list = shopListings(ctx, a.shopId).filter((_, i) => i % 3 === (a.sectionId - 40948436) % 3)
    return page(list, a.offset ?? 0, 10)
  },
  featured: async (a, ctx) => {
    if (mode() === 'error') return fail()
    if (mode() === 'empty') return { count: 0, offset: 0, listings: [] }
    const list = [...shopListings(ctx, a.shopId)].sort((x, y) => (y.numFavorers ?? 0) - (x.numFavorers ?? 0)).slice(0, 14)
    return page(list, a.offset ?? 0, 8, true)
  },
  returnPolicies: async () =>
    mode() === 'error'
      ? fail()
      : mode() === 'empty'
        ? []
        : [
            { id: 1, acceptsReturns: false, acceptsExchanges: false, returnDeadline: null },
            { id: 2, acceptsReturns: true, acceptsExchanges: true, returnDeadline: 30 },
            { id: 3, acceptsReturns: true, acceptsExchanges: false, returnDeadline: 14 }
          ],
  returnPolicy: async (a) => ({ id: a.policyId, acceptsReturns: true, acceptsExchanges: true, returnDeadline: 30 }),

  properties: async () =>
    mode() === 'error'
      ? fail()
      : mode() === 'empty'
        ? []
        : [
            { propertyId: 200, name: 'Primary color', scaleId: null, scaleName: null, valueIds: [1], values: ['Pink'] },
            { propertyId: 52047899002, name: 'Occasion', scaleId: null, scaleName: null, valueIds: [1, 2], values: ['New Year’s', 'Back to school'] },
            { propertyId: 3, name: 'Digital file format', scaleId: null, scaleName: null, valueIds: [3], values: ['XLSX', 'PDF'] },
            { propertyId: 47626759834, name: 'Width', scaleId: 327, scaleName: 'Inches', valueIds: [], values: ['8.5'] },
            { propertyId: 47626759898, name: 'Height', scaleId: 327, scaleName: 'Inches', valueIds: [], values: ['11'] }
          ],
  images: async (a, ctx) => {
    if (mode() === 'error') return fail()
    if (mode() === 'empty') return []
    return (listingOf(ctx, a.listingId)?.images ?? []).map(liveImage)
  },
  image: async (a, ctx) => {
    const im = (listingOf(ctx, a.listingId)?.images ?? []).find((i) => i.id === a.imageId)
    return im ? liveImage(im) : { ok: false, error: 'Etsy не знайшов це фото (HTTP 404).' }
  },
  videos: async (a, ctx) => {
    if (mode() === 'error') return fail()
    if (mode() === 'empty') return []
    const im = listingOf(ctx, a.listingId)?.images?.[2]
    return [{ id: 3045871, width: 1920, height: 1080, state: 'active', thumbnailUrl: im ? `etsyimg://img/${im.id}/570xN` : null }]
  },
  video: async (a) => ({ id: a.videoId, width: 1920, height: 1080, state: 'active', thumbnailUrl: null }),
  personalization: async () =>
    mode() === 'error'
      ? fail()
      : mode() === 'empty'
        ? []
        : [
            {
              id: 1,
              text: 'Name for the cover page',
              instructions: 'Enter the name exactly as it should appear.\nLatin letters only, up to 24 characters.',
              type: 'text_input',
              required: true,
              maxChars: 24,
              maxFiles: null,
              addOnPrice: null,
              options: []
            },
            {
              id: 2,
              text: 'Colour theme',
              instructions: null,
              type: 'dropdown',
              required: false,
              maxChars: null,
              maxFiles: null,
              addOnPrice: { amount: 200, divisor: 100, currency: 'USD' },
              options: [
                { id: 1, label: 'Blush pink' },
                { id: 2, label: 'Sage green' },
                { id: 3, label: 'Neutral beige' },
                { id: 4, label: 'Ocean blue' }
              ]
            },
            { id: 3, text: 'Upload your logo (optional)', instructions: null, type: 'file', required: false, maxChars: null, maxFiles: 2, addOnPrice: null, options: [] }
          ],
  translation: async (a, ctx) => {
    if (mode() === 'error') return fail()
    if (a.language !== 'de') return null
    const l = listingOf(ctx, a.listingId)
    return {
      listingId: a.listingId,
      language: 'de',
      title: 'Monatliche Budget-Tabelle | Rosa Farbpalette | Einfacher Jahreshaushalt | Persönliche Finanzen | Google Sheets',
      description:
        'Behalten Sie Ihre Finanzen mit dieser einfachen Budget-Tabelle im Blick.\n\n• Monatliche und jährliche Übersicht\n• Automatische Diagramme\n• Funktioniert mit Google Sheets\n\n' +
        (l?.description ?? '').slice(0, 400),
      tags: ['budget tabelle', 'haushaltsbuch', 'finanzplaner', 'google sheets', 'sparplan', 'ausgaben tracker']
    }
  },
  variationImages: async (a, ctx) => {
    if (mode() === 'error') return fail()
    if (mode() === 'empty') return []
    const ims = listingOf(ctx, a.listingId)?.images ?? []
    const names = ['Blush pink', 'Sage green', 'Neutral beige', 'Ocean blue']
    return names.map((value, i) => ({ propertyId: 200, valueId: i + 1, value, imageId: ims[i]?.id ?? 999000 + i }))
  },
  shipping: async (a, ctx) => {
    if (mode() === 'error') return fail()
    const l = listingOf(ctx, a.listingId)
    const own = l && l.shopId === ctx.own.id
    return [{ listingId: a.listingId, profile: own || mode() === 'profile' ? PROFILE : null }]
  },
  carriers: async (a) => {
    if (mode() === 'error') return fail()
    if (a.country === 'AQ') return []
    return CARRIERS[a.country] ?? CARRIERS.other
  },
  reviews: async (a, ctx) => {
    if (mode() === 'error') return fail()
    const stored = ctx.fx.listingExtras[a.listingId]?.reviews?.reviews ?? []
    const all = mode() === 'empty' ? [] : stored.length ? stored : ctx.fx.listingExtras[Object.keys(ctx.fx.listingExtras)[0]]?.reviews?.reviews ?? []
    const offset = a.offset ?? 0
    const limit = a.limit ?? 20
    const reviews = all.slice(offset, offset + limit).map((r, i) => ({
      shopId: r.shopId,
      listingId: r.listingId,
      rating: r.rating,
      text: r.text || null,
      language: r.language,
      imageUrl: i === 1 ? `etsyimg://img/${listingOf(ctx, r.listingId)?.images?.[0]?.id}/570xN` : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }))
    return { count: Math.max(all.length, mode() === 'empty' ? 0 : 47), offset, reviews }
  }
}
