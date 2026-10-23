// "Персоналізація": the listing's personalization questions — edit, add,
// remove, save (replaces them all on Etsy: a save that drops saved questions
// asks first); "Прибрати персоналізацію" asks first.

import { useEffect, useState } from 'react'
import {
  DROPDOWN_LABEL_MAX,
  MAX_QUESTIONS,
  PERSONALIZATION_TYPES,
  type PersonalizationQuestion,
  type PersonalizationType,
  QUESTION_TEXT_MAX,
  UPLOAD_LABEL_MAX,
  newQuestion,
  personalizationProblems
} from '@shared/features/listingMeta'
import type { MyListing } from '@shared/types'
import { useStore } from '../../store'
import { featureCall } from '../call'

const numOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(',', '.')))
const isUpload = (t: PersonalizationType): boolean => t === 'unlabeled_upload' || t === 'labeled_upload'
const hasOptions = (t: PersonalizationType): boolean => t === 'dropdown' || t === 'labeled_upload'

/** A type change drops what the new type doesn't allow (and an unsupported Etsy type). */
function withType({ unsupportedType: _u, ...q }: PersonalizationQuestion, type: PersonalizationType): PersonalizationQuestion {
  return {
    ...q,
    type,
    instructions: type === 'dropdown' ? null : q.instructions,
    maxChars: type === 'text_input' ? q.maxChars : null,
    maxFiles: isUpload(type) ? q.maxFiles : null,
    options: hasOptions(type) ? q.options : [],
    addOnPrice: type === 'text_input' ? q.addOnPrice : null
  }
}

function QuestionEditor({
  index,
  q,
  onChange,
  onRemove
}: {
  index: number
  q: PersonalizationQuestion
  onChange: (q: PersonalizationQuestion) => void
  onRemove: () => void
}): JSX.Element {
  const id = `lm-q${index}`
  const set = (patch: Partial<PersonalizationQuestion>): void => onChange({ ...q, ...patch })
  const labelMax = q.type === 'dropdown' ? DROPDOWN_LABEL_MAX : UPLOAD_LABEL_MAX
  return (
    <fieldset className="lm-question" data-testid={id}>
      <legend>Питання {index + 1}</legend>
      {q.unsupportedType && (
        <div className="hint warn">
          Тип «{q.unsupportedType}» цей редактор не підтримує. Щоб не змінити питання ненароком, зберегти можна лише після вибору
          іншого типу або видалення питання.
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-text`}>
          Текст питання ({q.text.trim().length}/{QUESTION_TEXT_MAX})
        </label>
        <input id={`${id}-text`} value={q.text} onChange={(e) => set({ text: e.target.value })} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-type`}>Тип</label>
          <select
            id={`${id}-type`}
            value={q.unsupportedType ? '' : q.type}
            onChange={(e) => onChange(withType(q, e.target.value as PersonalizationType))}
          >
            {q.unsupportedType && (
              <option value="" disabled>
                {q.unsupportedType} (не підтримується)
              </option>
            )}
            {PERSONALIZATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {q.type === 'text_input' && (
          <div className="field">
            <label htmlFor={`${id}-chars`}>Максимум символів</label>
            <input
              id={`${id}-chars`}
              inputMode="numeric"
              value={q.maxChars ?? ''}
              onChange={(e) => set({ maxChars: numOrNull(e.target.value) })}
            />
          </div>
        )}
        {isUpload(q.type) && (
          <div className="field">
            <label htmlFor={`${id}-files`}>Максимум файлів</label>
            <input
              id={`${id}-files`}
              inputMode="numeric"
              value={q.maxFiles ?? ''}
              onChange={(e) => set({ maxFiles: numOrNull(e.target.value) })}
            />
          </div>
        )}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={q.required}
          onChange={(e) => set({ required: e.target.checked, addOnPrice: e.target.checked ? null : q.addOnPrice })}
        />
        Обов’язкове
      </label>
      {q.type !== 'dropdown' && (
        <div className="field">
          <label htmlFor={`${id}-instr`}>Інструкції для покупця (необов’язково)</label>
          <textarea
            id={`${id}-instr`}
            rows={2}
            value={q.instructions ?? ''}
            onChange={(e) => set({ instructions: e.target.value || null })}
          />
        </div>
      )}
      {q.type === 'text_input' && !q.required && (
        <div className="field">
          <label htmlFor={`${id}-price`}>Доплата{q.addOnCurrency ? `, ${q.addOnCurrency}` : ''} (необов’язково)</label>
          <input
            id={`${id}-price`}
            inputMode="decimal"
            value={q.addOnPrice ?? ''}
            onChange={(e) => set({ addOnPrice: numOrNull(e.target.value) })}
          />
        </div>
      )}
      {hasOptions(q.type) && (
        <div className="field">
          <label>{q.type === 'dropdown' ? 'Варіанти' : 'Підписи файлів'} (до {labelMax} символів)</label>
          <ol className="lm-options">
            {q.options.map((o, i) => (
              <li key={i}>
                <input
                  aria-label={`Варіант ${i + 1}`}
                  value={o.label}
                  onChange={(e) => set({ options: q.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                />
                <button
                  className="btn small"
                  aria-label={`Прибрати варіант ${i + 1}`}
                  onClick={() => set({ options: q.options.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <button className="btn small" onClick={() => set({ options: [...q.options, { id: null, label: '' }] })}>
            ＋ Варіант
          </button>
        </div>
      )}
      <button className="btn small" onClick={onRemove}>
        Видалити питання
      </button>
    </fieldset>
  )
}

const droppedText = (n: number): string =>
  n === 1 ? '1 збережене питання' : n < 5 ? `${n} збережені питання` : `${n} збережених питань`

export function PersonalizationSection({ listing }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const requestConfirm = useStore((s) => s.requestConfirm)
  const [saved, setSaved] = useState<PersonalizationQuestion[] | null>(null)
  const [qs, setQs] = useState<PersonalizationQuestion[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const listingId = listing.listingId

  useEffect(() => {
    let alive = true
    void featureCall<PersonalizationQuestion[]>('listingMeta', 'personalization', { listingId }).then((r) => {
      if (!alive) return
      if (!r.ok) return setLoadError(r.error)
      setSaved(r.value)
      setQs(r.value)
    })
    return () => {
      alive = false
    }
  }, [listingId])

  if (loadError) {
    return (
      <div className="test-result err" role="alert">
        {loadError}
      </div>
    )
  }
  if (!saved) return <div className="hint">Завантаження…</div>

  const dirty = JSON.stringify(qs) !== JSON.stringify(saved)
  const problems = dirty ? personalizationProblems(qs) : []
  const edit = (next: PersonalizationQuestion[]): void => {
    setQs(next)
    setNote(null)
  }

  async function save(): Promise<void> {
    const dropped = (saved ?? []).filter((s) => s.id != null && !qs.some((q) => q.id === s.id))
    if (
      dropped.length &&
      !(await requestConfirm(
        `Зберегти персоналізацію? Etsy замінить усі питання — ${droppedText(dropped.length)} буде видалено: ${dropped
          .map((d) => `«${d.text}»`)
          .join(', ')}.`
      ))
    ) {
      return
    }
    setBusy(true)
    setError(null)
    const r = await featureCall<PersonalizationQuestion[]>('listingMeta', 'savePersonalization', { listingId, questions: qs })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setSaved(r.value)
    setQs(r.value)
    setNote('Персоналізацію збережено на Etsy.')
  }

  async function removeAll(): Promise<void> {
    if (!(await requestConfirm('Прибрати всю персоналізацію цього лістингу на Etsy? Покупці більше не зможуть нічого вказати.'))) return
    setBusy(true)
    setError(null)
    const r = await featureCall('listingMeta', 'removePersonalization', { listingId })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setSaved([])
    setQs([])
    setNote('Персоналізацію прибрано.')
  }

  return (
    <div data-testid="lm-personalization">
      {qs.length === 0 && (
        <div className="hint">
          {saved.length
            ? 'Усі питання прибрано з форми — щоб прибрати їх і на Etsy, натисніть «Прибрати персоналізацію».'
            : 'Персоналізації немає — покупця ні про що не питають.'}
        </div>
      )}
      {qs.map((q, i) => (
        <QuestionEditor
          key={i}
          index={i}
          q={q}
          onChange={(nq) => edit(qs.map((x, j) => (j === i ? nq : x)))}
          onRemove={() => edit(qs.filter((_, j) => j !== i))}
        />
      ))}
      {problems.length > 0 && qs.length > 0 && (
        <div className="hint warn">
          <ul className="plain-list">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="settings-actions">
        <button className="btn small" disabled={qs.length >= MAX_QUESTIONS} onClick={() => edit([...qs, newQuestion()])}>
          ＋ Додати питання
        </button>
        <button
          className="btn small primary"
          disabled={busy || !dirty || qs.length === 0 || problems.length > 0}
          onClick={() => void save()}
        >
          Зберегти персоналізацію
        </button>
        {saved.length > 0 && (
          <button className="btn small danger" disabled={busy} onClick={() => void removeAll()}>
            Прибрати персоналізацію
          </button>
        )}
      </div>
      {error && (
        <div className="test-result err" role="alert">
          {error}
        </div>
      )}
      {note && <div className="test-result ok">{note}</div>}
    </div>
  )
}
