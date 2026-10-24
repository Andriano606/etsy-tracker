import { useEffect, useState } from 'react'
import { COMMON_COUNTRIES, DEFAULT_BUYER_COUNTRY, countryLabel, normalizeCountry } from '@shared/countries'
import { useStore } from '../store'
import { RevealOnShow } from './MinioSection'
import { Button, Callout, Field, Icon, InfoTip, Select, Term } from '../ui'

const OTHER = '__other'

/**
 * Settings → "Ціни для покупця": Etsy's buyer-facing prices (VAT, UK shipping,
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
  const normalized = normalizeCountry(value)
  const valid = normalized != null
  const unchanged = normalized === current
  const badCode = choice === OTHER && typed.trim() !== '' && !valid

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
    <section className="ui-section" data-testid="buyer-country-section">
      <h3 className="ui-section-title">
        Країна покупця <InfoTip glossary="buyerCountry" />
      </h3>
      <p className="ui-section-desc">
        Покупці з різних країн бачать на Etsy різну ціну того самого товару: з <Term glossary="vat" /> своєї країни, з
        урахуванням <Term glossary="promotion">акцій</Term>, а у Великій Британії — ще й з доставкою. Виберіть країну, для
        якої програма показуватиме ціни.
      </p>

      <figure className="settings-example" aria-label="Приклад розрахунку ціни">
        <figcaption>Приклад для покупця з України</figcaption>
        <ol className="settings-example-steps">
          <li>
            <span className="settings-example-price num">2,50 USD</span>
            <span className="settings-example-what">
              <Term glossary="basePrice">ціна продавця</Term>
            </span>
          </li>
          <li aria-hidden="true" className="settings-example-arrow">
            <Icon name="chevron-right" size={16} />
          </li>
          <li>
            <span className="settings-example-price num">3,00 USD</span>
            <span className="settings-example-what">+ ПДВ 20 %</span>
          </li>
          <li aria-hidden="true" className="settings-example-arrow">
            <Icon name="chevron-right" size={16} />
          </li>
          <li>
            <span className="settings-example-price num is-final">1,20 USD</span>
            <span className="settings-example-what">з акцією −60 %</span>
          </li>
        </ol>
      </figure>

      <div className="settings-current">
        <Icon name="globe" size={16} />
        <span>
          Зараз: <b>{countryLabel(current)}</b>
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void onSave()
        }}
      >
        <div className="ui-form-grid">
          <Field label="Країна" hint="Найпоширеніші країни; решта — у пункті «Інша…».">
            <Select
              id="buyer-country"
              fullWidth
              value={choice}
              onChange={(v) => {
                setChoice(v)
                setSaved(false)
                setError(null)
              }}
              options={[...COMMON_COUNTRIES.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })), { value: OTHER, label: 'Інша…' }]}
            />
          </Field>
          {choice === OTHER && (
            <Field
              label="Код країни"
              glossary="settings.countryCode"
              hint={badCode ? undefined : valid ? `Це ${countryLabel(normalized!)}.` : 'Дві латинські літери, наприклад JP, NO, CH.'}
              error={badCode ? 'Невідомий код країни — потрібні дві латинські літери, як-от JP, NO, CH.' : undefined}
            >
              <input
                placeholder="напр. JP"
                maxLength={2}
                spellCheck={false}
                autoComplete="off"
                className="settings-code-input"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value.toUpperCase())
                  setSaved(false)
                  setError(null)
                }}
              />
            </Field>
          )}
        </div>
        {error && (
          <Callout tone="error" compact className="settings-msg">
            {error}
          </Callout>
        )}
        {saved && (
          <RevealOnShow>
            <Callout tone="success" compact className="settings-msg">
              Збережено. Нова країна застосується з наступного сканування.
            </Callout>
          </RevealOnShow>
        )}
        <div className="ui-row settings-buttons">
          <Button type="submit" variant="primary" icon="check" disabled={!valid || unchanged}>
            Зберегти країну
          </Button>
        </div>
        <p className="settings-note">
          Нова країна діє з наступного сканування; уже збережені ціни не зміняться. Базову ціну продавця програма зберігає
          завжди, а список товарів від країни не залежить.
        </p>
      </form>
    </section>
  )
}
