// UI harness samples for feature "inventory" (see ../fake-api.cjs): the variants
// table, variation photos and the "Ціни й залишки" overview. The first own
// listing has variations (Формат × Колір), the others are single products.

const usd = (amount) => ({ amount, divisor: 100, currency: 'USD' })

const FORMATS = [
  [9101, 'Letter'],
  [9102, 'A4']
]
const COLORS = [
  [9201, 'Blush pink'],
  [9202, 'Sage green'],
  [9203, 'Navy blue']
]

function variants(listingId) {
  const products = []
  let n = 0
  for (const [fid, f] of FORMATS) {
    for (const [cid, c] of COLORS) {
      n++
      products.push({
        productId: listingId * 10 + n,
        sku: `BUD-${f.slice(0, 2).toUpperCase()}-${c.slice(0, 2).toUpperCase()}`,
        propertyValues: [
          { propertyId: 513, propertyName: 'Формат', scaleId: null, scaleName: null, valueIds: [fid], values: [f] },
          { propertyId: 200, propertyName: 'Колір', scaleId: null, scaleName: null, valueIds: [cid], values: [c] }
        ],
        offerings: [{ offeringId: listingId * 100 + n, price: usd(f === 'A4' ? 1450 : 1250), quantity: n === 4 ? 0 : 20 + n, isEnabled: n !== 6, readinessStateId: 77 }]
      })
    }
  }
  return { listingId, products, priceOnProperty: [513], quantityOnProperty: [513, 200], skuOnProperty: [513, 200], readinessStateOnProperty: [] }
}

function single(listingId, ctx) {
  const l = ctx.myListings.find((x) => x.listingId === listingId)
  return {
    listingId,
    products: [{ productId: listingId * 10, sku: '', propertyValues: [], offerings: [{ offeringId: listingId * 100, price: usd(l?.priceAmount ?? 500), quantity: l?.quantity ?? 999, isEnabled: true, readinessStateId: null }] }],
    priceOnProperty: [],
    quantityOnProperty: [],
    skuOnProperty: [],
    readinessStateOnProperty: []
  }
}

const inventoryOf = (listingId, ctx) => (listingId === ctx.myListings[0]?.listingId ? variants(listingId) : single(listingId, ctx))

/** Which own listing a scene edits: 0 = the first (full data), 1 = the second (empty states), 2 = the third (errors). */
const which = (listingId, ctx) => ctx.myListings.filter((l) => l.state === 'active').findIndex((l) => l.listingId === listingId)
const FAIL = { ok: false, error: 'Etsy не відповідає (тайм-аут 30 с). Перевірте інтернет і спробуйте ще раз.' }

function summary(inv) {
  const all = inv.products.flatMap((p) => p.offerings)
  const enabled = all.filter((o) => o.isEnabled)
  const prices = enabled.map((o) => o.price).sort((a, b) => a.amount - b.amount)
  const only = inv.products.length === 1 ? inv.products[0] : null
  return {
    priceMin: prices[0] ?? null,
    priceMax: prices[prices.length - 1] ?? null,
    totalQuantity: enabled.reduce((s, o) => s + o.quantity, 0),
    productCount: inv.products.length,
    enabledCount: enabled.length,
    single: only ? { productId: only.productId, offeringId: only.offerings[0].offeringId, sku: only.sku, price: only.offerings[0].price, quantity: only.offerings[0].quantity, isEnabled: true } : null
  }
}

module.exports = {
  get: ({ listingId }, ctx) => (which(listingId, ctx) === 2 ? FAIL : inventoryOf(listingId, ctx)),
  update: ({ listingId }, ctx) => inventoryOf(listingId, ctx),
  quickUpdate: ({ listingId }, ctx) => inventoryOf(listingId, ctx),
  overview: ({ offset = 0 }, ctx) => {
    const rows = ctx.myListings.map((l) => ({
      listingId: l.listingId,
      title: l.title,
      state: 'active',
      imageUrl: l.imageUrl,
      hasInventory: true,
      ...summary(inventoryOf(l.listingId, ctx))
    }))
    return { total: rows.length + 8, offset, rows: offset ? [] : rows }
  },
  variationImages: ({ listingId }, ctx) => {
    if (which(listingId, ctx) === 2) return FAIL
    if (which(listingId, ctx) === 1) return { listingId, properties: [], photos: [], assigned: [] }
    const tracked = ctx.allListings.find((x) => x.listingId === listingId)
    const photos = (tracked?.images ?? []).slice(0, 8).map((im, i) => ({ imageId: im.id, url: im.url170 ?? im.url75, rank: i + 1, alt: null }))
    return {
      listingId,
      properties: [
        { propertyId: 200, name: 'Колір', values: COLORS.map(([valueId, value]) => ({ valueId, value })) },
        { propertyId: 513, name: 'Формат', values: FORMATS.map(([valueId, value]) => ({ valueId, value })) }
      ],
      photos,
      assigned: photos.length > 2 ? [{ propertyId: 200, valueId: 9201, value: 'Blush pink', imageId: photos[1].imageId }] : []
    }
  },
  saveVariationImages: ({ items }) => items.map((x) => ({ ...x, value: null }))
}
