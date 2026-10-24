// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Badge, Button, Callout, EmptyState, Icon, ICON_NAMES, Loading, Spinner, Stat, formatSigned } from '../../../src/renderer/src/ui'
import { place } from '../../../src/renderer/src/ui/position'
import { GLOSSARY } from '../../../src/shared/glossary'

describe('place (floating layers stay inside the window)', () => {
  const vp = { width: 900, height: 560 }
  it('above the anchor, centred', () => {
    expect(place({ top: 300, left: 400, width: 20, height: 20 }, { width: 200, height: 60 }, vp)).toMatchObject({ top: 234, left: 310, side: 'top' })
  })
  it('flips below when there is no room above', () => {
    expect(place({ top: 10, left: 400, width: 20, height: 20 }, { width: 200, height: 60 }, vp)).toMatchObject({ top: 36, side: 'bottom' })
  })
  it('flips above when a menu has no room below', () => {
    expect(place({ top: 520, left: 10, width: 30, height: 30 }, { width: 200, height: 160 }, vp, { side: 'bottom', align: 'start' })).toMatchObject({ side: 'top', left: 10 })
  })
  it('clamps to the window edges', () => {
    expect(place({ top: 300, left: 880, width: 16, height: 16 }, { width: 300, height: 40 }, vp).left).toBe(900 - 8 - 300)
    expect(place({ top: 300, left: 0, width: 16, height: 16 }, { width: 300, height: 40 }, vp).left).toBe(8)
    expect(place({ top: 300, left: 600, width: 100, height: 30 }, { width: 200, height: 40 }, vp, { align: 'end' }).left).toBe(500)
  })
  it('a layer taller than both sides gets the bigger side + a max height', () => {
    const p = place({ top: 200, left: 10, width: 20, height: 20 }, { width: 100, height: 900 }, vp, { side: 'bottom' })
    expect(p.side).toBe('bottom')
    expect(p.maxHeight).toBe(560 - 220 - 6 - 8)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })
})

describe('Button', () => {
  it('icon + text, variants map to the .btn classes', () => {
    render(
      <>
        <Button variant="primary" icon="refresh">
          Сканувати
        </Button>
        <Button variant="danger">Видалити</Button>
        <Button variant="danger-solid">Видалити назавжди</Button>
      </>
    )
    expect(screen.getByRole('button', { name: 'Сканувати' })).toHaveClass('btn', 'primary')
    expect(screen.getByRole('button', { name: 'Сканувати' }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: 'Видалити' })).toHaveClass('btn', 'danger')
    expect(screen.getByRole('button', { name: 'Видалити назавжди' })).toHaveClass('btn', 'stop')
  })

  it('icon-only: named by label, tooltip on hover', async () => {
    const onClick = vi.fn()
    render(<Button icon="settings" iconOnly label="Налаштування" onClick={onClick} />)
    const b = screen.getByRole('button', { name: 'Налаштування' })
    await userEvent.hover(b)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Налаштування')
    await userEvent.click(b)
    expect(onClick).toHaveBeenCalled()
  })

  it('busy: spinner, disabled, aria-busy', () => {
    render(<Button busy>Сканування</Button>)
    const b = screen.getByRole('button', { name: 'Сканування' })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
    expect(b.querySelector('.ui-spinner')).not.toBeNull()
  })
})

describe('Callout', () => {
  it('error is an alert, others a status; action + close', async () => {
    const onClose = vi.fn()
    render(
      <>
        <Callout tone="error" title="Сканування не вдалося" action={<Button>Спробувати ще</Button>} onClose={onClose}>
          Etsy не відповідає.
        </Callout>
        <Callout tone="warn">Дані застаріли</Callout>
      </>
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Сканування не вдалосяEtsy не відповідає.')
    expect(screen.getByRole('status')).toHaveTextContent('Дані застаріли')
    await userEvent.click(screen.getByRole('button', { name: 'Закрити повідомлення' }))
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Спробувати ще' })).toBeInTheDocument()
  })
})

describe('Badge', () => {
  it('a tone class; a hint makes it focusable with a description', () => {
    render(
      <>
        <Badge tone="accent">NEW</Badge>
        <Badge tone="warn" hint="Дані старші за 6 годин">застаріло</Badge>
      </>
    )
    expect(screen.getByText('NEW')).toHaveClass('ui-badge', 'ui-badge--accent')
    expect(screen.getByText('застаріло')).toHaveAttribute('tabindex', '0')
    expect(screen.getByText('застаріло')).toHaveAccessibleDescription('Дані старші за 6 годин')
  })
})

describe('Stat', () => {
  it('formats a signed delta and colours it by direction', () => {
    render(
      <>
        <Stat label="Обране" glossary="favorites" value="1 204" delta={12} caption="за 30 днів" />
        <Stat label="Зникли" value="3" delta={2} lowerIsBetter />
        <Stat label="Рейтинг" value="4,9" delta={0} />
      </>
    )
    expect(screen.getByText('+12')).toHaveClass('is-up')
    expect(screen.getByText('+2')).toHaveClass('is-down')
    expect(screen.getByText('0')).toHaveClass('is-flat')
    expect(screen.getByText('за 30 днів')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Що таке «Обране»?' })).toHaveAccessibleDescription(GLOSSARY.favorites.short)
  })

  it('formatSigned uses a typographic minus and uk-UA grouping', () => {
    expect(formatSigned(-1234)).toBe('−1 234')
    expect(formatSigned(5)).toBe('+5')
    expect(formatSigned(0)).toBe('0')
  })
})

describe('EmptyState, Spinner, Loading, Icon', () => {
  it('empty state: title, text, action', () => {
    render(<EmptyState icon="store" title="Ще немає магазинів" action={<Button variant="primary">Додати магазин</Button>}>Додайте посилання на магазин Etsy.</EmptyState>)
    expect(screen.getByText('Ще немає магазинів')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Додати магазин' })).toBeInTheDocument()
  })

  it('spinner and loading are statuses with a label', () => {
    render(
      <>
        <Spinner label="Сканування…" />
        <Loading>Завантаження відгуків…</Loading>
      </>
    )
    expect(screen.getByRole('status', { name: 'Сканування…' })).toBeInTheDocument()
    expect(screen.getByText('Завантаження відгуків…').closest('[role=status]')).not.toBeNull()
  })

  it('every icon renders a path; a titled icon is an image', () => {
    const { container } = render(
      <>
        {ICON_NAMES.map((n) => (
          <Icon key={n} name={n} />
        ))}
        <Icon name="warning" title="Увага" />
      </>
    )
    expect(container.querySelectorAll('svg path[d]').length).toBe(ICON_NAMES.length + 1)
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(40)
    expect(screen.getByRole('img', { name: 'Увага' })).toBeInTheDocument()
  })
})
