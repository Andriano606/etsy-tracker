// "Розділи" (Мій магазин) and the own listing's "Розділ магазину" section.

import { useState } from 'react'
import type { ListingSectionInfo, ShopSection } from '@shared/features/shopConfig'
import type { MyListing } from '@shared/types'
import { Button, EmptyState, Field, Loading, Select } from '../../ui'
import { useChange, useLoad } from './common'
import { Card, DataTable, ErrorNote, Intro, Note, Status, Td } from './kit'

type ChangeState = ReturnType<typeof useChange>

function SectionRow({ s, ch, onChanged }: { s: ShopSection; ch: ChangeState; onChanged: () => void }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(s.title)
  const rename = async (): Promise<void> => {
    const r = await ch.run<ShopSection>({
      confirmLabel: 'Перейменувати',
      confirm: `Перейменувати розділ «${s.title}» на «${title.trim()}»? Покупці побачать нову назву на сторінці магазину.`,
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
      confirmLabel: 'Видалити розділ',
      danger: true,
      confirm: `Видалити розділ «${s.title}»?\nЙого товари залишаться в магазині, просто без розділу.`,
      action: 'deleteSection',
      args: { sectionId: s.id },
      done: 'Розділ видалено.'
    })
    if (r) onChanged()
  }
  return (
    <tr>
      <Td label="Розділ" primary>
        {editing ? (
          <input
            aria-label="Нова назва розділу"
            className="fx-inline-input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(false)
                setTitle(s.title)
              }
            }}
          />
        ) : (
          <span className="clamp-2 fx-title" title={s.title}>
            {s.title}
          </span>
        )}
      </Td>
      <Td label="Активних товарів" align="end">
        <span className="num">{s.activeListingCount ?? '—'}</span>
      </Td>
      <Td label="Дії" actions>
        {editing ? (
          <>
            <Button size="sm" variant="primary" disabled={ch.busy || !title.trim() || title.trim() === s.title} onClick={() => void rename()}>
              Зберегти
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false)
                setTitle(s.title)
              }}
            >
              Скасувати
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" icon="edit" aria-label={`Перейменувати розділ «${s.title}»`} onClick={() => setEditing(true)}>
              Перейменувати
            </Button>
            <Button size="sm" variant="danger" icon="trash" aria-label={`Видалити розділ «${s.title}»`} disabled={ch.busy} onClick={() => void remove()}>
              Видалити
            </Button>
          </>
        )}
      </Td>
    </tr>
  )
}

export function SectionsTab(): JSX.Element {
  const list = useLoad<ShopSection[]>('sections')
  const [title, setTitle] = useState('')
  const ch = useChange()
  const add = async (): Promise<void> => {
    const r = await ch.run<ShopSection>({
      confirmLabel: 'Створити розділ',
      confirm: `Створити розділ «${title.trim()}»? Покупці побачать його на сторінці магазину, щойно в ньому з’являться товари.`,
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
    <div className="fx-page" data-testid="sc-sections">
      <Intro title="Розділи магазину" glossary="section" icon="folder">
        Розділи — це полиці вашого магазину: покупці бачать їх зліва на сторінці магазину і можуть швидко знайти потрібне. У який розділ потрапляє
        товар, вибирається в «Товари → Редагувати → Розділ магазину».
      </Intro>
      <ErrorNote error={list.error} title="Не вдалося завантажити розділи" />
      {!list.value && !list.error && <Loading>Завантаження розділів…</Loading>}
      {list.value && list.value.length === 0 && (
        <EmptyState compact icon="folder" title="Розділів ще немає.">
          Додайте перший розділ нижче — наприклад, «Планери» чи «Подарунки».
        </EmptyState>
      )}
      {list.value && list.value.length > 0 && (
        <DataTable
          label="Розділи магазину"
          stack="sm"
          columns={[
            { label: 'Розділ' },
            { label: 'Активних товарів', glossary: 'features.shopConfig.activeInSection', align: 'end' },
            { label: 'Дії', srOnly: true }
          ]}
        >
          {list.value.map((s) => (
            <SectionRow key={s.id} s={s} ch={ch} onChanged={list.reload} />
          ))}
        </DataTable>
      )}
      <Status error={ch.error} note={ch.note} />
      <Card tone="form">
        <form
          className="fx-inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!ch.busy && title.trim()) void add()
          }}
        >
          <Field label="Новий розділ" hint="Коротка назва, яку побачать покупці на сторінці магазину.">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Наприклад, «Планери на рік»" />
          </Field>
          <Button type="submit" variant="primary" icon="plus" disabled={ch.busy || !title.trim()}>
            Додати розділ
          </Button>
        </form>
      </Card>
    </div>
  )
}

/** Мій магазин → Лістинги → Редагувати → "Розділ магазину". */
export function ListingSectionPanel({ listing, onChanged }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const info = useLoad<ListingSectionInfo>('listingSection', { listingId: listing.listingId }, String(listing.listingId))
  const [choice, setChoice] = useState<string | null>(null)
  const ch = useChange()
  if (info.error) return <ErrorNote error={info.error} title="Не вдалося завантажити розділи" />
  if (!info.value) return <Loading>Завантаження розділів…</Loading>
  const { sections, sectionId, known } = info.value
  const current = known ? String(sectionId ?? 0) : ''
  const selected = choice ?? current
  const nameOf = (id: string): string => (id === '0' ? 'без розділу' : `«${sections.find((s) => String(s.id) === id)?.title ?? id}»`)
  const save = async (): Promise<void> => {
    const l = await ch.run<MyListing>({
      confirmLabel: 'Перенести товар',
      confirm: `Перенести товар «${listing.title}» ${selected === '0' ? 'у «без розділу»' : `у розділ ${nameOf(selected)}`}? На сторінці магазину він з’явиться в новому розділі.`,
      action: 'setListingSection',
      args: { listingId: listing.listingId, sectionId: Number(selected) },
      done: 'Розділ товару збережено.'
    })
    if (l) {
      onChanged(l.value)
      info.reload()
      setChoice(null)
    }
  }
  return (
    <div className="fx-page fx-page--compact" data-testid="sc-listing-section">
      {!known && <Note tone="warn">Поточний розділ невідомий: Etsy не віддає цей товар публічно (наприклад, це чернетка). Виберіть розділ нижче.</Note>}
      <div className="fx-inline-form">
        <Field label="Розділ" glossary="section" hint={sections.length === 0 ? 'У магазині ще немає розділів — створіть їх у вкладці «Розділи».' : 'На якій полиці магазину покупці знайдуть цей товар.'}>
          <Select value={selected} onChange={setChoice}>
            {!known && <option value="">— виберіть —</option>}
            <option value="0">Без розділу</option>
            {sections.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.title}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" disabled={ch.busy || selected === '' || selected === current} busy={ch.busy} onClick={() => void save()}>
          Зберегти розділ
        </Button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}
