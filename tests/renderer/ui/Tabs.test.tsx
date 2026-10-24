// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, tabPanelProps, type TabItem } from '../../../src/renderer/src/ui'
import { fakeLayout, type FakeLayout } from './measure'

type Id = 'info' | 'listings' | 'orders' | 'money' | 'reviews'
const TABS: TabItem<Id>[] = [
  { id: 'info', label: 'Магазин' },
  { id: 'listings', label: 'Товари', badge: 12 },
  { id: 'orders', label: 'Замовлення', disabled: true },
  { id: 'money', label: 'Гроші' },
  { id: 'reviews', label: 'Відгуки', hint: 'Що пишуть покупці' }
]

function Harness({ orientation, onChange }: { orientation?: 'horizontal' | 'vertical'; onChange?: (id: Id) => void }) {
  const [v, setV] = useState<Id>('info')
  return (
    <Tabs
      tabs={TABS}
      value={v}
      label="Розділи"
      orientation={orientation}
      onChange={(id) => {
        setV(id)
        onChange?.(id)
      }}
    >
      <p>Панель: {v}</p>
    </Tabs>
  )
}

let layout: FakeLayout | null = null
afterEach(() => {
  layout?.restore()
  layout = null
})

describe('Tabs', () => {
  it('has tablist/tab/tabpanel semantics with a roving tabindex', () => {
    render(<Harness />)
    const list = screen.getByRole('tablist', { name: 'Розділи' })
    const tabs = within(list).getAllByRole('tab')
    expect(tabs).toHaveLength(5)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
    const panel = screen.getByRole('tabpanel', { name: 'Магазин' })
    expect(panel).toHaveTextContent('Панель: info')
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
    expect(tabs[1]).toHaveTextContent('12')
    expect(tabs[4]).toHaveAccessibleDescription('Що пишуть покупці')
  })

  it('click selects; arrows/Home/End move + select, skipping disabled and wrapping', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: /Товари/ }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Панель: listings')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Гроші' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Гроші' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Магазин' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Відгуки' })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Магазин' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Відгуки' })).toHaveFocus()
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['listings', 'money', 'reviews', 'info', 'reviews', 'info', 'reviews'])
  })

  it('tabs that do not fit go into a "Ще" menu; the active one always stays visible', async () => {
    layout = fakeLayout({ 'ui-tablist-wrap': 280, 'ui-tabs-more-btn': 60 }, { tab: 100 })
    render(<Harness />)
    const list = screen.getByRole('tablist')
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Магазин', 'Товари12'])
    const more = screen.getByRole('button', { name: 'Ще вкладки (3)' })
    await userEvent.click(more)
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Замовлення', 'Гроші', 'Відгуки'])
    expect(items[0]).toBeDisabled()
    await userEvent.click(items[2])
    // The chosen tab is now visible (it took the place of a non-active one) and focused.
    const shown = within(list).getAllByRole('tab').map((t) => t.textContent)
    expect(shown).toContain('Відгуки')
    expect(shown).toHaveLength(2)
    expect(screen.getByRole('tab', { name: 'Відгуки' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Відгуки' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Панель: reviews')
  })

  it('arrow keys reach tabs hidden in the menu', async () => {
    layout = fakeLayout({ 'ui-tablist-wrap': 280, 'ui-tabs-more-btn': 60 }, { tab: 100 })
    render(<Harness />)
    await userEvent.click(screen.getByRole('tab', { name: /Товари/ }))
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Гроші' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Панель: money')
  })

  it('everything returns to the row when the container grows', () => {
    layout = fakeLayout({ 'ui-tablist-wrap': 280, 'ui-tabs-more-btn': 60 }, { tab: 100 })
    render(<Harness />)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    layout.resize('ui-tablist-wrap', 900)
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Ще вкладки/ })).toBeNull()
  })

  it('vertical: every tab stays in the list, ↑/↓ work', async () => {
    layout = fakeLayout({ 'ui-tablist-wrap': 100 }, { tab: 100 })
    render(<Harness orientation="vertical" />)
    const list = screen.getByRole('tablist')
    expect(list).toHaveAttribute('aria-orientation', 'vertical')
    expect(within(list).getAllByRole('tab')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Ще вкладки/ })).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: 'Магазин' }))
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('tab', { name: /Товари/ })).toHaveFocus()
  })

  it('without children renders no panel; tabPanelProps links an outside panel', () => {
    render(
      <>
        <Tabs idBase="t" tabs={TABS} value="money" onChange={() => {}} label="Розділи" />
        <div {...tabPanelProps('t', 'money')}>outside</div>
      </>
    )
    expect(screen.getByRole('tabpanel', { name: 'Гроші' })).toHaveTextContent('outside')
  })
})
