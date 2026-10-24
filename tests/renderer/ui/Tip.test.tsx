// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InfoTip, Term, Tooltip, Modal } from '../../../src/renderer/src/ui'
import { GLOSSARY } from '../../../src/shared/glossary'

const escape = () => act(() => void fireEvent.keyDown(document.body, { key: 'Escape' }))

describe('InfoTip', () => {
  it('is a button described by the glossary text even while closed', () => {
    render(<InfoTip glossary="vat" />)
    const b = screen.getByRole('button', { name: 'Що таке «ПДВ»?' })
    expect(b).toHaveAccessibleDescription(GLOSSARY.vat.short)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens on hover and closes shortly after the pointer leaves', async () => {
    vi.useFakeTimers()
    try {
      render(<InfoTip text="Пояснення числа" />)
      const b = screen.getByRole('button', { name: 'Пояснення' })
      fireEvent.mouseEnter(b)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Пояснення числа')
      fireEvent.mouseLeave(b)
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
      act(() => void vi.advanceTimersByTime(200))
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens on keyboard focus, closes on blur and on Escape', async () => {
    render(
      <>
        <InfoTip glossary="views" />
        <button>next</button>
      </>
    )
    await userEvent.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent(GLOSSARY.views.short)
    escape()
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.tab()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('a click pins it (with the long text) and a second click or a click elsewhere closes it', async () => {
    render(
      <>
        <InfoTip glossary="apiKey" />
        <p>outside</p>
      </>
    )
    const b = screen.getByRole('button', { name: /Ключ доступу/ })
    await userEvent.click(b)
    expect(b).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tooltip')).toHaveTextContent(GLOSSARY.apiKey.long!)
    await userEvent.click(b)
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.click(b)
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('hover alone shows "click for more" instead of the long text', () => {
    render(<InfoTip glossary="quota" />)
    fireEvent.mouseEnter(screen.getByRole('button'))
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Натисніть, щоб прочитати більше')
    expect(tip).not.toHaveTextContent(GLOSSARY.quota.long!)
  })

  it('renders nothing without text', () => {
    const { container } = render(<InfoTip />)
    expect(container).toBeEmptyDOMElement()
  })

  it('inside a modal, Escape closes the tip first, then the modal', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="Налаштування" onClose={onClose}>
        <InfoTip glossary="vat" />
      </Modal>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Що таке «ПДВ»?' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    escape()
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the bubble is portalled to <body> (never clipped) and placed inside the window', () => {
    render(
      <div style={{ overflow: 'hidden' }} data-testid="clip">
        <InfoTip text="t" />
      </div>
    )
    fireEvent.mouseEnter(screen.getByRole('button'))
    const tip = screen.getByRole('tooltip')
    expect(screen.getByTestId('clip')).not.toContainElement(tip)
    expect(tip.closest('.ui-layer')).toHaveStyle({ position: 'fixed' })
  })
})

describe('Term', () => {
  it('shows the glossary term with a dotted underline, focusable and described', async () => {
    render(<p>Ціна з <Term glossary="vat" /></p>)
    const t = screen.getByText('ПДВ')
    expect(t).toHaveClass('ui-term')
    expect(t).toHaveAttribute('tabindex', '0')
    expect(t).toHaveAccessibleDescription(GLOSSARY.vat.short)
    await userEvent.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent(GLOSSARY.vat.short)
  })

  it('custom children keep the term as the bubble heading; Enter toggles', async () => {
    render(<Term glossary="favorites">в обраному</Term>)
    const t = screen.getByText('в обраному')
    act(() => t.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('Обране')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('a click inside a label does not toggle the labelled control', async () => {
    const onChange = vi.fn()
    render(
      <label>
        <input type="checkbox" onChange={onChange} /> Ціна з <Term glossary="vat" />
      </label>
    )
    await userEvent.click(screen.getByText('ПДВ'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })
})

describe('Tooltip', () => {
  it('describes the wrapped control and shows on hover/focus', async () => {
    render(
      <Tooltip content="Оновити всі магазини">
        <button>Сканувати</button>
      </Tooltip>
    )
    const b = screen.getByRole('button', { name: 'Сканувати' })
    expect(b).toHaveAccessibleDescription('Оновити всі магазини')
    await userEvent.hover(b)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Оновити всі магазини')
    await userEvent.click(b)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('without content renders just the child', () => {
    const { container } = render(
      <Tooltip content="">
        <button>x</button>
      </Tooltip>
    )
    expect(container.innerHTML).toBe('<button>x</button>')
  })
})
