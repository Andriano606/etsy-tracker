import type { ScanChange, ScanSummary } from '@shared/types'
import { formatDateTime } from '@shared/format'
import { GLOSSARY } from '@shared/glossary'
import { useStore } from '../store'
import { Badge, Icon, InfoTip, Modal } from '../ui'
import { ChangeRows, KIND_LABEL, countOf } from './ChangeList'

/** What a kind of change means, in plain words (from the glossary). */
export const KIND_DESC: Record<ScanChange['kind'], string> = {
  added: GLOSSARY.listingNew.short,
  returned: GLOSSARY.listingReturned.short,
  removed: GLOSSARY.listingRemoved.short,
  changed: GLOSSARY.listingChanged.short
}

/** "нові 2 · зникли 1 · змінились 3 · усього 57 товарів" (zeros left out). */
export function scanCounts(s: ScanSummary): string {
  if (s.status === 'error') return s.error ?? 'помилка'
  if (s.status === 'running') return 'триває…'
  if (s.isBaseline) return `базове: ${countOf(s.total, 'товар', 'товари', 'товарів')}`
  const parts: string[] = []
  if (s.added) parts.push(`нові ${s.added}`)
  if (s.returned) parts.push(`повернулися ${s.returned}`)
  if (s.removed) parts.push(`зникли ${s.removed}`)
  if (s.changed) parts.push(`змінились ${s.changed}`)
  if (!parts.length) parts.push('без змін')
  return `${parts.join(' · ')} · усього ${countOf(s.total, 'товар', 'товари', 'товарів')}`
}

/** An ok scan that found nothing added, returned, removed or changed. */
const hasNoChanges = (s: ScanSummary): boolean => !s.added && !s.returned && !s.removed && !s.changed

const STATUS: Record<ScanSummary['status'], { label: string; tone: 'accent' | 'danger' | 'info' }> = {
  ok: { label: 'Успішно', tone: 'accent' },
  error: { label: 'Помилка', tone: 'danger' },
  running: { label: 'Триває', tone: 'info' }
}

export function ScanHistory({ scans }: { scans: ScanSummary[] }): JSX.Element | null {
  const { openHistoryScan } = useStore()
  if (!scans.length) return null
  return (
    <details className="history" data-testid="scan-history">
      <summary className="group-summary">
        <Icon name="chevron-right" size={16} className="group-chevron" />
        <span className="group-main">
          <span className="group-label">
            <Icon name="history" size={15} /> <span>Історія сканувань ({scans.length})</span>
          </span>
          <span className="group-desc">{GLOSSARY['shop.scanHistory'].short}</span>
        </span>
      </summary>
      <ul className="history-list">
        {scans.map((s) => {
          // Only a scan with changes opens: a baseline or an unchanged one would show an empty dialog.
          const unchanged = s.status === 'ok' && !s.isBaseline && hasNoChanges(s)
          const opens = s.status === 'ok' && !s.isBaseline && !unchanged
          const counts = scanCounts(s)
          return (
            <li key={s.id}>
              <button
                className={`history-row ${s.status}`}
                onClick={() => void openHistoryScan(s)}
                disabled={!opens}
                title={
                  opens
                    ? 'Показати зміни цього сканування'
                    : s.isBaseline
                      ? 'Перше сканування лише запам’ятовує товари — змін у ньому немає'
                      : unchanged
                        ? 'У цьому скануванні нічого не змінилось'
                        : undefined
                }
              >
                <span className="history-date num">{formatDateTime(s.startedAt)}</span>
                <span className="history-status">
                  <Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
                </span>
                <span className="history-counts" title={counts}>
                  {counts}
                </span>
                {opens && <Icon name="chevron-right" size={16} className="history-go" />}
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** One historical scan's changes, grouped by kind. */
export function HistoryModal(): JSX.Element | null {
  const { historyScan, historyChanges, openHistoryScan, openListing } = useStore()
  const close = (): void => void openHistoryScan(null)
  if (!historyScan) return null
  return (
    <Modal
      title={`Сканування ${formatDateTime(historyScan.startedAt)}`}
      subtitle={
        <>
          Що змінилось у магазині порівняно з попереднім скануванням{' '}
          <InfoTip glossary="shop.scanChanges" />
        </>
      }
      size="md"
      onClose={close}
      className="history-modal"
    >
      {historyChanges.length === 0 && <p className="results-empty">Змін не було.</p>}
      {(['added', 'returned', 'removed', 'changed'] as const).map((kind) => {
        const list = historyChanges.filter((c) => c.kind === kind)
        if (!list.length) return null
        return (
          <div key={kind} className="history-group">
            <h3>
              {KIND_LABEL[kind]}: {list.length}
            </h3>
            <p className="history-group-desc">{KIND_DESC[kind]}</p>
            <ChangeRows
              changes={list}
              onOpen={(c) => {
                if (c.listing) openListing(c.listing)
              }}
            />
          </div>
        )
      })}
    </Modal>
  )
}
