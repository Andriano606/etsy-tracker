// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ui } from '../../../src/renderer/src/features/shopConfig'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { etsyTimeLabel } from '../../../src/renderer/src/features/shopConfig/Processing'
import type { ShippingCarrier, ShippingDestination, ShippingProfile, ShippingUpgrade } from '../../../src/shared/features/shopConfig'
import { mkMyListing, mockFeature, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

const tab = (label: string) => ui.myShopTabs!.find((t) => t.label === label)!.Component

async function show(el: JSX.Element) {
  await act(async () => {
    render(
      <>
        {el}
        <ConfirmModal />
      </>
    )
  })
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el)
  })
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })

/**
 * The open confirmation: its text, then confirm (or cancel). The confirm button
 * says the verb of the change — `label` checks it (else it is the footer's last button).
 */
async function answer(yes: boolean, label?: string): Promise<string> {
  const modal = screen.getByText('Підтвердження').closest('[role="alertdialog"], [role="dialog"], .modal') as HTMLElement
  const text = modal.textContent ?? ''
  const foot = modal.querySelector('.ui-modal-foot') as HTMLElement
  const ok = label ? within(foot).getByRole('button', { name: label }) : [...within(foot).getAllByRole('button')].at(-1)!
  expect(ok).not.toHaveTextContent(/^Скасувати$/)
  await click(yes ? ok : within(foot).getByRole('button', { name: 'Скасувати' }))
  return text
}

/** The open confirmation's confirm button (to check its verb and tone). */
const confirmButton = (name: string) =>
  within(screen.getByText('Підтвердження').closest('[role="alertdialog"]') as HTMLElement).getByRole('button', { name })

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

const calls = (action: string) => api.featureCall.mock.calls.filter((c) => c[0] === 'shopConfig' && c[1] === action).map((c) => c[2])

const money = (amount: number) => ({ amount, divisor: 100, currency: 'USD' })

describe('shopConfig UI pieces', () => {
  it('registers six "Мій магазин" tabs and the own-listing section', () => {
    expect(ui.myShopTabs!.map((t) => t.label)).toEqual(['Розділи', 'Доставка', 'Обробка', 'Повернення', 'Свята', 'Партнери'])
    expect(ui.ownListingSections!.map((s) => s.label)).toEqual(['Розділ магазину'])
  })
})

describe('Розділи', () => {
  const sections = [
    { id: 11, title: 'Planners', rank: 1, activeListingCount: 4 },
    { id: 12, title: 'Budget', rank: 2, activeListingCount: 0 }
  ]

  it('lists sections with listing counts; a load error is an alert', async () => {
    mockFeature({ 'shopConfig.sections': sections })
    const Sections = tab('Розділи')
    await show(<Sections />)
    expect(api.featureCall).toHaveBeenCalledWith('shopConfig', 'sections', {})
    const rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Planners4')
    expect(rows[2]).toHaveTextContent('Budget0')
  })

  it('a load error is shown', async () => {
    mockFeature({ 'shopConfig.sections': { ok: false, error: 'Увійдіть в Etsy' } })
    const Sections = tab('Розділи')
    await show(<Sections />)
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
  })

  it('adds a section after confirming; cancelling sends nothing', async () => {
    mockFeature({ 'shopConfig.sections': sections, 'shopConfig.createSection': { id: 13, title: 'New', rank: 3, activeListingCount: 0 } })
    const Sections = tab('Розділи')
    await show(<Sections />)
    expect(button('Додати розділ')).toBeDisabled()
    type('Новий розділ', 'New')
    await click(button('Додати розділ'))
    expect(await answer(false)).toContain('Створити розділ «New»')
    expect(calls('createSection')).toEqual([])
    await click(button('Додати розділ'))
    await answer(true)
    expect(calls('createSection')).toEqual([{ input: { title: 'New' } }])
    expect(screen.getByRole('status')).toHaveTextContent('Розділ створено.')
    expect(calls('sections')).toHaveLength(2)
  })

  it('renames and deletes (confirmed); an Etsy error is an alert', async () => {
    mockFeature({
      'shopConfig.sections': sections,
      'shopConfig.updateSection': { ...sections[0], title: 'Plans' },
      'shopConfig.deleteSection': { ok: false, error: 'Etsy відхилив запит' }
    })
    const Sections = tab('Розділи')
    await show(<Sections />)
    await click(button('Перейменувати розділ «Planners»'))
    expect(button('Зберегти')).toBeDisabled()
    type('Нова назва розділу', 'Plans')
    await click(button('Зберегти'))
    expect(await answer(true, 'Перейменувати')).toContain('Перейменувати розділ «Planners» на «Plans»')
    expect(calls('updateSection')).toEqual([{ sectionId: 11, input: { title: 'Plans' } }])
    await click(button('Видалити розділ «Budget»'))
    // The confirm says the verb, in red (a deletion).
    expect(confirmButton('Видалити розділ')).toHaveClass('stop')
    expect(await answer(true, 'Видалити розділ')).toContain('Видалити розділ «Budget»')
    expect(calls('deleteSection')).toEqual([{ sectionId: 12 }])
    expect(screen.getByRole('alert')).toHaveTextContent('Etsy відхилив запит')
  })
})

describe('Розділи: keyboard and empty state', () => {
  it('Enter in the new-section field adds it; Escape leaves a rename unchanged', async () => {
    const sections = [{ id: 11, title: 'Planners', rank: 1, activeListingCount: 4 }]
    mockFeature({ 'shopConfig.sections': sections, 'shopConfig.createSection': { ...sections[0], id: 12, title: 'Gifts' } })
    const Sections = tab('Розділи')
    await show(<Sections />)
    type('Новий розділ', 'Gifts')
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Новий розділ').closest('form')!)
    })
    expect(await answer(true, 'Створити розділ')).toContain('Створити розділ «Gifts»?')
    expect(calls('createSection')).toEqual([{ input: { title: 'Gifts' } }])
    await click(button(/^Перейменувати розділ «/))
    type('Нова назва розділу', 'Plans')
    fireEvent.keyDown(screen.getByLabelText('Нова назва розділу'), { key: 'Escape' })
    expect(screen.queryByLabelText('Нова назва розділу')).toBeNull()
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Planners')
  })

  it('no sections → says how to start; the count column explains itself', async () => {
    mockFeature({ 'shopConfig.sections': [] })
    const Sections = tab('Розділи')
    await show(<Sections />)
    expect(screen.getByText('Розділів ще немає.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Додати розділ' })).toBeDisabled()
  })
})

describe('Розділ магазину (own listing)', () => {
  const Panel = ui.ownListingSections![0].Component
  const info = { sections: [{ id: 11, title: 'Planners', rank: 1, activeListingCount: 4 }], sectionId: 11, known: true }

  it("shows the listing's section and saves a new one (confirmed) → onChanged(listing)", async () => {
    const saved = mkMyListing(900, { title: 'Budget planner' })
    mockFeature({ 'shopConfig.listingSection': info, 'shopConfig.setListingSection': saved })
    const onChanged = vi.fn()
    await show(<Panel listing={mkMyListing(900, { title: 'Budget planner' })} onChanged={onChanged} />)
    expect(calls('listingSection')).toEqual([{ listingId: 900 }])
    expect(screen.getByLabelText('Розділ')).toHaveValue('11')
    expect(button('Зберегти розділ')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Розділ'), { target: { value: '0' } })
    await click(button('Зберегти розділ'))
    expect(await answer(true, 'Перенести товар')).toContain('Перенести товар «Budget planner» у «без розділу»')
    expect(calls('setListingSection')).toEqual([{ listingId: 900, sectionId: 0 }])
    expect(onChanged).toHaveBeenCalledWith(saved)
    expect(screen.getByRole('status')).toHaveTextContent('Розділ товару збережено.')
  })

  it('an unknown current section asks to pick one; cancel sends nothing', async () => {
    mockFeature({ 'shopConfig.listingSection': { ...info, sectionId: null, known: false } })
    await show(<Panel listing={mkMyListing(900)} onChanged={vi.fn()} />)
    expect(screen.getByText(/Поточний розділ невідомий/)).toBeInTheDocument()
    expect(button('Зберегти розділ')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Розділ'), { target: { value: '11' } })
    await click(button('Зберегти розділ'))
    expect(await answer(false)).toContain('у розділ «Planners»')
    expect(calls('setListingSection')).toEqual([])
  })

  it('a load error is shown', async () => {
    mockFeature({ 'shopConfig.listingSection': { ok: false, error: 'HTTP 500' } })
    await show(<Panel listing={mkMyListing(900)} onChanged={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500')
  })
})

const dest: ShippingDestination = {
  id: 31,
  profileId: 21,
  originCountry: 'UA',
  destinationCountry: 'US',
  destinationRegion: 'none',
  primaryCost: money(500),
  secondaryCost: money(150),
  carrierId: null,
  mailClass: null,
  minDeliveryDays: 5,
  maxDeliveryDays: 10
}
const upgrade: ShippingUpgrade = {
  id: 41,
  profileId: 21,
  name: 'Express',
  international: true,
  rank: 0,
  language: 'en',
  price: money(1000),
  secondaryPrice: money(200),
  carrierId: 2,
  mailClass: 'priority',
  minDeliveryDays: null,
  maxDeliveryDays: null
}
const profile: ShippingProfile = {
  id: 21,
  title: 'Standard',
  originCountry: 'UA',
  originPostalCode: '79000',
  isDeleted: false,
  profileType: 'manual',
  domesticHandlingFee: 0,
  internationalHandlingFee: 0,
  destinations: [dest],
  upgrades: [upgrade]
}
const carriers: ShippingCarrier[] = [
  { id: 2, name: 'Ukrposhta', domesticClasses: [{ key: 'standard', name: 'Standard' }], internationalClasses: [{ key: 'priority', name: 'Priority' }] }
]

describe('Доставка', () => {
  const Shipping = tab('Доставка')
  const base = {
    'shopConfig.shippingProfiles': [profile],
    'shopConfig.shippingProfile': profile,
    'shopConfig.destinations': [dest],
    'shopConfig.upgrades': [upgrade],
    'shopConfig.carriers': carriers
  }

  async function openProfile(origin: string | null = 'UA') {
    await show(<Shipping />)
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Standard')
    await click(button(/^Відкрити профіль доставки «/))
    expect(calls('shippingProfile')).toEqual([{ profileId: 21 }])
    // The carriers of the origin are read once per opened profile (names in the lists, choices in the forms).
    expect(calls('carriers')).toEqual(origin ? [{ country: origin }] : [])
    expect(calls('destinations')).toEqual([{ profileId: 21 }])
    expect(calls('upgrades')).toEqual([{ profileId: 21 }])
  }

  it('profile detail: origin, destinations (country, costs, days) and upgrades', async () => {
    mockFeature(base)
    await openProfile()
    const d = screen.getByTestId('sc-destinations')
    expect(d).toHaveTextContent(/США \(US\)5,00\s*USD1,50\s*USD5–10 дн\./)
    const u = screen.getByTestId('sc-upgrades')
    expect(u).toHaveTextContent('Express')
    expect(u).toHaveTextContent('Міжнародна')
    // The carrier and its mail class by name (from the carriers of the origin country).
    expect(u).toHaveTextContent('Ukrposhta · Priority')
    // Under "Строк доставки" a tariff says it is one (Etsy counts the days by it).
    expect(within(u).getByText('за тарифом:').parentElement).toHaveAttribute('title', 'Строк у днях рахує Etsy за тарифом цього перевізника')
    expect(screen.getByTestId('sc-profile')).toHaveTextContent('Україна (UA), 79000')
  })

  it('adds a destination to a region with delivery days (confirmed)', async () => {
    mockFeature({ ...base, 'shopConfig.createDestination': { ...dest, id: 32 } })
    await openProfile()
    await click(button('Додати напрямок'))
    const form = within(screen.getByTestId('sc-destination-form'))
    fireEvent.change(form.getByLabelText('Куди'), { target: { value: 'eu' } })
    fireEvent.change(form.getByLabelText('Вартість за один товар'), { target: { value: '7,5' } })
    fireEvent.change(form.getByLabelText('За кожен наступний товар'), { target: { value: '2' } })
    fireEvent.change(form.getByLabelText('Найменше днів у дорозі'), { target: { value: '7' } })
    fireEvent.change(form.getByLabelText('Найбільше днів у дорозі'), { target: { value: '21' } })
    // What the two costs mean for a 3-item order.
    expect(form.getByTestId('cost-example')).toHaveTextContent('7,50 + 2 × 2,00 = 11,50 USD')
    await click(form.getByRole('button', { name: 'Додати напрямок' }))
    expect(await answer(true, 'Додати доставку')).toContain('Додати доставку «Країни ЄС» у профіль «Standard»')
    expect(calls('createDestination')).toEqual([
      {
        profileId: 21,
        input: { primary_cost: '7,5', secondary_cost: '2', destination_region: 'eu', shipping_carrier_id: 0, min_delivery_days: '7', max_delivery_days: '21' }
      }
    ])
    expect(calls('destinations')).toHaveLength(2)
    expect(screen.queryByTestId('sc-destination-form')).toBeNull()
    expect(within(screen.getByTestId('sc-destinations')).getByRole('status')).toHaveTextContent('Напрямок додано.')
    // Back to the list: it is read again (its destination/upgrade counts changed).
    await click(button('Усі профілі'))
    expect(screen.getByTestId('sc-shipping')).toBeInTheDocument()
    expect(calls('shippingProfiles')).toHaveLength(2)
  })

  it('edits a destination: the note stays after the form closes', async () => {
    mockFeature({ ...base, 'shopConfig.updateDestination': dest })
    await openProfile()
    await click(within(screen.getByTestId('sc-destinations')).getByRole('button', { name: 'Змінити доставку «США (US)»' }))
    fireEvent.change(within(screen.getByTestId('sc-destination-form')).getByLabelText('Вартість за один товар'), { target: { value: '6' } })
    await click(button('Зберегти напрямок'))
    await answer(true)
    expect(calls('updateDestination')).toHaveLength(1)
    expect(screen.queryByTestId('sc-destination-form')).toBeNull()
    expect(within(screen.getByTestId('sc-destinations')).getByRole('status')).toHaveTextContent('Напрямок збережено.')
  })

  it('edits a destination (prefilled) with a carrier and mail class; main errors are shown', async () => {
    mockFeature({ ...base, 'shopConfig.updateDestination': { ok: false, error: 'Etsy відхилив запит як некоректний (HTTP 400).' } })
    await openProfile()
    await click(within(screen.getByTestId('sc-destinations')).getByRole('button', { name: 'Змінити доставку «США (US)»' }))
    const form = within(screen.getByTestId('sc-destination-form'))
    expect(form.getByLabelText('Країна призначення')).toHaveValue('US')
    expect(form.getByLabelText('Вартість за один товар')).toHaveValue('5')
    await click(form.getByLabelText(/Перевізник і клас пошти/))
    fireEvent.change(form.getByLabelText('Перевізник'), { target: { value: '2' } })
    fireEvent.change(form.getByLabelText('Клас пошти'), { target: { value: 'priority' } })
    await click(form.getByRole('button', { name: 'Зберегти напрямок' }))
    expect(await answer(true, 'Зберегти доставку')).toContain('Зберегти доставку «США (US)»')
    expect(calls('carriers')).toEqual([{ country: 'UA' }])
    expect(calls('updateDestination')).toEqual([
      {
        profileId: 21,
        destinationId: 31,
        input: { primary_cost: '5', secondary_cost: '1.5', destination_country_iso: 'US', shipping_carrier_id: '2', mail_class: 'priority' }
      }
    ])
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 400')
    expect(screen.getByTestId('sc-destination-form')).toBeInTheDocument()
  })

  it('deletes a destination and an upgrade (confirmed)', async () => {
    mockFeature({ ...base, 'shopConfig.deleteDestination': null, 'shopConfig.deleteUpgrade': null })
    await openProfile()
    await click(within(screen.getByTestId('sc-destinations')).getByRole('button', { name: 'Видалити доставку «США (US)»' }))
    expect(await answer(true, 'Видалити доставку')).toContain('Видалити доставку «США (US)»')
    expect(calls('deleteDestination')).toEqual([{ profileId: 21, destinationId: 31 }])
    await click(within(screen.getByTestId('sc-upgrades')).getByRole('button', { name: 'Видалити прискорену доставку «Express»' }))
    expect(await answer(true, 'Видалити доставку')).toContain('Видалити прискорену доставку «Express»')
    expect(calls('deleteUpgrade')).toEqual([{ profileId: 21, upgradeId: 41 }])
  })

  it('adds a domestic upgrade and edits one (confirmed)', async () => {
    mockFeature({ ...base, 'shopConfig.createUpgrade': upgrade, 'shopConfig.updateUpgrade': upgrade })
    await openProfile()
    await click(button('Додати прискорену доставку'))
    let form = within(screen.getByTestId('sc-upgrade-form'))
    // Nothing to add without a name the buyers would see.
    expect(form.getByRole('button', { name: 'Додати' })).toBeDisabled()
    expect(form.getByRole('radio', { name: 'Всередині країни' })).toBeChecked()
    fireEvent.change(form.getByLabelText('Назва для покупців'), { target: { value: 'Fast' } })
    fireEvent.change(form.getByLabelText('Доплата'), { target: { value: '4' } })
    fireEvent.change(form.getByLabelText('Доплата за кожен наступний товар'), { target: { value: '1' } })
    fireEvent.change(form.getByLabelText('Найменше днів у дорозі'), { target: { value: '1' } })
    fireEvent.change(form.getByLabelText('Найбільше днів у дорозі'), { target: { value: '2' } })
    await click(form.getByRole('button', { name: 'Додати' }))
    expect(await answer(true, 'Додати доставку')).toContain('Додати прискорену доставку «Fast»')
    expect(within(screen.getByTestId('sc-upgrades')).getByRole('status')).toHaveTextContent('Прискорену доставку додано.')
    expect(calls('createUpgrade')).toEqual([
      {
        profileId: 21,
        input: { type: 0, upgrade_name: 'Fast', price: '4', secondary_price: '1', shipping_carrier_id: 0, min_delivery_days: '1', max_delivery_days: '2' }
      }
    ])
    await click(within(screen.getByTestId('sc-upgrades')).getByRole('button', { name: 'Змінити прискорену доставку «Express»' }))
    form = within(screen.getByTestId('sc-upgrade-form'))
    expect(form.getByRole('radio', { name: 'Міжнародна' })).toBeChecked()
    expect(form.getByRole('radio', { name: 'Перевізник і клас пошти' })).toBeChecked()
    expect(form.getByLabelText('Перевізник')).toHaveValue('2')
    expect(form.getByLabelText('Клас пошти')).toHaveValue('priority')
    fireEvent.change(form.getByLabelText('Доплата'), { target: { value: '12' } })
    await click(form.getByRole('button', { name: 'Зберегти' }))
    await answer(true)
    expect(calls('updateUpgrade')).toEqual([
      {
        profileId: 21,
        upgradeId: 41,
        input: { type: 1, upgrade_name: 'Express', price: '12', secondary_price: '2', shipping_carrier_id: '2', mail_class: 'priority' }
      }
    ])
    expect(screen.queryByTestId('sc-upgrade-form')).toBeNull()
    expect(within(screen.getByTestId('sc-upgrades')).getByRole('status')).toHaveTextContent('Прискорену доставку збережено.')
  })

  it('saves only the changed profile fields; deletes the profile and goes back to the list', async () => {
    mockFeature({ ...base, 'shopConfig.updateShippingProfile': { ...profile, title: 'Main' }, 'shopConfig.deleteShippingProfile': null })
    await openProfile()
    // The summary first; the form opens on demand.
    expect(screen.getByTestId('sc-profile-summary')).toHaveTextContent('Фіксована вартість')
    expect(screen.queryByTestId('sc-profile-edit')).toBeNull()
    await click(button('Змінити основне'))
    const edit = within(screen.getByTestId('sc-profile-edit'))
    expect(edit.getByRole('button', { name: 'Зберегти профіль' })).toBeDisabled()
    fireEvent.change(edit.getByLabelText('Назва профілю'), { target: { value: 'Main' } })
    fireEvent.change(edit.getByLabelText('Підготовка: від'), { target: { value: '1' } })
    fireEvent.change(edit.getByLabelText('Підготовка: до'), { target: { value: '3' } })
    await click(edit.getByRole('button', { name: 'Зберегти профіль' }))
    await answer(true)
    expect(calls('updateShippingProfile')).toEqual([
      { profileId: 21, input: { title: 'Main', min_processing_time: '1', max_processing_time: '3', processing_time_unit: 'business_days' } }
    ])
    expect(screen.getByTestId('sc-profile')).toHaveTextContent('Main')
    // The renamed profile keeps the same form: its note stays, the time fields are emptied.
    expect(within(screen.getByTestId('sc-profile-edit')).getByRole('status')).toHaveTextContent('Профіль збережено.')
    expect(within(screen.getByTestId('sc-profile-edit')).getByLabelText('Підготовка: від')).toHaveValue(null)
    expect(within(screen.getByTestId('sc-profile-edit')).getByRole('button', { name: 'Зберегти профіль' })).toBeDisabled()
    await click(button('Видалити профіль'))
    expect(await answer(true, 'Видалити профіль')).toContain('Видалити профіль доставки «Main»')
    expect(calls('deleteShippingProfile')).toEqual([{ profileId: 21 }])
    expect(screen.getByTestId('sc-shipping')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Профіль видалено.')
    expect(calls('shippingProfiles')).toHaveLength(2)
  })

  it('clears the postal code; an unknown origin is not sent until picked', async () => {
    const noOrigin = { ...profile, originCountry: null }
    mockFeature({ ...base, 'shopConfig.shippingProfile': noOrigin, 'shopConfig.updateShippingProfile': { ...noOrigin, originPostalCode: null } })
    // No origin known: no carriers to ask for.
    await openProfile(null)
    await click(button('Змінити основне'))
    const edit = within(screen.getByTestId('sc-profile-edit'))
    expect(edit.getByLabelText('Країна відправлення')).toHaveValue('')
    fireEvent.change(edit.getByLabelText('Поштовий індекс відправлення'), { target: { value: '' } })
    await click(edit.getByRole('button', { name: 'Зберегти профіль' }))
    await answer(true)
    expect(calls('updateShippingProfile')).toEqual([{ profileId: 21, input: { origin_postal_code: '' } }])
    fireEvent.change(edit.getByLabelText('Країна відправлення'), { target: { value: 'PL' } })
    await click(edit.getByRole('button', { name: 'Зберегти профіль' }))
    await answer(true)
    expect(calls('updateShippingProfile')[1]).toEqual({ profileId: 21, input: { origin_country_iso: 'PL' } })
  })

  it('creates a profile with its first destination, then opens it', async () => {
    mockFeature({ ...base, 'shopConfig.shippingProfiles': [], 'shopConfig.createShippingProfile': profile })
    await show(<Shipping />)
    expect(screen.getByText('Профілів доставки ще немає.')).toBeInTheDocument()
    await click(button('Новий профіль доставки'))
    // The intro's button and the empty state's step aside while the form is open.
    expect(screen.queryByRole('button', { name: 'Новий профіль доставки' })).toBeNull()
    const form = within(screen.getByTestId('sc-profile-create'))
    fireEvent.change(form.getByLabelText('Назва профілю'), { target: { value: 'Standard' } })
    fireEvent.change(form.getByLabelText('Поштовий індекс відправлення'), { target: { value: '79000' } })
    fireEvent.change(form.getByLabelText('Країна призначення'), { target: { value: 'DE' } })
    fireEvent.change(form.getByLabelText('Вартість за один товар'), { target: { value: '5' } })
    fireEvent.change(form.getByLabelText('За кожен наступний товар'), { target: { value: '1' } })
    fireEvent.change(form.getByLabelText('Найменше днів у дорозі'), { target: { value: '5' } })
    fireEvent.change(form.getByLabelText('Найбільше днів у дорозі'), { target: { value: '10' } })
    expect(within(form.getByLabelText('Куди')).queryByText('Усі інші країни')).toBeNull()
    await click(form.getByRole('button', { name: 'Створити профіль' }))
    expect(await answer(true, 'Створити профіль')).toContain('Створити профіль доставки «Standard»')
    expect(calls('createShippingProfile')).toEqual([
      {
        input: {
          title: 'Standard',
          origin_country_iso: 'UA',
          origin_postal_code: '79000',
          primary_cost: '5',
          secondary_cost: '1',
          destination_country_iso: 'DE',
          min_processing_time: '',
          max_processing_time: '',
          shipping_carrier_id: 0,
          min_delivery_days: '5',
          max_delivery_days: '10'
        }
      }
    ])
    expect(screen.getByTestId('sc-profile')).toBeInTheDocument()
    expect(within(screen.getByTestId('sc-profile')).getAllByRole('status')[0]).toHaveTextContent('Профіль створено.')
  })

  it('a failed carriers load is a note; the days still work', async () => {
    mockFeature({ ...base, 'shopConfig.carriers': { ok: false, error: 'Немає з’єднання з Etsy.' } })
    await openProfile()
    await click(button('Додати напрямок'))
    expect(screen.getByTestId('sc-destination-form')).toHaveTextContent('Перевізники: Немає з’єднання з Etsy. Строк у днях можна вказати й без них.')
    expect(within(screen.getByTestId('sc-destination-form')).getByLabelText('Найменше днів у дорозі')).toBeInTheDocument()
  })
})

describe('Обробка', () => {
  const Processing = tab('Обробка')
  const p = { id: 51, readinessState: 'made_to_order' as const, minDays: 1, maxDays: 3, label: '1-3 days' }

  it('lists, creates, edits and deletes processing profiles (confirmed)', async () => {
    mockFeature({
      'shopConfig.processingProfiles': [p],
      'shopConfig.createProcessingProfile': p,
      'shopConfig.updateProcessingProfile': p,
      'shopConfig.deleteProcessingProfile': null
    })
    await show(<Processing />)
    // Etsy's own English text ("1-3 days") is shown in Ukrainian.
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Виготовляється на замовлення1–3 дн.1–3 дні')
    await click(button('Новий профіль підготовки'))
    let form = within(screen.getByTestId('sc-processing-form'))
    // Each kind says what it means.
    expect(form.getByRole('radio', { name: /Виготовляється на замовлення/ })).toBeChecked()
    expect(form.getByRole('radio', { name: /Готовий до відправлення/ })).toHaveAccessibleName(expect.stringContaining('Товар уже зроблений'))
    await click(form.getByLabelText(/Готовий до відправлення/))
    fireEvent.change(form.getByLabelText('Від'), { target: { value: '1' } })
    fireEvent.change(form.getByLabelText('До'), { target: { value: '2' } })
    await click(form.getByRole('radio', { name: 'тижні' }))
    await click(form.getByRole('button', { name: 'Створити' }))
    expect(await answer(true)).toContain('Готовий до відправлення, 1–2 тиж.')
    expect(calls('createProcessingProfile')).toEqual([
      { input: { readiness_state: 'ready_to_ship', min_processing_time: '1', max_processing_time: '2', processing_time_unit: 'weeks' } }
    ])
    expect(screen.queryByTestId('sc-processing-form')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Профіль обробки створено.')
    await click(button('Змінити профіль підготовки «1–3 дні»'))
    form = within(screen.getByTestId('sc-processing-form'))
    expect(form.getByLabelText('Від')).toHaveValue(1)
    expect(form.getByRole('button', { name: 'Зберегти' })).toBeDisabled()
    fireEvent.change(form.getByLabelText('До'), { target: { value: '5' } })
    await click(form.getByRole('button', { name: 'Зберегти' }))
    await answer(true)
    expect(calls('updateProcessingProfile')).toEqual([
      { id: 51, input: { min_processing_time: '1', max_processing_time: '5', processing_time_unit: 'days' } }
    ])
    expect(screen.getByRole('status')).toHaveTextContent('Профіль обробки збережено.')
    await click(button('Видалити профіль підготовки «1–3 дні»'))
    expect(await answer(true, 'Видалити профіль')).toContain('Видалити профіль підготовки «1–3 дні»')
    expect(calls('deleteProcessingProfile')).toEqual([{ id: 51 }])
    expect(screen.getByRole('status')).toHaveTextContent('Профіль обробки видалено.')
  })

  it('edit sends only what changed: a weeks profile (reported in days) keeps its time when only the type changes', async () => {
    const weeks = { id: 52, readinessState: 'made_to_order' as const, minDays: 14, maxDays: 21, label: '2-3 weeks' }
    mockFeature({ 'shopConfig.processingProfiles': [weeks], 'shopConfig.updateProcessingProfile': weeks })
    await show(<Processing />)
    await click(button('Змінити профіль підготовки «2–3 тижні»'))
    const form = within(screen.getByTestId('sc-processing-form'))
    expect(screen.getByTestId('sc-processing-form')).toHaveTextContent('Etsy повертає поточний строк лише в днях («2–3 тижні»)')
    await click(form.getByLabelText(/Готовий до відправлення/))
    await click(form.getByRole('button', { name: 'Зберегти' }))
    await answer(true)
    expect(calls('updateProcessingProfile')).toEqual([{ id: 52, input: { readiness_state: 'ready_to_ship' } }])
  })

  it('the time must be whole numbers 1–10, "від" ≤ "до" — until then the button is off and says why', async () => {
    mockFeature({ 'shopConfig.processingProfiles': [p], 'shopConfig.createProcessingProfile': p, 'shopConfig.updateProcessingProfile': p })
    await show(<Processing />)
    await click(button('Новий профіль підготовки'))
    const form = within(screen.getByTestId('sc-processing-form'))
    const create = form.getByRole('button', { name: 'Створити' })
    const why = () => screen.getByTestId('processing-time-error')
    // A new profile: empty fields are not sent to Etsy.
    expect(create).toBeDisabled()
    expect(why()).toHaveTextContent('Вкажіть строк')
    fireEvent.change(form.getByLabelText('Від'), { target: { value: '0' } })
    fireEvent.change(form.getByLabelText('До'), { target: { value: '3' } })
    expect(why()).toHaveTextContent('Строк — ціле число від 1 до 10.')
    expect(create).toBeDisabled()
    fireEvent.change(form.getByLabelText('Від'), { target: { value: '11' } })
    expect(why()).toHaveTextContent('від 1 до 10')
    fireEvent.change(form.getByLabelText('Від'), { target: { value: '5' } })
    expect(why()).toHaveTextContent('«Від» не може бути більше, ніж «До».')
    expect(create).toBeDisabled()
    fireEvent.change(form.getByLabelText('До'), { target: { value: '7' } })
    expect(screen.queryByTestId('processing-time-error')).toBeNull()
    expect(create).toBeEnabled()
    await click(create)
    expect(await answer(false)).toContain('5–7 дн.')
    expect(calls('createProcessingProfile')).toEqual([])
    await click(form.getByRole('button', { name: 'Скасувати' }))

    // An edit checks the time only once it is touched; a broken one blocks "Зберегти" too.
    await click(button('Змінити профіль підготовки «1–3 дні»'))
    const edit = within(screen.getByTestId('sc-processing-form'))
    expect(screen.queryByTestId('processing-time-error')).toBeNull()
    fireEvent.change(edit.getByLabelText('До'), { target: { value: '' } })
    expect(why()).toHaveTextContent('Вкажіть строк')
    expect(edit.getByRole('button', { name: 'Зберегти' })).toBeDisabled()
  })

  it('a refused create is an alert and keeps the form', async () => {
    mockFeature({
      'shopConfig.processingProfiles': [],
      'shopConfig.createProcessingProfile': { ok: false, error: 'Профіль обробки з такими значеннями вже існує.' }
    })
    await show(<Processing />)
    expect(screen.getByText('Профілів обробки ще немає.')).toBeInTheDocument()
    await click(button('Створити профіль'))
    const form = within(screen.getByTestId('sc-processing-form'))
    fireEvent.change(form.getByLabelText('Від'), { target: { value: '2' } })
    fireEvent.change(form.getByLabelText('До'), { target: { value: '4' } })
    await click(form.getByRole('button', { name: 'Створити' }))
    await answer(true, 'Створити профіль')
    expect(screen.getByRole('alert')).toHaveTextContent('вже існує')
    expect(screen.getByTestId('sc-processing-form')).toBeInTheDocument()
  })
})

describe('Повернення', () => {
  const Returns = tab('Повернення')
  const p1 = { id: 61, acceptsReturns: true, acceptsExchanges: false, returnDeadline: 30 }
  const p2 = { id: 62, acceptsReturns: true, acceptsExchanges: true, returnDeadline: 14 }

  it('lists policies, shows the listings of one, creates one without returns (no deadline sent)', async () => {
    mockFeature({
      'shopConfig.returnPolicies': [p1, p2],
      'shopConfig.returnPolicyListings': [{ listingId: 900, title: 'Budget planner', state: 'active' }],
      'shopConfig.createReturnPolicy': { id: 63, acceptsReturns: false, acceptsExchanges: false, returnDeadline: null }
    })
    await show(<Returns />)
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Повернення протягом 30 дн.')
    expect(screen.getAllByRole('row')[2]).toHaveTextContent('Повернення і обмін протягом 14 дн.')
    await click(button('Товари з правилами «Повернення протягом 30 дн.» (#61)'))
    expect(calls('returnPolicyListings')).toEqual([{ id: 61 }])
    expect(screen.getByTestId('sc-policy-listings')).toHaveTextContent('Budget planner#900 · активний')
    await click(button('Сховати список'))
    expect(screen.queryByTestId('sc-policy-listings')).toBeNull()
    await click(button('Нові правила'))
    const form = within(screen.getByTestId('sc-return-form'))
    expect(form.getByRole('switch', { name: 'Приймаю повернення' })).toBeChecked()
    expect(form.getByRole('switch', { name: 'Приймаю обмін' })).not.toBeChecked()
    await click(form.getByLabelText('Приймаю повернення'))
    expect(form.queryByLabelText('Строк (днів після доставки)')).toBeNull()
    expect(screen.getByTestId('sc-return-form')).toHaveTextContent('Покупці побачать: Без повернень і обміну')
    await click(form.getByRole('button', { name: 'Створити' }))
    expect(await answer(true)).toContain('Без повернень і обміну')
    expect(calls('createReturnPolicy')).toEqual([{ input: { accepts_returns: false, accepts_exchanges: false } }])
    expect(screen.queryByTestId('sc-return-form')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Політику створено.')
  })

  it('edits a policy (deadline from the OAS list) and deletes one (confirmed)', async () => {
    mockFeature({
      'shopConfig.returnPolicies': [p1, p2],
      'shopConfig.updateReturnPolicy': p1,
      'shopConfig.deleteReturnPolicy': { ok: false, error: 'Etsy відхилив запит як некоректний (HTTP 400).' }
    })
    await show(<Returns />)
    await click(button(/^Змінити правила «.*» \(#61\)$/))
    const form = within(screen.getByTestId('sc-return-form'))
    const deadline = form.getByLabelText('Строк (днів після доставки)')
    expect([...(deadline as HTMLSelectElement).options].map((o) => o.value)).toEqual(['7', '14', '21', '30', '45', '60', '90'])
    fireEvent.change(deadline, { target: { value: '60' } })
    await click(form.getByRole('switch', { name: 'Приймаю обмін' }))
    expect(form.getByRole('switch', { name: 'Приймаю обмін' })).toBeChecked()
    await click(form.getByRole('button', { name: 'Зберегти' }))
    expect(await answer(true, 'Зберегти правила')).toContain('Повернення і обмін протягом 60 дн.')
    expect(calls('updateReturnPolicy')).toEqual([{ id: 61, input: { accepts_returns: true, accepts_exchanges: true, return_deadline: '60' } }])
    expect(screen.getByRole('status')).toHaveTextContent('Політику збережено.')
    await click(button(/^Видалити правила «.*» \(#62\)$/))
    await answer(true, 'Видалити правила')
    expect(calls('deleteReturnPolicy')).toEqual([{ id: 62 }])
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 400')
  })

  it('consolidates one policy into another (confirmed), cancel sends nothing', async () => {
    let merged = false
    mockFeature({
      'shopConfig.returnPolicies': () => (merged ? [p2] : [p1, p2]),
      'shopConfig.consolidateReturnPolicies': () => {
        merged = true
        return p2
      }
    })
    await show(<Returns />)
    const box = within(screen.getByTestId('sc-consolidate'))
    expect(box.getByRole('button', { name: 'Об’єднати' })).toBeDisabled()
    fireEvent.change(box.getByLabelText('Які правила прибрати'), { target: { value: '61' } })
    expect(within(box.getByLabelText('Куди перенести товари')).queryByText(/#61/)).toBeNull()
    fireEvent.change(box.getByLabelText('Куди перенести товари'), { target: { value: '62' } })
    await click(box.getByRole('button', { name: 'Об’єднати' }))
    expect(await answer(false)).toContain('Перенести всі товари з правил «Повернення протягом 30 дн.» (#61)')
    expect(calls('consolidateReturnPolicies')).toEqual([])
    await click(box.getByRole('button', { name: 'Об’єднати' }))
    // Merging deletes the source: a red verb, said explicitly (not guessed from the wording).
    expect(confirmButton('Об’єднати правила')).toHaveClass('stop')
    await answer(true, 'Об’єднати правила')
    expect(calls('consolidateReturnPolicies')).toEqual([{ sourceId: 61, destinationId: 62 }])
    expect(calls('returnPolicies')).toHaveLength(2)
    // One policy left: the merge block is gone, its note is not.
    expect(screen.queryByTestId('sc-consolidate')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Політики об’єднано.')
  })
})

describe('Свята і Партнери', () => {
  it('toggles a holiday after confirming; cancel keeps it', async () => {
    const h = { holidayId: 7, countryIso: 'US', name: 'Thanksgiving', isWorking: false }
    mockFeature({ 'shopConfig.holidays': [h], 'shopConfig.setHoliday': { ...h, isWorking: true } })
    const Holidays = tab('Свята')
    await show(<Holidays />)
    const box = screen.getByRole('switch', { name: 'Працює: Thanksgiving' })
    expect(box).not.toBeChecked()
    expect(screen.getByTestId('sc-holidays')).toHaveTextContent('вихідний')
    await click(box)
    expect(await answer(false)).toContain('Працювати у свято «Thanksgiving»')
    expect(calls('setHoliday')).toEqual([])
    expect(screen.getByLabelText('Працює: Thanksgiving')).not.toBeChecked()
    await click(screen.getByLabelText('Працює: Thanksgiving'))
    await answer(true, 'Працювати у свято')
    expect(calls('setHoliday')).toEqual([{ holidayId: 7, isWorking: true }])
    expect(screen.getByLabelText('Працює: Thanksgiving')).toBeChecked()
    expect(screen.getByTestId('sc-holidays')).toHaveTextContent('працюємо')
    expect(screen.getByRole('status')).toHaveTextContent('«Thanksgiving»: магазин працює.')
  })

  it('no holidays → a note; an error is an alert', async () => {
    mockFeature({ 'shopConfig.holidays': [] })
    const Holidays = tab('Свята')
    await show(<Holidays />)
    expect(screen.getByText('Для країни вашого магазину свят немає.')).toBeInTheDocument()
  })

  it('production partners: none → a plain explanation', async () => {
    mockFeature({ 'shopConfig.partners': [] })
    const Partners = tab('Партнери')
    await show(<Partners />)
    expect(screen.getByText('Виробничих партнерів немає.')).toBeInTheDocument()
    expect(screen.getByTestId('sc-partners')).toHaveTextContent('Якщо ви робите все самі, нічого вказувати не треба.')
  })

  it('production partners: list, empty, error', async () => {
    const Partners = tab('Партнери')
    mockFeature({ 'shopConfig.partners': [{ id: 71, name: 'Print House', location: 'Lviv' }] })
    const { unmount } = render(<Partners />)
    expect(await screen.findByText('Print House')).toBeInTheDocument()
    // The location is its own line under the name (no dangling "·" when it wraps).
    expect(screen.getByText('Lviv')).toHaveClass('fx-meta')
    expect(screen.getByText('Print House')).not.toContainElement(screen.getByText('Lviv'))
    unmount()
    mockFeature({ 'shopConfig.partners': { ok: false, error: 'Для цього потрібен дозвіл' } })
    await show(<Partners />)
    expect(screen.getByRole('alert')).toHaveTextContent('Для цього потрібен дозвіл')
  })

  it('shows "Завантаження…" until the answer comes', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockFeature({ 'shopConfig.partners': () => new Promise((r) => (resolve = r)) })
    const Partners = tab('Партнери')
    await show(<Partners />)
    expect(screen.getByRole('status')).toHaveTextContent('Завантаження…')
    await act(async () => resolve([]))
    expect(screen.getByText('Виробничих партнерів немає.')).toBeInTheDocument()
  })
})

describe('etsyTimeLabel', () => {
  it("puts Etsy's processing text into Ukrainian with the right plural; other text stays", () => {
    expect(etsyTimeLabel('1-3 business days')).toBe('1–3 робочі дні')
    expect(etsyTimeLabel('3-5 business days')).toBe('3–5 робочих днів')
    expect(etsyTimeLabel('1 business day')).toBe('1 робочий день')
    expect(etsyTimeLabel('2-3 weeks')).toBe('2–3 тижні')
    expect(etsyTimeLabel('5-6 weeks')).toBe('5–6 тижнів')
    expect(etsyTimeLabel('1-11 days')).toBe('1–11 днів')
    expect(etsyTimeLabel('21 days')).toBe('21 день')
    expect(etsyTimeLabel('Ships in a while')).toBe('Ships in a while')
  })
})
