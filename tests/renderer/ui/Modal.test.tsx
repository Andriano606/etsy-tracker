// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, Modal } from '../../../src/renderer/src/ui'

const escape = () => act(() => void fireEvent.keyDown(document.body, { key: 'Escape' }))

describe('Modal', () => {
  it('is a labelled dialog with subtitle, ×, scrolling body and a sticky footer', () => {
    render(
      <Modal title="Налаштування" subtitle="Ключ і сховище" onClose={() => {}} size="lg" className="settings-modal" footer={<Button>Зберегти</Button>}>
        <p>Тіло</p>
      </Modal>
    )
    const d = screen.getByRole('dialog', { name: 'Налаштування' })
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveAccessibleDescription('Ключ і сховище')
    expect(d).toHaveClass('ui-modal', 'ui-modal--lg', 'settings-modal')
    expect(screen.getByRole('heading', { name: 'Налаштування' })).toBeInTheDocument()
    expect(screen.getByText('Тіло').closest('.ui-modal-body')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Зберегти' }).closest('.ui-modal-foot')).not.toBeNull()
  })

  it('closes with ×, Escape and a backdrop click — not a click inside', async () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal title="T" onClose={onClose}>
        <p>inside</p>
      </Modal>
    )
    await userEvent.click(screen.getByText('inside'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Закрити' }))
    escape()
    fireEvent.click(container.querySelector('.modal-backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('a drag that starts inside and ends on the backdrop does not close; closeOnBackdrop=false', () => {
    const onClose = vi.fn()
    const { container, rerender } = render(
      <Modal title="T" onClose={onClose}>
        <p>inside</p>
      </Modal>
    )
    const backdrop = container.querySelector('.ui-backdrop')!
    fireEvent.mouseDown(screen.getByText('inside'))
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    rerender(
      <Modal title="T" onClose={onClose} closeOnBackdrop={false}>
        <p>inside</p>
      </Modal>
    )
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('only the topmost modal closes on Escape', () => {
    const a = vi.fn()
    const b = vi.fn()
    render(
      <>
        <Modal title="A" onClose={a}>
          a
        </Modal>
        <Modal title="B" onClose={b}>
          b
        </Modal>
      </>
    )
    escape()
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })

  it('open=false renders nothing and listens to nothing', () => {
    const onClose = vi.fn()
    render(
      <Modal open={false} title="T" onClose={onClose}>
        x
      </Modal>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    escape()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('moves focus in on open, keeps Tab inside and gives focus back on close', async () => {
    function App() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Відкрити</button>
          <Modal open={open} title="T" onClose={() => setOpen(false)} footer={<button>Зберегти</button>}>
            <input aria-label="Назва" />
          </Modal>
        </>
      )
    }
    render(<App />)
    const opener = screen.getByRole('button', { name: 'Відкрити' })
    await userEvent.click(opener)
    expect(screen.getByRole('dialog')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Закрити' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByLabelText('Назва')).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Зберегти' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Закрити' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Зберегти' })).toHaveFocus()
    escape()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('an autoFocus child keeps the focus', () => {
    render(
      <Modal title="T" onClose={() => {}}>
        <input aria-label="Посилання" autoFocus />
      </Modal>
    )
    expect(screen.getByLabelText('Посилання')).toHaveFocus()
  })

  it('hideClose hides the ×; headerExtra sits in the header', () => {
    render(
      <Modal title="T" onClose={() => {}} hideClose headerExtra={<span>Період</span>} role="alertdialog">
        x
      </Modal>
    )
    expect(screen.queryByRole('button', { name: 'Закрити' })).toBeNull()
    expect(screen.getByText('Період').closest('.ui-modal-head')).not.toBeNull()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
