import { describe, expect, it } from 'vitest'
import {
  type CategoryProperty,
  LISTING_META_TOOL_SUMMARY,
  type PersonalizationQuestion,
  TRANSLATION_LANGUAGES,
  isPersonalizationType,
  isTranslationLanguage,
  newQuestion,
  personalizationProblems,
  propertyProblems,
  translationProblems
} from '../../../src/shared/features/listingMeta'

const def = (over: Partial<CategoryProperty> = {}): CategoryProperty => ({
  id: 1,
  name: 'size',
  displayName: 'Розмір',
  scales: [],
  isRequired: false,
  supportsAttributes: true,
  supportsVariations: false,
  isMultivalued: false,
  maxValuesAllowed: null,
  possibleValues: [],
  selectedValues: [],
  ...over
})

const q = (over: Partial<PersonalizationQuestion> = {}): PersonalizationQuestion => ({ ...newQuestion(), text: 'Ім’я', ...over })

describe('propertyProblems', () => {
  it('fine: ids + values paired, a scale the category has', () => {
    expect(propertyProblems({ valueIds: [1], values: ['Black'], scaleId: null })).toEqual([])
    const sized = def({ scales: [{ id: 5, name: 'US', description: null }], isMultivalued: true, maxValuesAllowed: 2 })
    expect(propertyProblems({ valueIds: [1, 2], values: ['S', 'M'], scaleId: 5 }, sized)).toEqual([])
  })

  it('empty, bad ids, parentheses/commas, blank values, a bad scale id', () => {
    expect(propertyProblems({ valueIds: [], values: [], scaleId: null })).toEqual(['Виберіть хоча б одне значення.'])
    expect(propertyProblems({ valueIds: [1.5], values: ['a'], scaleId: null })).toEqual(['Некоректний ідентифікатор значення.'])
    expect(propertyProblems({ valueIds: [1, 2, 3], values: ['Red (dark)', 'a,b', ' '], scaleId: 0 })).toEqual([
      'Значення «Red (dark)» містить недозволений символ (дужки або кому).',
      'Значення «a,b» містить недозволений символ (дужки або кому).',
      'Значення не може бути порожнім.',
      'Некоректна шкала.'
    ])
  })

  it('value_ids and values must pair up (both required by the OAS, one id per name)', () => {
    const paired = 'Кожне значення потребує і ідентифікатора, і назви зі списку дозволених.'
    expect(propertyProblems({ valueIds: [], values: ['Mint'], scaleId: null })).toEqual([paired])
    expect(propertyProblems({ valueIds: [1], values: [], scaleId: null })).toEqual([paired])
    expect(propertyProblems({ valueIds: [1, 2], values: ['Red'], scaleId: null })).toEqual([paired])
  })

  it('the category limits: single value, max values, scale needed / unknown', () => {
    expect(propertyProblems({ valueIds: [1, 2], values: ['a', 'b'], scaleId: null }, def())).toEqual(['«Розмір» має лише одне значення.'])
    expect(propertyProblems({ valueIds: [1, 2, 3], values: ['a', 'b', 'c'], scaleId: null }, def({ isMultivalued: true, maxValuesAllowed: 2 }))).toEqual([
      '«Розмір»: не більше 2 значень.'
    ])
    const sized = def({ scales: [{ id: 5, name: 'US', description: null }] })
    expect(propertyProblems({ valueIds: [1], values: ['S'], scaleId: null }, sized)).toEqual(['«Розмір»: виберіть шкалу.'])
    expect(propertyProblems({ valueIds: [1], values: ['S'], scaleId: 6 }, sized)).toEqual(['«Розмір»: такої шкали немає.'])
  })
})

describe('personalizationProblems', () => {
  it('fine: each type with what it allows', () => {
    expect(
      personalizationProblems([
        q({ maxChars: 30, addOnPrice: 1.5, instructions: 'Як на виробі' }),
        q({ type: 'dropdown', required: true, options: [{ id: null, label: 'Teal' }] }),
        q({ type: 'unlabeled_upload', maxFiles: 3 }),
        q({ type: 'labeled_upload', maxFiles: 2, options: [{ id: 1, label: 'Front' }, { id: null, label: 'Back' }] })
      ])
    ).toEqual([])
  })

  it('count: none and more than 5', () => {
    expect(personalizationProblems([])[0]).toContain('хоча б одне питання')
    expect(personalizationProblems(Array.from({ length: 6 }, () => q()))).toEqual(['Питань може бути не більше 5.'])
  })

  it('every rule from the OAS body', () => {
    expect(personalizationProblems([q({ text: ' ' })])).toEqual(['Питання 1: текст не може бути порожнім.'])
    expect(personalizationProblems([q({ text: 'x'.repeat(46) })])).toEqual(['Питання 1: текст довший за 45 символів.'])
    expect(personalizationProblems([q({ type: 'nope' as never })])).toEqual(['Питання 1: невідомий тип.'])
    expect(personalizationProblems([q({ type: 'dropdown', instructions: 'x', options: [{ id: null, label: 'A' }] })])).toEqual([
      'Питання 1: у питання зі списком не буває інструкцій.'
    ])
    expect(personalizationProblems([q({ maxChars: 0 })])[0]).toContain('максимум символів')
    expect(personalizationProblems([q({ type: 'unlabeled_upload', maxChars: 5 })])[0]).toContain('максимум символів')
    expect(personalizationProblems([q({ maxFiles: 2 })])[0]).toContain('максимум файлів')
    expect(personalizationProblems([q({ options: [{ id: null, label: 'A' }] })])).toEqual([
      'Питання 1: варіанти бувають лише у списку і файлів з підписами.'
    ])
    expect(personalizationProblems([q({ type: 'dropdown', options: [] })])).toEqual(['Питання 1: додайте хоча б одну відповідь.'])
    expect(personalizationProblems([q({ type: 'dropdown', options: [{ id: null, label: '' }, { id: null, label: 'x'.repeat(21) }] })])).toEqual([
      'Питання 1: варіант не може бути порожнім.',
      `Питання 1: варіант «${'x'.repeat(21)}» довший за 20 символів.`
    ])
    expect(personalizationProblems([q({ type: 'labeled_upload', maxFiles: 1, options: [{ id: null, label: 'x'.repeat(45) }] })])).toEqual([])
    expect(personalizationProblems([q({ type: 'labeled_upload', maxFiles: 2, options: [{ id: null, label: 'A' }] })])).toEqual([
      'Питання 1: кількість підписів має дорівнювати максимуму файлів.'
    ])
    expect(personalizationProblems([q({ required: true, addOnPrice: 1 })])[0]).toContain('доплата можлива лише')
    expect(personalizationProblems([q({ addOnPrice: -1 })])).toEqual(['Питання 1: доплата має бути додатним числом.'])
    expect(personalizationProblems([q(), q({ text: '' })])).toEqual(['Питання 2: текст не може бути порожнім.'])
  })

  it('a question of a type the editor does not know is never saved (it would be rewritten)', () => {
    expect(personalizationProblems([q({ unsupportedType: 'checkbox' })])).toEqual([
      'Питання 1: тип «checkbox» цей редактор не підтримує — виберіть інший тип або видаліть питання.'
    ])
  })

  it('isPersonalizationType: the OAS enum only', () => {
    expect(['text_input', 'dropdown', 'unlabeled_upload', 'labeled_upload'].every(isPersonalizationType)).toBe(true)
    expect(isPersonalizationType('checkbox')).toBe(false)
  })
})

describe('translations', () => {
  it('languages: the OAS examples (+ ru); others refused', () => {
    expect(TRANSLATION_LANGUAGES.map((l) => l.code)).toEqual(['de', 'en', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru'])
    expect(isTranslationLanguage('de')).toBe(true)
    expect(isTranslationLanguage('uk')).toBe(false)
  })

  it('translationProblems: title, description, tags', () => {
    expect(translationProblems({ title: 'Planer', description: 'Text', tags: ['budget'] })).toEqual([])
    expect(translationProblems({ title: '', description: ' ', tags: [''] })).toEqual([
      'Назва не може бути порожньою.',
      'Опис не може бути порожнім.',
      'Тег не може бути порожнім.'
    ])
    expect(translationProblems({ title: 'x'.repeat(141), description: 'd', tags: [] })).toEqual(['Назва довша за 140 символів (141).'])
    expect(translationProblems({ title: 't', description: 'd', tags: ['a,b'] })[0]).toContain('недозволений символ')
  })
})

describe('LISTING_META_TOOL_SUMMARY', () => {
  it('Ukrainian texts, writes flagged, no marketplace name', () => {
    expect(LISTING_META_TOOL_SUMMARY.filter((t) => t.write).map((t) => t.name)).toEqual([
      'set_my_product_attribute',
      'remove_my_product_attribute',
      'set_my_product_personalization',
      'remove_my_product_personalization',
      'set_my_product_translation',
      'delete_my_product'
    ])
    expect(JSON.stringify(LISTING_META_TOOL_SUMMARY)).not.toMatch(/etsy/i)
  })
})
