// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ui } from '../../../src/renderer/src/features/compete'
import { languageName, mailClassLabel } from '../../../src/renderer/src/features/compete/listingPanels'
import { panelMeta } from '../../../src/renderer/src/features/LazyDetails'
import { GLOSSARY } from '../../../src/shared/glossary'
import { useStore } from '../../../src/renderer/src/store'
import type { CompeteListingRow, LiveImage, LiveReview, ShippingProfileInfo } from '../../../src/shared/features/compete'
import type { Listing } from '../../../src/shared/types'
import { etsyIn, etsyOut, mkListing, mkShop, mockFeature, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ etsyAuth: etsyIn() })
})

const shopPanel = (id: string) => ui.shopPanels!.find((p) => p.id === id)!.Component
const listingPanel = (id: string) => ui.listingPanels!.find((p) => p.id === id)!.Component
const SHOP = mkShop({ id: 1001 })
const LISTING = mkListing(5, { shopId: 1001 })

async function renderShop(id: string, mine = false) {
  const C = shopPanel(id)
  await act(async () => {
    render(<C shop={SHOP} mine={mine} />)
  })
}
async function renderListing(id: string, listing: Listing = LISTING, mine = false) {
  const C = listingPanel(id)
  await act(async () => {
    render(<C listing={listing} mine={mine} />)
  })
}
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el)
  })
}

const row = (id: number, over: Partial<CompeteListingRow> = {}): CompeteListingRow => ({
  listingId: id,
  title: `Planner ${id}`,
  price: { amount: 1250, divisor: 100, currency: 'USD' },
  state: 'active',
  quantity: 1,
  featuredRank: null,
  numFavorers: 7,
  shopSectionId: 10,
  url: `https://www.etsy.com/listing/${id}/x`,
  ...over
})

const img = (id: number, over: Partial<LiveImage> = {}): LiveImage => ({
  id,
  rank: 1,
  url570: `https://i.etsystatic.com/1/${id}/570.jpg`,
  urlFull: `https://i.etsystatic.com/1/${id}/full.jpg`,
  width: 3000,
  height: 2000,
  altText: 'Planner on a desk',
  hexCode: 'E1D5C9',
  red: 225,
  green: 213,
  blue: 201,
  hue: 30,
  saturation: 10,
  brightness: 88,
  isBlackAndWhite: false,
  createdAt: 1_700_000_000,
  ...over
})

const review = (n: number, over: Partial<LiveReview> = {}): LiveReview => ({
  shopId: 1001,
  listingId: 5,
  rating: 4,
  text: `Review ${n}`,
  language: 'en',
  imageUrl: null,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
  ...over
})

const profile: ShippingProfileInfo = {
  id: 88,
  title: 'Standard',
  originCountry: 'US',
  originPostalCode: '10001',
  profileType: 'manual',
  isDeleted: false,
  domesticHandlingFee: 0,
  internationalHandlingFee: 0,
  destinations: [
    {
      id: 1,
      originCountry: 'US',
      destinationCountry: null,
      destinationRegion: 'eu',
      primaryCost: { amount: 1500, divisor: 100, currency: 'USD' },
      secondaryCost: { amount: 500, divisor: 100, currency: 'USD' },
      carrierId: 1,
      mailClass: 'usps_first_class',
      minDeliveryDays: 5,
      maxDeliveryDays: 10
    }
  ],
  upgrades: [
    {
      id: 5,
      name: 'Express',
      type: 1,
      price: { amount: 1000, divisor: 100, currency: 'USD' },
      secondaryPrice: null,
      carrierId: 1,
      mailClass: 'usps_priority',
      minDeliveryDays: 2,
      maxDeliveryDays: 4
    }
  ]
}

describe('compete UI registry', () => {
  it('exposes the shop panels and the listing panels', () => {
    expect(ui.shopPanels!.map((p) => p.label)).toEqual(['Розділи магазину', 'Рекомендовані товари', 'Правила повернення'])
    expect(ui.listingPanels!.map((p) => p.label)).toEqual([
      'Характеристики',
      'Усі фото й відео',
      'Персоналізація',
      'Переклади',
      'Фото варіантів',
      'Доставка і повернення',
      'Відгуки зараз на Etsy (з фото)'
    ])
  })

  it('every panel says in one line what it shows, and has an icon (read by the hosts through panelMeta)', () => {
    for (const p of [...ui.shopPanels!, ...ui.listingPanels!]) {
      const meta = panelMeta(p)
      expect(meta.description, p.id).toMatch(/^[А-ЯІЇЄҐ].{20,140}\.$/)
      expect(meta.icon, p.id).toBeTruthy()
    }
  })
})

describe('Розділи магазину', () => {
  it('lists the sections; opening one loads it and its listings, with paging and Etsy links', async () => {
    mockFeature({
      'compete.sections': [
        { id: 10, title: 'Budget', rank: 1, activeListingCount: 3 },
        { id: 11, title: 'Calendars', rank: 2, activeListingCount: 0 }
      ],
      'compete.section': { id: 10, title: 'Budget (fresh)', rank: 1, activeListingCount: 3 },
      'compete.sectionListings': (a: Record<string, unknown>) =>
        a.offset === 0 ? { count: 3, offset: 0, listings: [row(1, { featuredRank: 2 }), row(2)] } : { count: 3, offset: 2, listings: [row(3, { url: null })] }
    })
    await renderShop('compete-sections')
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'sections', { shopId: 1001 })
    const table = screen.getByTestId('compete-sections')
    expect(table).toHaveTextContent('Budget')
    expect(table).toHaveTextContent('Calendars')
    await click(screen.getAllByRole('button', { name: 'Відкрити' })[0])
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'section', { shopId: 1001, sectionId: 10 })
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'sectionListings', { shopId: 1001, sectionId: 10, offset: 0 })
    const view = screen.getByTestId('compete-section-view')
    expect(view).toHaveTextContent('Budget (fresh)')
    expect(view).toHaveTextContent('активних товарів: 3')
    expect(view).toHaveTextContent('Planner 1')
    const first = within(view).getAllByTestId('compete-listing-row')[0]
    expect(first).toHaveTextContent('12,50 USD')
    expect(first).toHaveTextContent('Місце серед рекомендованих: 2')
    expect(first).toHaveTextContent('В обраному: 7')
    expect(view).toHaveTextContent('Показано 2 з 3')
    await click(within(view).getByRole('button', { name: 'Показати ще' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'sectionListings', { shopId: 1001, sectionId: 10, offset: 2 })
    expect(view).toHaveTextContent('Planner 3')
    expect(within(view).queryByRole('button', { name: 'Показати ще' })).toBeNull()
    expect(within(view).getAllByRole('button', { name: 'Відкрити на Etsy' })).toHaveLength(2)
    await click(within(view).getAllByRole('button', { name: 'Відкрити на Etsy' })[0])
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/listing/1/x')
    await click(screen.getByRole('button', { name: 'Закрити розділ' }))
    expect(screen.queryByTestId('compete-section-view')).toBeNull()
  })

  it('an empty section and a failing page', async () => {
    mockFeature({
      'compete.sections': [{ id: 10, title: '', rank: 1, activeListingCount: null }],
      'compete.section': { ok: false, error: 'Etsy не знайшов цей магазин або товар (HTTP 404).' },
      'compete.sectionListings': { count: 0, offset: 0, listings: [] }
    })
    await renderShop('compete-sections')
    expect(screen.getByTestId('compete-sections')).toHaveTextContent('Розділ #10')
    await click(screen.getByRole('button', { name: 'Відкрити' }))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 404')
    expect(screen.getByText('У цьому розділі немає активних товарів.')).toBeInTheDocument()
  })

  it('no sections / an error', async () => {
    mockFeature({ 'compete.sections': [] })
    await renderShop('compete-sections')
    expect(screen.getByText('У магазині немає розділів.')).toBeInTheDocument()
    expect(screen.getByText(/усі вони на головній сторінці магазину/)).toBeInTheDocument()
  })

  it('shows the error; "Спробувати ще" asks Etsy again', async () => {
    mockFeature({ 'compete.sections': { ok: false, error: 'Немає з’єднання з Etsy.' } })
    await renderShop('compete-sections')
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання з Etsy.')
    mockFeature({ 'compete.sections': [{ id: 10, title: 'Budget', rank: 1, activeListingCount: 3 }] })
    await click(within(screen.getByRole('alert')).getByRole('button', { name: 'Спробувати ще' }))
    expect(api.featureCall).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('compete-sections')).toHaveTextContent('Budget')
  })

  it('an opened section appears right under its row, takes the focus and gives it back when closed', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    mockFeature({
      'compete.sections': [
        { id: 10, title: 'Budget', rank: 1, activeListingCount: 3 },
        { id: 11, title: 'Calendars', rank: 2, activeListingCount: 1 },
        { id: 12, title: 'Bundles', rank: 3, activeListingCount: 1 }
      ],
      'compete.section': (a: Record<string, unknown>) => ({ id: a.sectionId, title: a.sectionId === 11 ? 'Calendars' : 'X', rank: 2, activeListingCount: 1 }),
      'compete.sectionListings': { count: 1, offset: 0, listings: [row(1)] }
    })
    await renderShop('compete-sections')
    const open = screen.getAllByRole('button', { name: 'Відкрити' })
    await click(open[1])
    const view = screen.getByTestId('compete-section-view')
    // The row of "Calendars", then the opened section, then the next section's row.
    const item = view.closest('li')!
    expect(item.previousElementSibling).toHaveTextContent('Calendars')
    expect(item.nextElementSibling).toHaveTextContent('Bundles')
    expect(open[1]).toHaveAttribute('aria-expanded', 'true')
    expect(within(view).getByRole('heading', { name: 'Calendars' })).toHaveFocus()
    expect(scroll.mock.instances[0]).toBe(view)
    await click(within(view).getByRole('button', { name: 'Закрити розділ' }))
    expect(screen.queryByTestId('compete-section-view')).toBeNull()
    expect(open[1]).toHaveFocus()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('a failing section page offers "Спробувати ще"', async () => {
    let fail = true
    mockFeature({
      'compete.sections': [{ id: 10, title: 'Budget', rank: 1, activeListingCount: 3 }],
      'compete.section': { id: 10, title: 'Budget', rank: 1, activeListingCount: 3 },
      'compete.sectionListings': () => (fail ? { ok: false, error: 'HTTP 503' } : { count: 1, offset: 0, listings: [row(1)] })
    })
    await renderShop('compete-sections')
    await click(screen.getByRole('button', { name: 'Відкрити' }))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503')
    fail = false
    await click(screen.getByRole('button', { name: 'Спробувати ще' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('compete-section-view')).toHaveTextContent('Planner 1')
  })
})

describe('Рекомендовані товари', () => {
  it('lists the featured listings with paging; a failing next page keeps the rows', async () => {
    mockFeature({
      'compete.featured': (a: Record<string, unknown>) =>
        a.offset === 0 ? { count: 150, offset: 0, listings: [row(1, { featuredRank: 1 })] } : { ok: false, error: 'Перевищено ліміт запитів до Etsy.' }
    })
    await renderShop('compete-featured')
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'featured', { shopId: 1001, offset: 0 })
    const box = screen.getByTestId('compete-featured')
    expect(box).toHaveTextContent('Planner 1')
    expect(box).toHaveTextContent('Місце серед рекомендованих: 1')
    // The ★ and ♡ explain themselves in a tooltip (focusable, so the keyboard gets it too).
    const star = within(box).getByText(/^Місце серед рекомендованих/).parentElement!
    expect(star).toHaveAttribute('tabindex', '0')
    expect(star).toHaveAccessibleDescription(`Місце №1 серед рекомендованих. ${GLOSSARY['features.compete.featured'].short}`)
    expect(within(box).getByText(/^В обраному/).parentElement).toHaveAccessibleDescription(GLOSSARY.favorites.short)
    await click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'featured', { shopId: 1001, offset: 1 })
    expect(screen.getByRole('alert')).toHaveTextContent('Перевищено ліміт')
    expect(box).toHaveTextContent('Planner 1')
    // "Спробувати ще" asks for the same next page.
    mockFeature({ 'compete.featured': { count: 2, offset: 1, listings: [row(2)] } })
    await click(within(screen.getByRole('alert')).getByRole('button', { name: 'Спробувати ще' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('compete', 'featured', { shopId: 1001, offset: 1 })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(box).toHaveTextContent('Planner 2')
  })

  it('empty / error', async () => {
    mockFeature({ 'compete.featured': { count: 0, offset: 0, listings: [] } })
    await renderShop('compete-featured')
    expect(screen.getByText('Магазин не має рекомендованих товарів.')).toBeInTheDocument()
  })

  it('a first page error', async () => {
    mockFeature({ 'compete.featured': { ok: false, error: 'boom' } })
    await renderShop('compete-featured')
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })
})

describe('Політики повернення', () => {
  it('shows returns, exchanges and the deadline', async () => {
    mockFeature({
      'compete.returnPolicies': [
        { id: 1, acceptsReturns: true, acceptsExchanges: false, returnDeadline: 30 },
        { id: 2, acceptsReturns: false, acceptsExchanges: false, returnDeadline: null }
      ]
    })
    await renderShop('compete-return-policies')
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'returnPolicies', { shopId: 1001 })
    const table = screen.getByTestId('compete-policies')
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('такні30 дн.')
    expect(rows[2]).toHaveTextContent('ніні—')
    expect(within(table).getByRole('button', { name: 'Що таке «Повернення товару»?' })).toHaveAccessibleDescription(GLOSSARY['features.compete.returns'].short)
    expect(within(table).getByRole('button', { name: 'Що таке «Строк повернення»?' })).toBeInTheDocument()
    expect(screen.getByText(/можуть мати різні правила/)).toBeInTheDocument()
  })

  it('none / error', async () => {
    mockFeature({ 'compete.returnPolicies': [] })
    await renderShop('compete-return-policies')
    expect(screen.getByText('Магазин не має правил повернення.')).toBeInTheDocument()
  })

  it('error', async () => {
    mockFeature({ 'compete.returnPolicies': { ok: false, error: 'HTTP 401' } })
    await renderShop('compete-return-policies')
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 401')
  })
})

describe('Атрибути (властивості)', () => {
  it('lists the properties from one list read; no per-property requests (that endpoint only answers 501)', async () => {
    mockFeature({
      'compete.properties': [
        { propertyId: 200, name: 'Primary color', scaleId: null, scaleName: null, valueIds: [1], values: ['Black'] },
        { propertyId: 300, name: 'Width', scaleId: 5, scaleName: 'Inches', valueIds: [], values: ['8.5'] },
        { propertyId: 400, name: null, scaleId: null, scaleName: null, valueIds: [], values: [] }
      ]
    })
    await renderListing('compete-properties')
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'properties', { shopId: 1001, listingId: 5 })
    const table = screen.getByTestId('compete-properties')
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Primary colorBlack')
    expect(rows[2]).toHaveTextContent('Width8.5Inches')
    expect(rows[3]).toHaveTextContent('Характеристика #400—')
    // Only the ⓘ of the "Шкала" column header — no per-property buttons.
    expect(within(table).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Що таке «Шкала»?'])
    expect(api.featureCall).toHaveBeenCalledTimes(1)
  })

  it('error', async () => {
    mockFeature({ 'compete.properties': { ok: false, error: 'HTTP 400' } })
    await renderListing('compete-properties')
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 400')
  })

  it('none', async () => {
    mockFeature({ 'compete.properties': [] })
    await renderListing('compete-properties')
    expect(screen.getByText('Характеристик немає.')).toBeInTheDocument()
  })
})

describe('Фото й відео (живі дані)', () => {
  it('lists photos and videos; Деталі loads one photo / one video', async () => {
    mockFeature({
      'compete.images': [img(501), img(502, { rank: 2, url570: '', altText: null, hexCode: null })],
      'compete.videos': [{ id: 601, width: 1920, height: 1080, state: 'active', thumbnailUrl: 'https://v.etsystatic.com/t.jpg' }],
      'compete.image': img(501, { isBlackAndWhite: true }),
      'compete.video': { id: 601, width: 1920, height: 1080, state: 'inactive', thumbnailUrl: null }
    })
    await renderListing('compete-media')
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'images', { listingId: 5 })
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'videos', { listingId: 5 })
    const box = screen.getByTestId('compete-media')
    const photos = within(box).getAllByTestId('compete-photo')
    expect(photos[0]).toHaveTextContent('Фото 1головне3000×2000 пікс.')
    expect(photos[0]).toHaveTextContent('Опис: Planner on a desk')
    expect(photos[1]).toHaveTextContent('Фото 2')
    expect(photos[1]).not.toHaveTextContent('головне')
    expect(photos[1]).toHaveTextContent('Без опису фото')
    expect(box).toHaveTextContent('Відео1920×1080 пікс.показується покупцям')
    expect(screen.getByAltText('Planner on a desk')).toHaveAttribute('src', 'https://i.etsystatic.com/1/501/570.jpg')
    const buttons = screen.getAllByRole('button', { name: 'Деталі' })
    await click(buttons[0])
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'image', { listingId: 5, imageId: 501 })
    const details = screen.getByTestId('compete-image-details')
    // Right after the clicked photo (not after the whole grid), with the focus on its heading.
    expect(details.closest('li')!.previousElementSibling).toBe(photos[0])
    expect(screen.getByRole('heading', { name: 'Деталі фото 1' })).toHaveFocus()
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'true')
    expect(details).toHaveTextContent('#E1D5C9 · RGB 225, 213, 201 · HSV 30°, 10%, 88%')
    expect(details).toHaveTextContent('Чорно-білетак')
    expect(details).toHaveTextContent('1 (головне фото)')
    expect(buttons[0]).toBeDisabled()
    await click(buttons[2])
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'video', { listingId: 5, videoId: 601 })
    expect(screen.queryByTestId('compete-image-details')).toBeNull()
    expect(screen.getByTestId('compete-video-details')).toHaveTextContent('вимкнене продавцем')
    expect(screen.getByRole('heading', { name: 'Деталі відео' })).toHaveFocus()
    await click(screen.getByRole('button', { name: 'Сховати' }))
    expect(screen.queryByTestId('compete-video-details')).toBeNull()
    expect(buttons[2]).toBeEnabled()
  })

  it('no photos, a videos error; "Спробувати ще" reloads only the videos', async () => {
    mockFeature({ 'compete.images': [], 'compete.videos': { ok: false, error: 'Etsy відхилив API-ключ (HTTP 403).' } })
    await renderListing('compete-media')
    expect(screen.getByText('Фото немає.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 403')
    mockFeature({ 'compete.videos': [] })
    await click(screen.getByRole('button', { name: 'Спробувати ще' }))
    expect(api.featureCall).toHaveBeenCalledTimes(3)
    expect(api.featureCall).toHaveBeenLastCalledWith('compete', 'videos', { listingId: 5 })
    expect(screen.getByText('Відео немає.')).toBeInTheDocument()
  })

  it('no videos', async () => {
    mockFeature({ 'compete.images': [img(1)], 'compete.videos': [] })
    await renderListing('compete-media')
    expect(screen.getByText('Відео немає.')).toBeInTheDocument()
  })
})

describe('Персоналізація (жива)', () => {
  it('lists the questions with their limits, add-on price and options', async () => {
    mockFeature({
      'compete.personalization': [
        {
          id: 3,
          text: 'Your name',
          instructions: 'Max 20\nLatin only',
          type: 'text_input',
          required: true,
          maxChars: 20,
          maxFiles: null,
          addOnPrice: { amount: 200, divisor: 100, currency: 'USD' },
          options: []
        },
        { id: 4, text: 'Color', instructions: null, type: 'dropdown', required: false, maxChars: null, maxFiles: 2, addOnPrice: null, options: [{ id: 1, label: 'Red' }, { id: 2, label: 'Blue' }] }
      ]
    })
    await renderListing('compete-personalization')
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'personalization', { listingId: 5 })
    const [name, color] = screen.getAllByTestId('compete-question')
    expect(name).toHaveTextContent('Your name')
    expect(name).toHaveTextContent('текстобов’язковедо 20 символівдоплата 2,00 USD')
    expect(name).toHaveTextContent('Max 20 Latin only')
    expect(color).toHaveTextContent('Colorвибір зі спискунеобов’язковедо 2 файлів')
    expect(color).toHaveTextContent('Варіанти:RedBlue')
    expect(within(color).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Red', 'Blue'])
  })

  it('none / error', async () => {
    mockFeature({ 'compete.personalization': [] })
    await renderListing('compete-personalization')
    expect(screen.getByText('Товар без персоналізації.')).toBeInTheDocument()
  })

  it('error', async () => {
    mockFeature({ 'compete.personalization': { ok: false, error: 'HTTP 500' } })
    await renderListing('compete-personalization')
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
  })
})

describe('Переклад', () => {
  it('nothing is loaded until a language is picked; shows the translation; "none" for a missing one', async () => {
    mockFeature({
      'compete.translation': (a: Record<string, unknown>) =>
        a.language === 'fr' ? { listingId: 5, language: 'fr', title: 'Agenda', description: 'Un agenda', tags: ['agenda', 'budget'] } : null
    })
    await renderListing('compete-translation')
    expect(api.featureCall).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Мова перекладу'), { target: { value: 'fr' } })
    await click(screen.getByRole('button', { name: 'Показати переклад' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'translation', { shopId: 1001, listingId: 5, language: 'fr' })
    const t = screen.getByTestId('compete-translation')
    expect(t).toHaveTextContent('НазваAgenda')
    expect(within(t).getByRole('list', { name: 'Теги' })).toHaveTextContent('agendabudget')
    expect(t).toHaveTextContent('ОписUn agenda')
    expect(screen.getByRole('button', { name: 'Показати переклад' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Мова перекладу'), { target: { value: 'ja' } })
    await click(screen.getByRole('button', { name: 'Показати переклад' }))
    expect(screen.getByText('Перекладу цією мовою немає (або Etsy не знайшов цей товар у магазині).')).toBeInTheDocument()
  })

  it('offers exactly the documented languages; an error', async () => {
    mockFeature({ 'compete.translation': { ok: false, error: 'Невідома мова перекладу.' } })
    await renderListing('compete-translation')
    const options = within(screen.getByLabelText('Мова перекладу')).getAllByRole('option')
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['de', 'en-GB', 'en-IN', 'en-US', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru', 'sv'])
    await click(screen.getByRole('button', { name: 'Показати переклад' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Невідома мова перекладу.')
  })
})

describe('Фото варіацій', () => {
  it('the stored photo of a value, else the live one; a photo found nowhere says so', async () => {
    mockFeature({
      'compete.variationImages': [
        { propertyId: 200, valueId: 1, value: 'Black', imageId: 50 },
        { propertyId: 200, valueId: 2, value: 'White', imageId: 777 },
        { propertyId: 200, valueId: 3, value: null, imageId: 999 }
      ],
      'compete.images': [img(777)]
    })
    await renderListing('compete-variation-images')
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'variationImages', { shopId: 1001, listingId: 5 })
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'images', { listingId: 5 })
    expect(screen.getByAltText('Black')).toHaveAttribute('src', 'etsyimg://img/50/170x135')
    expect(screen.getByAltText('White')).toHaveAttribute('src', 'https://i.etsystatic.com/1/777/570.jpg')
    const [black, white, third] = screen.getAllByTestId('compete-variation')
    expect(black).toHaveTextContent('Black')
    expect(white).toHaveTextContent('White')
    expect(white).not.toHaveTextContent('не знайдено')
    expect(third).toHaveTextContent('Значення #3')
    expect(third).toHaveTextContent('Фото не знайдено серед фото товару')
  })

  it('live photos failing: stored photos still show, the rest says not found', async () => {
    mockFeature({
      'compete.variationImages': [
        { propertyId: 200, valueId: 1, value: 'Black', imageId: 50 },
        { propertyId: 200, valueId: 2, value: 'White', imageId: 777 }
      ],
      'compete.images': { ok: false, error: 'HTTP 500' }
    })
    await renderListing('compete-variation-images')
    expect(screen.getByAltText('Black')).toHaveAttribute('src', 'etsyimg://img/50/170x135')
    expect(screen.queryByAltText('White')).toBeNull()
    const [black, white] = screen.getAllByTestId('compete-variation')
    expect(black).not.toHaveTextContent('не знайдено')
    expect(white).toHaveTextContent('Фото не знайдено серед фото товару')
  })

  it('none / error', async () => {
    mockFeature({ 'compete.variationImages': [] })
    await renderListing('compete-variation-images')
    expect(screen.getByText('Фото для варіантів не задано.')).toBeInTheDocument()
  })

  it('error', async () => {
    mockFeature({ 'compete.variationImages': { ok: false, error: 'HTTP 404' } })
    await renderListing('compete-variation-images')
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 404')
  })
})

describe('Доставка (вартість)', () => {
  it('signed in, own listing: the profile, its destinations and upgrades, the listing’s return policy', async () => {
    mockFeature({
      'compete.shipping': [{ listingId: 5, profile }],
      'compete.returnPolicy': { id: 77, acceptsReturns: true, acceptsExchanges: true, returnDeadline: 14 }
    })
    const listing = mkListing(5, { shopId: 1001, details: { returnPolicyId: 77 } as Listing['details'] })
    await renderListing('compete-shipping', listing, true)
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'shipping', { listingId: 5 })
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'returnPolicy', { shopId: 1001, policyId: 77 })
    const p = screen.getByTestId('compete-shipping-profile')
    const facts = within(p).getAllByRole('definition').map((d) => d.textContent)
    expect(facts).toEqual(['Standard', 'США (US), 10001', 'фіксовані ціни'])
    expect(within(p).getByRole('button', { name: 'Що таке «Профіль доставки»?' })).toHaveAccessibleDescription(GLOSSARY.shippingProfile.short)
    const rows = within(p).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Країни ЄС15,00 USD5,00 USD5–10 дн.USPS First Class')
    expect(rows[3]).toHaveTextContent('Expressміжнародна10,00 USD—2–4 дн.')
    expect(screen.getByTestId('compete-listing-policy')).toHaveTextContent('повернення — так, обмін — так, строк — 14 дн.')
  })

  it('a calculated profile: the handling fee in the currency of the profile’s prices', async () => {
    mockFeature({ 'compete.shipping': [{ listingId: 5, profile: { ...profile, profileType: 'calculated', domesticHandlingFee: 2, internationalHandlingFee: 5.5 } }] })
    await renderListing('compete-shipping', LISTING, true)
    const facts = within(screen.getByTestId('compete-shipping-profile')).getAllByRole('definition').map((d) => d.textContent!.replace(/\s/g, ' '))
    expect(facts[3]).toBe('по країні 2,00 USD, міжнародна 5,50 USD')
  })

  it('another seller’s listing: Etsy gives no profile — explained', async () => {
    mockFeature({ 'compete.shipping': [{ listingId: 5, profile: null }] })
    await renderListing('compete-shipping')
    expect(screen.getByTestId('compete-shipping')).toHaveTextContent('лише власнику магазину')
    expect(screen.queryByTestId('compete-listing-policy')).toBeNull()
  })

  it('signed out: says so and makes no shipping request; carriers still work', async () => {
    useStore.setState({ etsyAuth: etsyOut })
    mockFeature({
      'compete.carriers': [
        { id: 1, name: 'USPS', domesticClasses: [{ key: 'a', name: 'First Class' }], internationalClasses: [{ key: 'b', name: 'Priority Intl' }] },
        { id: 2, name: 'Local Post', domesticClasses: [], internationalClasses: [] }
      ]
    })
    await renderListing('compete-shipping')
    expect(screen.getByTestId('compete-shipping')).toHaveTextContent('лише після входу')
    expect(api.featureCall).not.toHaveBeenCalled()
    const country = screen.getByLabelText('Країна відправлення')
    expect(country).toHaveValue('US')
    expect(within(country).getByRole('option', { name: 'Велика Британія (GB)' })).toBeInTheDocument()
    expect(within(country).getAllByRole('option')).toHaveLength(249)
    fireEvent.change(country, { target: { value: 'GB' } })
    await click(screen.getByRole('button', { name: 'Показати служби' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'carriers', { country: 'GB' })
    const list = screen.getByTestId('compete-carriers')
    expect(list).toHaveTextContent('USPSПо країні: First ClassМіжнародні: Priority Intl')
    expect(list).toHaveTextContent('Local Post')
  })

  it('a sign-in without shops_r: asks to sign in again', async () => {
    useStore.setState({ etsyAuth: etsyIn({ scopes: ['listings_r'] }) })
    await renderListing('compete-shipping')
    expect(screen.getByTestId('compete-shipping')).toHaveTextContent('читання налаштувань магазину')
    expect(api.featureCall).not.toHaveBeenCalled()
  })

  it('errors: shipping and carriers', async () => {
    mockFeature({
      'compete.shipping': { ok: false, error: 'Etsy не знайшов цей магазин або товар (HTTP 404).' },
      'compete.carriers': { ok: false, error: 'Вкажіть країну двома латинськими літерами (наприклад, UA, US, GB).' }
    })
    await renderListing('compete-shipping')
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 404')
    fireEvent.change(screen.getByLabelText('Країна відправлення'), { target: { value: 'ZW' } })
    await click(screen.getByRole('button', { name: 'Показати служби' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'carriers', { country: 'ZW' })
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent('двома латинськими літерами')
    // "Спробувати ще" under the carriers asks again for the same country.
    mockFeature({ 'compete.carriers': [] })
    await click(within(screen.getAllByRole('alert')[1]).getByRole('button', { name: 'Спробувати ще' }))
    expect(api.featureCall).toHaveBeenLastCalledWith('compete', 'carriers', { country: 'ZW' })
    expect(screen.getByText('Для цієї країни служб доставки немає.')).toBeInTheDocument()
  })

  it('mail classes are shown readable; unknown shapes as is', () => {
    expect(mailClassLabel('usps_first_class')).toBe('USPS First Class')
    expect(mailClassLabel('royal_mail_tracked_48')).toBe('Royal Mail Tracked 48')
    expect(mailClassLabel('Ukrposhta Express')).toBe('Ukrposhta Express')
    expect(mailClassLabel(null)).toBe('—')
  })

  it('a destination country is shown by its name', async () => {
    const d = { ...profile.destinations[0], destinationCountry: 'DE', destinationRegion: 'none' }
    mockFeature({ 'compete.shipping': [{ listingId: 5, profile: { ...profile, destinations: [d], upgrades: [] } }] })
    await renderListing('compete-shipping', LISTING, true)
    expect(within(screen.getByTestId('compete-shipping-profile')).getAllByRole('row')[1]).toHaveTextContent('Німеччина (DE)')
  })

  it('no carriers for a country', async () => {
    useStore.setState({ etsyAuth: etsyOut })
    mockFeature({ 'compete.carriers': [] })
    await renderListing('compete-shipping')
    await click(screen.getByRole('button', { name: 'Показати служби' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'carriers', { country: 'US' })
    expect(screen.getByText('Для цієї країни служб доставки немає.')).toBeInTheDocument()
  })
})

describe('Відгуки (живі)', () => {
  it('the first page, then "Показати ще" with the next offset', async () => {
    mockFeature({
      'compete.reviews': (a: Record<string, unknown>) =>
        a.offset === 0
          ? { count: 21, offset: 0, reviews: Array.from({ length: 20 }, (_, i) => review(i, i === 0 ? { rating: 5, text: 'Love it', imageUrl: 'https://i.etsystatic.com/r.jpg' } : {})) }
          : { count: 21, offset: 20, reviews: [review(20, { text: 'Last one', language: null })] }
    })
    await renderListing('compete-reviews')
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'reviews', { listingId: 5, offset: 0, limit: 20 })
    const box = screen.getByTestId('compete-reviews')
    expect(box).toHaveTextContent('Відгуків: 21, показано 20')
    expect(box).toHaveTextContent('★★★★★')
    expect(box).toHaveTextContent('Love it')
    expect(box).toHaveTextContent('мова: англійська')
    expect(box).not.toHaveTextContent('мова: en')
    expect(screen.getByAltText('Фото покупця')).toHaveAttribute('src', 'https://i.etsystatic.com/r.jpg')
    await click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'reviews', { listingId: 5, offset: 20, limit: 20 })
    expect(box).toHaveTextContent('Last one')
    expect(box).toHaveTextContent('показано 21')
    expect(screen.queryByRole('button', { name: 'Показати ще' })).toBeNull()
  })

  it('a failing next page, no reviews, a failing first page', async () => {
    mockFeature({
      'compete.reviews': (a: Record<string, unknown>) =>
        a.offset === 0 ? { count: 30, offset: 0, reviews: [review(1)] } : { ok: false, error: 'Перевищено ліміт запитів до Etsy.' }
    })
    await renderListing('compete-reviews')
    await click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Перевищено ліміт')
  })

  it('no reviews', async () => {
    mockFeature({ 'compete.reviews': { count: 0, offset: 0, reviews: [] } })
    await renderListing('compete-reviews')
    expect(screen.getByText('Відгуків немає.')).toBeInTheDocument()
  })

  it('first page error', async () => {
    mockFeature({ 'compete.reviews': { ok: false, error: 'HTTP 500' } })
    await renderListing('compete-reviews')
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
  })

  it('review languages are named in Ukrainian; an unknown code stays as is', () => {
    expect(languageName('en')).toBe('англійська')
    expect(languageName('de')).toBe('німецька')
    expect(languageName('zz')).toBe('zz')
    expect(languageName('not a code!')).toBe('not a code!')
  })
})

describe('Відкрити на весь розмір (живі дані)', () => {
  const viewer = () => useStore.getState().viewer

  it('a live photo opens every photo of the listing (fullxfull) at the clicked one; "Деталі" is not opened', async () => {
    mockFeature({
      'compete.images': [img(501), img(502, { rank: 2, url570: '' }), img(503, { rank: 3, urlFull: '', altText: null })],
      'compete.videos': []
    })
    await renderListing('compete-media')
    const photos = screen.getAllByTestId('compete-photo')
    // no thumbnail → nothing to open, and not in the gallery
    expect(within(photos[1]).queryByRole('button', { name: /на весь розмір/ })).toBeNull()
    await click(within(photos[2]).getByRole('button', { name: 'Відкрити на весь розмір: Фото 3' }))
    expect(viewer()).toEqual({
      images: [
        { src: 'https://i.etsystatic.com/1/501/full.jpg', alt: 'Planner on a desk', caption: 'Фото 1 — Planner on a desk' },
        // no fullxfull → the 570xN
        { src: 'https://i.etsystatic.com/1/503/570.jpg', alt: 'Фото 3', caption: 'Фото 3' }
      ],
      index: 1
    })
    expect(api.featureCall).not.toHaveBeenCalledWith('compete', 'image', expect.anything())
    expect(screen.queryByTestId('compete-image-details')).toBeNull()
  })

  it('a video frame opens in the viewer; no video details are loaded', async () => {
    mockFeature({
      'compete.images': [],
      'compete.videos': [{ id: 601, width: 1920, height: 1080, state: 'active', thumbnailUrl: 'https://v.etsystatic.com/t.jpg' }]
    })
    await renderListing('compete-media')
    await click(screen.getByRole('button', { name: 'Відкрити на весь розмір: Кадр відео' }))
    expect(viewer()!.images).toEqual([expect.objectContaining({ src: 'https://v.etsystatic.com/t.jpg' })])
    expect(api.featureCall).not.toHaveBeenCalledWith('compete', 'video', expect.anything())
  })

  it('variation photos open as a gallery: the stored original, else the live fullxfull', async () => {
    mockFeature({
      'compete.variationImages': [
        { propertyId: 200, valueId: 1, value: 'Black', imageId: 50 },
        { propertyId: 200, valueId: 2, value: 'White', imageId: 777 },
        { propertyId: 200, valueId: 3, value: null, imageId: 999 }
      ],
      'compete.images': [img(777)]
    })
    await renderListing('compete-variation-images')
    await click(screen.getByRole('button', { name: 'Відкрити на весь розмір: White' }))
    expect(viewer()).toEqual({
      images: [
        { src: 'etsyimg://img/50/fullxfull', alt: 'Black', caption: 'Варіант: Black' },
        { src: 'https://i.etsystatic.com/1/777/full.jpg', alt: 'White', caption: 'Варіант: White' }
      ],
      index: 1
    })
    const [, , third] = screen.getAllByTestId('compete-variation')
    expect(within(third).queryByRole('button')).toBeNull()
  })

  it('a buyer photo of a live review opens in the viewer', async () => {
    mockFeature({ 'compete.reviews': { count: 1, offset: 0, reviews: [review(1, { rating: 5, imageUrl: 'https://i.etsystatic.com/r.jpg', createdAt: 1_700_000_000 })] } })
    await renderListing('compete-reviews')
    await click(screen.getByRole('button', { name: 'Відкрити на весь розмір: Фото покупця' }))
    const v = viewer()!
    expect(v.images).toHaveLength(1)
    expect(v.images[0]).toMatchObject({ src: 'https://i.etsystatic.com/r.jpg', alt: 'Фото покупця' })
    expect(v.images[0].caption).toMatch(/^Фото покупця · оцінка 5 з 5 · /)
  })
})
