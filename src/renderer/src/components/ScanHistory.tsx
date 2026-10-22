import type { ScanSummary } from '@shared/types'
import { formatDateTime } from '@shared/format'
import { useStore } from '../store'
import { ChangeRows, KIND_LABEL } from './ChangeList'
import { useEscape } from './useEscape'

function counts(s: ScanSummary): string {
  if (s.status === 'error') return s.error ?? 'помилка'
  if (s.status === 'running') return 'триває…'
  if (s.isBaseline) return `базове: ${s.total} товарів`
  const parts = [`+${s.added}`, `−${s.removed}`, `~${s.changed}`]
  if (s.returned) parts.push(`↩${s.returned}`)
  return `${parts.join(' ')} · всього ${s.total}`
}

export function ScanHistory({ scans }: { scans: ScanSummary[] }): JSX.Element | null {
  const { openHistoryScan } = useStore()
  if (!scans.length) return null
  return (
    <details className="history">
      <summary>Історія сканувань ({scans.length})</summary>
      <ul className="history-list">
        {scans.map((s) => (
          <li key={s.id}>
            <button
              className={`history-row ${s.status}`}
              onClick={() => void openHistoryScan(s)}
              disabled={s.status !== 'ok' || s.isBaseline}
            >
              <span className="history-date">{formatDateTime(s.startedAt)}</span>
              <span className={`history-status ${s.status}`}>
                {s.status === 'ok' ? 'OK' : s.status === 'error' ? 'Помилка' : '…'}
              </span>
              <span className="history-counts">{counts(s)}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** One historical scan's changes, grouped by kind. */
export function HistoryModal(): JSX.Element | null {
  const { historyScan, historyChanges, openHistoryScan, openListing } = useStore()
  const close = (): void => void openHistoryScan(null)
  useEscape(close, historyScan != null)
  if (!historyScan) return null
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <h2>Сканування {formatDateTime(historyScan.startedAt)}</h2>
        {historyChanges.length === 0 && <div className="hint">Змін не було.</div>}
        {(['added', 'returned', 'removed', 'changed'] as const).map((kind) => {
          const list = historyChanges.filter((c) => c.kind === kind)
          if (!list.length) return null
          return (
            <div key={kind} className="history-group">
              <h3>
                {KIND_LABEL[kind]}: {list.length}
              </h3>
              <ChangeRows
                changes={list}
                onOpen={(c) => {
                  if (c.listing) openListing(c.listing)
                }}
              />
            </div>
          )
        })}
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  )
}
