// "Персоналізація": the listing's personalization questions — edit, add,
// remove, save (replaces them all on Etsy: a save that drops saved questions
// asks first); "Прибрати персоналізацію" asks first.

import { useEffect, useState, type InputHTMLAttributes } from 'react'
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
import { Badge, Button, Callout, EmptyState, Field, GLOSSARY, InfoTip, Loading, Term, Toggle } from '../../ui'
import { featureCall } from '../call'

const numOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(',', '.')))
/** 2.5 → "2,50" (how prices read everywhere else in the app). */
const priceText = (n: number | null): string => (n == null ? '' : Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : String(n))

/** A money input that keeps what is typed ("2," mid-typing) and reports the number. */
function MoneyInput({
  value,
  onChange,
  ...rest
}: { value: number | null; onChange: (n: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>): JSX.Element {
  const [text, setText] = useState(() => priceText(value))
  return (
    <input
      {...rest}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onChange(numOrNull(e.target.value))
      }}
    />
  )
}
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

/** What the buyer does for each question type (under the type picker). */
const TYPE_HINT: Record<PersonalizationType, string> = {
  text_input: 'Покупець впише текст у поле — наприклад, ім’я чи дату.',
  dropdown: 'Покупець вибере одну відповідь зі списку, який ви задасте нижче.',
  unlabeled_upload: 'Покупець завантажить файли (наприклад, фото для друку).',
  labeled_upload: 'Покупець завантажить файли, кожен під вашим підписом («Фото спереду», «Фото ззаду»).'
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
  // "Варіанти відповіді" of a list vs. the labels of uploads — never "варіант" (that word is for product variants).
  const opt =
    q.type === 'dropdown'
      ? { title: 'Варіанти відповіді', one: 'Відповідь', add: 'Додати відповідь', each: `кожна до ${labelMax} символів` }
      : { title: 'Підписи файлів', one: 'Підпис', add: 'Додати підпис', each: `кожен до ${labelMax} символів` }
  const textLen = q.text.trim().length
  return (
    <fieldset className="lm-question" data-testid={id}>
      <legend className="sr-only">Питання {index + 1}</legend>
      <div className="lm-question-head" aria-hidden="true">
        <span className="lm-question-n num">{index + 1}</span>
        <span className="lm-question-title truncate" title={q.text || undefined}>
          {q.text.trim() || 'Нове питання'}
        </span>
      </div>
      <div className="lm-question-remove">
        <Button size="sm" variant="ghost" icon="trash" onClick={onRemove}>
          Видалити питання
        </Button>
      </div>
      {q.unsupportedType && (
        <Callout tone="warn" role="note" compact>
          Тип «{q.unsupportedType}» цей редактор не підтримує. Щоб не змінити питання ненароком, зберегти можна лише після вибору іншого типу
          або видалення питання.
        </Callout>
      )}
      <div className="ui-form-grid">
        <Field
          label="Текст питання"
          id={`${id}-text`}
          aside={
            <span className={textLen > QUESTION_TEXT_MAX ? 'lm-over' : undefined}>
              {textLen}/{QUESTION_TEXT_MAX}
            </span>
          }
          hint="Що побачить покупець, наприклад «Ім’я для обкладинки»."
        >
          <input value={q.text} onChange={(e) => set({ text: e.target.value })} />
        </Field>
        <Field label="Тип" id={`${id}-type`} glossary="features.listingMeta.questionType" hint={q.unsupportedType ? undefined : TYPE_HINT[q.type]}>
          <select value={q.unsupportedType ? '' : q.type} onChange={(e) => onChange(withType(q, e.target.value as PersonalizationType))}>
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
        </Field>
        {q.type === 'text_input' && (
          <Field label="Максимум символів" id={`${id}-chars`} hint="Порожньо — без обмеження.">
            <input inputMode="numeric" value={q.maxChars ?? ''} onChange={(e) => set({ maxChars: numOrNull(e.target.value) })} />
          </Field>
        )}
        {isUpload(q.type) && (
          <Field label="Максимум файлів" id={`${id}-files`} hint="Скільки файлів покупець може завантажити.">
            <input inputMode="numeric" value={q.maxFiles ?? ''} onChange={(e) => set({ maxFiles: numOrNull(e.target.value) })} />
          </Field>
        )}
        {q.type === 'text_input' && !q.required && (
          <Field label={`Доплата${q.addOnCurrency ? `, ${q.addOnCurrency}` : ''} (необов’язково)`} id={`${id}-price`} glossary="features.compete.addOnPrice">
            <MoneyInput value={q.addOnPrice} onChange={(n) => set({ addOnPrice: n })} />
          </Field>
        )}
      </div>
      {q.type !== 'dropdown' && (
        <Field label="Інструкції для покупця (необов’язково)" id={`${id}-instr`} hint={GLOSSARY['features.listingMeta.instructions'].short}>
          <textarea rows={2} value={q.instructions ?? ''} onChange={(e) => set({ instructions: e.target.value || null })} />
        </Field>
      )}
      {hasOptions(q.type) && (
        <div className="lm-options-box">
          <div className="lm-options-head">
            <span className="lm-options-title">{opt.title}</span>
            <InfoTip glossary="features.listingMeta.answerOptions" size={13} />
            <span className="lm-hint">{opt.each}</span>
          </div>
          {q.options.length > 0 && (
            <ol className="lm-options">
              {q.options.map((o, i) => (
                <li key={i}>
                  <span className="lm-option-n num" aria-hidden="true">
                    {i + 1}.
                  </span>
                  <input
                    aria-label={`${opt.one} ${i + 1} питання ${index + 1}`}
                    value={o.label}
                    onChange={(e) => set({ options: q.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="close"
                    iconOnly
                    label={`Прибрати: ${opt.one.toLowerCase()} ${i + 1}`}
                    onClick={() => set({ options: q.options.filter((_, j) => j !== i) })}
                  />
                </li>
              ))}
            </ol>
          )}
          <Button size="sm" icon="plus" onClick={() => set({ options: [...q.options, { id: null, label: '' }] })}>
            {opt.add}
          </Button>
        </div>
      )}
      <Toggle
        className="lm-required"
        switchFirst
        label="Обов’язкове"
        glossary="features.listingMeta.requiredQuestion"
        hint={q.type === 'text_input' ? 'Обов’язкове питання не може мати доплати.' : undefined}
        checked={q.required}
        onChange={(c) => set({ required: c, addOnPrice: c ? null : q.addOnPrice })}
      />
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
  const [attempt, setAttempt] = useState(0)
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
  }, [listingId, attempt])

  if (loadError) {
    return (
      <Callout
        tone="error"
        action={
          <Button size="sm" icon="refresh" onClick={() => {
              setLoadError(null)
              setAttempt((n) => n + 1)
            }}>
            Спробувати ще
          </Button>
        }
      >
        {loadError}
      </Callout>
    )
  }
  if (!saved) return <Loading>Завантаження персоналізації…</Loading>

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
    if (!(await requestConfirm('Прибрати всю персоналізацію цього товару на Etsy? Покупці більше не зможуть нічого вказати.'))) return
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
    <div className="lm-section" data-testid="lm-personalization">
      <p className="lm-intro">
        <Term glossary="personalization">Персоналізація</Term> — питання, які Etsy поставить покупцю під час замовлення: ім’я для гравіювання,
        колір, фото для друку. Відповіді ви побачите в замовленні. До {MAX_QUESTIONS} питань; Etsy зберігає їх усі разом.
      </p>
      {qs.length === 0 && (
        <EmptyState
          compact
          icon="edit"
          title={
            saved.length
              ? 'Усі питання прибрано з форми — щоб прибрати їх і на Etsy, натисніть «Прибрати персоналізацію».'
              : 'Персоналізації немає — покупця ні про що не питають.'
          }
        >
          {saved.length ? null : 'Додайте питання, якщо товар робиться під покупця (ім’я, дата, напис).'}
        </EmptyState>
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
      <div className="lm-actions">
        <Button icon="plus" disabled={qs.length >= MAX_QUESTIONS} onClick={() => edit([...qs, newQuestion()])}>
          Додати питання
        </Button>
        <span className="lm-hint num">
          {qs.length} з {MAX_QUESTIONS}
        </span>
      </div>
      {problems.length > 0 && qs.length > 0 && (
        <Callout tone="warn" role="note" compact title="Перш ніж зберегти, виправте:">
          <ul className="lm-problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Callout>
      )}
      {error && <Callout tone="error">{error}</Callout>}
      {note && (
        <Callout tone="success" compact>
          {note}
        </Callout>
      )}
      <div className="lm-actions lm-footer">
        <Button variant="primary" icon="upload" busy={busy} disabled={!dirty || qs.length === 0 || problems.length > 0} onClick={() => void save()}>
          Зберегти персоналізацію
        </Button>
        {dirty && !busy && (
          <Badge tone="warn" icon="edit">
            Є незбережені зміни
          </Badge>
        )}
        <span className="lm-spacer" />
        {saved.length > 0 && (
          <Button variant="danger" icon="trash" disabled={busy} onClick={() => void removeAll()}>
            Прибрати персоналізацію
          </Button>
        )}
      </div>
    </div>
  )
}
