import { describe, expect, it } from 'vitest'
import { FIELD_LABEL, changedFields, changedLabel, whenMadeLabel } from '../../src/shared/changes'

describe('changedFields / changedLabel', () => {
  it('groups TrackedFields keys and orders them for display', () => {
    const n = { images: [1], description: 'x', priceAmount: 1, priceDivisor: 100, currency: 'UAH', processingMax: 3 }
    expect(changedFields(n)).toEqual(['price', 'description', 'images', 'processing'])
    expect(changedLabel(n)).toBe('ціна, опис, фото, час на підготовку')
  })
  it('a field set to null still counts as changed', () => {
    expect(changedLabel({ shopSectionId: null })).toBe('розділ магазину')
  })
  it('empty / null', () => {
    expect(changedFields(null)).toEqual([])
    expect(changedLabel({})).toBe('')
  })
  it('every change group has a label', () => {
    expect(Object.values(FIELD_LABEL).every((l) => l.length > 0)).toBe(true)
  })
  it('whenMadeLabel', () => {
    expect(whenMadeLabel('made_to_order')).toBe('на замовлення')
    expect(whenMadeLabel('2020_2026')).toBe('2020–2026')
    expect(whenMadeLabel('before_1700')).toBe('до 1700')
    expect(whenMadeLabel(null)).toBeNull()
  })
})
