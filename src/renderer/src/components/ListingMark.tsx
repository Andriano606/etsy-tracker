import { useEffect, useState } from 'react'
import type { Listing, ListingMark, ListingMarkStatus } from '@shared/types'
import { MARK_LABEL, MARK_NOTE_MAX } from '@shared/marks'
import { formatDateTime } from '@shared/format'
import { GLOSSARY } from '@shared/glossary'
import { parseClaudeRef } from '@shared/claudeRef'
import { etsyListingUrl } from '@shared/myShop'
import { Badge, Button, Field, Icon, InfoTip, Menu, Segmented, Tooltip, type MenuItem } from '../ui'
import { useStore } from '../store'
import { ExternalLink } from './ExternalLink'

// Listing marks ("В роботі" / "Реалізовано"): the user's own record of which
// example listings they already made their own version of. The card's badge
// and quick menu, and the listing window's "Мітка" block.

type MarkChoice = ListingMarkStatus | 'none'

const CHOICES: ReadonlyArray<{ value: MarkChoice; label: string }> = [
  { value: 'none', label: 'Без мітки' },
  { value: 'in_progress', label: MARK_LABEL.in_progress },
  { value: 'done', label: MARK_LABEL.done }
]

const GLOSSARY_OF: Record<ListingMarkStatus, 'markInProgress' | 'markDone'> = {
  in_progress: 'markInProgress',
  done: 'markDone'
}

/** Who set the mark and when: "Поставив Claude · 25.10.2026, 14:05". */
export function markAuthor(m: ListingMark): string {
  return `${m.source === 'mcp' ? 'Поставив Claude' : 'Поставили ви'} · ${formatDateTime(m.updatedAt)}`
}

/**
 * The mark on the card's photo (bottom-left; "Новий" is top-left, the icons
 * top-right): "✓ Реалізовано" / "В роботі", with the note and our listing in
 * its tooltip. Inside the card button, so the tooltip is hover-only.
 */
export function CardMarkBadge({ mark }: { mark: ListingMark | null | undefined }): JSX.Element | null {
  if (!mark) return null
  const g = GLOSSARY[GLOSSARY_OF[mark.status]]
  const tip = (
    <>
      <div className="ui-tip-term">{g.term}</div>
      <div className="ui-tip-short">{g.short}</div>
      {mark.note && <div className="card-tip-extra mark-tip-note">{mark.note}</div>}
      {mark.ourListingId != null && <div className="card-tip-extra">Наш товар № {mark.ourListingId}</div>}
      <div className="card-tip-extra">{markAuthor(mark)}</div>
    </>
  )
  return (
    <Tooltip content={tip} describe={false}>
      <span className="card-mark-badge" data-testid="card-mark" data-status={mark.status}>
        <Badge tone={mark.status === 'done' ? 'accent' : 'info'} solid icon={mark.status === 'done' ? 'check' : 'clock'}>
          {MARK_LABEL[mark.status]}
        </Badge>
        {mark.note && <span className="sr-only">. Нотатка: {mark.note}</span>}
      </span>
    </Tooltip>
  )
}

/**
 * The card's quick-mark icon (a sibling of the card button in
 * `.listing-card-host`, under the copy-link icon): a menu "Без мітки" /
 * "В роботі" / "Реалізовано" with the current one checked. Shown on hover /
 * focus-within (and while its menu is open).
 */
export function CardMarkMenu({ listing, solo }: { listing: Listing; solo?: boolean }): JSX.Element {
  const setListingMark = useStore((s) => s.setListingMark)
  const setError = useStore((s) => s.setError)
  const current: MarkChoice = listing.mark?.status ?? 'none'
  const choose = (v: MarkChoice): void => {
    if (v === current) return
    void setListingMark(listing.listingId, { status: v }).then((r) => {
      if (!r.ok) setError(r.error)
    })
  }
  const items: MenuItem[] = CHOICES.map((c) => ({
    id: c.value,
    label: c.label,
    checked: c.value === current,
    onSelect: () => choose(c.value)
  }))
  return (
    <span className={`card-mark${solo ? ' card-mark--solo' : ''}`} data-testid="card-mark-menu">
      <Menu
        items={items}
        label={`Мітка товару: ${listing.title}`}
        title={`${GLOSSARY['shop.markMenu'].term} — ${GLOSSARY['shop.markMenu'].short}`}
        trigger={<Icon name="tag" size={14} />}
        buttonClassName={`card-copy-btn card-mark-btn${listing.mark ? ' is-marked' : ''}`}
        align="end"
      />
    </span>
  )
}

/** "Наш товар": an Etsy listing link, an app reference or a bare id → the listing id (null = not one). */
export function parseOurListing(text: string): number | null {
  const t = text.trim()
  if (/^\d{1,20}$/.test(t)) {
    const n = Number(t)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }
  const ref = parseClaudeRef(t)
  return ref && (ref.kind === 'product' || ref.kind === 'photo' || ref.kind === 'video') ? ref.productId : null
}

/**
 * The listing window's "Мітка" block: the mark (Segmented), and once marked a
 * note (saved on leaving the field or with "Зберегти"), "Наш товар" (a link or
 * id, with "Відкрити на Etsy"), "Відкрити чернетку" for the draft made from it,
 * and who set it when.
 */
export function MarkBlock({ listing }: { listing: Listing }): JSX.Element {
  const setListingMark = useStore((s) => s.setListingMark)
  const openDrafts = useStore((s) => s.openDrafts)
  const openListing = useStore((s) => s.openListing)
  const drafts = useStore((s) => s.drafts)
  const mark = listing.mark ?? null
  const [note, setNote] = useState(mark?.note ?? '')
  const [our, setOur] = useState(mark?.ourListingId != null ? String(mark.ourListingId) : '')
  const [error, setError] = useState<string | null>(null)
  const [ourError, setOurError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A change made elsewhere (the card's menu, Claude) shows here.
  useEffect(() => setNote(mark?.note ?? ''), [mark?.note])
  useEffect(() => setOur(mark?.ourListingId != null ? String(mark.ourListingId) : ''), [mark?.ourListingId])

  const save = async (input: Parameters<typeof setListingMark>[1]): Promise<boolean> => {
    setBusy(true)
    const r = await setListingMark(listing.listingId, input)
    setBusy(false)
    setError(r.ok ? null : r.error)
    return r.ok
  }
  const status: MarkChoice = mark?.status ?? 'none'
  const noteDirty = !!mark && note.trim() !== (mark.note ?? '')
  const tooLong = note.trim().length > MARK_NOTE_MAX
  const saveNote = (): void => {
    if (!mark || !noteDirty || tooLong) return
    void save({ status: mark.status, note: note.trim() || null })
  }
  const saveOur = (): void => {
    if (!mark) return
    const t = our.trim()
    const id = t ? parseOurListing(t) : null
    if (t && id == null) {
      setOurError('Не схоже на посилання на товар Etsy чи його номер.')
      return
    }
    setOurError(null)
    if (id === mark.ourListingId) return
    void save({ status: mark.status, ourListingId: id })
  }
  const draft = mark?.ourDraftId != null ? drafts.find((d) => d.id === mark.ourDraftId) : undefined

  return (
    <section className="lm-block lm-mark" aria-label="Мітка" data-testid="mark-block">
      <h3 className="lm-block-title">
        Мітка <InfoTip glossary="mark" size={13} />
      </h3>
      <Segmented
        options={CHOICES}
        value={status}
        onChange={(v) => void save(v === 'none' ? { status: null } : { status: v })}
        label="Мітка товару"
        size="sm"
        disabled={busy}
      />
      {mark && (
        <div className="lm-mark-fields">
          <Field
            label="Нотатка"
            glossary="listing.markNote"
            aside={
              <span className={tooLong ? 'lm-mark-count over' : 'lm-mark-count'}>
                {note.trim().length}/{MARK_NOTE_MAX}
              </span>
            }
            error={tooLong ? `Можна до ${MARK_NOTE_MAX} символів.` : undefined}
          >
            <textarea
              rows={2}
              value={note}
              placeholder="Наприклад: зробили свою версію з іншими кольорами"
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              data-testid="mark-note"
            />
          </Field>
          {noteDirty && (
            <div className="lm-mark-actions">
              <Button size="sm" variant="primary" onClick={saveNote} disabled={tooLong} busy={busy}>
                Зберегти
              </Button>
            </div>
          )}
          <Field label="Наш товар" glossary="listing.ourListing" error={ourError ?? undefined}>
            <input
              value={our}
              placeholder="Посилання на ваш товар на Etsy або його номер"
              onChange={(e) => setOur(e.target.value)}
              onBlur={saveOur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveOur()
              }}
              data-testid="mark-our-listing"
            />
          </Field>
          <div className="lm-mark-actions">
            {mark.ourListingId != null && (
              <ExternalLink href={etsyListingUrl(mark.ourListingId)} className="ext-link" icon>
                Відкрити наш товар на Etsy
              </ExternalLink>
            )}
            {draft && (
              <Button
                size="sm"
                icon="draft"
                tooltip="Закриє це вікно й відкриє чернетку, зроблену за цим прикладом"
                onClick={() => {
                  // The drafts window sits under the listing window: close this one first.
                  openListing(null)
                  openDrafts({ draftId: draft.id })
                }}
                data-testid="mark-open-draft"
              >
                Відкрити чернетку
              </Button>
            )}
            <span className="lm-mark-meta" data-testid="mark-meta">
              {markAuthor(mark)}
            </span>
          </div>
        </div>
      )}
      {error && (
        <p className="lm-mark-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
