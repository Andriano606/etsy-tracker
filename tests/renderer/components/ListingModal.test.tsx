// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ListingModal } from '../../../src/renderer/src/components/ListingModal'
import { useStore } from '../../../src/renderer/src/store'
import { mkListing, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

describe('ListingModal', () => {
  it('renders the description as plain text with line breaks, never as HTML', () => {
    const description = 'Line one\nLine <b>two</b>\n<img src=x onerror="alert(1)">'
    useStore.setState({ detailListing: mkListing(1, { description }) })
    const { container } = render(<ListingModal />)
    const desc = screen.getByTestId('listing-description')
    expect(desc.textContent).toBe(description)
    expect(desc.querySelector('b')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(desc).toHaveClass('description')
  })

  it('shows price, tags, quantity and a gallery that switches images', () => {
    const l = mkListing(2, {
      tags: ['mug', 'ceramic'],
      quantity: 4,
      images: [
        { ...mkListing(2).images[0], id: 1, rank: 1, url570: 'https://i.etsystatic.com/a.jpg' },
        { ...mkListing(2).images[0], id: 2, rank: 2, url570: 'https://i.etsystatic.com/b.jpg' }
      ]
    })
    useStore.setState({ detailListing: l })
    const { container } = render(<ListingModal />)
    expect(screen.getByText('mug')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText(/20,00/)).toBeInTheDocument()
    const main = () => container.querySelector('.gallery-main img')!.getAttribute('src')
    expect(main()).toBe('https://i.etsystatic.com/a.jpg')
    fireEvent.click(screen.getByLabelText('Фото 2'))
    expect(main()).toBe('https://i.etsystatic.com/b.jpg')
  })

  it('Відкрити на Etsy goes through main (system browser)', () => {
    useStore.setState({ detailListing: mkListing(3) })
    render(<ListingModal />)
    fireEvent.click(screen.getByText('Відкрити на Etsy'))
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/listing/3/x')
  })

  it('closes', () => {
    useStore.setState({ detailListing: mkListing(3) })
    render(<ListingModal />)
    fireEvent.click(screen.getByText('Закрити'))
    expect(useStore.getState().detailListing).toBeNull()
  })

  it('handles a listing with no images', () => {
    useStore.setState({ detailListing: mkListing(4, { images: [] }) })
    render(<ListingModal />)
    expect(screen.getByText('без фото')).toBeInTheDocument()
  })
})
