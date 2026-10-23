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
  const [language, setLanguage] = useState<TranslationLanguage>('en')
  /** undefined = loading; null = none in that language yet. */
  const [tr, setTr] = useState<ListingTranslation | null | undefined>(undefined)
  const [form, setForm] = useState<Form>(formOf(null))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
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
  }, [listingId, language])

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
    <div data-testid="lm-translations">
      <div className="field">
        <label htmlFor="lm-lang">Мова</label>
        <select id="lm-lang" value={language} onChange={(e) => setLanguage(e.target.value as TranslationLanguage)}>
          {TRANSLATION_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label} ({l.code})
            </option>
          ))}
        </select>
      </div>
      {loadError ? (
        <div className="test-result err" role="alert">
          {loadError}
        </div>
      ) : tr === undefined ? (
        <div className="hint">Завантаження…</div>
      ) : (
        <>
          {tr === null && <div className="hint">Перекладу цією мовою ще немає — заповніть поля й створіть його.</div>}
          <div className="field">
            <label htmlFor="lm-tr-title">
              Назва ({form.title.trim().length}/{TITLE_MAX})
            </label>
            <input id="lm-tr-title" value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="lm-tr-desc">Опис</label>
            <textarea id="lm-tr-desc" rows={6} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="lm-tr-tags">
              Теги через кому ({input.tags.length}/{MAX_TAGS})
            </label>
            <input id="lm-tr-tags" value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
            {tr != null && tr.tags.length > 0 && !input.tags.length && (
              <div className="hint warn">Прибрати всі теги перекладу Etsy API не дозволяє — без тегів наявні лишаться як є.</div>
            )}
          </div>
          {dirty && problems.length > 0 && <div className="hint warn">{problems.join(' ')}</div>}
          <div className="settings-actions">
            <button className="btn small primary" disabled={busy || !dirty || problems.length > 0} onClick={() => void save()}>
              {tr ? 'Оновити переклад' : 'Створити переклад'}
            </button>
          </div>
          {error && (
            <div className="test-result err" role="alert">
              {error}
            </div>
          )}
          {note && <div className="test-result ok">{note}</div>}
        </>
      )}
    </div>
  )
}
