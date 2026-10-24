import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { McpStatus } from '@shared/types'
import {
  MCP_OLD_SERVER_NAMES,
  MCP_SERVER_NAME,
  validateMcpPort,
  MCP_TOOL_SUMMARY,
  claudeCodeCommand,
  claudeCodeReplaceCommand,
  claudeDesktopConfig,
  mcpJsonConfig
} from '@shared/mcpConfig'
import { formatDateTime } from '@shared/format'
import { useStore } from '../store'
import { Badge, Button, Callout, EmptyState, Field, Icon, InfoTip, Modal, Segmented, Term, Toggle } from '../ui'

/** How often the open modal refreshes the server state (requests, last client). */
export const MCP_POLL_MS = 2000

type ClientKind = 'code' | 'desktop' | 'other'

const CLIENTS = [
  { value: 'code' as const, label: 'Claude Code', hint: 'Claude у терміналі' },
  { value: 'desktop' as const, label: 'Claude Desktop', hint: 'Програма Claude для комп’ютера' },
  { value: 'other' as const, label: 'Інший клієнт', hint: 'Будь-яка програма, що підтримує MCP-сервери за адресою' }
]

/**
 * Read tools that answer from the app's own database (the data as of the last
 * scan; listing/review photos from MinIO, else Etsy's CDN; logos, banners and
 * video frames from the CDN) — no Etsy API request, no quota.
 * Every other read tool (not a draft tool) calls the Etsy API live — on the
 * daily quota, except the category trees (find_categories,
 * list_market_categories): read once per app run, then answered from memory.
 */
export const MCP_LOCAL_TOOLS: ReadonlySet<string> = new Set([
  'list_stores',
  'get_store',
  'search_products',
  'get_product',
  'get_product_history',
  'list_snapshots',
  'get_snapshot_changes',
  'list_reviews',
  'get_store_stats',
  'get_product_image',
  'get_store_logo',
  'get_product_video_preview',
  'get_review_photo'
])

/** Drafts kept in the app (nothing reaches Etsy until one is sent); sending is a write tool. */
export const MCP_DRAFT_TOOLS: ReadonlySet<string> = new Set(['prepare_product', 'list_prepared_products', 'delete_prepared_product'])

const OLD_NAMES = MCP_OLD_SERVER_NAMES.map((n) => `«${n}»`).join(', ')

const EXAMPLES = ['Які нові товари з’явилися в магазинах?', 'Покажи найпопулярніші товари зі знижкою', 'Що пишуть у відгуках про цей товар?']

/** What ConfirmModal can show besides the message: its own heading, a verb on the button, the red style. */
export interface ConfirmOptions {
  message: string
  title?: string
  confirmLabel?: string
  danger?: boolean
}

/**
 * Like the store's requestConfirm (same dialog, same resolve path), but with a
 * heading and a button that say what happens ("Видалити ключ", "Дозволити
 * зміни") — ConfirmModal reads these optional fields of the request.
 */
export function confirmWith(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const request = { ...opts, onResolve: resolve }
    useStore.setState({ confirmRequest: request })
  })
}

/** A ready-to-paste snippet with its own "Копіювати" button. */
export function CopyBlock({ id, label, text }: { id: string; label: ReactNode; text: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const copy = async (): Promise<void> => {
    const ok = await window.api.copyText(text).catch(() => false)
    setState(ok ? 'ok' : 'err')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <div className="copy-block" data-testid={`copy-${id}`}>
      <div className="copy-block-head">
        <span className="copy-block-label">{label}</span>
        <Button
          size="sm"
          icon={state === 'ok' ? 'check' : state === 'err' ? 'warning' : 'copy'}
          className={state === 'ok' ? 'copied' : state === 'err' ? 'copy-failed' : undefined}
          onClick={() => void copy()}
        >
          {state === 'ok' ? 'Скопійовано' : state === 'err' ? 'Не вдалося' : 'Копіювати'}
        </Button>
      </div>
      <pre className="copy-block-text">{text}</pre>
    </div>
  )
}

function StatusLine({ st }: { st: McpStatus }): JSX.Element {
  if (!st.enabled) {
    return (
      <div className="mcp-status is-off">
        <span className="mcp-dot" aria-hidden="true" />
        <span>Вимкнено.</span>
        <span className="mcp-status-meta">Claude не має доступу до даних програми.</span>
      </div>
    )
  }
  if (st.error) {
    return (
      <div className="mcp-status is-error" role="alert">
        <span className="mcp-dot" aria-hidden="true" />
        <span>
          Не працює: {st.error} <span className="mcp-status-meta">Номер порту можна змінити в розділі «Для досвідчених».</span>
        </span>
      </div>
    )
  }
  if (!st.running) {
    return (
      <div className="mcp-status is-off">
        <span className="mcp-dot" aria-hidden="true" />
        <span>Запускається…</span>
      </div>
    )
  }
  return (
    <div className="mcp-status is-on" data-testid="mcp-running">
      <span className="mcp-dot" aria-hidden="true" />
      <span className="min-w-0">
        <b>Працює</b> на <code>{st.url}</code>
        <span className="mcp-status-meta">
          {' · '}
          {st.requests > 0
            ? `запитів: ${st.requests.toLocaleString('uk-UA')}, останній ${formatDateTime(st.lastRequestAt)}${st.lastClient ? ` (${st.lastClient})` : ''}`
            : 'ще жодного запиту'}
        </span>
      </span>
    </div>
  )
}

/** validateMcpPort's message, or null for a valid port. */
function portCheck(raw: string): string | null {
  try {
    validateMcpPort(raw)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function ToolList({ tools, testId }: { tools: typeof MCP_TOOL_SUMMARY; testId?: string }): JSX.Element {
  return (
    <ul className="mcp-tools" data-testid={testId}>
      {tools.map((t) => (
        <li key={t.name}>
          <span className="mcp-tool-text">{cap(t.text)}</span>
          <code className="mcp-tool-name">{t.name}</code>
        </li>
      ))}
    </ul>
  )
}

/** The steps for one kind of Claude app, with its ready command / config. */
function ConnectSteps({ client, st }: { client: ClientKind; st: McpStatus & { token: string } }): JSX.Element {
  if (client === 'code') {
    return (
      <ol className="mcp-steps">
        <li>
          <p>
            Відкрийте <Term glossary="settings.terminal">термінал</Term> і вставте команду — сервер стане доступним у всіх
            ваших проєктах:
          </p>
          <CopyBlock id="claude-code" label="Команда для Claude Code" text={claudeCodeCommand(st.port, st.token)} />
          <details className="settings-details is-inline">
            <summary>
              <Icon name="chevron-right" size={16} className="settings-details-chevron" />
              Уже підключали раніше, змінився порт чи токен?
            </summary>
            <div className="settings-details-body">
              <p className="settings-note" data-testid="mcp-replace-note">
                Ця команда спершу видаляє вже доданий сервер, а тоді додає його знову з поточними портом і токеном.
                Попередні версії програми називали сервер {OLD_NAMES} — команда прибирає і цей запис, щоб у Claude не
                лишилося двох серверів.
              </p>
              <CopyBlock
                id="claude-code-replace"
                label={`Замінити вже доданий «${MCP_SERVER_NAME}»`}
                text={claudeCodeReplaceCommand(st.port, st.token)}
              />
            </div>
          </details>
        </li>
        <li>
          <p>
            Перезапустіть Claude Code і введіть <code>/mcp</code> — сервер <code>{MCP_SERVER_NAME}</code> має бути
            «connected».
          </p>
        </li>
      </ol>
    )
  }
  if (client === 'desktop') {
    return (
      <ol className="mcp-steps">
        <li>
          <p>
            Встановіть Node.js (безкоштовно, з сайту nodejs.org) — через нього Claude Desktop під’єднується до програми.
          </p>
        </li>
        <li>
          <p>
            У Claude Desktop відкрийте Settings → Developer → Edit Config і вставте це у файл claude_desktop_config.json
            (якщо там уже є інші сервери — додайте лише блок «{MCP_SERVER_NAME}»; блок {OLD_NAMES} від попередньої
            версії програми, якщо він є, видаліть):
          </p>
          <CopyBlock id="claude-desktop" label="Налаштування для Claude Desktop" text={claudeDesktopConfig(st.port, st.token)} />
        </li>
        <li>
          <p>Повністю закрийте й знову відкрийте Claude Desktop.</p>
        </li>
      </ol>
    )
  }
  return (
    <ol className="mcp-steps">
      <li>
        <p>
          Для файлу .mcp.json у теці проєкту або будь-якої іншої програми, що вміє підключатися до MCP-сервера за адресою
          (запис {OLD_NAMES} від попередньої версії програми, якщо він є, видаліть):
        </p>
        <CopyBlock id="mcp-json" label="Налаштування сервера" text={mcpJsonConfig(st.port, st.token)} />
      </li>
    </ol>
  )
}

/**
 * The MCP modal: switch the local MCP server on/off (applied at once), copy a
 * ready command/config for Claude Code, Claude Desktop or another client, allow
 * changes to the own store, and — under "Для досвідчених" — the port and token.
 * The commands use the saved port and token.
 */
export function McpModal(): JSX.Element | null {
  const { showMcp, setShowMcp } = useStore()
  if (!showMcp) return null
  return <McpDialog onClose={() => setShowMcp(false)} />
}

function McpDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { mcpStatus: st, setMcpStatus, etsyAuth } = useStore()
  const [port, setPort] = useState(st ? String(st.port) : '')
  const [error, setError] = useState<string | null>(null)
  const [portError, setPortError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [savingPort, setSavingPort] = useState(false)
  const [client, setClient] = useState<ClientKind>('code')
  const [advanced, setAdvanced] = useState(!!st?.error)

  // Fresh state on opening, then poll while open (requests, last client, errors).
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void window.api
        .getMcpStatus()
        .then((s) => {
          if (alive) setMcpStatus(s)
        })
        .catch(() => undefined)
    }
    refresh()
    const t = setInterval(refresh, MCP_POLL_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [setMcpStatus])

  // The port field follows the saved port (on opening / after a save).
  const savedPort = st ? String(st.port) : ''
  useEffect(() => {
    if (savedPort) setPort(savedPort)
  }, [savedPort])

  // A server that can't start (busy port) → show the port field.
  const failing = !!st?.enabled && !!st.error
  useEffect(() => {
    if (failing) setAdvanced(true)
  }, [failing])

  const dirty = !!st && port.trim() !== String(st.port)
  // Checked while typing (the same rule main applies); a busy port is main's answer.
  const portInvalid = dirty ? portCheck(port) : null

  const setEnabled = async (on: boolean): Promise<void> => {
    setSwitching(true)
    setError(null)
    try {
      const res = await window.api.setMcp({ enabled: on })
      if (!res.ok) setError(res.error)
      else setMcpStatus(res.status)
    } finally {
      setSwitching(false)
    }
  }

  const savePort = async (): Promise<void> => {
    setSavingPort(true)
    setPortError(null)
    try {
      const res = await window.api.setMcp({ enabled: !!st?.enabled, port: port.trim() })
      if (!res.ok) setPortError(res.error)
      else setMcpStatus(res.status)
    } finally {
      setSavingPort(false)
    }
  }

  // Applied at once: MCP clients may change the own store.
  const toggleWrites = async (on: boolean): Promise<void> => {
    if (
      on &&
      !(await confirmWith({
        title: 'Зміни у вашому магазині',
        message:
          'Дозволити Claude змінювати ваш магазин на Etsy? Він зможе створювати й публікувати товари (публікація коштує $0,20), змінювати й видаляти їх, міняти ціни й залишки, фото й файли, тексти, розділи, доставку й політики магазину, позначати замовлення відправленими (покупець отримає лист від Etsy). Зміни одразу потрапляють на Etsy. Claude Code за замовчуванням питає дозволу на кожен виклик інструмента.',
        confirmLabel: 'Дозволити зміни',
        danger: true
      }))
    ) {
      return
    }
    setError(null)
    const res = await window.api.setMcp({ allowWrites: on })
    if (!res.ok) setError(res.error)
    else setMcpStatus(res.status)
  }

  const regenerate = async (): Promise<void> => {
    const ok = await confirmWith({
      title: 'Новий токен доступу',
      message:
        'Створити новий токен? Усі вже підключені клієнти перестануть працювати, доки ви не оновите в них команду чи конфіг.',
      confirmLabel: 'Створити новий токен'
    })
    if (!ok) return
    setMcpStatus(await window.api.regenerateMcpToken())
  }

  const localTools = MCP_TOOL_SUMMARY.filter((t) => !t.write && MCP_LOCAL_TOOLS.has(t.name))
  const draftTools = MCP_TOOL_SUMMARY.filter((t) => !t.write && MCP_DRAFT_TOOLS.has(t.name))
  const liveTools = MCP_TOOL_SUMMARY.filter((t) => !t.write && !MCP_LOCAL_TOOLS.has(t.name) && !MCP_DRAFT_TOOLS.has(t.name))
  const writeTools = MCP_TOOL_SUMMARY.filter((t) => t.write)
  const token = st?.token ?? null

  return (
    <Modal
      title="Підключити Claude (MCP)"
      subtitle="Помічник Claude зможе читати зібрані дані й відповідати на ваші запитання про них"
      size="lg"
      onClose={onClose}
      className="mcp-modal"
      footer={
        <>
          <span className="ui-modal-foot-start settings-foot-note">
            <Icon name="lock" size={14} />
            Сервер працює лише на цьому комп’ютері й лише поки програма відкрита.
          </span>
          <Button onClick={onClose}>Закрити</Button>
        </>
      }
    >
      <section className="ui-section mcp-intro">
        <p className="ui-section-desc">
          <Term glossary="claude" /> — помічник зі штучним інтелектом. Підключіть його до програми через{' '}
          <Term glossary="mcp">MCP-сервер</Term> — і просто питайте його про магазини Etsy, за якими стежите: товари,
          ціни й знижки, популярність, відгуки, фото, історію змін і статистику. Claude знає, що це дані з Etsy, зібрані
          цією програмою, і бачить тексти товарів, політик і відгуків такими, як вони є на Etsy. Сирих відповідей API,
          ключів і токенів він не отримує.
        </p>
        <ul className="settings-facts mcp-can">
          <li>
            <Icon name="eye" size={16} />
            <span>
              Без окремого дозволу Claude нічого не змінює на Etsy, а <b>лише читає</b>: дані, які програма зібрала під
              час сканувань (стан на останнє сканування), а деякі інструменти — свіжі дані з Etsy (вони витрачають{' '}
              <Term glossary="quota">денний ліміт запитів</Term>). Ще він може готувати чернетки товарів у програмі — на
              Etsy вони потрапляють, лише коли їх надіслати.
            </span>
          </li>
          <li>
            <Icon name="edit" size={16} />
            <span>Змінювати ваш власний магазин він може, лише якщо ви це дозволите нижче. Чужі магазини — ніколи.</span>
          </li>
        </ul>
        <div className="mcp-examples">
          <span className="mcp-examples-label">Наприклад, запитайте:</span>
          <ul aria-label="Приклади запитань">
            {EXAMPLES.map((q) => (
              <li key={q}>«{q}»</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ui-section">
        <h3 className="ui-section-title">Сервер</h3>
        <div className="settings-toggle-card">
          <Toggle
            label="Увімкнути MCP-сервер"
            glossary="mcp"
            hint="Claude зможе підключатися до програми, поки вона відкрита."
            checked={!!st?.enabled}
            disabled={!st || switching}
            onChange={(on) => void setEnabled(on)}
          />
          {st && <StatusLine st={st} />}
        </div>
        {error && (
          <Callout tone="error" compact className="settings-msg">
            {error}
          </Callout>
        )}
      </section>

      <section className="ui-section" data-testid={token ? 'mcp-connect' : undefined}>
        <h3 className="ui-section-title">Як підключити Claude</h3>
        {st && token ? (
          <>
            {!st.enabled ? (
              <Callout tone="warn" role="note" compact className="settings-msg">
                Сервер вимкнено — Claude не зможе підключитися, доки ви не увімкнете його вище.
              </Callout>
            ) : st.error ? (
              <Callout tone="warn" role="note" compact className="settings-msg">
                Сервер зараз не працює — Claude не зможе підключитися, доки ви не виправите помилку вище.
              </Callout>
            ) : null}
            {dirty && (
              <Callout tone="warn" role="note" compact className="settings-msg">
                Збережіть зміни — команди нижче для збережених налаштувань.
              </Callout>
            )}
            <div className="mcp-client-pick">
              <span className="mcp-client-label">
                Де ви користуєтесь Claude? <InfoTip glossary="settings.claudeApp" />
              </span>
              <Segmented label="Програма Claude" value={client} onChange={setClient} options={CLIENTS} />
            </div>
            <ConnectSteps client={client} st={{ ...st, token }} />
          </>
        ) : (
          <EmptyState compact icon="power" title="Сервер ще не вмикали">
            Увімкніть сервер — тут з’являться готові команди для підключення.
          </EmptyState>
        )}
      </section>

      <section className="ui-section" data-testid="mcp-writes">
        <h3 className="ui-section-title">Мій магазин через Claude</h3>
        <div className="settings-toggle-card">
          <Toggle
            label="Дозволити Claude змінювати мій магазин"
            glossary="settings.mcpWrites"
            hint="Створювати, публікувати, редагувати й видаляти товари (ціни, залишки, фото, відео, файли, атрибути), змінювати тексти, розділи, доставку й політики магазину, позначати замовлення відправленими. Читати свій магазин (і чернетки на Etsy) Claude може й без цього, якщо ви увійшли."
            checked={!!st?.allowWrites}
            disabled={!st}
            onChange={(on) => void toggleWrites(on)}
          />
        </div>
        {!etsyAuth?.loggedIn && (
          <Callout tone="info" role="note" compact className="settings-msg">
            Спершу увійдіть у свій магазин: «Мій магазин» у бічній панелі.
          </Callout>
        )}
        {st?.allowWrites && (
          <Callout tone="warn" role="note" compact className="settings-msg" title="Claude може змінювати ваш магазин на Etsy">
            Зміни одразу бачать покупці, а публікація товару платна. Вимкніть цей дозвіл, коли він не потрібен.
          </Callout>
        )}
      </section>

      <section className="ui-section">
        <h3 className="ui-section-title">
          Що вміє Claude <InfoTip glossary="settings.mcpTools" />
        </h3>
        <details className="settings-details">
          <summary>
            <Icon name="chevron-right" size={16} className="settings-details-chevron" />
            <Icon name="eye" size={16} />
            Читати дані програми
            <Badge>{localTools.length}</Badge>
          </summary>
          <div className="settings-details-body">
            <p className="settings-note">
              Відповідають з бази програми — стан на останнє сканування; до Etsy API не звертаються. Фото товарів і
              відгуків беруться з вашого сховища MinIO (якщо копії там немає — з Etsy), логотипи, банери й кадри відео — з
              Etsy; ліміт запитів на це не витрачається.
            </p>
            <ToolList tools={localTools} testId="mcp-local-tools" />
          </div>
        </details>
        <details className="settings-details">
          <summary>
            <Icon name="chevron-right" size={16} className="settings-details-chevron" />
            <Icon name="eye" size={16} />
            Читати наживо з Etsy
            <Badge>{liveTools.length}</Badge>
          </summary>
          <div className="settings-details-body">
            <p className="settings-note mcp-tools-note">
              Звертаються до Etsy API напряму: пошук по всьому Etsy, свіжі дані будь-якого магазину й товару, ваш
              власний магазин (для нього потрібен вхід у «Мій магазин»). Кожен виклик витрачає денний ліміт запитів{' '}
              <InfoTip glossary="quota" />. Виняток — пошук категорій (<code>find_categories</code>,{' '}
              <code>list_market_categories</code>): дерево категорій програма завантажує з Etsy один раз, поки відкрита,
              і далі шукає в ньому сама, без запитів.
            </p>
            <ToolList tools={liveTools} testId="mcp-live-tools" />
          </div>
        </details>
        <details className="settings-details">
          <summary>
            <Icon name="chevron-right" size={16} className="settings-details-chevron" />
            <Icon name="edit" size={16} />
            Чернетки в програмі
            <Badge>{draftTools.length}</Badge>
          </summary>
          <div className="settings-details-body">
            <p className="settings-note">
              Чернетки зберігаються лише в програмі (кнопка «Чернетки» у шапці вашого магазину — вона з’являється, коли ви увійшли в Etsy), дозвіл на зміни для них не потрібен. На Etsy чернетку
              надсилаєте ви самі — або Claude інструментом <code>send_prepared_product</code>, якщо зміни дозволено.
            </p>
            <ToolList tools={draftTools} testId="mcp-draft-tools" />
          </div>
        </details>
        <details className="settings-details">
          <summary>
            <Icon name="chevron-right" size={16} className="settings-details-chevron" />
            <Icon name="edit" size={16} />
            Змінювати мій магазин — лише з дозволом
            <Badge tone="warn">{writeTools.length}</Badge>
          </summary>
          <div className="settings-details-body">
            <ToolList tools={writeTools} testId="mcp-write-tools" />
          </div>
        </details>
      </section>

      <section className="ui-section">
        <details className="settings-details" open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
          <summary>
            <Icon name="chevron-right" size={16} className="settings-details-chevron" />
            Для досвідчених: порт і токен
          </summary>
          <div className="settings-details-body">
            <form
              className="mcp-port-row"
              onSubmit={(e) => {
                e.preventDefault()
                if (dirty && !portInvalid) void savePort()
              }}
            >
              <Field
                label="Порт"
                glossary="port"
                aside="1024–65535"
                hint="Змінюйте, лише якщо цей номер уже зайняла інша програма."
                error={portInvalid ?? portError ?? undefined}
              >
                <input
                  id="mcp-port"
                  inputMode="numeric"
                  spellCheck={false}
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value)
                    setPortError(null)
                  }}
                />
              </Field>
              <Button type="submit" variant="primary" busy={savingPort} disabled={!dirty || !!portInvalid}>
                {savingPort ? 'Зберігаю…' : 'Зберегти порт'}
              </Button>
            </form>

            {token && (
              <div className="mcp-token">
                <div className="mcp-token-text">
                  <div className="ui-field-head">
                    <span className="ui-field-label">Токен</span>
                    <InfoTip glossary="mcpToken" />
                  </div>
                  <p className="settings-note">
                    Уже вписаний у команди вище. Створіть новий, якщо команда чи конфіг потрапили до сторонніх.
                  </p>
                </div>
                <Button icon="refresh" onClick={() => void regenerate()}>
                  Новий токен
                </Button>
              </div>
            )}
            {token && st && !st.tokenEncrypted && (
              <Callout tone="warn" role="note" compact className="settings-msg">
                Токен збережено без шифрування (системне сховище ключів недоступне).
              </Callout>
            )}
          </div>
        </details>
      </section>
    </Modal>
  )
}
