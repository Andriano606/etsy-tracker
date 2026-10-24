// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ConfirmModal, confirmTone, confirmWith, isDestructiveMessage, splitConfirmMessage } from '../../../src/renderer/src/components/ConfirmModal'
import { useStore } from '../../../src/renderer/src/store'
import { setupRenderer } from '../helpers'

beforeEach(() => setupRenderer())

describe('ConfirmModal', () => {
  it('renders nothing without a pending request', () => {
    const { container } = render(<ConfirmModal />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the message and confirms with true', () => {
    const onResolve = vi.fn()
    useStore.setState({ confirmRequest: { message: 'Delete it?', onResolve } })
    render(<ConfirmModal />)
    expect(screen.getByText('Delete it?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Підтвердити'))
    expect(onResolve).toHaveBeenCalledWith(true)
    expect(useStore.getState().confirmRequest).toBeNull()
  })

  it('shows the question large and the explanation under it; Escape cancels', () => {
    const onResolve = vi.fn()
    useStore.setState({ confirmRequest: { message: 'Позначити замовлення відправленим?\nПокупець одразу отримає лист.', onResolve } })
    render(<ConfirmModal />)
    const dialog = screen.getByRole('alertdialog', { name: 'Підтвердження' })
    expect(dialog).toHaveClass('modal')
    expect(screen.getByText('Позначити замовлення відправленим?')).toHaveClass('confirm-question')
    expect(screen.getByText('Покупець одразу отримає лист.')).toHaveClass('confirm-details')
    // Not destructive: a green confirm button — but the focus still starts on "Скасувати",
    // so a stray Enter never confirms anything.
    expect(screen.getByRole('button', { name: 'Підтвердити' })).toHaveClass('primary')
    expect(screen.getByRole('button', { name: 'Скасувати' })).toHaveFocus()
    // The question and the explanation describe the dialog (read by screen readers).
    expect(dialog).toHaveAccessibleDescription('Позначити замовлення відправленим? Покупець одразу отримає лист.')
    act(() => void fireEvent.keyDown(document.body, { key: 'Escape' }))
    expect(onResolve).toHaveBeenCalledWith(false)
  })

  it('destructive requests are red and focus "Скасувати", so Enter never deletes', () => {
    useStore.setState({ confirmRequest: { message: 'Видалити «Shop»? Усі збережені товари буде видалено.', onResolve: vi.fn() } })
    render(<ConfirmModal />)
    expect(screen.getByRole('alertdialog')).toHaveClass('is-danger')
    expect(screen.getByText('Видалити «Shop»?')).toBeInTheDocument()
    expect(screen.getByText('Усі збережені товари буде видалено.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Підтвердити' })).toHaveClass('stop')
    expect(screen.getByRole('button', { name: 'Скасувати' })).toHaveFocus()
  })

  it('costly, replacing or access-granting requests are amber, data-dropping ones red; focus on "Скасувати"', () => {
    const cases: [string, string, string][] = [
      ['Зберегти персоналізацію? Etsy замінить усі питання — 1 питання буде видалено: «Ім’я».', 'is-danger', 'stop'],
      ['Опублікувати товар?\nВін з’явиться в магазині, а Etsy стягне звичайну плату за публікацію ($0.20 за 4 місяці).', 'is-caution', 'confirm-ok-caution'],
      ['Зберегти фото варіацій на Etsy?\nЦе замінить усі прив’язки фото до варіацій цього лістингу.', 'is-caution', 'confirm-ok-caution'],
      ['Створити новий токен?\nУсі вже підключені клієнти перестануть працювати.', 'is-caution', 'confirm-ok-caution'],
      ['Дозволити Claude змінювати ваш магазин на Etsy? Він зможе створювати товари.', 'is-caution', 'confirm-ok-caution']
    ]
    for (const [message, dialogClass, buttonClass] of cases) {
      act(() => useStore.setState({ confirmRequest: { message, onResolve: vi.fn() } }))
      const { unmount } = render(<ConfirmModal />)
      expect(screen.getByRole('alertdialog'), message).toHaveClass(dialogClass)
      expect(screen.getByRole('button', { name: 'Підтвердити' }), message).toHaveClass(buttonClass)
      expect(screen.getByRole('button', { name: 'Підтвердити' }), message).not.toHaveClass('primary')
      expect(screen.getByRole('button', { name: 'Скасувати' }), message).toHaveFocus()
      unmount()
    }
  })

  it('a destructive request is described by its question and what will be lost', () => {
    useStore.setState({ confirmRequest: { message: 'Видалити «Shop»?\nУсі збережені товари буде видалено.', onResolve: vi.fn() } })
    render(<ConfirmModal />)
    expect(screen.getByRole('alertdialog', { name: 'Підтвердження' })).toHaveAccessibleDescription(
      'Видалити «Shop»? Усі збережені товари буде видалено.'
    )
  })

  it('a request may name its own title and button', () => {
    const onResolve = vi.fn()
    useStore.setState({
      confirmRequest: { message: 'Remove it?', title: 'Видалити магазин', confirmLabel: 'Видалити', danger: true, onResolve } as never
    })
    render(<ConfirmModal />)
    expect(screen.getByRole('alertdialog', { name: 'Видалити магазин' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }))
    expect(onResolve).toHaveBeenCalledWith(true)
  })

  it('confirmWith shows its own heading, verb and tone, and resolves through the same dialog', async () => {
    render(<ConfirmModal />)
    let answer: Promise<boolean> = Promise.resolve(false)
    act(() => {
      answer = confirmWith({ title: 'Видалити магазин?', message: 'Видалити «Alpha»?\nУсе буде видалено.', confirmLabel: 'Видалити магазин' })
    })
    expect(screen.getByRole('alertdialog', { name: 'Видалити магазин?' })).toHaveClass('is-danger')
    expect(screen.getByRole('button', { name: 'Скасувати' })).toHaveFocus()
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Видалити магазин' })))
    await expect(answer).resolves.toBe(true)
    expect(useStore.getState().confirmRequest).toBeNull()
  })

  it('splitConfirmMessage / isDestructiveMessage', () => {
    expect(splitConfirmMessage('A?\nB.')).toEqual({ question: 'A?', details: 'B.' })
    expect(splitConfirmMessage('Вийти з Etsy? Щоб знову редагувати, увійдіть.')).toEqual({
      question: 'Вийти з Etsy?',
      details: 'Щоб знову редагувати, увійдіть.'
    })
    expect(splitConfirmMessage('Створити розділ?')).toEqual({ question: 'Створити розділ?', details: '' })
    expect(isDestructiveMessage('Видалити цю чернетку?')).toBe(true)
    expect(isDestructiveMessage('Прибрати атрибут «Колір»?')).toBe(true)
    expect(isDestructiveMessage('Позначити відправленим?\nЦе не можна скасувати.')).toBe(true)
    expect(isDestructiveMessage('Зберегти ціни на Etsy?')).toBe(false)
    expect(isDestructiveMessage('Зберегти? 2 питання буде видалено.')).toBe(true)
    expect(confirmTone('Зберегти ціни на Etsy?')).toBe('normal')
    expect(confirmTone('Надіслати на Etsy як чернетку?\nПлати за це немає.')).toBe('normal')
    expect(confirmTone('Опублікувати? Etsy стягне плату.')).toBe('caution')
    expect(confirmTone('Зберегти? Etsy замінить увесь інвентар.')).toBe('caution')
    expect(confirmTone('Видалити?')).toBe('danger')
    // An explicit `danger` wins over the guess.
    expect(confirmTone('Зберегти ціни?', true)).toBe('danger')
    expect(confirmTone('Видалити?', false)).toBe('normal')
  })

  it('closing gives the focus back to what had it before', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    useStore.setState({ confirmRequest: { message: 'Видалити?', onResolve: vi.fn() } })
    const { rerender } = render(<ConfirmModal />)
    expect(screen.getByRole('button', { name: 'Скасувати' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }))
    rerender(<ConfirmModal />)
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('cancels with false', () => {
    const onResolve = vi.fn()
    useStore.setState({ confirmRequest: { message: 'Delete it?', onResolve } })
    render(<ConfirmModal />)
    fireEvent.click(screen.getByText('Скасувати'))
    expect(onResolve).toHaveBeenCalledWith(false)
  })
})
