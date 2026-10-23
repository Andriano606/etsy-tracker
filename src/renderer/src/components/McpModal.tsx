import { useEffect, useRef, useState } from 'react'
import type { McpStatus } from '@shared/types'
import {
  MCP_SERVER_NAME,
  MCP_TOOL_SUMMARY,
  claudeCodeCommand,
  claudeCodeReplaceCommand,
  claudeDesktopConfig,
  mcpJsonConfig
} from '@shared/mcpConfig'
import { formatDateTime } from '@shared/format'
import { useStore } from '../store'
import { useEscape } from './useEscape'

/** How often the open modal refreshes the server state (requests, last client). */
export const MCP_POLL_MS = 2000

/** A ready-to-paste snippet with its own "Копіювати" button. */
function CopyBlock({ id, label, text }: { id: string; label: string; text: string }): JSX.Element {
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async (): Promise<void> => {
    const ok = await window.api.copyText(text).catch(() => false)
    setState(ok ? 'ok' : 'err')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <div className="copy-block" data-testid={`copy-${id}`}>
      <div className="copy-block-head">
        <span>{label}</span>
        <button type="button" className={`btn small${state === 'ok' ? ' copied' : ''}`} onClick={() => void copy()}>
          {state === 'ok' ? 'Скопійовано ✓' : state === 'err' ? 'Не вдалося' : 'Копіювати'}
        </button>
      </div>
      <pre className="copy-block-text">{text}</pre>
    </div>
  )
}

function StatusLine({ st }: { st: McpStatus }): JSX.Element {
  if (!st.enabled) return <div className="hint">Вимкнено.</div>
  if (st.error) {
    return (
      <div className="hint err" role="alert">
        Не працює: {st.error}
      </div>
    )
  }
  if (!st.running) return <div className="hint">Запускається…</div>
  return (
    <div className="hint" data-testid="mcp-running">
      <span className="ok">● Працює</span> на <code>{st.url}</code>
      {' · '}
      {st.requests > 0
        ? `запитів: ${st.requests.toLocaleString('uk-UA')}, останній ${formatDateTime(st.lastRequestAt)}${st.lastClient ? ` (${st.lastClient})` : ''}`
        : 'ще жодного запиту'}
    </div>
  )
}

/**
 * The MCP modal: switch the local MCP server on/off, pick its port, and copy
 * a ready command/config for Claude Code, a project's .mcp.json or Claude
 * Desktop. The commands use the saved port and token.
 */
export function McpModal(): JSX.Element | null {
  const { showMcp, setShowMcp, mcpStatus: st, setMcpStatus, requestConfirm, etsyAuth } = useStore()
  const [enabled, setEnabled] = useState(false)
  const [port, setPort] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const close = (): void => setShowMcp(false)
  useEscape(close, showMcp)

  // Fresh state on every opening, then poll while open (requests, last client, errors).
  useEffect(() => {
    if (!showMcp) return
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
  }, [showMcp, setMcpStatus])

  // The form follows the saved settings when the modal opens / after a save.
  const savedKey = st ? `${st.enabled}:${st.port}` : ''
  useEffect(() => {
    if (!st) return
    setEnabled(st.enabled)
    setPort(String(st.port))
  }, [savedKey, showMcp])

  useEffect(() => {
    if (!showMcp) setError(null)
  }, [showMcp])

  if (!showMcp) return null

  const dirty = !!st && (enabled !== st.enabled || port.trim() !== String(st.port))

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const res = await window.api.setMcp({ enabled, port: port.trim() })
      if (!res.ok) setError(res.error)
      else setMcpStatus(res.status)
    } finally {
      setSaving(false)
    }
  }

  // Applied at once (not part of the port form): MCP clients may change the own store.
  const toggleWrites = async (on: boolean): Promise<void> => {
    if (
      on &&
      !(await requestConfirm(
        'Дозволити Claude змінювати ваш магазин на Etsy? Він зможе створювати лістинги (чернетки, а якщо ви попросите — публікувати їх за $0.20), редагувати лістинги й тексти магазину. Claude Code однаково питатиме дозволу на кожну дію.'
      ))
    ) {
      return
    }
    setError(null)
    const res = await window.api.setMcp({ allowWrites: on })
    if (!res.ok) setError(res.error)
    else setMcpStatus(res.status)
  }

  const regenerate = async (): Promise<void> => {
    const ok = await requestConfirm(
      'Створити новий токен? Усі вже підключені клієнти перестануть працювати, доки ви не оновите в них команду чи конфіг.'
    )
    if (!ok) return
    setMcpStatus(await window.api.regenerateMcpToken())
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal mcp-modal"
        role="dialog"
        aria-labelledby="mcp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="mcp-title">MCP — дані для Claude</h2>
        <p className="hint">
          Локальний MCP-сервер дає будь-якому Claude (Claude Code, Claude Desktop, іншим MCP-клієнтам)
          <b> читати</b> все, що зібрала програма: магазини, товари, описи, ціни й знижки, популярність,
          відгуки, фото, історію змін і статистику. Лише читання, лише з цього комп’ютера
          (127.0.0.1), лише поки програма відкрита. Для Claude це просто каталог «магазинів» і
          «товарів» — без назви майданчика, посилань на нього й сирих даних API.
        </p>

        <section className="settings-section">
          <h3>Сервер</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="field">
              <label className="check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => {
                    setEnabled(e.target.checked)
                    setError(null)
                  }}
                />{' '}
                Увімкнути MCP-сервер
              </label>
            </div>
            <div className="field">
              <label htmlFor="mcp-port">Порт</label>
              <div className="row">
                <input
                  id="mcp-port"
                  inputMode="numeric"
                  spellCheck={false}
                  value={port}
                  onChange={(e) => {
                    setPort(e.target.value)
                    setError(null)
                  }}
                />
                <button type="submit" className="btn primary" disabled={saving || !dirty}>
                  {saving ? 'Зберігаю…' : 'Зберегти'}
                </button>
              </div>
            </div>
            {error && (
              <div className="hint err" role="alert">
                {error}
              </div>
            )}
            {st && <StatusLine st={st} />}
          </form>
        </section>

        {st?.token ? (
          <section className="settings-section" data-testid="mcp-connect">
            <h3>Підключення</h3>
            {dirty && (
              <div className="hint warn">Збережіть зміни — команди нижче для збережених налаштувань.</div>
            )}
            <CopyBlock
              id="claude-code"
              label="Claude Code — у всіх проєктах (вставте в термінал)"
              text={claudeCodeCommand(st.port, st.token)}
            />
            <CopyBlock
              id="claude-code-replace"
              label={`Claude Code — якщо «${MCP_SERVER_NAME}» уже додано (новий токен чи порт)`}
              text={claudeCodeReplaceCommand(st.port, st.token)}
            />
            <CopyBlock
              id="mcp-json"
              label="Файл .mcp.json у теці проєкту (або інший клієнт з HTTP-серверами)"
              text={mcpJsonConfig(st.port, st.token)}
            />
            <CopyBlock
              id="claude-desktop"
              label="Claude Desktop — claude_desktop_config.json (потрібен Node.js: npx mcp-remote)"
              text={claudeDesktopConfig(st.port, st.token)}
            />
            <p className="hint">
              Після додавання перезапустіть Claude і перевірте: у Claude Code — <code>/mcp</code>, сервер{' '}
              <code>{MCP_SERVER_NAME}</code> має бути «connected». Потім просто питайте: «які нові товари
              з’явилися в магазинах?», «покажи найпопулярніші товари зі знижкою»…
            </p>
            {!st.tokenEncrypted && (
              <div className="hint warn">
                Токен збережено без шифрування (системне сховище ключів недоступне).
              </div>
            )}
            <div className="settings-actions">
              <button type="button" className="btn" onClick={() => void regenerate()}>
                Новий токен
              </button>
            </div>
          </section>
        ) : (
          <p className="hint">Увімкніть сервер — тут з’являться готові команди для підключення.</p>
        )}

        <section className="settings-section" data-testid="mcp-writes">
          <h3>Мій магазин через Claude</h3>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={!!st?.allowWrites}
                disabled={!st}
                onChange={(e) => void toggleWrites(e.target.checked)}
              />{' '}
              Дозволити Claude змінювати мій магазин
            </label>
            <div className="hint">
              Створювати лістинги з фото й файлами, редагувати їх, вмикати / вимикати, змінювати тексти магазину.
              Читати свої лістинги (і чернетки) Claude може й без цього.{' '}
              {!etsyAuth?.loggedIn && <span className="warn-text">Спершу увійдіть у свій магазин: «✏️ Мій магазин».</span>}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3>Що може читати Claude</h3>
          <ul className="mcp-tools">
            {MCP_TOOL_SUMMARY.filter((t) => !t.write).map((t) => (
              <li key={t.name}>
                <code>{t.name}</code> — {t.text}
              </li>
            ))}
          </ul>
          <h3>Що може змінювати (якщо дозволено)</h3>
          <ul className="mcp-tools" data-testid="mcp-write-tools">
            {MCP_TOOL_SUMMARY.filter((t) => t.write).map((t) => (
              <li key={t.name}>
                <code>{t.name}</code> — {t.text}
              </li>
            ))}
          </ul>
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
