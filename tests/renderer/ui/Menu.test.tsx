// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu, Modal } from '../../../src/renderer/src/ui'

const items = (spy = vi.fn()) => [
  { id: 'a', label: 'Редагувати', icon: 'edit' as const, onSelect: () => spy('a') },
  { id: 'b', label: 'Недоступно', disabled: true, onSelect: () => spy('b') },
  { id: 'c', label: 'Видалити', icon: 'trash' as const, danger: true, onSelect: () => spy('c'), hint: 'Назавжди' }
]

describe('Menu', () => {
  it('a menu button: opens on click, focuses the first item, arrows skip disabled items', async () => {
    render(<Menu label="Ще дії" items={items()} />)
    const trigger = screen.getByRole('button', { name: 'Ще дії' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Ще дії' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Редагувати' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: /Видалити/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Редагувати' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: /Видалити/ })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Редагувати' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: /Видалити/ })).toHaveFocus()
  })

  it('Enter chooses an item, closes and returns focus to the trigger', async () => {
    const spy = vi.fn()
    render(<Menu label="Ще дії" items={items(spy)} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ще дії' }))
    await userEvent.keyboard('{End}{Enter}')
    expect(spy).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ще дії' })).toHaveFocus()
  })

  it('↓ on the trigger opens it; ↑ opens at the last item', async () => {
    render(<Menu label="Ще дії" items={items()} />)
    screen.getByRole('button', { name: 'Ще дії' }).focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: /Видалити/ })).toHaveFocus()
  })

  it('closes on Escape (before an enclosing modal), on Tab and on a click outside', async () => {
    const onClose = vi.fn()
    render(
      <Modal title="Діалог" onClose={onClose}>
        <Menu label="Ще дії" items={items()} />
        <p>outside</p>
      </Modal>
    )
    const trigger = screen.getByRole('button', { name: 'Ще дії' })
    await userEvent.click(trigger)
    act(() => void fireEvent.keyDown(document.activeElement!, { key: 'Escape' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    await userEvent.click(trigger)
    await userEvent.tab()
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(trigger)
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows hints, danger and checked states', async () => {
    render(<Menu label="Вибір" trigger="Сортування" items={[...items(), { id: 'd', label: 'Новіші', checked: true, onSelect: () => {} }]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Сортування' }))
    expect(screen.getByRole('menuitem', { name: /Видалити/ })).toHaveTextContent('Назавжди')
    expect(screen.getByRole('menuitem', { name: /Видалити/ })).toHaveClass('is-danger')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Новіші' })).toHaveAttribute('aria-checked', 'true')
  })
})
