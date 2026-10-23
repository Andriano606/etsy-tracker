import { useEffect, useState } from 'react'
import type { KeyTestResult } from '@shared/types'
import { useStore } from '../store'
import { BuyerCountrySection } from './BuyerCountrySection'
import { KeyHelp } from './KeyHelp'
import { MinioSection } from './MinioSection'
import { useEscape } from './useEscape'

export const UNREADABLE_KEY_MESSAGE =
  'Збережений ключ не вдалося розшифрувати (системне сховище ключів недоступне або змінилося) — введіть ключ ще раз.'

export const TRADEMARK_NOTICE =
  "The term 'Etsy' is a trademark of Etsy, Inc. This Application uses Etsy's API, but is not endorsed or certified by Etsy."

/**
 * API-key settings. The inputs always start empty: the renderer never receives
 * the stored key back, only its masked keystring (KeyStatus.masked).
 */
export function SettingsModal(): JSX.Element | null {
  const { showSettings, setShowSettings, keyStatus, saveKey, clearKey, testKey } = useStore()
  const [keystring, setKeystring] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<KeyTestResult | null>(null)

  useEffect(() => {
    if (!showSettings) {
      setKeystring('')
      setSecret('')
      setError(null)
      setSaved(false)
      setTest(null)
    }
  }, [showSettings])

  const close = (): void => setShowSettings(false)
  useEscape(close, showSettings)
  if (!showSettings) return null
  const typed = keystring.trim() !== '' || secret.trim() !== ''

  const onSave = async (): Promise<void> => {
    setTest(null)
    const res = await saveKey(keystring, secret)
    if (!res.ok) {
      setError(res.error ?? 'Не вдалося зберегти ключ.')
      return
    }
    setKeystring('')
    setSecret('')
    setError(null)
    setSaved(true)
  }

  const onTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      setTest(typed ? await testKey(keystring, secret) : await testKey())
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Налаштування</h2>

        <section className="settings-section">
          <h3>API-ключ Etsy</h3>
          <div className="key-status" data-testid="key-status">
            {keyStatus?.hasKey ? (
              <>
                Збережено: <code>{keyStatus.masked}</code>
                {keyStatus.encrypted ? (
                  <span className="ok"> · зашифровано системним сховищем ключів</span>
                ) : (
                  <div className="hint warn">
                    Системне сховище ключів недоступне — ключ збережено без шифрування у файлі
                    налаштувань програми.
                  </div>
                )}
              </>
            ) : keyStatus?.unreadable ? (
              <div className="hint warn" role="alert">
                {UNREADABLE_KEY_MESSAGE}
              </div>
            ) : (
              <span className="dim">Ключ не задано.</span>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void onSave()
            }}
          >
            <div className="field">
              <label htmlFor="keystring">Keystring</label>
              <div className="row">
                <input
                  id="keystring"
                  autoComplete="off"
                  spellCheck={false}
                  value={keystring}
                  placeholder={keyStatus?.hasKey ? 'Вставте новий, щоб замінити' : ''}
                  onChange={(e) => {
                    setKeystring(e.target.value)
                    setSaved(false)
                    setError(null)
                  }}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="shared-secret">Shared secret</label>
              <div className="row">
                <input
                  id="shared-secret"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  onChange={(e) => {
                    setSecret(e.target.value)
                    setSaved(false)
                    setError(null)
                  }}
                />
              </div>
              <div className="hint">
                Etsy вимагає обидва значення: запити йдуть із заголовком{' '}
                <code>x-api-key: keystring:shared_secret</code>.
              </div>
              {error && (
                <div className="hint err" role="alert">
                  {error}
                </div>
              )}
              {saved && <div className="hint ok">Ключ збережено.</div>}
            </div>
            <div className="settings-actions">
              <button type="submit" className="btn primary" disabled={!keystring.trim() || !secret.trim()}>
                Зберегти
              </button>
              <button
                type="button"
                className="btn"
                disabled={testing || (!typed && !keyStatus?.hasKey)}
                onClick={() => void onTest()}
              >
                {testing ? 'Перевіряю…' : 'Перевірити ключ'}
              </button>
              {keyStatus?.hasKey && (
                <button type="button" className="btn danger" onClick={() => void clearKey()}>
                  Видалити ключ
                </button>
              )}
            </div>
            {test && (
              <div className={`test-result ${test.ok ? 'ok' : 'err'}`} role="status">
                {test.message}
              </div>
            )}
          </form>
        </section>

        <BuyerCountrySection />

        <MinioSection />

        <section className="settings-section">
          <h3>Як отримати ключ</h3>
          <KeyHelp />
        </section>

        <section className="settings-section">
          <h3>Про програму</h3>
          <p className="hint">
            Дані товарів показуються такими, якими вони були на момент останнього сканування.
            Умови Etsy API вимагають, щоб показані дані були не старші за 6 годин — скануйте
            повторно перед використанням.
          </p>
          <p className="hint legal">{TRADEMARK_NOTICE}</p>
        </section>

        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  )
}
