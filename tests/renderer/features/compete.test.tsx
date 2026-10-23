// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ui } from '../../../src/renderer/src/features/compete'
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
    expect(ui.shopPanels!.map((p) => p.label)).toEqual(['Розділи магазину', 'Рекомендовані товари', 'Політики повернення'])
    expect(ui.listingPanels!.map((p) => p.label)).toEqual([
      'Атрибути (властивості)',
      'Фото й відео (живі дані)',
      'Персоналізація (жива)',
      'Переклад',
      'Фото варіацій',
      'Доставка (вартість)',
      'Відгуки (живі)'
    ])
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
    expect(view).toHaveTextContent('12,50 USD · ★ 2 · ❤ 7')
    expect(view).toHaveTextContent('Показано 2 з 3')
    await click(within(view).getByRole('button', { name: 'Показати ще' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'sectionListings', { shopId: 1001, sectionId: 10, offset: 2 })
    expect(view).toHaveTextContent('Planner 3')
    expect(within(view).queryByRole('button', { name: 'Показати ще' })).toBeNull()
    expect(within(view).getAllByRole('button', { name: 'На Etsy ↗' })).toHaveLength(2)
    await click(within(view).getAllByRole('button', { name: 'На Etsy ↗' })[0])
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
  })

  it('shows the error', async () => {
    mockFeature({ 'compete.sections': { ok: false, error: 'Немає з’єднання з Etsy.' } })
    await renderShop('compete-sections')
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання з Etsy.')
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
    expect(box).toHaveTextContent('★ 1')
    await click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'featured', { shopId: 1001, offset: 1 })
    expect(screen.getByRole('alert')).toHaveTextContent('Перевищено ліміт')
    expect(box).toHaveTextContent('Planner 1')
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
    const rows = within(screen.getByTestId('compete-policies')).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('такні30 дн.')
    expect(rows[2]).toHaveTextContent('ніні—')
  })

  it('none / error', async () => {
    mockFeature({ 'compete.returnPolicies': [] })
    await renderShop('compete-return-policies')
    expect(screen.getByText('Магазин не має політик повернення.')).toBeInTheDocument()
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
    expect(table).toHaveTextContent('Primary colorBlack')
    expect(table).toHaveTextContent('Width8.5Inches')
    expect(table).toHaveTextContent('#400—')
    expect(within(table).queryAllByRole('button')).toHaveLength(0)
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
    expect(screen.getByText('Атрибутів немає.')).toBeInTheDocument()
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
    expect(box).toHaveTextContent('#1 · 3000×2000')
    expect(box).toHaveTextContent('Alt: Planner on a desk')
    expect(box).toHaveTextContent('Без alt-тексту')
    expect(box).toHaveTextContent('Відео #601 · 1920×1080')
    expect(screen.getByAltText('Planner on a desk')).toHaveAttribute('src', 'https://i.etsystatic.com/1/501/570.jpg')
    const buttons = screen.getAllByRole('button', { name: 'Деталі' })
    await click(buttons[0])
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'image', { listingId: 5, imageId: 501 })
    const details = screen.getByTestId('compete-image-details')
    expect(details).toHaveTextContent('#E1D5C9 · RGB 225, 213, 201 · HSV 30°, 10%, 88%')
    expect(details).toHaveTextContent('Чорно-білетак')
    await click(buttons[2])
    expect(api.featureCall).toHaveBeenCalledWith('compete', 'video', { listingId: 5, videoId: 601 })
    expect(screen.queryByTestId('compete-image-details')).toBeNull()
    expect(screen.getByTestId('compete-video-details')).toHaveTextContent('Станinactive')
  })

  it('no photos, a videos error', async () => {
    mockFeature({ 'compete.images': [], 'compete.videos': { ok: false, error: 'Etsy відхилив API-ключ (HTTP 403).' } })
    await renderListing('compete-media')
    expect(screen.getByText('Фото немає.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 403')
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
    const list = screen.getByTestId('compete-personalization')
    expect(list).toHaveTextContent('Your name (text_input · обов’язкове · до 20 символів · доплата 2,00 USD)')
    expect(list).toHaveTextContent('Max 20 Latin only')
    expect(list).toHaveTextContent('Color (dropdown · необов’язкове · до 2 файлів)')
    expect(list).toHaveTextContent('Варіанти: Red, Blue')
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
    expect(t).toHaveTextContent('Тегиagenda, budget')
    expect(t).toHaveTextContent('ОписUn agenda')
    expect(screen.getByRole('button', { name: 'Показати переклад' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Мова перекладу'), { target: { value: 'ja' } })
    await click(screen.getByRole('button', { name: 'Показати переклад' }))
    expect(screen.getByText('Перекладу цією мовою немає (або Etsy не знайшов цей лістинг у магазині).')).toBeInTheDocument()
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
    const list = screen.getByTestId('compete-variation-images')
    expect(list).toHaveTextContent('White')
    expect(list).not.toHaveTextContent('фото #777 (')
    expect(list).toHaveTextContent('Значення #3')
    expect(list).toHaveTextContent('фото #999 (фото не знайдено серед фото лістингу)')
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
    expect(screen.getByTestId('compete-variation-images')).toHaveTextContent('фото #777 (фото не знайдено серед фото лістингу)')
  })

  it('none / error', async () => {
    mockFeature({ 'compete.variationImages': [] })
    await renderListing('compete-variation-images')
    expect(screen.getByText('Фото для варіацій не задано.')).toBeInTheDocument()
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
    expect(p).toHaveTextContent('Профіль доставкиStandard')
    expect(p).toHaveTextContent('ЗвідкиUS, 10001')
    expect(p).toHaveTextContent('Типфіксовані ціни')
    const rows = within(p).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('ЄС15,00 USD5,00 USD5–10 дн.usps_first_class')
    expect(rows[3]).toHaveTextContent('Expressміжнародна10,00 USD—2–4 дн.')
    expect(screen.getByTestId('compete-listing-policy')).toHaveTextContent('повернення — так, обмін — так, строк — 14 дн.')
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
    fireEvent.change(screen.getByLabelText('Країна відправлення'), { target: { value: 'gb' } })
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
    fireEvent.change(screen.getByLabelText('Країна відправлення'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: 'Показати служби' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Країна відправлення'), { target: { value: 'zz' } })
    await click(screen.getByRole('button', { name: 'Показати служби' }))
    expect(screen.getAllByRole('alert')[1]).toHaveTextContent('двома латинськими літерами')
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
})
