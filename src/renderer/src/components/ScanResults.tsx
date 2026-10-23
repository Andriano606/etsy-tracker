import type { Listing, ScanChange, ShopSummary } from '@shared/types'
import { ChangeRows, KIND_LABEL, changedSummary } from './ChangeList'
import { ListingCard } from './ListingCard'

/** The latest successful scan's outcome: new listings first, the rest collapsible. */
export function ScanResults({
  shop,
  changes,
  onOpen
}: {
  shop: ShopSummary
  changes: ScanChange[]
  onOpen: (l: Listing) => void
}): JSX.Element | null {
  const scan = shop.lastOkScan
  if (!scan) return null

  if (scan.isBaseline) {
    return (
      <section className="results baseline" data-testid="scan-results">
        <div className="results-title">Базове сканування: збережено {scan.total} товарів</div>
        <div className="hint">
          Це перше сканування магазину — воно лише запам’ятовує поточні товари. Натисніть
          «Сканувати повторно» пізніше, щоб побачити, що додалося.
        </div>
      </section>
    )
  }

  const of = (kind: ScanChange['kind']): ScanChange[] => changes.filter((c) => c.kind === kind)
  const added = of('added')
  const openChange = (c: ScanChange): void => {
    if (c.listing) onOpen(c.listing)
  }

  return (
    <section className="results" data-testid="scan-results">
      <div className="results-title">
        Нові з минулого сканування: <span className="results-count">{scan.added}</span>
      </div>
      {added.length > 0 ? (
        <div className="grid new-grid">
          {added.map(
            (c) =>
              c.listing && (
                <ListingCard key={c.id} listing={c.listing} isNew onOpen={onOpen} />
              )
          )}
        </div>
      ) : (
        <div className="hint">Нових товарів немає.</div>
      )}
      {scan.truncated && (
        <div className="hint warn">
          У магазині більше товарів, ніж Etsy дозволяє прочитати (≈12 100), тому зниклі товари
          не визначалися.
        </div>
      )}
      {(['returned', 'removed', 'changed'] as const).map((kind) => {
        const list = of(kind)
        if (!list.length) return null
        return (
          <details key={kind} className="results-group">
            <summary>
              {KIND_LABEL[kind]}: {list.length}
              {kind === 'changed' && changedSummary(list) && (
                <span className="dim" data-testid="changed-summary">
                  {' '}
                  ({changedSummary(list)})
                </span>
              )}
            </summary>
            <ChangeRows changes={list} onOpen={openChange} />
          </details>
        )
      })}
    </section>
  )
}
