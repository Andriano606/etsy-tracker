// "Розділи" (Мій магазин) and the own listing's "Розділ магазину" section.

import { useState } from 'react'
import type { ListingSectionInfo, ShopSection } from '@shared/features/shopConfig'
import type { MyListing } from '@shared/types'
import { ErrorNote, Loading, Status, useChange, useLoad } from './common'

type ChangeState = ReturnType<typeof useChange>

function SectionRow({ s, ch, onChanged }: { s: ShopSection; ch: ChangeState; onChanged: () => void }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(s.title)
  const rename = async (): Promise<void> => {
    const r = await ch.run<ShopSection>({
      confirm: `Перейменувати розділ «${s.title}» на «${title.trim()}»? Покупці побачать нову назву.`,
      action: 'updateSection',
      args: { sectionId: s.id, input: { title } },
      done: 'Розділ перейменовано.'
    })
    if (r) {
      setEditing(false)
      onChanged()
    }
  }
  const remove = async (): Promise<void> => {
    const r = await ch.run({
      confirm: `Видалити розділ «${s.title}»? Його лістинги залишаться в магазині, але без розділу.`,
      action: 'deleteSection',
      args: { sectionId: s.id },
      done: 'Розділ видалено.'
    })
    if (r) onChanged()
  }
  return (
    <tr>
      <td>
        {editing ? (
          <input aria-label="Нова назва розділу" value={title} onChange={(e) => setTitle(e.target.value)} />
        ) : (
          s.title
        )}
      </td>
      <td>{s.activeListingCount ?? '—'}</td>
      <td className="sc-actions">
        {editing ? (
          <>
            <button className="btn small primary" disabled={ch.busy || !title.trim() || title.trim() === s.title} onClick={() => void rename()}>
              Зберегти
            </button>
            <button className="btn small" onClick={() => setEditing(false)}>
              Скасувати
            </button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={() => setEditing(true)}>
              Перейменувати
            </button>
            <button className="btn small danger" disabled={ch.busy} onClick={() => void remove()}>
              Видалити
            </button>
          </>
        )}
      </td>
    </tr>
  )
}

export function SectionsTab(): JSX.Element {
  const list = useLoad<ShopSection[]>('sections')
  const [title, setTitle] = useState('')
  const ch = useChange()
  const add = async (): Promise<void> => {
    const r = await ch.run<ShopSection>({
      confirm: `Створити розділ «${title.trim()}» у магазині? Покупці бачать розділи на сторінці магазину.`,
      action: 'createSection',
      args: { input: { title } },
      done: 'Розділ створено.'
    })
    if (r) {
      setTitle('')
      list.reload()
    }
  }
  return (
    <div data-testid="sc-sections">
      <p className="hint">Розділи групують лістинги на сторінці магазину. Розділ лістингу змінюється в «Лістинги → Редагувати → Розділ магазину».</p>
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && <div className="hint">Розділів ще немає.</div>}
      {list.value && list.value.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Розділ</th>
              <th>Активних лістингів</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.value.map((s) => (
              <SectionRow key={s.id} s={s} ch={ch} onChanged={list.reload} />
            ))}
          </tbody>
        </table>
      )}
      <div className="field-row sc-add">
        <div className="field">
          <label>
            Новий розділ
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Назва розділу" />
          </label>
        </div>
      </div>
      <div className="settings-actions">
        <button className="btn primary" disabled={ch.busy || !title.trim()} onClick={() => void add()}>
          Додати розділ
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

/** Мій магазин → Лістинги → Редагувати → "Розділ магазину". */
export function ListingSectionPanel({ listing, onChanged }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const info = useLoad<ListingSectionInfo>('listingSection', { listingId: listing.listingId }, String(listing.listingId))
  const [choice, setChoice] = useState<string | null>(null)
  const ch = useChange()
  if (info.error) return <ErrorNote error={info.error} />
  if (!info.value) return <Loading />
  const { sections, sectionId, known } = info.value
  const current = known ? String(sectionId ?? 0) : ''
  const selected = choice ?? current
  const nameOf = (id: string): string => (id === '0' ? 'без розділу' : `«${sections.find((s) => String(s.id) === id)?.title ?? id}»`)
  const save = async (): Promise<void> => {
    const l = await ch.run<MyListing>({
      confirm: `Перенести лістинг «${listing.title}» ${selected === '0' ? 'у «без розділу»' : `у розділ ${nameOf(selected)}`}?`,
      action: 'setListingSection',
      args: { listingId: listing.listingId, sectionId: Number(selected) },
      done: 'Розділ лістингу збережено.'
    })
    if (l) {
      onChanged(l.value)
      info.reload()
      setChoice(null)
    }
  }
  return (
    <div data-testid="sc-listing-section">
      {!known && <div className="hint">Поточний розділ невідомий (Etsy не віддав цей лістинг публічно — наприклад, чернетку).</div>}
      <div className="field">
        <label>
          Розділ
          <select value={selected} onChange={(e) => setChoice(e.target.value)}>
            {!known && <option value="">— виберіть —</option>}
            <option value="0">Без розділу</option>
            {sections.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="settings-actions">
        <button className="btn primary" disabled={ch.busy || selected === '' || selected === current} onClick={() => void save()}>
          Зберегти розділ
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}
