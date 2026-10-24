// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Field, Segmented, Select } from '../../../src/renderer/src/ui'
import { GLOSSARY } from '../../../src/shared/glossary'

describe('Field', () => {
  it('labels the control and describes it with the hint', () => {
    render(
      <Field label="Keystring" hint="Скопіюйте зі сторінки застосунку на Etsy">
        <input />
      </Field>
    )
    const input = screen.getByLabelText('Keystring')
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAccessibleDescription('Скопіюйте зі сторінки застосунку на Etsy')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('an error is announced, marks the control invalid and joins the description', () => {
    render(
      <Field label="Назва" hint="До 140 символів" error="Назва задовга">
        <input aria-describedby="own" />
      </Field>
    )
    const input = screen.getByLabelText('Назва')
    expect(screen.getByRole('alert')).toHaveTextContent('Назва задовга')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')!.split(' ')).toHaveLength(3)
    expect(input.getAttribute('aria-describedby')).toMatch(/^own /)
  })

  it('required: a visual * outside the label (the name stays exact) and required on the control', () => {
    render(
      <Field label="Назва" required>
        <input />
      </Field>
    )
    const input = screen.getByLabelText('Назва')
    expect(input).toBeRequired()
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps the child id, or uses the id prop; works with select and textarea', () => {
    render(
      <>
        <Field label="Країна">
          <select id="country">
            <option>UA</option>
          </select>
        </Field>
        <Field label="Опис" id="desc">
          <textarea />
        </Field>
      </>
    )
    expect(screen.getByLabelText('Країна')).toHaveAttribute('id', 'country')
    expect(screen.getByLabelText('Опис')).toHaveAttribute('id', 'desc')
  })

  it('a render function gets the control props', () => {
    render(<Field label="Порт">{(p) => <input type="number" {...p} />}</Field>)
    expect(screen.getByLabelText('Порт')).toHaveAttribute('type', 'number')
  })

  it('glossary adds an ⓘ (not part of the label), aside shows on the label row', () => {
    render(
      <Field label="Теги" glossary="tags" aside="3/13">
        <input />
      </Field>
    )
    expect(screen.getByLabelText('Теги')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Що таке «Теги»?' })).toHaveAccessibleDescription(GLOSSARY.tags.short)
    expect(screen.getByText('3/13')).toBeInTheDocument()
  })
})

describe('Segmented', () => {
  function Period() {
    const [v, setV] = useState<'all' | '90d' | '30d'>('all')
    return (
      <Segmented
        label="Період"
        value={v}
        onChange={setV}
        options={[
          { value: 'all', label: 'Усе' },
          { value: '90d', label: '90 днів', hint: 'Останні три місяці' },
          { value: '30d', label: '30 днів', disabled: true }
        ]}
      />
    )
  }

  it('is a radio group: click and arrow keys change the choice', async () => {
    render(<Period />)
    const group = screen.getByRole('radiogroup', { name: 'Період' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Усе' })).toBeChecked()
    await userEvent.click(screen.getByText('90 днів'))
    expect(screen.getByRole('radio', { name: '90 днів' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Усе' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '30 днів' })).toBeDisabled()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Усе' })).toBeChecked()
  })
})

describe('Select', () => {
  it('a native select with options and onChange(value)', async () => {
    function S() {
      const [v, setV] = useState('UA')
      return (
        <Field label="Країна покупця">
          <Select
            value={v}
            onChange={setV}
            options={[
              { value: 'UA', label: 'Україна' },
              { value: 'DE', label: 'Німеччина' }
            ]}
          />
        </Field>
      )
    }
    render(<S />)
    const sel = screen.getByLabelText('Країна покупця')
    expect(sel).toHaveValue('UA')
    await userEvent.selectOptions(sel, 'DE')
    expect(sel).toHaveValue('DE')
  })
})
