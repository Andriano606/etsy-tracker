// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActionBar, type Action } from '../../../src/renderer/src/ui'
import { fitItems } from '../../../src/renderer/src/ui/overflow'
import { fakeLayout, type FakeLayout } from './measure'

describe('fitItems', () => {
  it('keeps everything when it fits (no room reserved for "more")', () => {
    expect(fitItems([100, 100, 100], 300, 40, 0)).toEqual([true, true, true])
    expect(fitItems([100, 100, 100], 316, 40, 8)).toEqual([true, true, true])
  })
  it('keeps items in order while they fit beside the "more" button', () => {
    expect(fitItems([100, 100, 100, 100], 290, 40, 0)).toEqual([true, true, false, false])
  })
  it('pinned items always stay, even when they come last', () => {
    expect(fitItems([100, 100, 100, 100], 250, 40, 0, [false, false, false, true])).toEqual([true, false, false, true])
  })
  it('stops at the first item that does not fit (order is priority)', () => {
    expect(fitItems([100, 300, 50], 260, 40, 0)).toEqual([true, false, false])
  })
  it('zero widths (no layout, e.g. jsdom) fit', () => {
    expect(fitItems([0, 0, 0], 0, 0, 0)).toEqual([true, true, true])
  })
})

const actions = (spy = vi.fn()): Action[] => [
  { id: 'scan', label: 'Сканувати повторно', icon: 'refresh', variant: 'primary', onClick: () => spy('scan') },
  { id: 'stats', label: 'Статистика', icon: 'stats', onClick: () => spy('stats') },
  { id: 'photos', label: 'Синхронізувати фото', icon: 'photo', onClick: () => spy('photos'), hint: 'Скопіювати фото у сховище' },
  { id: 'delete', label: 'Видалити', icon: 'trash', variant: 'danger', onClick: () => spy('delete') }
]

let layout: FakeLayout | null = null
afterEach(() => {
  layout?.restore()
  layout = null
})

describe('ActionBar', () => {
  it('renders every action once when there is room (and no "more" button)', () => {
    layout = fakeLayout({ 'ui-actionbar': 1000, 'ui-actionbar-item': 100, 'ui-menu-trigger': 36 })
    render(<ActionBar label="Дії з магазином" actions={actions()} />)
    const g = screen.getByRole('group', { name: 'Дії з магазином' })
    expect(within(g).getAllByRole('button').map((b) => b.textContent)).toEqual(['Сканувати повторно', 'Статистика', 'Синхронізувати фото', 'Видалити'])
    expect(screen.queryByRole('button', { name: 'Ще дії' })).toBeNull()
  })

  it('moves what does not fit into the "⋯" menu, keeping the primary', async () => {
    const spy = vi.fn()
    layout = fakeLayout({ 'ui-actionbar': 250, 'ui-actionbar-item': 100, 'ui-menu-trigger': 36 })
    render(<ActionBar actions={actions(spy)} />)
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Статистика' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Видалити' })).toBeNull()
    const more = screen.getByRole('button', { name: 'Ще дії' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    await userEvent.click(more)
    const menu = screen.getByRole('menu', { name: 'Ще дії' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((i) => i.querySelector('.ui-menu-label')?.textContent)).toEqual(['Синхронізувати фото', 'Видалити'])
    expect(items[0]).toHaveTextContent('Скопіювати фото у сховище')
    expect(items[1]).toHaveClass('is-danger')
    await userEvent.click(items[1])
    expect(spy).toHaveBeenCalledWith('delete')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('re-fits when the container is resized', () => {
    layout = fakeLayout({ 'ui-actionbar': 1000, 'ui-actionbar-item': 100, 'ui-menu-trigger': 36 })
    render(<ActionBar actions={actions()} />)
    expect(screen.queryByRole('button', { name: 'Ще дії' })).toBeNull()
    layout.resize('ui-actionbar', 150)
    expect(screen.getByRole('button', { name: 'Ще дії' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Статистика' })).toBeNull()
    layout.resize('ui-actionbar', 1000)
    expect(screen.queryByRole('button', { name: 'Ще дії' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Видалити' })).toBeInTheDocument()
  })

  it('pinned actions stay; the bar is at least as wide as them + the menu', () => {
    layout = fakeLayout({ 'ui-actionbar': 120, 'ui-actionbar-item': 100, 'ui-menu-trigger': 36 })
    const list = actions()
    list[3] = { ...list[3], pinned: true }
    render(<ActionBar actions={list} />)
    expect(screen.getByRole('button', { name: 'Сканувати повторно' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Видалити' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Статистика' })).toBeNull()
    expect(screen.getByRole('group')).toHaveStyle({ minWidth: '236px' })
  })

  it('skips falsy entries; busy/disabled actions are disabled (in the menu too)', async () => {
    layout = fakeLayout({ 'ui-actionbar': 150, 'ui-actionbar-item': 100, 'ui-menu-trigger': 36 })
    render(
      <ActionBar
        actions={[
          { id: 'a', label: 'Сканувати', variant: 'primary', busy: true, onClick: () => {} },
          false,
          null,
          { id: 'b', label: 'Видалити', disabled: true, onClick: () => {} }
        ]}
      />
    )
    expect(screen.getByRole('button', { name: 'Сканувати' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сканувати' })).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Ще дії' }))
    expect(screen.getByRole('menuitem', { name: 'Видалити' })).toBeDisabled()
  })

  it('an icon-only action has the label as its name and tooltip', async () => {
    render(<ActionBar actions={[{ id: 'x', label: 'Налаштування', icon: 'settings', iconOnly: true, onClick: () => {} }]} />)
    const b = screen.getByRole('button', { name: 'Налаштування' })
    expect(b).not.toHaveTextContent('Налаштування')
    await userEvent.hover(b)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Налаштування')
  })

  it('in jsdom (no layout) everything is visible exactly once', () => {
    render(<ActionBar actions={actions()} />)
    expect(screen.getAllByText('Статистика')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Ще дії' })).toBeNull()
  })
})
