// UI harness samples for feature "market" (Пошук по Etsy): answers built from the
// fixtures' real listings. A scene can force a state with
// document.documentElement.dataset.uih = 'error' | 'slow' (read here, in the preload).

const mode = () => globalThis.document?.documentElement?.dataset?.uih ?? ''
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const CATEGORIES = [
  'Paper & Party Supplies › Paper › Calendars & Planners',
  'Paper & Party Supplies › Paper › Calendars & Planners › Planner Inserts & Refills',
  'Paper & Party Supplies › Paper › Stationery › Notebooks & Notepads',
  'Home & Living › Office › Organization & Storage',
  'Home & Living › Kitchen & Dining › Drink & Barware › Drinkware › Mugs',
  'Home & Living › Kitchen & Dining › Dining & Serving › Mug Rugs',
  'Art & Collectibles › Prints › Digital Prints',
  'Art & Collectibles › Painting › Watercolor',
  'Weddings › Invitations & Paper › Invitations',
  'Books, Movies & Music › Books › Workbooks'
].map((path, i) => ({ id: 1000 + i, name: path.split(' › ').pop(), level: path.split(' › ').length - 1, parentId: null, path }))

const PROPERTIES = [
  {
    propertyId: 200,
    name: 'primary_color',
    displayName: 'Primary color',
    isRequired: false,
    supportsAttributes: true,
    supportsVariations: true,
    isMultivalued: false,
    maxValuesAllowed: null,
    scales: [],
    possibleValues: ['Beige', 'Black', 'Blue', 'Bronze', 'Brown', 'Clear', 'Copper', 'Gold', 'Gray', 'Green', 'Orange', 'Pink', 'Purple', 'Rainbow', 'Red', 'Rose gold', 'Silver', 'White', 'Yellow'].map((name, i) => ({ valueId: i + 1, name, scaleId: null }))
  },
  {
    propertyId: 52047899002,
    name: 'occasion',
    displayName: 'Occasion',
    isRequired: false,
    supportsAttributes: true,
    supportsVariations: false,
    isMultivalued: true,
    maxValuesAllowed: 3,
    scales: [],
    possibleValues: ['Anniversary', 'Back to school', 'Birthday', 'Christmas', 'Graduation', 'Housewarming', 'Moving', "New Year's", 'Retirement', 'Wedding'].map((name, i) => ({ valueId: 100 + i, name, scaleId: null }))
  },
  {
    propertyId: 47626759834,
    name: 'width',
    displayName: 'Width',
    isRequired: true,
    supportsAttributes: true,
    supportsVariations: true,
    isMultivalued: false,
    maxValuesAllowed: null,
    scales: [
      { scaleId: 327, name: 'Inches', description: null },
      { scaleId: 328, name: 'Centimeters', description: null }
    ],
    possibleValues: []
  },
  {
    propertyId: 3,
    name: 'digital_file_format',
    displayName: 'Digital file format',
    isRequired: false,
    supportsAttributes: true,
    supportsVariations: false,
    isMultivalued: true,
    maxValuesAllowed: 5,
    scales: [],
    possibleValues: ['PDF', 'PNG', 'JPEG', 'XLSX', 'DOCX', 'SVG'].map((name, i) => ({ valueId: 200 + i, name, scaleId: null }))
  }
]

function toMarket(l, fx) {
  const img = l.images[0]
  return {
    listingId: l.listingId,
    shopId: l.shopId,
    title: l.title,
    priceAmount: l.priceAmount,
    priceDivisor: l.priceDivisor,
    currency: l.currency,
    url: l.url,
    tags: l.tags,
    numFavorers: l.numFavorers,
    views: l.views,
    createdAt: l.details?.originalCreatedAt ?? l.etsyCreatedAt,
    imageUrl: img && fx.images[img.id] ? `etsyimg://img/${img.id}/570xN` : null
  }
}

/** A shop that is not in the sidebar, so "Стежити за магазином" shows too. */
const UNTRACKED = { id: 31415926, shopName: 'PaperFoxStudio' }

module.exports = {
  search: async (a, { fx, allListings }) => {
    if (mode() === 'slow') await wait(60000)
    if (mode() === 'error') return { ok: false, error: 'Etsy не відповідає (тайм-аут 30 с). Перевірте інтернет і спробуйте ще раз.' }
    if (!a.keywords && !a.taxonomyId && !a.shopLocation && !a.minPrice && !a.maxPrice)
      return { ok: false, error: 'Вкажіть ключові слова, категорію, розташування магазину або ціну.' }
    const words = String(a.keywords ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    let rows = allListings.filter((l) => words.every((w) => `${l.title} ${l.tags.join(' ')}`.toLowerCase().includes(w)))
    const v = (l) => l.priceAmount / l.priceDivisor
    if (a.minPrice) rows = rows.filter((l) => v(l) >= Number(a.minPrice))
    if (a.maxPrice) rows = rows.filter((l) => v(l) <= Number(a.maxPrice))
    const sorted = !!(a.keywords || a.taxonomyId || a.shopLocation)
    if (sorted && a.sort === 'price_low') rows = [...rows].sort((x, y) => v(x) - v(y))
    if (sorted && a.sort === 'price_high') rows = [...rows].sort((x, y) => v(y) - v(x))
    if (sorted && a.sort === 'newest') rows = [...rows].sort((x, y) => y.etsyCreatedAt - x.etsyCreatedAt)
    const offset = a.offset ?? 0
    const limit = a.limit ?? 24
    const page = rows.slice(offset, offset + limit).map((l) => toMarket(l, fx))
    // Every 7th result without a photo, like a listing whose photos Etsy didn't send.
    page.forEach((l, i) => i % 7 === 6 && (l.imageUrl = null))
    // Every 3rd from a shop the user doesn't track yet (the rest: the tracked shops' own listings).
    page.forEach((l, i) => i % 3 === 1 && (l.shopId = UNTRACKED.id))
    return { count: rows.length, offset, limit, sorted, listings: page, imagesError: null }
  },
  categories: async (a) => {
    const q = String(a.query ?? '').toLowerCase()
    const all = CATEGORIES.filter((c) => c.path.toLowerCase().includes(q))
    return { total: all.length, categories: all.slice(0, 8) }
  },
  properties: async () => PROPERTIES,
  shopName: async (a, { fx }) =>
    a.shopId === UNTRACKED.id
      ? UNTRACKED.shopName
      : (fx.shops.find((s) => s.id === a.shopId)?.shopName ?? { ok: false, error: 'Etsy не знайшов цей магазин (HTTP 404).' })
}
