// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { McpModal, MCP_DRAFT_TOOLS, MCP_LOCAL_TOOLS, MCP_POLL_MS } from '../../../src/renderer/src/components/McpModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { useStore } from '../../../src/renderer/src/store'
import {
  MCP_OLD_SERVER_NAMES,
  MCP_TOOL_SUMMARY,
  claudeCodeCommand,
  claudeCodeReplaceCommand,
  claudeDesktopConfig,
  mcpJsonConfig
} from '../../../src/shared/mcpConfig'
import { GLOSSARY } from '../../../src/shared/glossary'
import { mcpOff, mcpOn, setupRenderer, withKey, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ keyStatus: withKey })
})
afterEach(() => {
  vi.useRealTimers()
})

const renderIt = () =>
  render(
    <>
      <Sidebar />
      <McpModal />
      <ConfirmModal />
    </>
  )

async function open(status = mcpOff) {
  api.getMcpStatus.mockResolvedValue(status)
  useStore.setState({ mcpStatus: status })
  const r = renderIt()
  await act(async () => {
    fireEvent.click(screen.getByLabelText('MCP-сервер для Claude'))
  })
  return r
}

const serverSwitch = () => screen.getByRole('switch', { name: 'Увімкнути MCP-сервер' })
const pickClient = (name: string) => fireEvent.click(screen.getByRole('radio', { name }))

describe('MCP modal', () => {
  it('opens from the sidebar button and reads a fresh status', async () => {
    await open()
    expect(screen.getByRole('dialog', { name: 'Підключити Claude (MCP)' })).toBeInTheDocument()
    expect(api.getMcpStatus).toHaveBeenCalled()
    expect(screen.getByText('Вимкнено.')).toBeInTheDocument()
    expect(screen.getByLabelText('Порт')).toHaveValue('9102')
    expect(serverSwitch()).not.toBeChecked()
    expect(serverSwitch()).toHaveAccessibleDescription('Claude зможе підключатися до програми, поки вона відкрита.')
    expect(screen.getByRole('button', { name: 'Що таке «MCP-сервер»?' })).toHaveAccessibleDescription(GLOSSARY.mcp.short)
  })

  it('before the first enabling there are no commands, only a hint', async () => {
    await open()
    expect(screen.queryByTestId('mcp-connect')).toBeNull()
    expect(screen.getByText(/Увімкніть сервер — тут з’являться готові команди/)).toBeInTheDocument()
  })

  it('says honestly that Claude gets Etsy data from this app, and lists every tool', async () => {
    await open()
    const intro = document.querySelector('.mcp-intro')!
    expect(intro).toHaveTextContent(/Claude знає, що це дані з Etsy, зібрані цією програмою/)
    expect(intro).toHaveTextContent(/такими, як вони є на Etsy/)
    expect(intro).toHaveTextContent(/Сирих відповідей API, ключів і токенів він не отримує/)
    expect(intro).not.toHaveTextContent(/майданчик|каталог «магазинів»/)
    // No "only reads" promise next to the write switch: reading is the default, changes need a permission,
    // and the live tools spend the daily request limit (explained by the glossary).
    expect(screen.getByText(/Без окремого дозволу Claude/)).toHaveTextContent(
      /нічого не змінює на Etsy.*стан на останнє сканування.*свіжі дані з Etsy.*денний ліміт запитів.*чернетки товарів у програмі/
    )
    expect(screen.getByText(/лише якщо ви це дозволите нижче/)).toBeInTheDocument()
    expect(screen.getByText('денний ліміт запитів')).toHaveAccessibleDescription(GLOSSARY.quota.short)
    expect(screen.getByText(/витрачає денний ліміт запитів/, { selector: '.mcp-tools-note' })).toBeInTheDocument()
    // The example questions are plain text, not buttons.
    const examples = screen.getByRole('list', { name: 'Приклади запитань' })
    expect(within(examples).getAllByRole('listitem')[0]).toHaveTextContent('«Які нові товари з’явилися в магазинах?»')
    expect(within(examples).queryByRole('button')).toBeNull()
    for (const t of MCP_TOOL_SUMMARY) expect(screen.getByText(t.name, { selector: '.mcp-tool-name' })).toBeInTheDocument()
    // Grouped and folded: the user opens a group when curious.
    for (const d of document.querySelectorAll('.mcp-tools')) expect(d.closest('details')).not.toHaveAttribute('open')
  })

  it('splits the read tools by where they read: the app’s database, live Etsy, drafts in the app', async () => {
    await open()
    for (const name of [...MCP_LOCAL_TOOLS, ...MCP_DRAFT_TOOLS]) {
      expect(MCP_TOOL_SUMMARY.find((t) => t.name === name && !t.write)).toBeTruthy()
    }
    const local = screen.getByTestId('mcp-local-tools')
    const live = screen.getByTestId('mcp-live-tools')
    const drafts = screen.getByTestId('mcp-draft-tools')
    const names = (el: HTMLElement) => [...el.querySelectorAll('.mcp-tool-name')].map((c) => c.textContent)
    expect(names(local)).toEqual(MCP_TOOL_SUMMARY.filter((t) => MCP_LOCAL_TOOLS.has(t.name)).map((t) => t.name))
    expect(names(drafts)).toEqual([
      'prepare_product',
      'list_prepared_products',
      'sync_prepared_products',
      'unlink_prepared_product',
      'delete_prepared_product'
    ])
    // Everything else that only reads goes to Etsy live: the store's live listings, market search, compete, own-shop reads.
    expect(names(live)).toEqual(
      MCP_TOOL_SUMMARY.filter((t) => !t.write && !MCP_LOCAL_TOOLS.has(t.name) && !MCP_DRAFT_TOOLS.has(t.name)).map((t) => t.name)
    )
    for (const n of ['list_my_products', 'search_market', 'get_store_sections']) expect(names(live)).toContain(n)
    for (const n of ['get_product', 'list_reviews', 'get_product_image']) expect(names(local)).toContain(n)
    expect(local.closest('details')).toHaveTextContent(/Читати дані програми.*стан на останнє сканування; до Etsy API не звертаються/)
    expect(live.closest('details')).toHaveTextContent(/Читати наживо з Etsy.*Кожен виклик витрачає денний ліміт запитів/)
    // …except the category trees: read once per app run, then searched without requests.
    expect(live.closest('details')).toHaveTextContent(
      /Виняток — пошук категорій \(find_categories, list_market_categories\): дерево категорій програма завантажує з Etsy один раз, поки відкрита, і далі шукає в ньому сама, без запитів/
    )
    for (const n of ['find_categories', 'list_market_categories']) expect(names(live)).toContain(n)
    expect(drafts.closest('details')).toHaveTextContent(/Чернетки в програмі.*дозвіл на зміни для них не потрібен/)
    // The drafts button as the shop header labels it (no emoji).
    expect(drafts.closest('details')).toHaveTextContent(/кнопка «Чернетки» у шапці вашого магазину/)
    expect(names(local).length + names(live).length + names(drafts).length).toBe(MCP_TOOL_SUMMARY.filter((t) => !t.write).length)
  })

  it('the client picker’s ⓘ names all three choices', async () => {
    await open(mcpOn())
    const tip = screen.getByRole('button', { name: 'Що таке «Програма Claude»?' })
    expect(tip).toHaveAccessibleDescription(GLOSSARY['settings.claudeApp'].short)
    const radios = within(screen.getByRole('radiogroup', { name: 'Програма Claude' })).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    for (const label of ['Claude Code', 'Claude Desktop', 'Інший клієнт']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
      expect(GLOSSARY['settings.claudeApp'].short).toContain(`«${label}»`)
    }
  })

  it('the replace command says it also removes the server registered under the old name', async () => {
    expect(MCP_OLD_SERVER_NAMES).toContain('shop-catalog')
    await open(mcpOn())
    expect(screen.getByTestId('mcp-replace-note')).toHaveTextContent(
      /спершу видаляє вже доданий сервер.*Попередні версії програми називали сервер «shop-catalog» — команда прибирає і цей запис/
    )
    expect(screen.getByTestId('copy-claude-code-replace')).toHaveTextContent('claude mcp remove --scope user shop-catalog')
    expect(screen.getByTestId('copy-claude-code-replace')).toHaveTextContent(/Замінити вже доданий «etsy-tracker»/)
    pickClient('Claude Desktop')
    expect(screen.getByTestId('mcp-connect')).toHaveTextContent(/блок «shop-catalog» від попередньої версії програми, якщо він є, видаліть/)
    pickClient('Інший клієнт')
    expect(screen.getByTestId('mcp-connect')).toHaveTextContent(/запис «shop-catalog» від попередньої версії програми/)
  })

  it('enabling: the switch applies at once, then shows the running server and the command for Claude Code', async () => {
    await open()
    api.getMcpStatus.mockResolvedValue(mcpOn())
    await act(async () => {
      fireEvent.click(serverSwitch())
    })
    expect(api.setMcp).toHaveBeenCalledWith({ enabled: true })
    expect(serverSwitch()).toBeChecked()
    expect(screen.getByTestId('mcp-running')).toHaveTextContent('Працює на http://127.0.0.1:9102/mcp')
    expect(screen.getByTestId('mcp-running')).toHaveTextContent('ще жодного запиту')
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked()
    expect(within(screen.getByTestId('copy-claude-code')).getByText(claudeCodeCommand(9102, 'tok_abc-123'))).toBeInTheDocument()
  })

  it('switching off applies at once too', async () => {
    await open(mcpOn())
    api.getMcpStatus.mockResolvedValue(mcpOff)
    await act(async () => {
      fireEvent.click(serverSwitch())
    })
    expect(api.setMcp).toHaveBeenCalledWith({ enabled: false })
    expect(serverSwitch()).not.toBeChecked()
    expect(screen.getByText('Вимкнено.')).toBeInTheDocument()
  })

  it('a new port (under "Для досвідчених") is saved with its own button; every client gets its ready config', async () => {
    await open(mcpOn())
    const save = screen.getByRole('button', { name: 'Зберегти порт' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Порт'), { target: { value: '9200' } })
    expect(save).toBeEnabled()
    const status = mcpOn({ port: 9200, url: 'http://127.0.0.1:9200/mcp' })
    api.getMcpStatus.mockResolvedValue(status)
    await act(async () => {
      fireEvent.click(save)
    })
    expect(api.setMcp).toHaveBeenCalledWith({ enabled: true, port: '9200' })
    expect(screen.getByTestId('mcp-running')).toHaveTextContent('Працює на http://127.0.0.1:9200/mcp')
    expect(within(screen.getByTestId('copy-claude-code')).getByText(claudeCodeCommand(9200, 'tok_abc-123'))).toBeInTheDocument()
    expect(screen.getByTestId('copy-claude-code-replace')).toHaveTextContent(claudeCodeReplaceCommand(9200, 'tok_abc-123'))
    expect(screen.queryByTestId('copy-mcp-json')).toBeNull()
    pickClient('Інший клієнт')
    expect(screen.getByTestId('copy-mcp-json').querySelector('pre')!.textContent).toBe(mcpJsonConfig(9200, 'tok_abc-123'))
    expect(screen.queryByTestId('copy-claude-code')).toBeNull()
    pickClient('Claude Desktop')
    expect(screen.getByTestId('copy-claude-desktop').querySelector('pre')!.textContent).toBe(
      claudeDesktopConfig(9200, 'tok_abc-123')
    )
    expect(screen.getByTestId('mcp-connect')).toHaveTextContent(/Node\.js/)
  })

  it('"Копіювати" copies exactly the shown command and confirms', async () => {
    await open(mcpOn())
    const block = screen.getByTestId('copy-claude-code')
    await act(async () => {
      fireEvent.click(within(block).getByText('Копіювати'))
    })
    expect(api.copyText).toHaveBeenCalledWith(claudeCodeCommand(9102, 'tok_abc-123'))
    expect(within(block).getByText('Скопійовано')).toBeInTheDocument()
  })

  it('the confirmation goes back to "Копіювати" after a moment', async () => {
    await open(mcpOn())
    vi.useFakeTimers()
    pickClient('Інший клієнт')
    const block = screen.getByTestId('copy-mcp-json')
    await act(async () => {
      fireEvent.click(within(block).getByText('Копіювати'))
    })
    expect(within(block).getByText('Скопійовано')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(2100)
    })
    expect(within(block).getByText('Копіювати')).toBeInTheDocument()
  })

  it('a refused copy says so', async () => {
    await open(mcpOn())
    api.copyText.mockResolvedValue(false)
    pickClient('Claude Desktop')
    const block = screen.getByTestId('copy-claude-desktop')
    await act(async () => {
      fireEvent.click(within(block).getByText('Копіювати'))
    })
    expect(within(block).getByText('Не вдалося')).toBeInTheDocument()
  })

  it('a port out of range is flagged while typing and cannot be saved', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Порт'), { target: { value: '80' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Порт — ціле число від 1024 до 65535.')
    expect(screen.getByLabelText('Порт')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Зберегти порт' })).toBeDisabled()
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('Порт').closest('form')!)
    })
    expect(api.setMcp).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Порт'), { target: { value: '9200' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Порт')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Зберегти порт' })).toBeEnabled()
  })

  it('a port main refuses is shown and nothing changes', async () => {
    await open()
    api.setMcp.mockResolvedValue({ ok: false, error: 'Порт 9200 уже зайнятий іншою програмою — виберіть інший.' })
    fireEvent.change(screen.getByLabelText('Порт'), { target: { value: '9200' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Зберегти порт' }))
    })
    expect(api.setMcp).toHaveBeenCalledWith({ enabled: false, port: '9200' })
    expect(screen.getByRole('alert')).toHaveTextContent('Порт 9200 уже зайнятий')
    expect(screen.getByLabelText('Порт')).toHaveAttribute('aria-invalid', 'true')
    expect(useStore.getState().mcpStatus).toEqual(mcpOff)
  })

  it('switched off with a token: the commands stay, with a warning that Claude cannot connect', async () => {
    await open(mcpOn({ enabled: false, running: false }))
    expect(screen.getByTestId('copy-claude-code')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-connect')).toHaveTextContent(/Сервер вимкнено — Claude не зможе підключитися/)
  })

  it('enabled but failing: the commands warn that the server does not work', async () => {
    await open(mcpOn({ running: false, error: 'Порт 9102 уже зайнятий іншою програмою — виберіть інший.' }))
    expect(screen.getByTestId('mcp-connect')).toHaveTextContent(/Сервер зараз не працює/)
  })

  it('running: no such warning', async () => {
    await open(mcpOn())
    expect(screen.getByTestId('mcp-connect')).not.toHaveTextContent(/Сервер вимкнено|Сервер зараз не працює/)
  })

  it('a busy port: the server error is shown', async () => {
    await open(mcpOn({ running: false, error: 'Порт 9102 уже зайнятий іншою програмою — виберіть інший.' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Не працює: Порт 9102 уже зайнятий')
    // The port field (under "Для досвідчених") opens by itself.
    expect(screen.getByLabelText('Порт').closest('details')).toHaveAttribute('open')
  })

  it('unsaved changes: warns that the commands are for the saved settings', async () => {
    await open(mcpOn())
    fireEvent.change(screen.getByLabelText('Порт'), { target: { value: '9300' } })
    expect(screen.getByText(/Збережіть зміни — команди нижче для збережених налаштувань/)).toBeInTheDocument()
  })

  it('shows requests and the last client; polls while open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await open(mcpOn())
    api.getMcpStatus.mockResolvedValue(mcpOn({ requests: 3, lastRequestAt: Date.now(), lastClient: 'claude-code' }))
    await act(async () => {
      vi.advanceTimersByTime(MCP_POLL_MS + 10)
    })
    await waitFor(() => expect(screen.getByTestId('mcp-running')).toHaveTextContent(/запитів: 3, останній .*\(claude-code\)/))
  })

  it('stops polling when closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await open(mcpOn())
    await act(async () => {
      fireEvent.click(screen.getByText('Закрити'))
    })
    const n = api.getMcpStatus.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(MCP_POLL_MS * 3)
    })
    expect(api.getMcpStatus.mock.calls.length).toBe(n)
  })

  it('"Новий токен" asks first; confirmed, the commands show the new token', async () => {
    await open(mcpOn())
    await act(async () => {
      fireEvent.click(screen.getByText('Новий токен'))
    })
    expect(screen.getByText(/Усі вже підключені клієнти перестануть працювати/)).toBeInTheDocument()
    expect(screen.getByRole('alertdialog', { name: 'Новий токен доступу' })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('Скасувати'))
    })
    expect(api.regenerateMcpToken).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText('Новий токен'))
    })
    api.getMcpStatus.mockResolvedValue(mcpOn({ token: 'tok_new-456' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Створити новий токен' }))
    })
    expect(api.regenerateMcpToken).toHaveBeenCalled()
    expect(screen.getByTestId('copy-claude-code')).toHaveTextContent('tok_new-456')
  })

  it('warns when the token is stored without a keyring', async () => {
    await open(mcpOn({ tokenEncrypted: false }))
    expect(screen.getByText(/Токен збережено без шифрування/)).toBeInTheDocument()
  })

  it('"Для досвідчених" is folded while the server works', async () => {
    await open(mcpOn())
    expect(screen.getByLabelText('Порт').closest('details')).not.toHaveAttribute('open')
  })

  it('Escape and the backdrop close it', async () => {
    const { container } = await open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByLabelText('MCP-сервер для Claude'))
    })
    fireEvent.click(container.querySelector('.modal-backdrop')!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('MCP modal: changes to the own store', () => {
  it('lists read tools and write tools separately', async () => {
    await open(mcpOn())
    const writes = screen.getByTestId('mcp-write-tools')
    for (const name of ['create_product', 'update_my_product', 'add_product_media', 'update_my_store']) {
      expect(within(writes).getByText(name)).toBeInTheDocument()
    }
    expect(within(writes).queryByText('list_my_products')).toBeNull()
    expect(writes.closest('details')).toHaveTextContent(/Змінювати мій магазин — лише з дозволом/)
    // Descriptions read as sentences.
    const first = MCP_TOOL_SUMMARY[0].text
    expect(screen.getByText(first.charAt(0).toUpperCase() + first.slice(1))).toBeInTheDocument()
  })

  it('turning "allow changes" on asks first and saves only that; off needs no confirm', async () => {
    useStore.setState({ etsyAuth: { loggedIn: true, redirectUri: '', pending: false, encrypted: true, shopId: 1 } })
    await open(mcpOn())
    const box = screen.getByLabelText('Дозволити Claude змінювати мій магазин')
    expect(box).not.toBeChecked()
    expect(screen.queryByText(/Спершу увійдіть у свій магазин/)).toBeNull()
    await act(async () => {
      fireEvent.click(box)
    })
    expect(screen.getByText(/Дозволити Claude змінювати ваш магазин на Etsy\?/)).toBeInTheDocument()
    expect(screen.getByRole('alertdialog', { name: 'Зміни у вашому магазині' })).toHaveTextContent(
      /публікація коштує \$0,20.*видаляти.*ціни й залишки.*позначати замовлення відправленими.*за замовчуванням питає дозволу/
    )
    // A risky grant: its own heading, a verb on the red button, and the focus on "Скасувати".
    const dialog = screen.getByRole('alertdialog', { name: 'Зміни у вашому магазині' })
    expect(within(dialog).getByRole('button', { name: 'Дозволити зміни' })).toHaveClass('stop') // danger-solid
    expect(within(dialog).getByRole('button', { name: 'Скасувати' })).toHaveFocus()
    await act(async () => {
      fireEvent.click(screen.getByText('Скасувати'))
    })
    expect(api.setMcp).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(box)
    })
    api.getMcpStatus.mockResolvedValue(mcpOn({ allowWrites: true }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Дозволити зміни' }))
    })
    expect(api.setMcp).toHaveBeenCalledWith({ allowWrites: true })
    expect(screen.getByLabelText('Дозволити Claude змінювати мій магазин')).toBeChecked()
    expect(screen.getByText('Claude може змінювати ваш магазин на Etsy')).toBeInTheDocument()
    api.setMcp.mockClear()
    api.getMcpStatus.mockResolvedValue(mcpOn({ allowWrites: false }))
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Дозволити Claude змінювати мій магазин'))
    })
    expect(api.setMcp).toHaveBeenCalledWith({ allowWrites: false })
  })

  it('reminds to sign in to the own store first', async () => {
    await open(mcpOn())
    expect(screen.getByText(/Спершу увійдіть у свій магазин/)).toBeInTheDocument()
  })
})

describe('Sidebar MCP button', () => {
  it('a green dot while the server runs, a red one when enabled but failing, none when off', () => {
    useStore.setState({ mcpStatus: mcpOn() })
    const { container, rerender } = render(<Sidebar />)
    const btn = () => screen.getByLabelText('MCP-сервер для Claude')
    expect(btn().querySelector('.dot-ok')).not.toBeNull()
    // The state is in the button's tooltip (its accessible description).
    expect(btn()).toHaveAccessibleDescription(/Зараз увімкнено і працює\./)
    act(() => useStore.setState({ mcpStatus: mcpOn({ running: false, error: 'busy' }) }))
    rerender(<Sidebar />)
    expect(btn().querySelector('.dot-ok')).toBeNull()
    expect(btn().querySelector('.dot-warn')).not.toBeNull()
    expect(btn()).toHaveAccessibleDescription(/не вдалося запустити/)
    act(() => useStore.setState({ mcpStatus: mcpOff }))
    rerender(<Sidebar />)
    expect(container.querySelector('.mcp-btn .dot-ok, .mcp-btn .dot-warn')).toBeNull()
    expect(btn()).toHaveAccessibleDescription(/Зараз вимкнено\./)
  })
})
