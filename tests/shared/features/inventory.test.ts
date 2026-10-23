import { describe, expect, it } from 'vitest'
import {
  inventoryProblems,
  inventoryProperties,
  inventorySummary,
  inventoryToWrite,
  parseQuantity,
  rowsFromInventory,
  variationImageProblems,
  writeFromRows,
  type InventoryWrite,
  type InvProduct,
  type ListingInventory
} from '../../../src/shared/features/inventory'

const usd = (amount: number) => ({ amount, divisor: 100, currency: 'USD' })

const product = (id: number, size: string, valueId: number, price: number, quantity = 5, over: Partial<InvProduct> = {}): InvProduct => ({
  productId: id,
  sku: `SKU-${size}`,
  propertyValues: [{ propertyId: 513, propertyName: 'Size', scaleId: null, scaleName: null, valueIds: [valueId], values: [size] }],
  offerings: [{ offeringId: id * 10, price: usd(price), quantity, isEnabled: true, readinessStateId: 77 }],
  ...over
})

const sized = (): ListingInventory => ({
  listingId: 1,
  products: [product(1, 'S', 901, 1000), product(2, 'M', 902, 1200), product(3, 'L', 903, 1400)],
  priceOnProperty: [513],
  quantityOnProperty: [],
  skuOnProperty: [513],
  readinessStateOnProperty: []
})

const simple = (): ListingInventory => ({
  listingId: 2,
  products: [{ productId: 11, sku: '', propertyValues: [], offerings: [{ offeringId: 111, price: usd(500), quantity: 3, isEnabled: true, readinessStateId: null }] }],
  priceOnProperty: [],
  quantityOnProperty: [],
  skuOnProperty: [],
  readinessStateOnProperty: []
})

const uk = (w: InventoryWrite) => inventoryProblems(w).map((p) => p.uk)
const en = (w: InventoryWrite) => inventoryProblems(w).map((p) => p.en)

describe('inventoryToWrite', () => {
  it('drops ids and scale names, turns Money into a float, copies the *_on_property lists', () => {
    const w = inventoryToWrite(sized())
    expect(w.products[0]).toEqual({
      sku: 'SKU-S',
      propertyValues: [{ propertyId: 513, propertyName: 'Size', scaleId: null, valueIds: [901], values: ['S'] }],
      offerings: [{ price: 10, quantity: 5, isEnabled: true, readinessStateId: 77 }]
    })
    expect(w.priceOnProperty).toEqual([513])
    expect(w.skuOnProperty).toEqual([513])
    expect(inventoryProblems(w)).toEqual([])
  })

  it('a missing price becomes NaN (flagged, never sent as 0)', () => {
    const inv = simple()
    inv.products[0].offerings[0].price = null
    expect(Number.isNaN(inventoryToWrite(inv).products[0].offerings[0].price)).toBe(true)
    expect(uk(inventoryToWrite(inv))[0]).toContain('ціна')
  })
})

describe('inventoryProperties / inventorySummary', () => {
  it('properties in first-seen order with distinct values', () => {
    const inv = sized()
    inv.products.push(product(4, 'S', 901, 1000))
    expect(inventoryProperties(inv.products)).toEqual([
      { propertyId: 513, name: 'Size', values: [{ valueId: 901, value: 'S' }, { valueId: 902, value: 'M' }, { valueId: 903, value: 'L' }] }
    ])
  })

  it('price range and total over enabled offerings; single only for one product + one offering', () => {
    const inv = sized()
    inv.products[2].offerings[0].isEnabled = false
    const s = inventorySummary(inv)
    expect(s.priceMin).toEqual(usd(1000))
    expect(s.priceMax).toEqual(usd(1200))
    expect(s.totalQuantity).toBe(10)
    expect(s.productCount).toBe(3)
    expect(s.enabledCount).toBe(2)
    expect(s.single).toBeNull()
    expect(inventorySummary(simple()).single).toEqual({ productId: 11, offeringId: 111, sku: '', price: usd(500), quantity: 3, isEnabled: true })
  })

  it('no enabled offering: the range still shows every price; empty inventory: nulls', () => {
    const inv = simple()
    inv.products[0].offerings[0].isEnabled = false
    expect(inventorySummary(inv).priceMin).toEqual(usd(500))
    expect(inventorySummary(inv).totalQuantity).toBe(0)
    expect(inventorySummary({ products: [] })).toMatchObject({ priceMin: null, priceMax: null, single: null, productCount: 0 })
  })
})

describe('inventoryProblems', () => {
  it('no products', () => {
    expect(uk({ ...inventoryToWrite(simple()), products: [] })).toEqual(['Потрібен хоча б один варіант.'])
  })

  it('price must be positive with ≤ 2 decimals; quantity a whole number 0–999', () => {
    const w = inventoryToWrite(simple())
    for (const price of [0, -1, 1.234, NaN, Infinity]) {
      w.products[0].offerings[0].price = price
      expect(uk(w)).toEqual(['Варіант №1: ціна — додатне число, не більше 2 знаків після коми.'])
    }
    w.products[0].offerings[0].price = 0.29
    expect(uk(w)).toEqual([])
    for (const quantity of [-1, 1000, 1.5, NaN]) {
      w.products[0].offerings[0].quantity = quantity
      expect(en(w)).toEqual(['Variant #1: the quantity must be a whole number from 0 to 999.'])
    }
    w.products[0].offerings[0].quantity = 0
    expect(uk(w)).toEqual([])
  })

  it('a product without offerings', () => {
    const w = inventoryToWrite(simple())
    w.products[0].offerings = []
    expect(uk(w)).toEqual(['Варіант №1: немає ціни й кількості.'])
  })

  it('parentheses and empty values', () => {
    const w = inventoryToWrite(sized())
    w.products[0].propertyValues[0].values = ['S (small)']
    w.products[1].propertyValues[0].values = [' ']
    expect(uk(w)).toEqual(['Значення «S (small)» містить дужки — їх не можна використовувати.', 'Варіант « »: порожнє значення властивості.'])
  })

  it('every variant needs the same properties; duplicates; > 3 properties', () => {
    const w = inventoryToWrite(sized())
    w.products[1].propertyValues = []
    expect(uk(w)).toContain('Варіант №2: у всіх варіантів мають бути ті самі властивості.')
    const d = inventoryToWrite(sized())
    d.products[1].propertyValues[0].values = ['s']
    expect(uk(d)).toContain('Варіант «s» повторюється.')
    const two = inventoryToWrite(simple())
    two.products.push({ ...two.products[0] })
    expect(uk(two)).toEqual(['Варіант №2 повторюється.'])
    const four = inventoryToWrite(simple())
    four.products[0].propertyValues = [1, 2, 3, 4].map((id) => ({ propertyId: id, propertyName: `P${id}`, scaleId: null, valueIds: [], values: ['x'] }))
    expect(en(four)).toEqual(['At most 3 options are allowed.'])
  })

  it('a *_on_property id no variant has', () => {
    const w = inventoryToWrite(sized())
    w.quantityOnProperty = [999]
    expect(uk(w)).toEqual(['Кількість залежить від властивості #999, якої немає у варіантах.'])
  })

  it('a value that does not vary by a property must match across variants', () => {
    const w = inventoryToWrite(sized())
    w.priceOnProperty = []
    expect(uk(w)).toEqual(['Ціна: значення мають збігатися в усіх варіантах (або позначте, від якої властивості це залежить).'])
    expect(en(w)).toEqual(['The price must be the same for every variant, or make it depend on an option.'])
    const q = inventoryToWrite(sized())
    q.products[0].offerings[0].quantity = 9
    expect(uk(q)).toEqual(['Кількість: значення мають збігатися в усіх варіантах (або позначте, від якої властивості це залежить).'])
    q.quantityOnProperty = [513]
    expect(uk(q)).toEqual([])
  })

  it('grouped by the properties it varies by (two properties)', () => {
    const color = (p: InvProduct, c: string): InvProduct => ({
      ...p,
      propertyValues: [...p.propertyValues, { propertyId: 200, propertyName: 'Color', scaleId: null, scaleName: null, valueIds: [], values: [c] }]
    })
    const inv: ListingInventory = {
      ...sized(),
      products: [color(product(1, 'S', 901, 1000), 'Red'), color(product(2, 'S', 901, 1100), 'Blue')],
      skuOnProperty: []
    }
    inv.products[1].sku = inv.products[0].sku
    expect(uk(inventoryToWrite(inv))).toEqual([
      'Ціна: значення мають збігатися у варіантах з тим самим «Size» (або позначте, що це залежить і від інших властивостей).'
    ])
    expect(uk({ ...inventoryToWrite(inv), priceOnProperty: [513, 200] })).toEqual([])
  })
})

describe('the editor rows', () => {
  it('rowsFromInventory → writeFromRows round-trips unchanged', () => {
    const inv = sized()
    const rows = rowsFromInventory(inv)
    expect(rows[0]).toEqual({ sku: 'SKU-S', price: '10', quantity: '5', enabled: true })
    expect(writeFromRows(inv, rows, { price: [513], quantity: [], sku: [513] })).toEqual(inventoryToWrite(inv))
  })

  it('edits: "12,50" price, trimmed SKU, quantity text, enabled, and the "depends on" choices', () => {
    const inv = sized()
    const rows = rowsFromInventory(inv)
    rows[1] = { sku: '  NEW ', price: '12,50', quantity: '7', enabled: false }
    const w = writeFromRows(inv, rows, { price: [513], quantity: [513], sku: [] })
    expect(w.products[1]).toMatchObject({ sku: 'NEW', offerings: [{ price: 12.5, quantity: 7, isEnabled: false, readinessStateId: 77 }] })
    expect(w.quantityOnProperty).toEqual([513])
    expect(w.skuOnProperty).toEqual([])
    expect(w.readinessStateOnProperty).toEqual([])
  })

  it('unparseable price / quantity → NaN, named by the problems', () => {
    const inv = simple()
    const w = writeFromRows(inv, [{ sku: '', price: 'abc', quantity: '2.5', enabled: true }], { price: [], quantity: [], sku: [] })
    expect(uk(w)).toHaveLength(2)
    expect(parseQuantity(' 12 ')).toBe(12)
    expect(parseQuantity('-1')).toBeNaN()
    expect(parseQuantity('')).toBeNaN()
  })
})

describe('variationImageProblems', () => {
  it('ok, duplicates, more than one property, bad ids', () => {
    expect(variationImageProblems([{ propertyId: 513, valueId: 901, imageId: 5 }])).toEqual([])
    expect(variationImageProblems([])).toEqual([])
    expect(
      variationImageProblems([
        { propertyId: 513, valueId: 901, imageId: 5 },
        { propertyId: 513, valueId: 901, imageId: 6 }
      ]).map((p) => p.uk)
    ).toEqual(['Одне значення має лише одне фото.'])
    expect(
      variationImageProblems([
        { propertyId: 513, valueId: 901, imageId: 5 },
        { propertyId: 200, valueId: 1, imageId: 6 }
      ]).map((p) => p.en)
    ).toEqual(['Photos can be linked to values of one option only.'])
    expect(variationImageProblems([{ propertyId: 0, valueId: 1.5, imageId: 5 }]).map((p) => p.uk)).toEqual(['Некоректні ідентифікатори фото варіацій.'])
  })
})
