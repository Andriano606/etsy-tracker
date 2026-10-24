import { useState } from 'react'
import type { KeyStatus, KeyTestResult } from '@shared/types'
import { useStore } from '../store'
import { Badge, Button, Callout, Field, Icon, InfoTip, Modal, Tabs, Term, type TabItem } from '../ui'
import { BuyerCountrySection } from './BuyerCountrySection'
import { KeyHelp } from './KeyHelp'
import { confirmWith } from './McpModal'
import { MinioSection, RevealOnShow } from './MinioSection'

export const UNREADABLE_KEY_MESSAGE =
  'Збережений ключ не вдалося розшифрувати (системне сховище ключів недоступне або змінилося) — введіть ключ ще раз.'

export const TRADEMARK_NOTICE =
  "The term 'Etsy' is a trademark of Etsy, Inc. This Application uses Etsy's API, but is not endorsed or certified by Etsy."

type SettingsTab = 'access' | 'prices' | 'photos' | 'about'

const TABS: ReadonlyArray<TabItem<SettingsTab>> = [
  { id: 'access', label: 'Доступ до Etsy', icon: 'key' },
  { id: 'prices', label: 'Ціни для покупця', icon: 'money' },
  { id: 'photos', label: 'Фото', icon: 'image' },
  { id: 'about', label: 'Про програму', icon: 'info' }
]

/**
 * Settings: four tabs (access to Etsy, buyer prices, photo storage, about).
 * Every panel stays mounted while the window is open (hidden when inactive), so
 * switching tabs never drops what the user typed; closing the window does.
 */
export function SettingsModal(): JSX.Element | null {
  const { showSettings, setShowSettings } = useStore()
  if (!showSettings) return null
  return <SettingsDialog onClose={() => setShowSettings(false)} />
}

function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('access')
  // Every panel stays mounted; the inactive ones are hidden (and so out of the accessibility tree).
  const panel = (id: SettingsTab): { hidden: boolean; className: string } => ({ hidden: id !== tab, className: 'settings-panel' })

  return (
    <Modal
      title="Налаштування"
      subtitle="Доступ до Etsy, ціни для покупця, збереження фото"
      size="lg"
      onClose={onClose}
      className="settings-modal"
      footer={
        <>
          <span className="ui-modal-foot-start settings-foot-note">
            <Icon name="lock" size={14} />
            Ключі й паролі зберігаються лише на цьому комп’ютері.
          </span>
          <Button onClick={onClose}>Закрити</Button>
        </>
      }
    >
      <Tabs label="Розділи налаштувань" orientation="vertical" tabs={TABS} value={tab} onChange={setTab} className="settings-tabs">
        <div {...panel('access')}>
          <AccessSection />
        </div>
        <div {...panel('prices')}>
          <BuyerCountrySection />
        </div>
        <div {...panel('photos')}>
          <MinioSection />
        </div>
        <div {...panel('about')}>
          <AboutSection />
        </div>
      </Tabs>
    </Modal>
  )
}

/** What is stored now: the masked keystring, whether it is encrypted, or why there is none. */
function KeyStatusCard({ st }: { st: KeyStatus | null }): JSX.Element {
  if (st?.hasKey) {
    return (
      <div className="settings-status is-ok" data-testid="key-status">
        <Icon name="success" size={18} className="settings-status-icon" />
        <div className="settings-status-main">
          <div className="settings-status-line">
            Збережено: <code>{st.masked}</code>
            {st.encrypted && (
              <span className="settings-status-badge">
                <Badge tone="accent" icon="lock">
                  зашифровано системним сховищем ключів
                </Badge>
                <InfoTip glossary="settings.keyEncrypted" />
              </span>
            )}
          </div>
          {!st.encrypted && (
            <Callout tone="warn" role="note" compact>
              Системне сховище ключів недоступне — ключ збережено без шифрування у файлі налаштувань програми.
            </Callout>
          )}
        </div>
      </div>
    )
  }
  if (st?.unreadable) {
    return (
      <div className="settings-status" data-testid="key-status">
        <Callout tone="error" title="Ключ треба ввести ще раз">
          {UNREADABLE_KEY_MESSAGE}
        </Callout>
      </div>
    )
  }
  return (
    <div className="settings-status is-empty" data-testid="key-status">
      <Icon name="key" size={18} className="settings-status-icon" />
      <div className="settings-status-main">
        <div className="settings-status-line">
          <span>Ключ не задано.</span>
        </div>
        <div className="settings-status-sub">Без ключа програма не може читати магазини з Etsy. Отримайте його за інструкцією нижче.</div>
      </div>
    </div>
  )
}

/**
 * "Доступ до Etsy": the API key. The inputs always start empty: the renderer
 * never receives the stored key back, only its masked keystring.
 */
function AccessSection(): JSX.Element {
  const { keyStatus, saveKey, testKey } = useStore()
  const [keystring, setKeystring] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<KeyTestResult | null>(null)
  const [howOpen, setHowOpen] = useState(!keyStatus?.hasKey)
  const typed = keystring.trim() !== '' || secret.trim() !== ''

  const edited = (): void => {
    setSaved(false)
    setError(null)
  }

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

  // Like store.clearKey, but the dialog says what is lost and the button says "Видалити ключ".
  const onClear = async (): Promise<void> => {
    const ok = await confirmWith({
      title: 'Видалення ключа',
      message:
        'Видалити збережений ключ доступу до Etsy?\nБез нього програма не зможе сканувати магазини, доки ви не введете ключ знову.',
      confirmLabel: 'Видалити ключ',
      danger: true
    })
    if (!ok) return
    setTest(null)
    setSaved(false)
    useStore.setState({ keyStatus: await window.api.clearApiKey() })
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
    <>
      <section className="ui-section">
        <h3 className="ui-section-title">
          Ключ доступу до Etsy <InfoTip glossary="apiKey" />
        </h3>
        <p className="ui-section-desc">
          Програма читає магазини через офіційний сервіс <Term glossary="etsy" /> для розробників. Для цього потрібен ваш
          особистий ключ доступу — він безкоштовний і складається з двох частин. Отримати його треба лише один раз.
        </p>
        <KeyStatusCard st={keyStatus} />

        <details className="settings-details" open={howOpen} onToggle={(e) => setHowOpen(e.currentTarget.open)}>
          <summary>
            <Icon name="chevron-right" size={16} className="settings-details-chevron" />
            Як отримати ключ — покроково
          </summary>
          <div className="settings-details-body">
            <KeyHelp />
          </div>
        </details>
      </section>

      <section className="ui-section">
        <h3 className="ui-section-title">{keyStatus?.hasKey ? 'Замінити ключ' : 'Ввести ключ'}</h3>
        <p className="ui-section-desc">
          Скопіюйте обидва значення зі сторінки свого застосунку на Etsy («Your Apps» → значок ока).
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void onSave()
          }}
        >
          <div className="ui-form-grid">
            <Field label="Keystring" glossary="keystring" hint="Перша, відкрита частина ключа.">
              <input
                id="keystring"
                autoComplete="off"
                spellCheck={false}
                value={keystring}
                placeholder={keyStatus?.hasKey ? 'Вставте новий, щоб замінити' : 'Вставте сюди'}
                onChange={(e) => {
                  setKeystring(e.target.value)
                  edited()
                }}
              />
            </Field>
            <Field label="Shared secret" glossary="sharedSecret" hint="Друга, секретна частина. Etsy вимагає обидві.">
              <input
                id="shared-secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                placeholder="Вставте сюди"
                onChange={(e) => {
                  setSecret(e.target.value)
                  edited()
                }}
              />
            </Field>
          </div>
          {error && (
            <Callout tone="error" compact className="settings-msg">
              {error}
            </Callout>
          )}
          {saved && (
            <Callout tone="success" compact className="settings-msg" role="note">
              Ключ збережено.
            </Callout>
          )}
          <div className="ui-row settings-buttons">
            <Button type="submit" variant="primary" icon="check" disabled={!keystring.trim() || !secret.trim()}>
              Зберегти ключ
            </Button>
            <Button
              icon="refresh"
              busy={testing}
              disabled={!typed && !keyStatus?.hasKey}
              tooltip={typed ? 'Перевірити щойно введені значення, нічого не зберігаючи' : 'Перевірити збережений ключ'}
              onClick={() => void onTest()}
            >
              {testing ? 'Перевіряю…' : 'Перевірити ключ'}
            </Button>
            {keyStatus?.hasKey && (
              <>
                <span className="ui-spacer" />
                <Button variant="danger" icon="trash" onClick={() => void onClear()}>
                  Видалити ключ
                </Button>
              </>
            )}
          </div>
          {test && (
            <RevealOnShow key={test.message}>
              <Callout tone={test.ok ? 'success' : 'error'} role="status" compact className="settings-msg">
                {test.message}
              </Callout>
            </RevealOnShow>
          )}
        </form>
      </section>

      <section className="ui-section">
        <h3 className="ui-section-title">
          Денний ліміт запитів <InfoTip glossary="quota" />
        </h3>
        <p className="ui-section-desc">
          Etsy дозволяє обмежену кількість звернень на добу для кожного ключа. Скільки лишилось на сьогодні — видно внизу
          бічної панелі. Ліміт поновлюється щодоби.
        </p>
      </section>
    </>
  )
}

function AboutSection(): JSX.Element {
  return (
    <>
      <section className="ui-section">
        <h3 className="ui-section-title">Etsy Tracker</h3>
        <p className="ui-section-desc">
          Програма стежить за магазинами на <Term glossary="etsy" />: після кожного{' '}
          <Term glossary="scan">сканування</Term> показує нові, зниклі й змінені товари, ціни та акції, популярність і
          відгуки покупців.
        </p>
        <ul className="settings-facts">
          <li>
            <Icon name="lock" size={16} />
            <span>Усі дані зберігаються лише на цьому комп’ютері.</span>
          </li>
          <li>
            <Icon name="eye" size={16} />
            <span>Чужі магазини програма лише читає — нічого не купує й не змінює.</span>
          </li>
          <li>
            <Icon name="refresh" size={16} />
            <span>Сама програма нічого не оновлює: дані свіжі на момент останнього сканування.</span>
          </li>
        </ul>
      </section>
      <section className="ui-section">
        <Callout tone="info" role="note" title="Свіжість даних">
          Дані товарів показуються такими, якими вони були на момент останнього сканування. Правила Etsy для таких програм
          вимагають, щоб показані дані були не старші за 6 годин — скануйте повторно перед використанням.
        </Callout>
        <p className="settings-legal" lang="en">
          {TRADEMARK_NOTICE}
        </p>
      </section>
    </>
  )
}
