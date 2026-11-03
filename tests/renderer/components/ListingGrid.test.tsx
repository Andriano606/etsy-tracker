// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { GRID_BATCH, ListingGrid } from '../../../src/renderer/src/components/ListingGrid'
import { ListingCard } from '../../../src/renderer/src/components/ListingCard'
import { ImageViewer } from '../../../src/renderer/src/ui'
import { useStore } from '../../../src/renderer/src/store'
import { mkListing, setupRenderer } from '../helpers'
import type { Listing } from '../../../src/shared/types'

beforeEach(() => {
  setupRenderer()
})

const many = (n: number): Listing[] => Array.from({ length: n }, (_, i) => mkListing(i + 1))
const none = new Set<number>()

/** A controllable IntersectionObserver (jsdom has none). */
class FakeIO {
  static all: FakeIO[] = []
  disconnected = false
  constructor(public cb: IntersectionObserverCallback) {
    FakeIO.all.push(this)
  }
  observe(): void {}
  disconnect(): void {
    this.disconnected = true
  }
  fire(isIntersecting: boolean): void {
    this.cb([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

describe('ListingGrid (renders big shops in steps)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeIO.all = []
  })

  it('a small shop: every card, no "show more"', () => {
    render(<ListingGrid listings={many(5)} newIds={none} onOpen={vi.fn()} resetKey="a" />)
    expect(screen.getAllByTestId('listing-card')).toHaveLength(5)
    expect(screen.queryByTestId('grid-more')).toBeNull()
  })

  it('a big shop: the first step, then more on "Показати ще"', () => {
    const list = many(GRID_BATCH * 2 + 10)
    render(<ListingGrid listings={list} newIds={new Set([1])} onOpen={vi.fn()} resetKey="a" />)
    expect(screen.getAllByTestId('listing-card')).toHaveLength(GRID_BATCH)
    expect(screen.getAllByTestId('listing-card')[0]).toHaveClass('is-new')
    expect(screen.getByTestId('grid-more')).toHaveTextContent(`Показано ${GRID_BATCH} з ${list.length}`)
    fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(screen.getAllByTestId('listing-card')).toHaveLength(GRID_BATCH * 2)
    fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(screen.getAllByTestId('listing-card')).toHaveLength(list.length)
    expect(screen.queryByTestId('grid-more')).toBeNull()
  })

  it('scrolling near the end shows the next step; a new observer per step', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO)
    render(<ListingGrid listings={many(GRID_BATCH * 3)} newIds={none} onOpen={vi.fn()} resetKey="a" />)
    act(() => FakeIO.all.at(-1)!.fire(false))
    expect(screen.getAllByTestId('listing-card')).toHaveLength(GRID_BATCH)
    act(() => FakeIO.all.at(-1)!.fire(true))
    expect(screen.getAllByTestId('listing-card')).toHaveLength(GRID_BATCH * 2)
    expect(FakeIO.all[0].disconnected).toBe(true)
    act(() => FakeIO.all.at(-1)!.fire(true))
    expect(screen.getAllByTestId('listing-card')).toHaveLength(GRID_BATCH * 3)
    expect(FakeIO.all.every((io) => io.disconnected)).toBe(true)
  })

  it('a new filter/sort/shop starts from the first step; a reload of the same list keeps what is shown', () => {
    const list = many(GRID_BATCH * 3)
    const { rerender } = render(<ListingGrid listings={list} newIds={none} onOpen={vi.fn()} resetKey="a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }))
    expect(screen.getAllByTestId('listing-card')).toHaveLength(GRID_BATCH * 2)
    rerender(<ListingGrid listings={list.map((l) => ({ ...l }))} newIds={none} onOpen={vi.fn()} resetKey="a" />)
    expect(screen.getAllByTestId('listing-card')).toHaveLength(GRID_BATCH * 2)
    rerender(<ListingGrid listings={list} newIds={none} onOpen={vi.fn()} resetKey="b" />)
    expect(screen.getAllByTestId('listing-card')).toHaveLength(GRID_BATCH)
  })
})

describe('ListingCard rendering cost', () => {
  it('builds its viewer gallery only when the magnifier is clicked', () => {
    const l = mkListing(7, { title: 'Планер' })
    render(
      <>
        <ListingCard listing={l} onOpen={vi.fn()} />
        <ImageViewer />
      </>
    )
    expect(useStore.getState().viewer).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Відкрити фото на весь розмір/ }))
    const v = useStore.getState().viewer!
    expect(v.images).toHaveLength(l.images.length)
    expect(v.images[0].ref).toBe(`etsy-tracker://product/7/photo/${l.images[0].id}`)
  })

  it('is memoized: an unchanged listing does not re-render', () => {
    const l = mkListing(1)
    const onOpen = vi.fn()
    const { rerender } = render(<ListingCard listing={l} onOpen={onOpen} />)
    const before = screen.getByTestId('listing-card')
    const title = before.querySelector('.card-title')!
    title.textContent = 'touched'
    rerender(<ListingCard listing={l} onOpen={onOpen} />)
    expect(screen.getByTestId('listing-card').querySelector('.card-title')).toHaveTextContent('touched')
    rerender(<ListingCard listing={{ ...l, title: 'Новий заголовок' }} onOpen={onOpen} />)
    expect(screen.getByTestId('listing-card').querySelector('.card-title')).toHaveTextContent('Новий заголовок')
  })
})
