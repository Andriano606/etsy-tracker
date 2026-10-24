import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MinioSettingsInput, MinioTestResult } from '@shared/types'
import { useStore } from '../store'
import { Button, Callout, Field, Icon, InfoTip, Term, Toggle } from '../ui'
import { CopyBlock } from './McpModal'

/**
 * Scrolls a just-shown message (a test result, "збережено") into view: in a short
 * window it may appear below the visible part of the scrolling modal body.
 * Remount it (key) to reveal a new message.
 */
export function RevealOnShow({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  return <div ref={ref}>{children}</div>
}

/** The README's `docker run` equivalent of docker-compose.yml, for the installed app (no source code). */
export const MINIO_DOCKER_RUN = [
  'docker run -d --name etsy-tracker-minio --restart unless-stopped \\',
  '  -p 127.0.0.1:9100:9000 -p 127.0.0.1:9101:9001 -v "$HOME/.local/share/etsy-tracker/minio":/data \\',
  '  -e MINIO_ROOT_USER=etsytracker -e MINIO_ROOT_PASSWORD=ваш-пароль \\',
  '  -e MINIO_API_CORS_ALLOW_ORIGIN=http://127.0.0.1:9101 \\',
  '  minio/minio:RELEASE.2025-09-07T16-13-09Z server /data --console-address :9001'
].join('\n')

type Fields = { endpoint: string; accessKey: string; bucket: string }

/**
 * Settings → "Фото": the local photo store (MinIO). A beginner sees what it is
 * for and one switch, which applies at once (like the MCP switch); the address,
 * credentials and how to start it are under "Для досвідчених", saved with their
 * own button, enabled only while something differs from the saved settings. The
 * password input always starts empty: main only tells whether the
 * docker-compose default or a stored (encrypted) secret is in use.
 */
export function MinioSection(): JSX.Element {
  // minioStatus is loaded with the app (store.load) and refreshed by saveMinio.
  const { minioStatus: st, saveMinio, testMinio } = useStore()
  const [fields, setFields] = useState<Fields>({ endpoint: '', accessKey: '', bucket: '' })
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<null | 'switch' | 'form'>(null)
  const [switching, setSwitching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<MinioTestResult | null>(null)
  const [advanced, setAdvanced] = useState(!!st?.unreadable)
  // The saved values the fields were last filled from: a field still equal to
  // its old saved value follows a new status; one the user edited is kept.
  const base = useRef<Fields | null>(null)

  useEffect(() => {
    if (!st) return
    const next: Fields = { endpoint: st.endpoint, accessKey: st.accessKey, bucket: st.bucket }
    const prev = base.current
    setFields((cur) =>
      prev
        ? {
            endpoint: cur.endpoint === prev.endpoint ? next.endpoint : cur.endpoint,
            accessKey: cur.accessKey === prev.accessKey ? next.accessKey : cur.accessKey,
            bucket: cur.bucket === prev.bucket ? next.bucket : cur.bucket
          }
        : next
    )
    base.current = next
    if (st.unreadable) setAdvanced(true)
  }, [st])

  const enabled = st?.enabled ?? true
  const dirty =
    !!st &&
    (fields.endpoint !== st.endpoint || fields.accessKey !== st.accessKey || fields.bucket !== st.bucket || secret.trim() !== '')

  const input = (): MinioSettingsInput => ({
    enabled,
    ...fields,
    ...(secret.trim() ? { secretKey: secret } : {})
  })
  const edit = (patch: Partial<Fields>): void => {
    setFields((f) => ({ ...f, ...patch }))
    setSaved(null)
    setError(null)
  }

  // The switch is saved at once, with the saved address and login — what was
  // typed under "Для досвідчених" stays in the fields, still unsaved.
  const onSwitch = async (on: boolean): Promise<void> => {
    if (!st) return
    setSwitching(true)
    setError(null)
    setSaved(null)
    try {
      const res = await saveMinio({ enabled: on, endpoint: st.endpoint, accessKey: st.accessKey, bucket: st.bucket })
      if (!res.ok) setError(res.error ?? 'Не вдалося зберегти.')
      else setSaved('switch')
    } finally {
      setSwitching(false)
    }
  }

  const onSave = async (): Promise<void> => {
    setTest(null)
    setSaving(true)
    try {
      const res = await saveMinio(input())
      if (!res.ok) {
        setError(res.error ?? 'Не вдалося зберегти.')
        return
      }
      // Show exactly what main saved (it may normalize the values).
      const now = useStore.getState().minioStatus
      if (now) {
        const next = { endpoint: now.endpoint, accessKey: now.accessKey, bucket: now.bucket }
        base.current = next
        setFields(next)
      }
      setSecret('')
      setSaved('form')
    } finally {
      setSaving(false)
    }
  }

  const onTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await testMinio(input()))
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="ui-section" data-testid="minio-section">
      <h3 className="ui-section-title">
        Копії фото на цьому комп’ютері <InfoTip glossary="minio" />
      </h3>
      <p className="ui-section-desc">
        Продавці часто міняють і видаляють фото товарів. Після кожного сканування програма копіює фото товарів і відгуків у
        сховище на вашому комп’ютері, щоб їх завжди можна було переглянути. Без сховища все працює — фото просто
        показуються прямо з Etsy.
      </p>

      <div className="settings-toggle-card">
        <Toggle
          label="Зберігати копії фото"
          hint={
            enabled
              ? 'Фото копіюються у сховище після кожного сканування. Зміна діє одразу.'
              : 'Фото показуються прямо з Etsy, нічого не копіюється. Зміна діє одразу.'
          }
          checked={enabled}
          disabled={!st || switching}
          onChange={(on) => void onSwitch(on)}
        />
      </div>
      {saved === 'switch' && (
        <Callout tone="success" compact className="settings-msg" role="note">
          {enabled ? 'Копіювання фото увімкнено.' : 'Копіювання фото вимкнено.'}
        </Callout>
      )}

      <Callout tone="info" role="note" compact className="settings-msg">
        Сховище — окрема безкоштовна програма, яку треба один раз запустити на цьому комп’ютері. Як це зробити і де
        змінити адресу чи пароль — у розділі «Для досвідчених» нижче.
      </Callout>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty) void onSave()
        }}
      >
        <details className="settings-details" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
          <summary>
            <Icon name="chevron-right" size={16} className="settings-details-chevron" />
            Для досвідчених: запуск і параметри сховища
          </summary>
          <div className="settings-details-body">
            <p className="settings-note">
              Сховище — це програма <b>MinIO</b>, яка працює в <Term glossary="settings.docker">Docker</Term>. Запустіть
              її один раз командою в <Term glossary="settings.terminal">терміналі</Term> — далі вона запускатиметься
              сама разом із комп’ютером.
            </p>
            <div className="settings-install">
              <CopyBlock
                id="minio-run"
                label="Якщо у вас встановлена програма (без вихідного коду)"
                text={MINIO_DOCKER_RUN}
              />
              <p className="settings-note">
                Замініть «ваш-пароль» на власний пароль і введіть той самий у поле «Пароль» нижче. Фото зберігатимуться в
                теці <code>~/.local/share/etsy-tracker/minio</code>.
              </p>
              <CopyBlock id="minio-compose" label="Якщо у вас вихідний код програми" text="docker compose up -d" />
              <p className="settings-note">
                Виконайте в теці з вихідним кодом, де лежить файл docker-compose.yml (у встановленій програмі його немає).
                Типові значення нижче збігаються з цим файлом.
              </p>
            </div>
            <p className="settings-note">
              Вебконсоль сховища (перегляд скопійованих фото): <code>http://127.0.0.1:9101</code>.
            </p>
            <div className="ui-form-grid">
              <Field label="Адреса сховища" glossary="settings.storageAddress">
                <input
                  id="minio-endpoint"
                  spellCheck={false}
                  value={fields.endpoint}
                  onChange={(e) => edit({ endpoint: e.target.value })}
                />
              </Field>
              <Field label="Тека для фото" glossary="settings.minioBucket">
                <input id="minio-bucket" spellCheck={false} value={fields.bucket} onChange={(e) => edit({ bucket: e.target.value })} />
              </Field>
              <Field label="Логін" glossary="settings.minioAccessKey">
                <input
                  id="minio-access"
                  autoComplete="off"
                  spellCheck={false}
                  value={fields.accessKey}
                  onChange={(e) => edit({ accessKey: e.target.value })}
                />
              </Field>
              <Field label="Пароль" glossary="settings.minioSecretKey">
                <input
                  id="minio-secret"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  placeholder="Залиште порожнім, щоб не змінювати"
                  onChange={(e) => {
                    setSecret(e.target.value)
                    setSaved(null)
                    setError(null)
                  }}
                />
              </Field>
            </div>
            <div className="settings-secret-status" data-testid="minio-secret-status">
              {st?.unreadable ? (
                <Callout tone="error" role="note" compact>
                  Збережений пароль не вдалося розшифрувати — введіть його ще раз.
                </Callout>
              ) : st?.secretSource === 'stored' ? (
                st.encrypted ? (
                  <span className="settings-ok">
                    <Icon name="lock" size={14} /> Пароль збережено, зашифровано системним сховищем ключів.
                  </span>
                ) : (
                  <Callout tone="warn" role="note" compact>
                    Пароль збережено без шифрування (системне сховище ключів недоступне).
                  </Callout>
                )
              ) : (
                <Callout tone="warn" role="note" compact>
                  Використовується типовий пароль із docker-compose.yml — він загальновідомий. Запустіть сховище з
                  власним паролем (у файлі .env це MINIO_ROOT_PASSWORD) і введіть його тут.
                </Callout>
              )}
            </div>

            {error && (
              <RevealOnShow key={error}>
                <Callout tone="error" compact className="settings-msg">
                  {error}
                </Callout>
              </RevealOnShow>
            )}
            {dirty && (
              <Callout tone="warn" role="note" compact className="settings-msg">
                Є незбережені зміни — натисніть «Зберегти налаштування фото», інакше вони пропадуть після закриття вікна.
              </Callout>
            )}
            {saved === 'form' && (
              <RevealOnShow>
                <Callout tone="success" compact className="settings-msg" role="note">
                  Налаштування фото збережено.
                </Callout>
              </RevealOnShow>
            )}
            <div className="ui-row settings-buttons">
              <Button type="submit" variant="primary" icon="check" busy={saving} disabled={!dirty}>
                Зберегти налаштування фото
              </Button>
              <Button
                icon="server"
                busy={testing}
                tooltip="Перевірити, чи працює сховище з цими налаштуваннями (нічого не зберігає)"
                onClick={() => void onTest()}
              >
                {testing ? 'Перевіряю…' : 'Перевірити з’єднання'}
              </Button>
            </div>
            {test && (
              <RevealOnShow key={test.message}>
                <Callout tone={test.ok ? 'success' : 'error'} role="status" compact className="settings-msg">
                  {test.message}
                </Callout>
              </RevealOnShow>
            )}
          </div>
        </details>
      </form>
    </section>
  )
}
