import { useEffect, useRef, useState } from 'react'
import type { Listing } from '@shared/types'
import { formatCount } from '@shared/format'
import { Button } from '../ui'
import { ListingCard } from './ListingCard'

/** Cards rendered at first and added per step — a big shop has thousands of listings. */
export const GRID_BATCH = 120

/**
 * The shop's listing grid, rendered in steps: the first GRID_BATCH cards, then
 * the next ones when the end of the grid comes near (an IntersectionObserver
 * with a generous margin) or on "Показати ще". Thousands of cards at once cost
 * hundreds of MB of DOM and decoded photos and made every re-render slow.
 * `resetKey` (shop + search + sort + filters) starts again from the first step;
 * a reload of the same list (after a scan) keeps what is shown.
 */
export function ListingGrid({
  listings,
  newIds,
  onOpen,
  resetKey
}: {
  listings: Listing[]
  newIds: ReadonlySet<number>
  onOpen: (l: Listing) => void
  resetKey: string
}): JSX.Element {
  const [shown, setShown] = useState(GRID_BATCH)
  const [key, setKey] = useState(resetKey)
  if (key !== resetKey) {
    setKey(resetKey)
    setShown(GRID_BATCH)
  }
  const sentinel = useRef<HTMLDivElement>(null)
  const more = listings.length > shown

  // A fresh observer per step: it reports at once whether the end is still in
  // reach (a tall window may need several steps).
  useEffect(() => {
    const el = sentinel.current
    if (!more || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((s) => s + GRID_BATCH)
      },
      { rootMargin: '1200px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [more, shown])

  return (
    <>
      <div className="grid">
        {listings.slice(0, shown).map((l) => (
          <ListingCard key={l.listingId} listing={l} isNew={newIds.has(l.listingId)} onOpen={onOpen} />
        ))}
      </div>
      {more && (
        <div className="grid-more" ref={sentinel} data-testid="grid-more">
          <span className="grid-more-count">
            Показано {formatCount(shown)} з {formatCount(listings.length)}
          </span>
          <Button size="sm" onClick={() => setShown((s) => s + GRID_BATCH)}>
            Показати ще
          </Button>
        </div>
      )}
    </>
  )
}
