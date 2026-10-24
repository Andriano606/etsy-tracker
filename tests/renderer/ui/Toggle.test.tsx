// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from '../../../src/renderer/src/ui'

function Controlled(props: { onChange?: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  const [on, setOn] = useState(false)
  return (
    <Toggle
      label="Зі знижкою"
      hint={props.hint}
      checked={on}
      disabled={props.disabled}
      onChange={(v) => {
        setOn(v)
        props.onChange?.(v)
      }}
    />
  )
}

describe('Toggle', () => {
  it('is a native checkbox with role=switch, named by its label only', () => {
    render(<Controlled hint="Показати лише товари з акцією" />)
    const sw = screen.getByRole('switch', { name: 'Зі знижкою' })
    expect(sw).toBe(screen.getByLabelText('Зі знижкою'))
    expect(sw).toHaveAttribute('type', 'checkbox')
    expect(sw).not.toBeChecked()
    expect(sw).toHaveAccessibleDescription('Показати лише товари з акцією')
  })

  it('toggles by clicking the label text, the hint, the switch and with Space', async () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} hint="Підказка" />)
    const sw = screen.getByRole('switch')
    await userEvent.click(screen.getByText('Зі знижкою'))
    expect(sw).toBeChecked()
    await userEvent.click(screen.getByText('Підказка'))
    expect(sw).not.toBeChecked()
    await userEvent.click(sw)
    expect(sw).toBeChecked()
    sw.focus()
    await userEvent.keyboard(' ')
    expect(sw).not.toBeChecked()
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([true, false, true, false])
  })

  it('does nothing while disabled', async () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} disabled hint="h" />)
    await userEvent.click(screen.getByText('Зі знижкою'))
    fireEvent.click(screen.getByText('h'))
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an ⓘ next to the label explains it without toggling', async () => {
    const onChange = vi.fn()
    render(<Toggle label="Обране" glossary="favorites" checked={false} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Що таке «Обране»?' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('tooltip')).toHaveTextContent('додали товар в обране')
    // The ⓘ is not part of the switch's name.
    expect(screen.getByRole('switch', { name: 'Обране' })).toBeInTheDocument()
  })

  it('works without a visible label through ariaLabel', () => {
    render(<Toggle ariaLabel="Увімкнути" checked onChange={() => {}} />)
    expect(screen.getByRole('switch', { name: 'Увімкнути' })).toBeChecked()
  })

  it('keeps a given id (so an outer <label htmlFor> still works)', () => {
    render(<Toggle id="mcp-on" label="Увімкнути MCP-сервер" checked={false} onChange={() => {}} />)
    expect(screen.getByLabelText('Увімкнути MCP-сервер')).toHaveAttribute('id', 'mcp-on')
  })
})
