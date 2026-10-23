// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ListingCard, PriceTag } from '../../../src/renderer/src/components/ListingCard'
import { mkBuyerPrice, mkListing, setupRenderer } from '../helpers'

beforeEach(() => {
  setupRenderer()
})

const usd = { priceAmount: 250, priceDivisor: 100, currency: 'USD' }

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
    expect(price.title).toMatch(/^Ціна для покупця з UA: з ПДВ \(якщо він є в цій країні\) і знижкою\. Базова ціна продавця: .*2,50/)
  })

  it('no promotion: the VAT-inclusive price, base price in the tooltip, no badge', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: mkBuyerPrice({ discount: false }) })} />)
    const price = screen.getByTestId('card-price')
    expect(price).toHaveAttribute('data-kind', 'buyer')
    expect(price).toHaveTextContent('3,00')
    expect(price).not.toHaveTextContent('2,50')
    expect(screen.queryByTestId('discount-badge')).toBeNull()
    expect(screen.queryByTestId('price-was')).toBeNull()
    expect(price.title).toMatch(/^Ціна для покупця з UA: з ПДВ \(якщо він є в цій країні\)\. Базова ціна продавця: .*2,50/)
  })

  it('buyer price unavailable: the seller base price, no country hint', () => {
    render(<PriceTag listing={mkListing(1, { ...usd, buyerPrice: null })} />)
    const price = screen.getByTestId('card-price')
    expect(price).toHaveAttribute('data-kind', 'base')
    expect(price).toHaveTextContent('2,50')
    expect(price.querySelector('.price-country')).toBeNull()
    expect(price.title).toMatch(/Базова ціна продавця \(без ПДВ і без знижок\)/)
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
    const name = screen.getByRole('button').textContent!.replace(/\s+/g, ' ')
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
    expect(screen.getByTestId('card-price').title).toMatch(
      /^Ціна для покупця з GB: з ПДВ \(якщо він є в цій країні\), доставкою і знижкою\. /
    )
  })
})
