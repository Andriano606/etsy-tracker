// "Обробка" (Мій магазин): processing profiles (readiness state definitions) —
// how long an order takes to get ready, and whether the item is already made.

import { useState } from 'react'
import { daysText, READINESS_LABEL, type ProcessingProfile, type ReadinessState } from '@shared/features/shopConfig'
import { Badge, Button, EmptyState, Loading, Segmented } from '../../ui'
import { TextField, useChange, useLoad, type Change } from './common'
import { Card, ChoiceCards, DataTable, ErrorNote, Intro, Note, Status, Step, Td } from './kit'

type Unit = 'days' | 'weeks'

const daysInput = (n: number | null | undefined): string => (n != null ? String(n) : '')

const plural = (n: number, one: string, few: string, many: string): string => {
  const t = n % 100
  const u = n % 10
  return u === 1 && t !== 11 ? one : u >= 2 && u <= 4 && (t < 12 || t > 14) ? few : many
}

/** Etsy's own display text ("1-3 business days", "2-3 weeks") in Ukrainian; anything else as Etsy wrote it. */
export function etsyTimeLabel(label: string): string {
  const m = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s+(business days?|days?|weeks?)\s*$/i.exec(label)
  if (!m) return label
  const n = Number(m[2] ?? m[1])
  const range = m[2] ? `${m[1]}–${m[2]}` : m[1]
  const unit = m[3].toLowerCase()
  const word = unit.startsWith('business')
    ? plural(n, 'робочий день', 'робочі дні', 'робочих днів')
    : unit.startsWith('week')
      ? plural(n, 'тиждень', 'тижні', 'тижнів')
      : plural(n, 'день', 'дні', 'днів')
  return `${range} ${word}`
}

/** A profile's name in a question or a button's name: its time as buyers see it. */
const profileName = (p: ProcessingProfile): string => (p.label ? etsyTimeLabel(p.label) : daysText(p.minDays, p.maxDays))

/** What each readiness state means, in plain words. */
export const READINESS_DESC: Record<ReadinessState, string> = {
  ready_to_ship: 'Товар уже зроблений і лежить у вас. Після покупки лишається запакувати й відправити — зазвичай 1–3 дні.',
  made_to_order: 'Ви виготовляєте товар після покупки (друк, шиття, гравіювання). Строк довший — вкажіть чесний.'
}

/** Why the typed processing time can't be sent (null = it can): whole numbers 1–10, "від" ≤ "до". */
export function processingTimeError(min: string, max: string): string | null {
  const a = min.trim()
  const b = max.trim()
  if (!a || !b) return 'Вкажіть строк: від скількох і до скількох днів чи тижнів.'
  const ok = (v: string): boolean => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 10
  if (!ok(a) || !ok(b)) return 'Строк — ціле число від 1 до 10.'
  if (Number(a) > Number(b)) return '«Від» не може бути більше, ніж «До».'
  return null
}

/**
 * The request body: everything for a new profile; for an edit only what the
 * user changed — Etsy reports the current time in days only (whatever unit it
 * was made in), so the time and its unit go only when the user touched them.
 */
function processingInput(
  profile: ProcessingProfile | null,
  v: { state: ReadinessState; min: string; max: string; unit: Unit }
): Record<string, string> {
  const time = { min_processing_time: v.min, max_processing_time: v.max, processing_time_unit: v.unit }
  if (!profile) return { readiness_state: v.state, ...time }
  const timeChanged = v.min !== daysInput(profile.minDays) || v.max !== daysInput(profile.maxDays) || v.unit !== 'days'
  return {
    ...(v.state !== profile.readinessState ? { readiness_state: v.state } : {}),
    ...(timeChanged ? time : {})
  }
}

function ProcessingForm({
  profile,
  onSaved,
  onCancel
}: {
  profile: ProcessingProfile | null
  onSaved: (note: string) => void
  onCancel: () => void
}): JSX.Element {
  const [state, setState] = useState<ReadinessState>(profile?.readinessState ?? 'made_to_order')
  const [min, setMin] = useState(daysInput(profile?.minDays))
  const [max, setMax] = useState(daysInput(profile?.maxDays))
  const [unit, setUnit] = useState<Unit>('days')
  const ch = useChange()
  const input = processingInput(profile, { state, min, max, unit })
  // A new profile always sends its time; an edit only when the time was touched.
  const timeError = !profile || 'min_processing_time' in input ? processingTimeError(min, max) : null
  const save = async (): Promise<void> => {
    const what = `${READINESS_LABEL[state]}, ${min}–${max} ${unit === 'weeks' ? 'тиж.' : 'дн.'}`
    const change: Change = profile
      ? {
          confirmLabel: 'Зберегти профіль',
          confirm: `Зберегти профіль підготовки (${what})?\nНовий строк одразу побачать покупці всіх товарів із цим профілем.`,
          action: 'updateProcessingProfile',
          args: { id: profile.id, input },
          done: 'Профіль обробки збережено.'
        }
      : {
          confirmLabel: 'Створити профіль',
          confirm: `Створити профіль підготовки (${what})?`,
          action: 'createProcessingProfile',
          args: { input },
          done: 'Профіль обробки створено.'
        }
    if (await ch.run<ProcessingProfile>(change)) onSaved(change.done)
  }
  return (
    <Card
      tone="form"
      testId="sc-processing-form" reveal
      title={profile ? 'Змінити профіль підготовки' : 'Новий профіль підготовки'}
      footer={
        <>
          <Button variant="primary" busy={ch.busy} disabled={Object.keys(input).length === 0 || timeError != null} onClick={() => void save()}>
            {profile ? 'Зберегти' : 'Створити'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Скасувати
          </Button>
        </>
      }
    >
      <Step n={1} title="Товар уже готовий чи ви робите його після покупки?">
        <ChoiceCards
          label="Тип"
          value={state}
          onChange={setState}
          options={(Object.keys(READINESS_LABEL) as ReadinessState[]).map((k) => ({
            value: k,
            label: READINESS_LABEL[k],
            icon: k === 'ready_to_ship' ? 'box' : 'sparkle',
            desc: READINESS_DESC[k]
          }))}
        />
      </Step>
      <Step n={2} title="Скільки часу потрібно до відправлення?" glossary="processingTime" desc="Від оплати до моменту, коли посилка у пошти. Час доставки сюди не входить.">
        <div className="ui-form-grid fx-grid-3">
          <TextField label="Від" type="number" aside="1–10" value={min} onChange={setMin} />
          <TextField label="До" type="number" aside="1–10" value={max} onChange={setMax} />
          <div className="ui-field">
            <div className="ui-field-head">
              <span className="ui-field-label" aria-hidden="true">
                Одиниця
              </span>
            </div>
            <Segmented
              label="Одиниця"
              fullWidth
              value={unit}
              onChange={setUnit}
              options={[
                { value: 'days', label: 'робочі дні' },
                { value: 'weeks', label: 'тижні' }
              ]}
            />
          </div>
        </div>
        {timeError && (
          <p className="fx-field-error" role="status" data-testid="processing-time-error">
            {timeError}
          </p>
        )}
      </Step>
      {profile && (
        <Note>
          Etsy повертає поточний строк лише в днях{profile.label ? ` («${etsyTimeLabel(profile.label)}»)` : ''}, навіть якщо профіль створено в тижнях. Тому строк
          надсилається, лише якщо ви його зміните; для тижнів виберіть «тижні» і введіть 1–10.
        </Note>
      )}
      <Status error={ch.error} note={ch.note} />
    </Card>
  )
}

export function ProcessingTab(): JSX.Element {
  const list = useLoad<ProcessingProfile[]>('processingProfiles')
  const [editing, setEditing] = useState<ProcessingProfile | 'new' | null>(null)
  const ch = useChange()
  const remove = async (p: ProcessingProfile): Promise<void> => {
    const r = await ch.run({
      confirmLabel: 'Видалити профіль',
      danger: true,
      confirm: `Видалити профіль підготовки «${profileName(p)}»?\nEtsy відмовить, якщо його використовують активні товари — спершу перенесіть їх на інший профіль.`,
      action: 'deleteProcessingProfile',
      args: { id: p.id },
      done: 'Профіль обробки видалено.'
    })
    if (r) list.reload()
  }
  const saved = (note: string): void => {
    setEditing(null)
    ch.notify(note)
    list.reload()
  }
  return (
    <div className="fx-page" data-testid="sc-processing">
      <Intro
        title="Час на підготовку"
        glossary="processingProfile"
        icon="clock"
        action={
          !editing && (
            <Button icon="plus" onClick={() => setEditing('new')}>
              Новий профіль підготовки
            </Button>
          )
        }
      >
        Скільки днів вам потрібно, щоб підготувати замовлення до відправлення. Кожен фізичний товар використовує один із цих профілів, а Etsy за
        ним показує покупцю, коли чекати посилку.
      </Intro>
      <ErrorNote error={list.error} title="Не вдалося завантажити профілі" />
      {!list.value && !list.error && <Loading>Завантаження профілів…</Loading>}
      {list.value && list.value.length === 0 && !editing && (
        <EmptyState
          compact
          icon="clock"
          title="Профілів обробки ще немає."
          action={
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              Створити профіль
            </Button>
          }
        >
          Створіть хоча б один, щоб указувати строк підготовки у фізичних товарах.
        </EmptyState>
      )}
      {list.value && list.value.length > 0 && (
        <DataTable
          label="Профілі підготовки"
          columns={[
            { label: 'Тип', info: 'Готовий товар відправляється швидко; товар на замовлення ви спершу виготовляєте.' },
            { label: 'Строк', glossary: 'processingTime' },
            { label: 'Як бачать покупці', glossary: 'features.shopConfig.buyerSees' },
            { label: 'Дії', srOnly: true }
          ]}
        >
          {list.value.map((p) => (
            <tr key={p.id}>
              <Td label="Тип" primary>
                {p.readinessState ? (
                  <Badge tone={p.readinessState === 'ready_to_ship' ? 'accent' : 'info'} icon={p.readinessState === 'ready_to_ship' ? 'box' : 'sparkle'}>
                    {READINESS_LABEL[p.readinessState]}
                  </Badge>
                ) : (
                  '—'
                )}
              </Td>
              <Td label="Строк">
                <span className="num">{daysText(p.minDays, p.maxDays)}</span>
              </Td>
              <Td label="Як бачать покупці">
                {p.label ? <span title={`Etsy пише англійською: «${p.label}»`}>{etsyTimeLabel(p.label)}</span> : '—'}
              </Td>
              <Td label="Дії" actions>
                <Button size="sm" icon="edit" aria-label={`Змінити профіль підготовки «${profileName(p)}»`} onClick={() => setEditing(p)}>
                  Змінити
                </Button>
                <Button size="sm" variant="danger" icon="trash" aria-label={`Видалити профіль підготовки «${profileName(p)}»`} disabled={ch.busy} onClick={() => void remove(p)}>
                  Видалити
                </Button>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Status error={ch.error} note={ch.note} />
      {editing && (
        <ProcessingForm
          key={editing === 'new' ? 'new' : editing.id}
          profile={editing === 'new' ? null : editing}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}
