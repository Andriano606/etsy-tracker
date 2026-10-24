// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ListingCard, PriceTag } from '../../../src/renderer/src/components/ListingCard'
import { GLOSSARY } from '../../../src/shared/glossary'
import { ImageViewer } from '../../../src/renderer/src/ui'
import { useStore } from '../../../src/renderer/src/store'
import { mkBuyerPrice, mkListing, setupRenderer } from '../helpers'

beforeEach(() => {
  setupRenderer()
})

const usd = { priceAmount: 250, priceDivisor: 100, currency: 'USD' }

/** Hover the price row and read its tooltip (a design-system bubble, not a native title). */
function priceTip(n = 0): string {
  const price = screen.getAllByTestId('card-price')[n]
  expect(price).not.toHaveAttribute('title')
  act(() => void fireEvent.mouseEnter(price.closest('.ui-tooltip-anchor')!))
  return screen.getAllByRole('tooltip').at(-1)!.textContent!.replace(/\s+/g, ' ')
}

describe('ListingCard price (like the shop page)', () => {
  it('an active promotion: sale price bold, original struck through, "−60%", the country', () => {
    render(<ListingCard listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice() })} onOpen={vi.fn()} />)
    const price = screen.getByTestId('card-price')
    expect(price).toHaveAttribute('data-kind', 'discounted')
    expect(price.querySelector('.price-now')).toHaveTextContent('1,20')
    expect(within(price).getByTestId('price-was').tagName).toBe('S')
    expect(within(price).getByTestId('price-was')).toHaveTextContent('3,00')
    expect(within(price).getByTestId('discount-badge')).toHaveTextContent('−60%')
    expect(within(price).getByText('UA')).toBeInTheDocument()
    expect(priceTip()).toMatch(/Ціна для покупця з UA: з ПДВ \(якщо він є в цій країні\) і знижкою\. Базова ціна продавця: .*2,50/)
  })

  it('no promotion: the VAT-inclusive price, base price in the tooltip, no badge', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice({ discount: false }) })} />)
    const price = screen.getByTestId('card-price')
    expect(price).toHaveAttribute('data-kind', 'buyer')
    expect(price).toHaveTextContent('3,00')
    expect(price).not.toHaveTextContent('2,50')
    expect(screen.queryByTestId('discount-badge')).toBeNull()
    expect(screen.queryByTestId('price-was')).toBeNull()
    expect(priceTip()).toMatch(/Ціна для покупця з UA: з ПДВ \(якщо він є в цій країні\)\. Базова ціна продавця: .*2,50/)
  })

  it('buyer price unavailable: the seller base price, no country hint', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: null })} />)
    const price = screen.getByTestId('card-price')
    expect(price).toHaveAttribute('data-kind', 'base')
    expect(price).toHaveTextContent('2,50')
    expect(price.querySelector('.price-country')).toBeNull()
    expect(priceTip()).toMatch(/Базова ціна продавця \(без ПДВ і без знижок\)/)
    // Visibly marked, so it isn't mistaken for what a buyer pays.
    expect(price.querySelector('.price-basis')).toHaveTextContent('без ПДВ')
  })

  it('the "−60%" badge and the country code wrap as one unit (a narrow card never orphans either)', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice() })} />)
    const price = screen.getByTestId('card-price')
    const tags = price.querySelector('.price-tags')!
    expect(tags.parentElement).toBe(price)
    expect(tags.querySelector('[data-testid=discount-badge]')).toHaveTextContent('−60%')
    expect(tags.querySelector('.price-country')).toHaveTextContent('UA')
    // The prices stay outside it.
    expect(tags.querySelector('.price-now, [data-testid=price-was]')).toBeNull()
    // No promotion: the group holds just the code.
    render(<PriceTag listing={mkListing(2, { ...usd, buyerPrice: mkBuyerPrice({ discount: false }) })} />)
    const plain = screen.getAllByTestId('card-price')[1].querySelector('.price-tags')!
    expect(plain.querySelector('[data-testid=discount-badge]')).toBeNull()
    expect(plain.querySelector('.price-country')).toHaveTextContent('UA')
  })

  it('a fixed-amount promotion shows the amount off', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice({ discountPercentage: null }) })} />)
    expect(screen.getByTestId('discount-badge')).toHaveTextContent(/−1,80/)
  })

  it('another country is named on the card (visibly as a code, for screen readers in words)', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice({ country: 'DE' }) })} />)
    const code = screen.getByTestId('card-price').querySelector('.price-country')!
    expect(code).toHaveTextContent('DE')
    expect(code).toHaveAttribute('aria-hidden', 'true')
    expect(code).not.toHaveAttribute('aria-label')
    expect(screen.getByText('(ціна для покупця з DE)')).toHaveClass('sr-only')
  })

  it('screen readers hear which price is the old one and which the sale price', () => {
    render(<ListingCard listing={mkListing(1, { ...usd, title: 'Mug', buyerPrice: mkBuyerPrice() })} onOpen={vi.fn()} />)
    expect(screen.getByText('стара ціна')).toHaveClass('sr-only')
    expect(screen.getByText('ціна зі знижкою')).toHaveClass('sr-only')
    // The card button's content reads in order: sale price, then the old one, then whose price
    // (the flex items get separated by the browser; jsdom's textContent just concatenates).
    const name = screen.getByTestId('listing-card').textContent!.replace(/\s+/g, ' ')
    expect(name).toMatch(/ціна зі знижкою 1,20 USD ?стара ціна 3,00 USD ?−60% ?UA ?\(ціна для покупця з UA\)/)
    // No sale: nothing to name.
    render(<PriceTag listing={mkListing(2, { ...usd, buyerPrice: mkBuyerPrice({ discount: false }) })} />)
    expect(screen.getAllByText('стара ціна')).toHaveLength(1)
  })

  it('formats like the UI really does (uk-UA: "1,20 USD", not "$1.20")', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice() })} />)
    expect(screen.getByTestId('card-price').querySelector('.price-now')!.textContent!.replace(/\s/g, ' ')).toBe('1,20 USD')
    expect(screen.getByTestId('price-was').textContent!.replace(/\s/g, ' ')).toBe('3,00 USD')
  })

  it('UK buyer prices say shipping is included in the tooltip too', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice({ country: 'GB' }) })} />)
    expect(priceTip()).toMatch(/Ціна для покупця з GB: з ПДВ \(якщо він є в цій країні\), доставкою і знижкою\. /)
  })
})

describe('ListingCard badges explain themselves (hover tooltips)', () => {
  const hover = (el: Element) => act(() => void fireEvent.mouseEnter(el.closest('.ui-tooltip-anchor')!))

  it('favourites (+ growth), views, featured position and reviews each say what they mean', () => {
    render(
      <ListingCard
        listing={mkListing(1, { numFavorers: 87, favorersDelta: 5, views: 1342, featuredRank: 2, reviewCount: 12, reviewAvg: 4.5, reviewsNew: 1 })}
        onOpen={vi.fn()}
      />
    )
    hover(screen.getByTestId('card-favorites'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(GLOSSARY.favorites.short)
    expect(screen.getByRole('tooltip')).toHaveTextContent('+5 з минулого сканування.')
    act(() => void fireEvent.mouseLeave(screen.getByTestId('card-favorites').closest('.ui-tooltip-anchor')!))
    hover(screen.getByTestId('card-views'))
    expect(screen.getAllByRole('tooltip').at(-1)).toHaveTextContent(GLOSSARY.views.short)
    hover(screen.getByTestId('card-featured'))
    expect(screen.getAllByRole('tooltip').at(-1)).toHaveTextContent(GLOSSARY.featuredRank.short)
    hover(screen.getByTestId('card-reviews'))
    expect(screen.getAllByRole('tooltip').at(-1)).toHaveTextContent('Середня оцінка 4,5 з 5, відгуків: 12. Нових з минулого сканування: +1.')
  })

  it('the "Новий" badge explains what new means; nothing focusable is nested in the card button', () => {
    render(<ListingCard listing={mkListing(1, { numFavorers: 3, buyerPrice: mkBuyerPrice() })} isNew onOpen={vi.fn()} />)
    expect(screen.queryByText('NEW')).toBeNull()
    hover(screen.getByText('Новий'))
    expect(screen.getByRole('tooltip')).toHaveTextContent(GLOSSARY.listingNew.short)
    const card = screen.getByTestId('listing-card')
    expect(card.querySelectorAll('button, a, [tabindex]')).toHaveLength(0)
  })

  it('the "−60%" badge and the country code explain themselves (glossary), in one tooltip for the price row', () => {
    render(<ListingCard listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice() })} onOpen={vi.fn()} />)
    hover(screen.getByText('UA'))
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Ціна для покупця з UA')
    expect(tip).toHaveTextContent(`−60% — ${GLOSSARY['shop.discountBadge'].short}`)
    expect(tip).toHaveTextContent(`UA — ${GLOSSARY['shop.priceCountry'].short}`)
  })

  it('the seller base price explains itself, with no country or badge lines', () => {
    render(<ListingCard listing={mkListing(1, { ...usd, buyerPrice: null })} onOpen={vi.fn()} />)
    hover(screen.getByText('без ПДВ'))
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent(GLOSSARY.basePrice.short)
    expect(tip).not.toHaveTextContent(GLOSSARY['shop.priceCountry'].short)
    expect(tip).not.toHaveTextContent(GLOSSARY['shop.discountBadge'].short)
  })

  it('the full title is in a tooltip (the card shows two lines)', () => {
    const title = 'A very long listing title that will be cut after two lines on a narrow card in the grid'
    render(<ListingCard listing={mkListing(1, { title })} onOpen={vi.fn()} />)
    expect(screen.getByText(title)).toHaveAttribute('title', title)
  })
})

describe('ListingCard photo → the image viewer', () => {
  const img = (id: number, rank: number, alt: string | null = null) => ({ ...mkListing(1).images[0], id, rank, alt })

  it('the magnifier (a sibling of the card button) opens every photo full size at the first; the card does not open', async () => {
    const onOpen = vi.fn()
    const l = mkListing(1, { title: 'Mug', images: [img(11, 1, 'Front'), img(12, 2), img(13, 3)] })
    render(
      <>
        <ListingCard listing={l} onOpen={onOpen} />
        <ImageViewer />
      </>
    )
    const card = screen.getByTestId('listing-card')
    const zoom = screen.getByRole('button', { name: /^Відкрити фото на весь розмір: / })
    expect(card.contains(zoom)).toBe(false)
    expect(zoom).toHaveClass('ui-zoom-corner')
    expect(zoom.closest('.ui-zoom-host')).toBe(card.parentElement)
    await act(async () => fireEvent.click(zoom))
    expect(onOpen).not.toHaveBeenCalled()
    const viewer = useStore.getState().viewer!
    expect(viewer.index).toBe(0)
    expect(viewer.images.map((i) => i.src)).toEqual(['etsyimg://img/11/fullxfull', 'etsyimg://img/12/fullxfull', 'etsyimg://img/13/fullxfull'])
    expect(viewer.images[0].alt).toBe('Front')
    expect(viewer.images[1].alt).toBe('Mug')
    const dlg = screen.getByRole('dialog', { name: 'Перегляд зображення' })
    expect(dlg.querySelector('img')).toHaveAttribute('src', 'etsyimg://img/11/fullxfull')
    expect(dlg).toHaveTextContent('1 / 3')
  })

  it('the card click still opens the listing (and not the viewer)', async () => {
    const onOpen = vi.fn()
    const l = mkListing(1)
    render(<ListingCard listing={l} onOpen={onOpen} />)
    await act(async () => fireEvent.click(screen.getByTestId('listing-card')))
    expect(onOpen).toHaveBeenCalledWith(l)
    expect(useStore.getState().viewer).toBeNull()
  })

  it('no photo → no magnifier', () => {
    render(<ListingCard listing={mkListing(1, { images: [] })} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^Відкрити фото на весь розмір/ })).toBeNull()
  })
})
