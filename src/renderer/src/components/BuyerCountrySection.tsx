import { useEffect, useState } from 'react'
import { COMMON_COUNTRIES, DEFAULT_BUYER_COUNTRY, countryLabel, normalizeCountry } from '@shared/countries'
import { useStore } from '../store'

const OTHER = '__other'

/**
 * Settings → "Країна покупця": Etsy's buyer-facing prices (VAT, UK shipping,
 * active promotions) are computed for one buyer country. A short list of
 * common countries plus free input of any ISO 3166-1 alpha-2 code. Applies
 * from the next scan — stored prices stay as they were scanned.
 */
export function BuyerCountrySection(): JSX.Element {
  const { buyerCountry, saveBuyerCountry } = useStore()
  const current = buyerCountry ?? DEFAULT_BUYER_COUNTRY
  const isCommon = (c: string): boolean => COMMON_COUNTRIES.some((x) => x.code === c)
  const [choice, setChoice] = useState(isCommon(current) ? current : OTHER)
  const [typed, setTyped] = useState(isCommon(current) ? '' : current)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setChoice(isCommon(current) ? current : OTHER)
    setTyped(isCommon(current) ? '' : current)
  }, [current])

  const value = choice === OTHER ? typed : choice
  const valid = normalizeCountry(value) != null

  const onSave = async (): Promise<void> => {
    const res = await saveBuyerCountry(value)
    if (!res.ok) {
      setError(res.error ?? 'Не вдалося зберегти країну.')
      setSaved(false)
      return
    }
    setError(null)
    setSaved(true)
  }

  return (
    <section className="settings-section" data-testid="buyer-country-section">
      <h3>Країна покупця</h3>
      <p className="hint">
        Etsy показує покупцям ціну з ПДВ їхньої країни (у Великій Британії — ще й з доставкою) та
        з урахуванням активних знижок. Застосунок запитує таку ціну для вибраної країни; базова ціна
        продавця (без ПДВ і знижок) теж зберігається. Зараз: <b>{countryLabel(current)}</b>.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void onSave()
        }}
      >
        <div className="field">
          <label htmlFor="buyer-country">Країна</label>
          <div className="row">
            <select
              id="buyer-country"
              value={choice}
              onChange={(e) => {
                setChoice(e.target.value)
                setSaved(false)
                setError(null)
              }}
            >
              {COMMON_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
              <option value={OTHER}>Інша…</option>
            </select>
            {choice === OTHER && (
              <input
                aria-label="Код країни (ISO 3166-1)"
                placeholder="напр. JP"
                maxLength={2}
                spellCheck={false}
                autoComplete="off"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value.toUpperCase())
                  setSaved(false)
                  setError(null)
                }}
              />
            )}
          </div>
          {choice === OTHER && typed.trim() !== '' && !valid && (
            <div className="hint err" role="alert">
              Невідомий код країни — потрібен двобуквений код ISO 3166-1 (напр. JP, NO, CH).
            </div>
          )}
          {error && (
            <div className="hint err" role="alert">
              {error}
            </div>
          )}
          {saved && (
            <div className="hint ok" role="status">
              Збережено. Нова країна застосується з наступного сканування.
            </div>
          )}
        </div>
        <div className="settings-actions">
          <button type="submit" className="btn primary" disabled={!valid}>
            Зберегти країну
          </button>
        </div>
      </form>
    </section>
  )
}
