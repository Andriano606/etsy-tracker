import type { ChangedField, ScanChange, TrackedFields } from '@shared/types'
import { formatPrice } from '@shared/format'
import { FIELD_LABEL, changedFields } from '@shared/changes'
import { imageSrc } from '../imageUrl'

function price(f: TrackedFields | null): string | null {
  if (!f || f.priceAmount == null || f.priceDivisor == null) return null
  return formatPrice(f.priceAmount, f.priceDivisor, f.currency ?? '')
}

/** "+a, +b, −c" between two string lists (as sets). */
function listDiff(a: string[] = [], b: string[] = []): string {
  const added = b.filter((x) => !a.includes(x)).map((x) => `+${x}`)
  const gone = a.filter((x) => !b.includes(x)).map((x) => `−${x}`)
  return [...added, ...gone].join(', ') || 'порядок'
}

function imagesDiff(a: number[] = [], b: number[] = []): string {
  const added = b.filter((x) => !a.includes(x)).length
  const gone = a.filter((x) => !b.includes(x)).length
  const parts: string[] = []
  if (added) parts.push(`нових ${added}`)
  if (gone) parts.push(`прибрано ${gone}`)
  if (!parts.length) parts.push('змінено порядок')
  return `${a.length} → ${b.length} (${parts.join(', ')})`
}

const show = (v: unknown): string => {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'так' : 'ні'
  return String(v)
}

/** Which changed fields get their own "old → new" line (the rest are named in the summary only). */
const SCALAR_LINES: Array<[ChangedField, keyof TrackedFields]> = [
  ['whoMade', 'whoMade'],
  ['whenMade', 'whenMade'],
  ['taxonomyId', 'taxonomyId'],
  ['shopSectionId', 'shopSectionId'],
  ['listingType', 'listingType'],
  ['isPersonalizable', 'isPersonalizable'],
  ['isCustomizable', 'isCustomizable'],
  ['hasVariations', 'hasVariations'],
  ['dimensions', 'dimensions']
]

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** "Змінилось: ціна, опис, фото" + an old → new line per field for a 'changed' row. */
export function ChangeDetail({ change }: { change: ScanChange }): JSX.Element | null {
  const o = change.oldValue
  const n = change.newValue
  if (!o || !n) return null
  const fields = changedFields(n)
  const has = (f: ChangedField): boolean => fields.includes(f)
  const oldPrice = price(o)
  const newPrice = price(n)
  return (
    <div className="change-detail">
      <div className="change-fields" data-testid="change-fields">
        Змінилось: {fields.map((f) => FIELD_LABEL[f]).join(', ')}
      </div>
      {has('title') && (
        <div>
          Назва: <s>{o.title}</s> → {n.title}
        </div>
      )}
      {newPrice && (
        <div>
          Ціна: <s>{oldPrice}</s> → <b>{newPrice}</b>
        </div>
      )}
      {has('images') && <div>Фото: {imagesDiff(o.images, n.images)}</div>}
      {has('tags') && <div>Теги: {listDiff(o.tags, n.tags)}</div>}
      {has('materials') && <div>Матеріали: {listDiff(o.materials, n.materials)}</div>}
      {has('styles') && <div>Стиль: {listDiff(o.styles, n.styles)}</div>}
      {has('processing') && (
        <div>
          Час виготовлення: <s>{show(o.processingMin)}–{show(o.processingMax)}</s> →{' '}
          {show(n.processingMin)}–{show(n.processingMax)} дн.
        </div>
      )}
      {SCALAR_LINES.filter(([f]) => has(f)).map(([f, k]) => (
        <div key={f}>
          {cap(FIELD_LABEL[f])}: <s>{show(o[k])}</s> → {show(n[k])}
        </div>
      ))}
    </div>
  )
}

/** Union of the changed fields of several rows: "ціна, опис, фото". */
export function changedSummary(changes: ScanChange[]): string {
  const all = new Set<ChangedField>()
  for (const c of changes) for (const f of changedFields(c.newValue)) all.add(f)
  return (Object.keys(FIELD_LABEL) as ChangedField[])
    .filter((f) => all.has(f))
    .map((f) => FIELD_LABEL[f])
    .join(', ')
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
        const img = l?.images[0]
        return (
          <li key={c.id}>
            <button className="change-row" onClick={() => onOpen(c)} disabled={!l}>
              {img ? (
                <img src={imageSrc(img, '75x75')} alt="" loading="lazy" referrerPolicy="no-referrer" />
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
  changed: 'Змінились'
}
