import type { ScanChange, TrackedFields } from '@shared/types'
import { formatPrice } from '@shared/format'

function price(f: TrackedFields | null): string | null {
  if (!f || f.priceAmount == null || f.priceDivisor == null) return null
  return formatPrice(f.priceAmount, f.priceDivisor, f.currency ?? '')
}

/** "Назва: a → b", "Ціна: x → y" for a 'changed' row. */
export function ChangeDetail({ change }: { change: ScanChange }): JSX.Element | null {
  const o = change.oldValue
  const n = change.newValue
  if (!o || !n) return null
  const oldPrice = price(o)
  const newPrice = price(n)
  return (
    <div className="change-detail">
      {n.title != null && (
        <div>
          Назва: <s>{o.title}</s> → {n.title}
        </div>
      )}
      {newPrice && (
        <div>
          Ціна: <s>{oldPrice}</s> → <b>{newPrice}</b>
        </div>
      )}
    </div>
  )
}

/** Rows for one kind of change; click opens the listing. */
export function ChangeRows({
  changes,
  onOpen
}: {
  changes: ScanChange[]
  onOpen: (c: ScanChange) => void
}): JSX.Element {
  return (
    <ul className="change-rows">
      {changes.map((c) => {
        const l = c.listing
        const thumb = l?.images[0]?.url75 || l?.images[0]?.url170
        return (
          <li key={c.id}>
            <button className="change-row" onClick={() => onOpen(c)} disabled={!l}>
              {thumb ? (
                <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <span className="thumb-ph" />
              )}
              <div className="change-text">
                <div className="change-title">{l?.title ?? `#${c.listingId}`}</div>
                {c.kind === 'changed' && <ChangeDetail change={c} />}
                {c.kind !== 'changed' && l && (
                  <div className="meta">{formatPrice(l.priceAmount, l.priceDivisor, l.currency)}</div>
                )}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export const KIND_LABEL: Record<ScanChange['kind'], string> = {
  added: 'Нові',
  returned: 'Повернулися',
  removed: 'Зникли',
  changed: 'Змінились (ціна/назва)'
}
