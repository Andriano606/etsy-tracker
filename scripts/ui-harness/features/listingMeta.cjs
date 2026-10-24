// UI harness samples for feature "listingMeta" (see ../fake-api.cjs):
// attributes of a planner category, two personalization questions, an English
// translation, delete.

const v = (id, name, scaleId = null) => ({ id, name, scaleId, equalTo: [] })
const def = (over) => ({
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

const DEFS = [
  def({ id: 200, name: 'Primary color', displayName: 'Основний колір', isRequired: true, possibleValues: ['Black', 'Blue', 'Pink', 'Green', 'White', 'Beige'].map((n, i) => v(i + 1, n)) }),
  def({
    id: 46803063641,
    name: 'Holiday',
    displayName: 'Свято',
    isMultivalued: true,
    maxValuesAllowed: 3,
    possibleValues: ['Christmas', 'Easter', 'Halloween', "Mother's Day", "Father's Day", 'New Year', "Valentine's Day", 'Thanksgiving', 'Graduation', 'Back to school', 'Birthday', 'Wedding'].map((n, i) => v(100 + i, n))
  }),
  def({
    id: 300,
    name: 'Paper size',
    displayName: 'Формат паперу',
    isMultivalued: true,
    maxValuesAllowed: 2,
    scales: [
      { id: 5, name: 'Дюйми (США)', description: null },
      { id: 6, name: 'ISO (A-формати)', description: null }
    ],
    possibleValues: [v(10, 'Letter', 5), v(11, 'Legal', 5), v(12, 'A4', 6), v(13, 'A5', 6), v(14, 'Tabloid', 5)],
    selectedValues: []
  }),
  def({ id: 400, name: 'Material', displayName: 'Матеріал', isMultivalued: true })
]

const PERSONALIZATION = [
  { id: 31, text: 'Ім’я на обкладинці', instructions: 'Напишіть ім’я так, як воно має бути на титульній сторінці', type: 'text_input', required: false, maxChars: 30, maxFiles: null, options: [], addOnPrice: 2.5, addOnCurrency: 'USD' },
  { id: 32, text: 'Початковий місяць', instructions: null, type: 'dropdown', required: true, maxChars: null, maxFiles: null, options: [{ id: 1, label: 'Січень' }, { id: 2, label: 'Липень' }], addOnPrice: null, addOnCurrency: null }
]

const which = (listingId, ctx) => ctx.myListings.filter((l) => l.state === 'active').findIndex((l) => l.listingId === listingId)
const FAIL = { ok: false, error: 'Для цього потрібен дозвіл: читання лістингів. Вийдіть і увійдіть в Etsy ще раз.' }

module.exports = {
  attributes: ({ listingId, taxonomyId }, ctx) =>
    which(listingId, ctx) === 2
      ? FAIL
      : which(listingId, ctx) === 1 && !taxonomyId
        ? { listingId, taxonomyId: null, categoryPath: null, properties: [], definitions: null, note: 'Etsy не показав категорію цього лістингу (можливо, це чернетка) — виберіть категорію вручну.' }
        : ({
    listingId,
    taxonomyId: taxonomyId ?? 2,
    categoryPath: 'Paper & Party Supplies › Paper › Calendars & Planners',
    properties: [
      { propertyId: 200, name: 'Primary color', scaleId: null, scaleName: null, valueIds: [3], values: ['Pink'] },
      { propertyId: 46803063641, name: 'Holiday', scaleId: null, scaleName: null, valueIds: [105], values: ['New Year'] },
      { propertyId: 999, name: 'Occasion', scaleId: null, scaleName: null, valueIds: [5], values: ['Birthday'] }
    ],
    definitions: DEFS,
    note: null
  }),
  categories: () => [
    { id: 1, path: 'Paper & Party Supplies' },
    { id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' },
    { id: 3, path: 'Home & Living › Office › Planners' }
  ],
  saveAttribute: ({ propertyId, valueIds, values, scaleId }) => ({ propertyId, name: null, scaleId, scaleName: null, valueIds, values }),
  removeAttribute: () => true,
  personalization: ({ listingId }, ctx) => (which(listingId, ctx) === 2 ? FAIL : which(listingId, ctx) === 1 ? [] : PERSONALIZATION),
  savePersonalization: ({ questions }) => questions,
  removePersonalization: () => true,
  translation: ({ listingId, language }, ctx) =>
    which(listingId, ctx) === 2
      ? FAIL
      : language === 'en' && which(listingId, ctx) === 0
      ? { listingId, language, title: 'Monthly Budget Spreadsheet | Blush Pink', description: 'A simple annual budget for Google Sheets.\nTrack income, expenses and savings.', tags: ['budget', 'planner', 'google sheets'] }
      : null,
  saveTranslation: ({ listingId, language, title, description, tags }) => ({ listingId, language, title, description, tags }),
  deleteListing: () => true
}
