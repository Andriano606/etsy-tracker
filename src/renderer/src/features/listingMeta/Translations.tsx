// "Переклади": pick a language, load the listing's translation in it, edit
// title/description/tags, create it or update it.

import { useEffect, useRef, useState } from 'react'
import {
  type ListingTranslation,
  TRANSLATION_LANGUAGES,
  type TranslationLanguage,
  translationProblems
} from '@shared/features/listingMeta'
import { MAX_TAGS, TITLE_MAX, splitList } from '@shared/myShop'
import type { MyListing } from '@shared/types'
import { Badge, Button, Callout, Field, Loading, Term } from '../../ui'
import { featureCall } from '../call'

interface Form {
  title: string
  description: string
  tags: string
}

const formOf = (t: ListingTranslation | null): Form => ({
  title: t?.title ?? '',
  description: t?.description ?? '',
  tags: (t?.tags ?? []).join(', ')
})

export function TranslationsSection({ listing }: { listing: MyListing; onChanged: (l?: MyListing) => void }): JSX.Element {
  const [language, setLanguage] = useState<TranslationLanguage>('en-US')
  /** undefined = loading; null = none in that language yet. */
  const [tr, setTr] = useState<ListingTranslation | null | undefined>(undefined)
  const [form, setForm] = useState<Form>(formOf(null))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const [attempt, setAttempt] = useState(0)
  const listingId = listing.listingId

  useEffect(() => {
    const my = ++seq.current
    setTr(undefined)
    setLoadError(null)
    setError(null)
    setNote(null)
    void featureCall<ListingTranslation | null>('listingMeta', 'translation', { listingId, language }).then((r) => {
      if (my !== seq.current) return
      if (!r.ok) return setLoadError(r.error)
      setTr(r.value)
      setForm(formOf(r.value))
    })
  }, [listingId, language, attempt])

  const input = { title: form.title, description: form.description, tags: splitList(form.tags) }
  const problems = translationProblems(input)
  const dirty = tr !== undefined && JSON.stringify(form) !== JSON.stringify(formOf(tr))

  async function save(): Promise<void> {
    const my = seq.current
    setBusy(true)
    setError(null)
    setNote(null)
    const r = await featureCall<ListingTranslation>('listingMeta', 'saveTranslation', {
      listingId,
      language,
      ...input,
      exists: tr != null
    })
    setBusy(false)
    if (my !== seq.current) return
    if (!r.ok) return setError(r.error)
    setNote(tr ? 'Переклад оновлено на Etsy.' : 'Переклад створено на Etsy.')
    setTr(r.value)
    setForm(formOf(r.value))
  }

  const set = (patch: Partial<Form>): void => {
    setForm((f) => ({ ...f, ...patch }))
    setNote(null)
  }

  return (
    <div className="lm-section" data-testid="lm-translations">
      <p className="lm-intro">
        Etsy показує назву, опис і <Term glossary="tags">теги</Term> мовою покупця, якщо є{' '}
        <Term glossary="features.compete.translation">переклад</Term>. Так покупці з інших країн легше знаходять і розуміють товар. Виберіть
        мову, заповніть поля й збережіть — кожна мова зберігається окремо.
      </p>
      <div className="lm-lang-row">
        <Field label="Мова" id="lm-lang" className="lm-lang">
          <select value={language} onChange={(e) => setLanguage(e.target.value as TranslationLanguage)}>
            {TRANSLATION_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </Field>
        {tr && !loadError && (
          <Badge tone="accent" icon="check">
            Переклад є на Etsy
          </Badge>
        )}
      </div>
      {loadError ? (
        <Callout tone="error" action={
          <Button size="sm" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>
            Спробувати ще
          </Button>
        }>
          {loadError}
        </Callout>
      ) : tr === undefined ? (
        <Loading>Завантаження перекладу…</Loading>
      ) : (
        <>
          {tr === null && (
            <Callout tone="info" role="note" compact>
              Перекладу цією мовою ще немає — заповніть поля й створіть його.
            </Callout>
          )}
          <Field
            label="Назва"
            id="lm-tr-title"
            aside={
              <span className={form.title.trim().length > TITLE_MAX ? 'lm-over' : undefined}>
                {form.title.trim().length}/{TITLE_MAX}
              </span>
            }
          >
            <input value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Опис" id="lm-tr-desc">
            <textarea rows={6} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field
            label="Теги через кому"
            id="lm-tr-tags"
            aside={
              <span className={input.tags.length > MAX_TAGS ? 'lm-over' : undefined}>
                {input.tags.length}/{MAX_TAGS}
              </span>
            }
            hint="Слова й фрази, за якими покупці шукатимуть товар цією мовою."
          >
            <input value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
          </Field>
          {tr != null && tr.tags.length > 0 && !input.tags.length && (
            <Callout tone="warn" role="note" compact>
              Etsy не дозволяє прибрати всі теги перекладу — якщо поле порожнє, наявні теги лишаться як є.
            </Callout>
          )}
          {dirty && problems.length > 0 && (
            <Callout tone="warn" role="note" compact>
              {problems.join(' ')}
            </Callout>
          )}
          {error && <Callout tone="error">{error}</Callout>}
          {note && (
            <Callout tone="success" compact>
              {note}
            </Callout>
          )}
          <div className="lm-actions lm-footer">
            <Button variant="primary" icon="upload" busy={busy} disabled={!dirty || problems.length > 0} onClick={() => void save()}>
              {tr ? 'Оновити переклад' : 'Створити переклад'}
            </Button>
            {dirty && <span className="lm-hint">Є незбережені зміни</span>}
          </div>
        </>
      )}
    </div>
  )
}
