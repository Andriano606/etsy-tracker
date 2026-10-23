// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { McpModal, MCP_POLL_MS } from '../../../src/renderer/src/components/McpModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { useStore } from '../../../src/renderer/src/store'
import {
  MCP_TOOL_SUMMARY,
  claudeCodeCommand,
  claudeCodeReplaceCommand,
  claudeDesktopConfig,
  mcpJsonConfig
} from '../../../src/shared/mcpConfig'
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

describe('MCP modal', () => {
  it('opens from the sidebar button and reads a fresh status', async () => {
    await open()
    expect(screen.getByRole('dialog', { name: 'MCP — дані для Claude' })).toBeInTheDocument()
    expect(api.getMcpStatus).toHaveBeenCalled()
    expect(screen.getByText('Вимкнено.')).toBeInTheDocument()
    expect(screen.getByLabelText('Порт')).toHaveValue('9102')
    expect(screen.getByLabelText('Увімкнути MCP-сервер')).not.toBeChecked()
  })

  it('before the first enabling there are no commands, only a hint', async () => {
    await open()
    expect(screen.queryByTestId('mcp-connect')).toBeNull()
    expect(screen.getByText(/Увімкніть сервер — тут з’являться готові команди/)).toBeInTheDocument()
  })

  it('explains that the client sees neutral data and lists every tool', async () => {
    await open()
    expect(screen.getByText(/без назви майданчика/)).toBeInTheDocument()
    for (const t of MCP_TOOL_SUMMARY) expect(screen.getByText(t.name)).toBeInTheDocument()
  })

  it('enabling: saves on + port, then shows the running server and the ready commands', async () => {
    await open()
    const save = screen.getByText('Зберегти')
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Увімкнути MCP-сервер'))
    fireEvent.change(screen.getByLabelText('Порт'), { target: { value: '9200' } })
    expect(save).toBeEnabled()
    const status = mcpOn({ port: 9200, url: 'http://127.0.0.1:9200/mcp' })
    api.getMcpStatus.mockResolvedValue(status)
    await act(async () => {
      fireEvent.click(save)
    })
    expect(api.setMcp).toHaveBeenCalledWith({ enabled: true, port: '9200' })
    expect(screen.getByTestId('mcp-running')).toHaveTextContent('Працює на http://127.0.0.1:9200/mcp')
    expect(screen.getByTestId('mcp-running')).toHaveTextContent('ще жодного запиту')
    expect(within(screen.getByTestId('copy-claude-code')).getByText(claudeCodeCommand(9200, 'tok_abc-123'))).toBeInTheDocument()
    expect(screen.getByTestId('copy-claude-code-replace')).toHaveTextContent(claudeCodeReplaceCommand(9200, 'tok_abc-123'))
    expect(screen.getByTestId('copy-mcp-json').querySelector('pre')!.textContent).toBe(mcpJsonConfig(9200, 'tok_abc-123'))
    expect(screen.getByTestId('copy-claude-desktop').querySelector('pre')!.textContent).toBe(
      claudeDesktopConfig(9200, 'tok_abc-123')
    )
  })

  it('"Копіювати" copies exactly the shown command and confirms', async () => {
    await open(mcpOn())
    const block = screen.getByTestId('copy-claude-code')
    await act(async () => {
      fireEvent.click(within(block).getByText('Копіювати'))
    })
    expect(api.copyText).toHaveBeenCalledWith(claudeCodeCommand(9102, 'tok_abc-123'))
    expect(within(block).getByText('Скопійовано ✓')).toBeInTheDocument()
  })

  it('the confirmation goes back to "Копіювати" after a moment', async () => {
    await open(mcpOn())
    vi.useFakeTimers()
    const block = screen.getByTestId('copy-mcp-json')
    await act(async () => {
      fireEvent.click(within(block).getByText('Копіювати'))
    })
    expect(within(block).getByText('Скопійовано ✓')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(2100)
    })
    expect(within(block).getByText('Копіювати')).toBeInTheDocument()
  })

  it('a refused copy says so', async () => {
    await open(mcpOn())
    api.copyText.mockResolvedValue(false)
    const block = screen.getByTestId('copy-claude-desktop')
    await act(async () => {
      fireEvent.click(within(block).getByText('Копіювати'))
    })
    expect(within(block).getByText('Не вдалося')).toBeInTheDocument()
  })

  it('a refused port is shown and nothing changes', async () => {
    await open()
    api.setMcp.mockResolvedValue({ ok: false, error: 'Порт — ціле число від 1024 до 65535.' })
    fireEvent.change(screen.getByLabelText('Порт'), { target: { value: '80' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Зберегти'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Порт — ціле число від 1024 до 65535.')
    expect(useStore.getState().mcpStatus).toEqual(mcpOff)
  })

  it('a busy port: the server error is shown', async () => {
    await open(mcpOn({ running: false, error: 'Порт 9102 уже зайнятий іншою програмою — виберіть інший.' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Не працює: Порт 9102 уже зайнятий')
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
    await act(async () => {
      fireEvent.click(screen.getByText('Скасувати'))
    })
    expect(api.regenerateMcpToken).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText('Новий токен'))
    })
    api.getMcpStatus.mockResolvedValue(mcpOn({ token: 'tok_new-456' }))
    await act(async () => {
      fireEvent.click(screen.getByText('Підтвердити'))
    })
    expect(api.regenerateMcpToken).toHaveBeenCalled()
    expect(screen.getByTestId('copy-claude-code')).toHaveTextContent('tok_new-456')
  })

  it('warns when the token is stored without a keyring', async () => {
    await open(mcpOn({ tokenEncrypted: false }))
    expect(screen.getByText(/Токен збережено без шифрування/)).toBeInTheDocument()
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

describe('Sidebar MCP button', () => {
  it('a green dot while the server runs, a red one when enabled but failing, none when off', () => {
    useStore.setState({ mcpStatus: mcpOn() })
    const { container, rerender } = render(<Sidebar />)
    const btn = () => screen.getByLabelText('MCP-сервер для Claude')
    expect(btn().querySelector('.dot-ok')).not.toBeNull()
    expect(btn()).toHaveAttribute('title', 'MCP-сервер для Claude: працює')
    act(() => useStore.setState({ mcpStatus: mcpOn({ running: false, error: 'busy' }) }))
    rerender(<Sidebar />)
    expect(btn().querySelector('.dot-ok')).toBeNull()
    expect(btn().querySelector('.dot-warn')).not.toBeNull()
    act(() => useStore.setState({ mcpStatus: mcpOff }))
    rerender(<Sidebar />)
    expect(container.querySelector('.mcp-btn .dot-ok, .mcp-btn .dot-warn')).toBeNull()
  })
})
