// "Обробка" (Мій магазин): processing profiles (readiness state definitions).

import { useState } from 'react'
import { daysText, READINESS_LABEL, type ProcessingProfile, type ReadinessState } from '@shared/features/shopConfig'
import { ErrorNote, Loading, Status, TextField, useChange, useLoad, type Change } from './common'

type Unit = 'days' | 'weeks'

const daysInput = (n: number | null | undefined): string => (n != null ? String(n) : '')

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
  const save = async (): Promise<void> => {
    const what = `${READINESS_LABEL[state]}, ${min}–${max} ${unit === 'weeks' ? 'тиж.' : 'дн.'}`
    const change: Change = profile
      ? {
          confirm: `Зберегти профіль обробки (${what})? Строк зміниться в усіх лістингах із цим профілем.`,
          action: 'updateProcessingProfile',
          args: { id: profile.id, input },
          done: 'Профіль обробки збережено.'
        }
      : {
          confirm: `Створити профіль обробки (${what})?`,
          action: 'createProcessingProfile',
          args: { input },
          done: 'Профіль обробки створено.'
        }
    if (await ch.run<ProcessingProfile>(change)) onSaved(change.done)
  }
  return (
    <div className="sc-form" data-testid="sc-processing-form">
      <h4>{profile ? 'Змінити профіль обробки' : 'Новий профіль обробки'}</h4>
      <div className="radio-row" role="radiogroup" aria-label="Тип">
        {(Object.keys(READINESS_LABEL) as ReadinessState[]).map((k) => (
          <label key={k}>
            <input type="radio" name={`ready-${profile?.id ?? 'new'}`} checked={state === k} onChange={() => setState(k)} /> {READINESS_LABEL[k]}
          </label>
        ))}
      </div>
      <div className="field-row">
        <TextField label="Мін. (1–10)" type="number" value={min} onChange={setMin} />
        <TextField label="Макс. (1–10)" type="number" value={max} onChange={setMax} />
        <div className="field">
          <label>
            Одиниця
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              <option value="days">дні</option>
              <option value="weeks">тижні</option>
            </select>
          </label>
        </div>
      </div>
      {profile && (
        <div className="hint">
          Etsy показує поточний строк у днях{profile.label ? ` («${profile.label}»)` : ''}, навіть якщо профіль створено в тижнях. Строк
          надсилається, лише якщо ви його зміните; для тижнів виберіть «тижні» і введіть 1–10.
        </div>
      )}
      <div className="settings-actions">
        <button className="btn primary" disabled={ch.busy || Object.keys(input).length === 0} onClick={() => void save()}>
          {profile ? 'Зберегти' : 'Створити'}
        </button>
        <button className="btn" onClick={onCancel}>
          Скасувати
        </button>
      </div>
      <Status error={ch.error} note={ch.note} />
    </div>
  )
}

export function ProcessingTab(): JSX.Element {
  const list = useLoad<ProcessingProfile[]>('processingProfiles')
  const [editing, setEditing] = useState<ProcessingProfile | 'new' | null>(null)
  const ch = useChange()
  const remove = async (p: ProcessingProfile): Promise<void> => {
    const r = await ch.run({
      confirm: `Видалити профіль обробки «${p.label ?? daysText(p.minDays, p.maxDays)}»? Etsy відмовить, якщо його використовують активні лістинги.`,
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
    <div data-testid="sc-processing">
      <p className="hint">Скільки часу потрібно, щоб підготувати товар до відправлення. Фізичні лістинги використовують один із цих профілів.</p>
      <ErrorNote error={list.error} />
      {!list.value && !list.error && <Loading />}
      {list.value && list.value.length === 0 && <div className="hint">Профілів обробки ще немає.</div>}
      {list.value && list.value.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Тип</th>
              <th>Строк</th>
              <th>Як бачать покупці</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.value.map((p) => (
              <tr key={p.id}>
                <td>{p.readinessState ? READINESS_LABEL[p.readinessState] : '—'}</td>
                <td>{daysText(p.minDays, p.maxDays)}</td>
                <td>{p.label ?? '—'}</td>
                <td className="sc-actions">
                  <button className="btn small" onClick={() => setEditing(p)}>
                    Змінити
                  </button>
                  <button className="btn small danger" disabled={ch.busy} onClick={() => void remove(p)}>
                    Видалити
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Status error={ch.error} note={ch.note} />
      {editing ? (
        <ProcessingForm
          key={editing === 'new' ? 'new' : editing.id}
          profile={editing === 'new' ? null : editing}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div className="settings-actions">
          <button className="btn" onClick={() => setEditing('new')}>
            ＋ Новий профіль обробки
          </button>
        </div>
      )}
    </div>
  )
}
