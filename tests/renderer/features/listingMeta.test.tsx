// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ui } from '../../../src/renderer/src/features/listingMeta'
import { panelMeta } from '../../../src/renderer/src/features/LazyDetails'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { useDeletedListings } from '../../../src/renderer/src/features/listingMeta/deleted'
import { useStore } from '../../../src/renderer/src/store'
import type { CategoryProperty, ListingAttributes, PersonalizationQuestion } from '../../../src/shared/features/listingMeta'
import type { MyListing } from '../../../src/shared/types'
import { mockFeature, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useDeletedListings.setState({ ids: [] })
})

const mine: MyListing = {
  listingId: 1234,
  state: 'active',
  title: 'Budget Planner & Tracker',
  description: 'A planner',
  tags: ['budget'],
  materials: [],
  shouldAutoRenew: true,
  type: 'download',
  priceAmount: 500,
  priceDivisor: 100,
  currency: 'USD',
  quantity: 999,
  url: null,
  imageUrl: null,
  updatedAt: null,
  endingAt: null
}

async function show(id: string, onChanged = vi.fn()) {
  const C = ui.ownListingSections!.find((s) => s.id === id)!.Component
  await act(async () => {
    render(
      <>
        <C listing={mine} onChanged={onChanged} />
        <ConfirmModal />
      </>
    )
  })
  return onChanged
}

const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el)
  })
const change = (el: HTMLElement, value: string) =>
  act(async () => {
    fireEvent.change(el, { target: { value } })
  })
/** The question the in-app confirmation is asking right now (null = none open). */
const asked = () => useStore.getState().confirmRequest?.message ?? null
const calls = (action: string) => api.featureCall.mock.calls.filter((c) => c[0] === 'listingMeta' && c[1] === action).map((c) => c[2])

it('registers the four own-listing sections in order', () => {
  expect(ui.ownListingSections!.map((s) => [s.id, s.label])).toEqual([
    ['attributes', 'Атрибути'],
    ['personalization', 'Персоналізація'],
    ['translations', 'Переклади'],
    ['danger', 'Видалити товар з Etsy']
  ])
  // Each has an icon + a one-line "what is inside" for its summary row (read by the host via panelMeta).
  expect(ui.ownListingSections!.map((s) => panelMeta(s).icon)).toEqual(['list', 'edit', 'globe', 'trash'])
  for (const s of ui.ownListingSections!) expect(panelMeta(s).description).toMatch(/\S.{20,}/)
})

// =============================================================== attributes

const color: CategoryProperty = {
  id: 200,
  name: 'Primary color',
  displayName: 'Основний колір',
  scales: [],
  isRequired: true,
  supportsAttributes: true,
  supportsVariations: true,
  isMultivalued: false,
  maxValuesAllowed: null,
  possibleValues: [
    { id: 1, name: 'Black', scaleId: null, equalTo: [] },
    { id: 2, name: 'Teal & Orange', scaleId: null, equalTo: [] }
  ],
  selectedValues: []
}
const size: CategoryProperty = {
  ...color,
  id: 300,
  displayName: 'Формат паперу',
  isRequired: false,
  isMultivalued: true,
  maxValuesAllowed: 2,
  scales: [
    { id: 5, name: 'Дюйми', description: null },
    { id: 6, name: 'ISO', description: null }
  ],
  possibleValues: [
    { id: 10, name: 'Letter', scaleId: 5, equalTo: [] },
    { id: 11, name: 'Legal', scaleId: 5, equalTo: [] },
    { id: 12, name: 'A4', scaleId: 6, equalTo: [] },
    { id: 13, name: 'Tabloid', scaleId: 5, equalTo: [] }
  ],
  selectedValues: [{ id: 10, name: 'Letter', scaleId: 5, equalTo: [] }]
}
const material: CategoryProperty = { ...color, id: 400, displayName: 'Матеріал', isRequired: false, isMultivalued: true, possibleValues: [] }

const attrs = (over: Partial<ListingAttributes> = {}): ListingAttributes => ({
  listingId: 1234,
  taxonomyId: 2,
  categoryPath: 'Paper › Calendars & Planners',
  properties: [{ propertyId: 200, name: 'Primary color', scaleId: null, scaleName: null, valueIds: [1], values: ['Black'] }],
  definitions: [size, material, color],
  note: null,
  ...over
})

describe('Атрибути', () => {
  it('loads the category form: required first, current values, the category path', async () => {
    mockFeature({ 'listingMeta.attributes': attrs() })
    await show('attributes')
    expect(calls('attributes')).toEqual([{ listingId: 1234, taxonomyId: null }])
    const box = screen.getByTestId('lm-attributes')
    expect(box).toHaveTextContent('Категорія: Paper › Calendars & Planners')
    const rows = within(box).getAllByTestId(/^lm-attr-\d+$/)
    expect(rows.map((r) => r.dataset.testid)).toEqual(['lm-attr-200', 'lm-attr-300', 'lm-attr-400'])
    expect(rows[0]).toHaveTextContent('обов’язковий')
    expect(rows[0]).toHaveTextContent('Зараз на Etsy: Black')
    expect(rows[2]).toHaveTextContent('Не заповнено')
    expect(box).toHaveTextContent('Заповнено 1 з 3')
    expect(screen.getByLabelText('Значення')).toHaveValue('Black')
    expect(rows[1]).toHaveTextContent('Завжди вибрано: Letter')
    expect(rows[1]).toHaveTextContent('кілька значень (до 2)')
  })

  it('shows "Завантаження…" first and a load error as an alert', async () => {
    let resolve!: (v: unknown) => void
    mockFeature({ 'listingMeta.attributes': () => new Promise((r) => (resolve = r)) })
    await show('attributes')
    expect(screen.getByText('Завантаження атрибутів…')).toBeInTheDocument()
    await act(async () => resolve({ ok: false, error: 'Увійдіть в Etsy' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
  })

  it('a single value: pick it and save that property only', async () => {
    mockFeature({
      'listingMeta.attributes': attrs(),
      'listingMeta.saveAttribute': { propertyId: 200, name: 'Primary color', scaleId: null, scaleName: null, valueIds: [2], values: ['Teal & Orange'] }
    })
    await show('attributes')
    const row = screen.getByTestId('lm-attr-200')
    const save = within(row).getByRole('button', { name: 'Зберегти' })
    expect(save).toBeDisabled()
    await change(within(row).getByLabelText('Значення'), 'Teal & Orange')
    await click(save)
    expect(calls('saveAttribute')).toEqual([{ listingId: 1234, propertyId: 200, valueIds: [2], values: ['Teal & Orange'], scaleId: null }])
    expect(row).toHaveTextContent('Збережено.')
    expect(row).toHaveTextContent('Зараз на Etsy: Teal & Orange')
  })

  it('scales + several values: a scale filters the values; too many values or no scale is flagged', async () => {
    mockFeature({ 'listingMeta.attributes': attrs(), 'listingMeta.saveAttribute': (a: any) => ({ propertyId: 300, name: null, scaleId: 5, scaleName: 'Дюйми', valueIds: a.valueIds, values: a.values }) })
    await show('attributes')
    const row = screen.getByTestId('lm-attr-300')
    const save = within(row).getByRole('button', { name: 'Зберегти' })
    await change(within(row).getByLabelText('Шкала'), '6')
    expect(within(row).queryByLabelText('Letter')).not.toBeInTheDocument()
    expect(within(row).getByLabelText('A4')).toBeInTheDocument()
    await change(within(row).getByLabelText('Шкала'), '5')
    await click(within(row).getByLabelText('Letter'))
    await click(within(row).getByLabelText('Legal'))
    await click(within(row).getByLabelText('Tabloid'))
    expect(row).toHaveTextContent('«Формат паперу»: не більше 2 значень.')
    expect(save).toBeDisabled()
    await click(within(row).getByLabelText('Tabloid'))
    await change(within(row).getByLabelText('Шкала'), '')
    expect(row).toHaveTextContent('«Формат паперу»: виберіть шкалу.')
    await change(within(row).getByLabelText('Шкала'), '5')
    await click(save)
    expect(calls('saveAttribute')).toEqual([{ listingId: 1234, propertyId: 300, valueIds: [10, 11], values: ['Letter', 'Legal'], scaleId: 5 }])
  })

  it('no allowed values (a free value has no id, and Etsy needs both): no editor, no save — only "Прибрати" when set', async () => {
    mockFeature({
      'listingMeta.attributes': attrs({
        properties: [{ propertyId: 400, name: 'Material', scaleId: null, scaleName: null, valueIds: [9], values: ['Paper'] }]
      })
    })
    await show('attributes')
    const row = screen.getByTestId('lm-attr-400')
    expect(row).toHaveTextContent('Etsy не дає для цього атрибута списку дозволених значень')
    expect(within(row).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Зберегти' })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Прибрати' })).toBeInTheDocument()
  })

  it('allowed values without an id are not offered, so ids and names always pair up', async () => {
    const odd: CategoryProperty = {
      ...color,
      isMultivalued: true,
      possibleValues: [...color.possibleValues, { id: null, name: 'Mint', scaleId: null, equalTo: [] }]
    }
    mockFeature({ 'listingMeta.attributes': attrs({ properties: [], definitions: [odd] }), 'listingMeta.saveAttribute': (a: any) => ({ propertyId: 200, name: null, scaleId: null, scaleName: null, valueIds: a.valueIds, values: a.values }) })
    await show('attributes')
    const row = screen.getByTestId('lm-attr-200')
    expect(within(row).queryByLabelText('Mint')).not.toBeInTheDocument()
    await click(within(row).getByLabelText('Black'))
    await click(within(row).getByLabelText('Teal & Orange'))
    await click(within(row).getByRole('button', { name: 'Зберегти' }))
    expect(calls('saveAttribute')).toEqual([{ listingId: 1234, propertyId: 200, valueIds: [1, 2], values: ['Black', 'Teal & Orange'], scaleId: null }])

    const none: CategoryProperty = { ...color, possibleValues: [{ id: null, name: 'Mint', scaleId: null, equalTo: [] }] }
    mockFeature({ 'listingMeta.attributes': attrs({ properties: [], definitions: [none] }) })
    await show('attributes')
    expect(screen.getAllByTestId('lm-attr-200')[1]).toHaveTextContent('списку дозволених значень')
  })

  it('a save error is shown as an alert', async () => {
    mockFeature({ 'listingMeta.attributes': attrs(), 'listingMeta.saveAttribute': { ok: false, error: 'Etsy відхилив запит.' } })
    await show('attributes')
    const row = screen.getByTestId('lm-attr-200')
    await change(within(row).getByLabelText('Значення'), 'Teal & Orange')
    await click(within(row).getByRole('button', { name: 'Зберегти' }))
    expect(within(row).getByRole('alert')).toHaveTextContent('Etsy відхилив запит.')
  })

  it('"Прибрати" asks first: cancel = nothing, confirm = removeAttribute', async () => {
    mockFeature({ 'listingMeta.attributes': attrs(), 'listingMeta.removeAttribute': true })
    await show('attributes')
    const row = screen.getByTestId('lm-attr-200')
    await click(within(row).getByRole('button', { name: 'Прибрати' }))
    expect(asked()).toMatch(/^Прибрати атрибут «Основний колір»/)
    await click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(calls('removeAttribute')).toEqual([])
    await click(within(row).getByRole('button', { name: 'Прибрати' }))
    await click(screen.getByRole('button', { name: 'Підтвердити' }))
    expect(calls('removeAttribute')).toEqual([{ listingId: 1234, propertyId: 200 }])
    expect(row).toHaveTextContent('Атрибут прибрано.')
    expect(within(row).queryByRole('button', { name: 'Прибрати' })).not.toBeInTheDocument()
  })

  it('properties the category form doesn\'t show are listed with "Прибрати"', async () => {
    mockFeature({
      'listingMeta.attributes': attrs({
        properties: [{ propertyId: 999, name: 'Occasion', scaleId: null, scaleName: 'US', valueIds: [5], values: ['Birthday'] }],
        definitions: []
      }),
      'listingMeta.removeAttribute': { ok: false, error: 'Немає доступу.' }
    })
    await show('attributes')
    expect(screen.getByText('Ця категорія не має атрибутів.')).toBeInTheDocument()
    const table = screen.getByTestId('lm-other-props')
    expect(table).toHaveTextContent('Occasion')
    expect(table).toHaveTextContent('Birthday (US)')
    await click(within(table).getByRole('button', { name: 'Прибрати' }))
    await click(screen.getByRole('button', { name: 'Підтвердити' }))
    expect(calls('removeAttribute')).toEqual([{ listingId: 1234, propertyId: 999 }])
    expect(screen.getByRole('alert')).toHaveTextContent('Немає доступу.')
  })

  it('no category known: the note + a category picker; picking reloads with that category', async () => {
    mockFeature({
      'listingMeta.attributes': (a: any) =>
        a.taxonomyId ? attrs({ taxonomyId: a.taxonomyId, categoryPath: 'Paper › Planners' }) : attrs({ taxonomyId: null, categoryPath: null, definitions: null, note: 'Виберіть категорію вручну.' }),
      'listingMeta.categories': [
        { id: 1, path: 'Paper' },
        { id: 7, path: 'Paper › Planners' }
      ]
    })
    await show('attributes')
    expect(screen.getByText('Виберіть категорію вручну.')).toBeInTheDocument()
    expect(screen.getByTestId('lm-other-props')).toHaveTextContent('Primary color')
    await change(screen.getByLabelText('Категорія товару'), 'plan')
    await click(screen.getByRole('option', { name: 'Paper › Planners' }))
    expect(calls('attributes')).toEqual([
      { listingId: 1234, taxonomyId: null },
      { listingId: 1234, taxonomyId: 7 }
    ])
    expect(screen.getByTestId('lm-attributes')).toHaveTextContent('Категорія: Paper › Planners')
  })

  it('the category picker is a combobox: ↑/↓ move through the results, Enter picks', async () => {
    mockFeature({
      'listingMeta.attributes': (a: any) =>
        a.taxonomyId ? attrs({ taxonomyId: a.taxonomyId, categoryPath: 'Paper' }) : attrs({ taxonomyId: null, categoryPath: null, definitions: null }),
      'listingMeta.categories': [
        { id: 1, path: 'Paper' },
        { id: 7, path: 'Paper › Planners' }
      ]
    })
    await show('attributes')
    const box = screen.getByRole('combobox', { name: 'Категорія товару' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
    await change(box, 'pap')
    expect(box).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox', { name: 'Категорії' })
    expect(box).toHaveAttribute('aria-controls', list.id)
    // Options sit directly in the listbox (no <button> between).
    expect(within(list).getAllByRole('option').map((o) => o.parentElement)).toEqual([list, list])
    expect(box).not.toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    const planners = screen.getByRole('option', { name: 'Paper › Planners' })
    expect(box).toHaveAttribute('aria-activedescendant', planners.id)
    expect(planners).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: 'Paper' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(calls('attributes')).toEqual([
      { listingId: 1234, taxonomyId: null },
      { listingId: 1234, taxonomyId: 7 }
    ])
  })

  it('several values are checkable chips; a load error has "Спробувати ще"', async () => {
    let n = 0
    mockFeature({ 'listingMeta.attributes': () => (++n === 1 ? { ok: false, error: 'Немає з’єднання.' } : attrs()) })
    await show('attributes')
    await click(screen.getByRole('button', { name: 'Спробувати ще' }))
    const row = screen.getByTestId('lm-attr-300')
    await change(within(row).getByLabelText('Шкала'), '5')
    const letter = within(row).getByRole('checkbox', { name: 'Letter' })
    expect(letter).not.toBeChecked()
    await click(letter)
    expect(letter).toBeChecked()
    expect(letter.closest('label')).toHaveClass('is-on')
    expect(within(row).getByText('Не збережено').closest('.ui-badge')).toBeInTheDocument()
  })

  it('the category list failing to load is shown', async () => {
    mockFeature({
      'listingMeta.attributes': attrs({ taxonomyId: null, definitions: null, properties: [] }),
      'listingMeta.categories': { ok: false, error: 'Немає з’єднання.' }
    })
    await show('attributes')
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання.')
    expect(screen.getByText('Атрибутів не задано.')).toBeInTheDocument()
  })
})

// ========================================================== personalization

const textQ: PersonalizationQuestion = {
  id: 31,
  text: 'Ваше ім’я',
  instructions: 'Як на обкладинці',
  type: 'text_input',
  required: false,
  maxChars: 40,
  maxFiles: null,
  options: [],
  addOnPrice: 2.5,
  addOnCurrency: 'USD'
}

describe('Персоналізація', () => {
  it('loads and shows the questions; an edit is saved as the whole list', async () => {
    mockFeature({ 'listingMeta.personalization': [textQ], 'listingMeta.savePersonalization': (a: any) => a.questions })
    await show('personalization')
    expect(calls('personalization')).toEqual([{ listingId: 1234 }])
    const q = screen.getByTestId('lm-q0')
    expect(within(q).getByLabelText(/Текст питання/)).toHaveValue('Ваше ім’я')
    expect(within(q).getByLabelText('Максимум символів')).toHaveValue('40')
    expect(within(q).getByLabelText('Доплата, USD (необов’язково)')).toHaveValue('2,50')
    const save = screen.getByRole('button', { name: 'Зберегти персоналізацію' })
    expect(save).toBeDisabled()
    await change(within(q).getByLabelText(/Текст питання/), 'Ім’я на обкладинці')
    await click(save)
    expect(calls('savePersonalization')).toEqual([{ listingId: 1234, questions: [{ ...textQ, text: 'Ім’я на обкладинці' }] }])
    expect(screen.getByText('Персоналізацію збережено на Etsy.')).toBeInTheDocument()
    expect(save).toBeDisabled()
  })

  it('a new dropdown question: problems block saving until it has options; type change drops what it doesn\'t allow', async () => {
    mockFeature({ 'listingMeta.personalization': [], 'listingMeta.savePersonalization': (a: any) => a.questions })
    await show('personalization')
    expect(screen.getByText(/Персоналізації немає/)).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Додати питання' }))
    const q = screen.getByTestId('lm-q0')
    const save = screen.getByRole('button', { name: 'Зберегти персоналізацію' })
    expect(screen.getByText('Питання 1: текст не може бути порожнім.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    await change(within(q).getByLabelText(/Текст питання/), 'Колір')
    await change(within(q).getByLabelText(/Інструкції/), 'Будь-який')
    await change(within(q).getByLabelText('Тип'), 'dropdown')
    expect(within(q).queryByLabelText(/Інструкції/)).not.toBeInTheDocument()
    expect(screen.getByText('Питання 1: додайте хоча б одну відповідь.')).toBeInTheDocument()
    // Answer options are "відповіді" — not "варіанти" (that word is for product variants).
    expect(q).toHaveTextContent('Варіанти відповіді')
    expect(within(q).queryByRole('button', { name: 'Додати варіант' })).toBeNull()
    await click(within(q).getByRole('button', { name: 'Додати відповідь' }))
    await click(within(q).getByRole('button', { name: 'Додати відповідь' }))
    await change(within(q).getByLabelText('Відповідь 1 питання 1'), 'Teal')
    await change(within(q).getByLabelText('Відповідь 2 питання 1'), 'Orange')
    expect(within(q).getByRole('button', { name: 'Прибрати: відповідь 2' })).toBeInTheDocument()
    await click(within(q).getByRole('switch', { name: 'Обов’язкове' }))
    expect(save).toBeEnabled()
    await click(save)
    expect(calls('savePersonalization')[0]).toEqual({
      listingId: 1234,
      questions: [
        {
          id: null,
          text: 'Колір',
          instructions: null,
          type: 'dropdown',
          required: true,
          maxChars: null,
          maxFiles: null,
          options: [
            { id: null, label: 'Teal' },
            { id: null, label: 'Orange' }
          ],
          addOnPrice: null,
          addOnCurrency: null
        }
      ]
    })
  })

  it('upload questions: max files; labeled upload needs one label per file; options can be removed', async () => {
    mockFeature({ 'listingMeta.personalization': [] })
    await show('personalization')
    await click(screen.getByRole('button', { name: 'Додати питання' }))
    const q = screen.getByTestId('lm-q0')
    await change(within(q).getByLabelText(/Текст питання/), 'Фото')
    await change(within(q).getByLabelText('Тип'), 'labeled_upload')
    await change(within(q).getByLabelText('Максимум файлів'), '2')
    expect(q).toHaveTextContent('Підписи файлів')
    await click(within(q).getByRole('button', { name: 'Додати підпис' }))
    await change(within(q).getByLabelText('Підпис 1 питання 1'), 'Спереду')
    expect(screen.getByText('Питання 1: кількість підписів має дорівнювати максимуму файлів.')).toBeInTheDocument()
    await click(within(q).getByRole('button', { name: 'Додати підпис' }))
    await change(within(q).getByLabelText('Підпис 2 питання 1'), 'Ззаду')
    expect(screen.getByRole('button', { name: 'Зберегти персоналізацію' })).toBeEnabled()
    await click(within(q).getByRole('button', { name: 'Прибрати: підпис 2' }))
    expect(within(q).queryByLabelText('Підпис 2 питання 1')).not.toBeInTheDocument()
    expect(within(q).queryByLabelText('Максимум символів')).not.toBeInTheDocument()
  })

  it('at most 5 questions; "Видалити питання" removes one from the form', async () => {
    mockFeature({ 'listingMeta.personalization': Array.from({ length: 5 }, (_, i) => ({ ...textQ, id: i + 1 })) })
    await show('personalization')
    expect(screen.getByRole('button', { name: 'Додати питання' })).toBeDisabled()
    await click(within(screen.getByTestId('lm-q4')).getByRole('button', { name: 'Видалити питання' }))
    expect(screen.queryByTestId('lm-q4')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Додати питання' })).toBeEnabled()
  })

  it('a save that drops saved questions asks first (Etsy replaces them all): cancel = nothing, confirm = save', async () => {
    const second = { ...textQ, id: 32, text: 'Дата' }
    mockFeature({ 'listingMeta.personalization': [textQ, second], 'listingMeta.savePersonalization': (a: any) => a.questions })
    await show('personalization')
    await click(within(screen.getByTestId('lm-q1')).getByRole('button', { name: 'Видалити питання' }))
    const save = screen.getByRole('button', { name: 'Зберегти персоналізацію' })
    await click(save)
    expect(asked()).toBe('Зберегти персоналізацію? Etsy замінить усі питання — 1 збережене питання буде видалено: «Дата».')
    await click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(calls('savePersonalization')).toEqual([])
    await click(save)
    await click(screen.getByRole('button', { name: 'Підтвердити' }))
    expect(calls('savePersonalization')).toEqual([{ listingId: 1234, questions: [textQ] }])
    expect(screen.getByText('Персоналізацію збережено на Etsy.')).toBeInTheDocument()
  })

  it('a question of a type the editor doesn\'t know: flagged, saving blocked until another type is picked', async () => {
    const odd: PersonalizationQuestion = { ...textQ, unsupportedType: 'checkbox' }
    mockFeature({ 'listingMeta.personalization': [odd], 'listingMeta.savePersonalization': (a: any) => a.questions })
    await show('personalization')
    const q = screen.getByTestId('lm-q0')
    expect(q).toHaveTextContent('Тип «checkbox» цей редактор не підтримує')
    expect(within(q).getByLabelText('Тип')).toHaveValue('')
    await change(within(q).getByLabelText(/Текст питання/), 'Ім’я')
    expect(screen.getByText(/тип «checkbox» цей редактор не підтримує — виберіть інший тип/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Зберегти персоналізацію' })).toBeDisabled()
    await change(within(q).getByLabelText('Тип'), 'text_input')
    expect(q).not.toHaveTextContent('не підтримує')
    await click(screen.getByRole('button', { name: 'Зберегти персоналізацію' }))
    expect(calls('savePersonalization')[0].questions[0]).not.toHaveProperty('unsupportedType')
  })

  it('"Прибрати персоналізацію" asks first: cancel = nothing, confirm = removePersonalization', async () => {
    mockFeature({ 'listingMeta.personalization': [textQ], 'listingMeta.removePersonalization': true })
    await show('personalization')
    await click(screen.getByRole('button', { name: 'Прибрати персоналізацію' }))
    await click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(calls('removePersonalization')).toEqual([])
    await click(screen.getByRole('button', { name: 'Прибрати персоналізацію' }))
    await click(screen.getByRole('button', { name: 'Підтвердити' }))
    expect(calls('removePersonalization')).toEqual([{ listingId: 1234 }])
    expect(screen.getByText('Персоналізацію прибрано.')).toBeInTheDocument()
    expect(screen.queryByTestId('lm-q0')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Прибрати персоналізацію' })).not.toBeInTheDocument()
  })

  it('load and save errors are alerts; a load error has "Спробувати ще"', async () => {
    let n = 0
    mockFeature({ 'listingMeta.personalization': () => (++n === 1 ? { ok: false, error: 'Не знайдено.' } : [textQ]) })
    await show('personalization')
    expect(screen.getByRole('alert')).toHaveTextContent('Не знайдено.')
    await click(screen.getByRole('button', { name: 'Спробувати ще' }))
    expect(within(screen.getByTestId('lm-q0')).getByLabelText(/Текст питання/)).toHaveValue('Ваше ім’я')
  })

  it('every question explains itself: the type in words, "Обов’язкове" as a switch, a counter of questions', async () => {
    mockFeature({ 'listingMeta.personalization': [textQ] })
    await show('personalization')
    const q = screen.getByTestId('lm-q0')
    expect(q).toHaveTextContent('Покупець впише текст у поле')
    expect(within(q).getByRole('switch', { name: 'Обов’язкове' })).not.toBeChecked()
    expect(within(q).getByRole('button', { name: 'Що таке «Тип питання»?' })).toBeInTheDocument()
    expect(within(q).getByLabelText(/Текст питання/)).toHaveAccessibleDescription('Що побачить покупець, наприклад «Ім’я для обкладинки».')
    expect(screen.getByText('1 з 5')).toBeInTheDocument()
    await change(within(q).getByLabelText('Тип'), 'dropdown')
    expect(q).toHaveTextContent('Покупець вибере одну відповідь зі списку')
    // The same warn badge as in the other editor sections.
    expect(screen.getByText('Є незбережені зміни').closest('.ui-badge')).toBeInTheDocument()
  })

  it('a save error keeps the form', async () => {
    mockFeature({ 'listingMeta.personalization': [textQ], 'listingMeta.savePersonalization': { ok: false, error: 'Etsy: помилка.' } })
    await show('personalization')
    await change(screen.getByLabelText('Максимум символів'), '20')
    await click(screen.getByRole('button', { name: 'Зберегти персоналізацію' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Etsy: помилка.')
    expect(screen.getByLabelText('Максимум символів')).toHaveValue('20')
  })
})

// ============================================================= translations

describe('Переклади', () => {
  it('no translation yet in English: fill in and create it (tags split at commas)', async () => {
    mockFeature({
      'listingMeta.translation': null,
      'listingMeta.saveTranslation': (a: any) => ({ listingId: 1234, language: a.language, title: a.title, description: a.description, tags: a.tags })
    })
    await show('translations')
    expect(calls('translation')).toEqual([{ listingId: 1234, language: 'en' }])
    expect(screen.getByText(/Перекладу цією мовою ще немає/)).toBeInTheDocument()
    const create = screen.getByRole('button', { name: 'Створити переклад' })
    expect(create).toBeDisabled()
    await change(screen.getByLabelText(/Назва/), 'Budget planner')
    expect(screen.getByText(/Опис не може бути порожнім/)).toBeInTheDocument()
    await change(screen.getByLabelText('Опис'), 'A planner')
    await change(screen.getByLabelText(/Теги через кому/), 'budget, planner,, budget')
    await click(create)
    expect(calls('saveTranslation')).toEqual([
      { listingId: 1234, language: 'en', title: 'Budget planner', description: 'A planner', tags: ['budget', 'planner'], exists: false }
    ])
    expect(screen.getByText('Переклад створено на Etsy.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Оновити переклад' })).toBeDisabled()
  })

  it('switching the language loads that translation; an edit updates it', async () => {
    mockFeature({
      'listingMeta.translation': (a: any) =>
        a.language === 'de' ? { listingId: 1234, language: 'de', title: 'Budgetplaner', description: 'Ein Planer', tags: ['budget'] } : null,
      'listingMeta.saveTranslation': (a: any) => ({ listingId: 1234, language: a.language, title: a.title, description: a.description, tags: a.tags })
    })
    await show('translations')
    await change(screen.getByLabelText('Мова'), 'de')
    expect(calls('translation')).toEqual([
      { listingId: 1234, language: 'en' },
      { listingId: 1234, language: 'de' }
    ])
    expect(screen.getByLabelText(/Назва/)).toHaveValue('Budgetplaner')
    expect(screen.getByLabelText(/Теги через кому/)).toHaveValue('budget')
    await change(screen.getByLabelText(/Назва/), 'Budgetplaner 2026')
    await click(screen.getByRole('button', { name: 'Оновити переклад' }))
    expect(calls('saveTranslation')).toEqual([
      { listingId: 1234, language: 'de', title: 'Budgetplaner 2026', description: 'Ein Planer', tags: ['budget'], exists: true }
    ])
    expect(screen.getByText('Переклад оновлено на Etsy.')).toBeInTheDocument()
  })

  it('clearing the tags of a translation that has some warns that they stay (Etsy has no way to clear them)', async () => {
    mockFeature({ 'listingMeta.translation': { listingId: 1234, language: 'en', title: 'T', description: 'D', tags: ['budget'] } })
    await show('translations')
    expect(screen.queryByText(/Etsy не дозволяє прибрати всі теги перекладу/)).not.toBeInTheDocument()
    await change(screen.getByLabelText(/Теги через кому/), '')
    expect(screen.getByText('Etsy не дозволяє прибрати всі теги перекладу — якщо поле порожнє, наявні теги лишаться як є.')).toBeInTheDocument()
  })

  it('an existing translation is marked; a load error has "Спробувати ще"', async () => {
    let n = 0
    mockFeature({
      'listingMeta.translation': () => (++n === 1 ? { ok: false, error: 'Увійдіть в Etsy' } : { listingId: 1234, language: 'en', title: 'T', description: 'D', tags: [] })
    })
    await show('translations')
    expect(screen.queryByText('Переклад є на Etsy')).toBeNull()
    await click(screen.getByRole('button', { name: 'Спробувати ще' }))
    expect(screen.getByText('Переклад є на Etsy')).toBeInTheDocument()
    expect(screen.getByLabelText(/Назва/)).toHaveValue('T')
  })

  it('load and save errors are alerts', async () => {
    mockFeature({ 'listingMeta.translation': { ok: false, error: 'Увійдіть в Etsy' } })
    await show('translations')
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')

    mockFeature({ 'listingMeta.translation': { listingId: 1234, language: 'fr', title: 'T', description: 'D', tags: [] } })
    await change(screen.getByLabelText('Мова'), 'fr')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    mockFeature({ 'listingMeta.saveTranslation': { ok: false, error: 'Etsy відхилив запит.' } })
    await change(screen.getByLabelText('Опис'), 'D2')
    await click(screen.getByRole('button', { name: 'Оновити переклад' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Etsy відхилив запит.')
  })
})

// =============================================================== danger zone

describe('Видалити товар з Etsy', () => {
  it('the delete button needs the exact title, then a confirmation; success → onChanged() + a note', async () => {
    mockFeature({ 'listingMeta.deleteListing': true })
    const onChanged = await show('danger')
    const del = screen.getByRole('button', { name: 'Видалити товар назавжди' })
    const input = screen.getByLabelText(/введіть назву товару точно/)
    expect(del).toBeDisabled()
    await change(input, 'budget planner & tracker')
    expect(del).toBeDisabled()
    await change(input, 'Budget Planner & Tracker ')
    expect(del).toBeDisabled()
    await change(input, 'Budget Planner & Tracker')
    expect(del).toBeEnabled()
    await click(del)
    expect(asked()).toMatch(/^Видалити товар «Budget Planner & Tracker» з Etsy назавжди\?/)
    await click(screen.getByRole('button', { name: 'Скасувати' }))
    expect(calls('deleteListing')).toEqual([])
    await click(del)
    await click(screen.getByRole('button', { name: 'Підтвердити' }))
    expect(calls('deleteListing')).toEqual([{ listingId: 1234 }])
    expect(onChanged).toHaveBeenCalledWith()
    expect(screen.getByText('Товар «Budget Planner & Tracker» видалено з Etsy.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Видалити товар назавжди' })).not.toBeInTheDocument()
  })

  it('says what deleting means (and the gentler option), shows the title to type and whether it matches', async () => {
    await show('danger')
    const zone = screen.getByTestId('lm-danger')
    expect(zone).toHaveTextContent('відновити його не можна')
    expect(zone).toHaveTextContent('Зробіть його неактивним')
    // "лістинг" appears only explained, inside the title.
    expect(within(zone).getByRole('heading', { name: 'Видалити товар (лістинг) з Etsy' })).toBeInTheDocument()
    expect(within(zone).getByText('товар (лістинг)')).toHaveAccessibleDescription(/На Etsy це називають «listing»/)
    const input = screen.getByLabelText(/введіть назву товару точно/)
    expect(input).toHaveAccessibleDescription('Назва: «Budget Planner & Tracker»')
    await change(input, 'Budget')
    expect(zone).toHaveTextContent('Поки не збігається')
    await change(input, mine.title)
    expect(zone).toHaveTextContent('Назва збігається')
  })

  it('after a delete the other sections of that listing stop offering edits', async () => {
    mockFeature({ 'listingMeta.deleteListing': true, 'listingMeta.attributes': attrs(), 'listingMeta.personalization': [textQ], 'listingMeta.translation': null })
    await act(async () => {
      render(
        <>
          {ui.ownListingSections!.map(({ id, Component }) => (
            <Component key={id} listing={mine} onChanged={vi.fn()} />
          ))}
          <ConfirmModal />
        </>
      )
    })
    expect(screen.getByTestId('lm-attributes')).toBeInTheDocument()
    await change(screen.getByLabelText(/введіть назву товару точно/), mine.title)
    await click(screen.getByRole('button', { name: 'Видалити товар назавжди' }))
    await click(screen.getByRole('button', { name: 'Підтвердити' }))
    expect(screen.getAllByText('Товар видалено з Etsy — редагувати нічого.')).toHaveLength(3)
    for (const id of ['lm-attributes', 'lm-personalization', 'lm-translations']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  it('an Etsy refusal is an alert and nothing is reported as changed', async () => {
    mockFeature({ 'listingMeta.deleteListing': { ok: false, error: 'Для цього потрібен дозвіл: видалення товарів.' } })
    const onChanged = await show('danger')
    await change(screen.getByLabelText(/введіть назву товару точно/), mine.title)
    await click(screen.getByRole('button', { name: 'Видалити товар назавжди' }))
    await click(screen.getByRole('button', { name: 'Підтвердити' }))
    expect(screen.getByRole('alert')).toHaveTextContent('видалення товарів')
    expect(onChanged).not.toHaveBeenCalled()
  })
})
