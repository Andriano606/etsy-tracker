import { useEffect, useState } from 'react'
import type { MinioSettingsInput, MinioTestResult } from '@shared/types'
import { useStore } from '../store'

/**
 * Settings → "Сховище зображень (MinIO)". The secret key input always starts
 * empty: main only tells whether the docker-compose default or a stored
 * (encrypted) secret is in use.
 */
export function MinioSection(): JSX.Element {
  // minioStatus is loaded with the app (store.load) and refreshed by saveMinio.
  const { minioStatus: st, saveMinio, testMinio } = useStore()
  const [endpoint, setEndpoint] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [secret, setSecret] = useState('')
  const [bucket, setBucket] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<MinioTestResult | null>(null)

  useEffect(() => {
    if (!st) return
    setEndpoint(st.endpoint)
    setAccessKey(st.accessKey)
    setBucket(st.bucket)
    setEnabled(st.enabled)
  }, [st])

  const input = (): MinioSettingsInput => ({
    enabled,
    endpoint,
    accessKey,
    bucket,
    ...(secret.trim() ? { secretKey: secret } : {})
  })
  const touch = (): void => {
    setSaved(false)
    setError(null)
  }

  const onSave = async (): Promise<void> => {
    setTest(null)
    const res = await saveMinio(input())
    if (!res.ok) {
      setError(res.error ?? 'Не вдалося зберегти.')
      return
    }
    setSecret('')
    setSaved(true)
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
    <section className="settings-section" data-testid="minio-section">
      <h3>Сховище зображень (MinIO)</h3>
      <p className="hint">
        Фото товарів копіюються з CDN Etsy у локальний MinIO після кожного сканування. Запуск:{' '}
        <code>docker compose up -d</code> у теці проєкту etsy-tracker (вихідний код, де лежить
        docker-compose.yml; встановлена програма його не містить) — типові значення нижче
        збігаються з ним. Консоль MinIO: <code>http://127.0.0.1:9101</code>.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void onSave()
        }}
      >
        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked)
                touch()
              }}
            />{' '}
            Зберігати фото в MinIO
          </label>
        </div>
        <div className="field">
          <label htmlFor="minio-endpoint">Адреса (S3 API)</label>
          <input
            id="minio-endpoint"
            spellCheck={false}
            value={endpoint}
            onChange={(e) => {
              setEndpoint(e.target.value)
              touch()
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="minio-access">Access key</label>
          <input
            id="minio-access"
            autoComplete="off"
            spellCheck={false}
            value={accessKey}
            onChange={(e) => {
              setAccessKey(e.target.value)
              touch()
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="minio-secret">Secret key</label>
          <input
            id="minio-secret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            placeholder="Залиште порожнім, щоб не змінювати"
            onChange={(e) => {
              setSecret(e.target.value)
              touch()
            }}
          />
          <div className="hint" data-testid="minio-secret-status">
            {st?.unreadable ? (
              <span className="err">Збережений Secret key не вдалося розшифрувати — введіть його ще раз.</span>
            ) : st?.secretSource === 'stored' ? (
              st.encrypted ? (
                'Збережено, зашифровано системним сховищем ключів.'
              ) : (
                <span className="warn">Збережено без шифрування (системне сховище ключів недоступне).</span>
              )
            ) : (
              <span className="warn">
                Використовується типовий ключ із docker-compose.yml — він загальновідомий. Задайте
                власний MINIO_ROOT_PASSWORD у .env, перезапустіть контейнер і введіть його тут.
              </span>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="minio-bucket">Бакет</label>
          <input
            id="minio-bucket"
            spellCheck={false}
            value={bucket}
            onChange={(e) => {
              setBucket(e.target.value)
              touch()
            }}
          />
        </div>
        {error && (
          <div className="hint err" role="alert">
            {error}
          </div>
        )}
        {saved && <div className="hint ok">Налаштування MinIO збережено.</div>}
        <div className="settings-actions">
          <button type="submit" className="btn primary">
            Зберегти MinIO
          </button>
          <button type="button" className="btn" disabled={testing} onClick={() => void onTest()}>
            {testing ? 'Перевіряю…' : 'Перевірити з’єднання'}
          </button>
        </div>
        {test && (
          <div className={`test-result ${test.ok ? 'ok' : 'err'}`} role="status">
            {test.message}
          </div>
        )}
      </form>
    </section>
  )
}
