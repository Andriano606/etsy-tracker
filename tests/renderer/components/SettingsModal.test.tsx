// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsModal } from '../../../src/renderer/src/components/SettingsModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { useStore } from '../../../src/renderer/src/store'
import { noKey, setupRenderer, withKey, type Api } from '../helpers'

const FULL_KEY = 'abcd1234efgh5678wxyz'
const SECRET = 'very-secret-value'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ showSettings: true, keyStatus: withKey })
})

const renderIt = () =>
  render(
    <>
      <SettingsModal />
      <ConfirmModal />
    </>
  )

describe('SettingsModal', () => {
  it('a stored key that cannot be decrypted is reported, not shown as "not set"', () => {
    useStore.setState({ keyStatus: { hasKey: false, masked: null, encrypted: false, unreadable: true } })
    renderIt()
    expect(screen.getByTestId('key-status')).toHaveTextContent(/не вдалося розшифрувати.*введіть ключ ще раз/)
    expect(screen.getByTestId('key-status')).not.toHaveTextContent('Ключ не задано.')
    expect(screen.queryByText('Видалити ключ')).toBeNull()
  })

  it('shows only the masked keystring; inputs start empty', () => {
    const { container } = renderIt()
    expect(screen.getByTestId('key-status')).toHaveTextContent('abcd…wxyz')
    expect(screen.getByLabelText('Keystring')).toHaveValue('')
    expect(screen.getByLabelText('Shared secret')).toHaveValue('')
    expect(screen.getByLabelText('Shared secret')).toHaveAttribute('type', 'password')
    expect(screen.getByText(/зашифровано системним сховищем/)).toBeInTheDocument()
    expect(container.innerHTML).not.toContain(FULL_KEY)
  })

  it('saves both halves, then clears the inputs — the full key never shows', async () => {
    const { container } = renderIt()
    fireEvent.change(screen.getByLabelText('Keystring'), { target: { value: FULL_KEY } })
    fireEvent.change(screen.getByLabelText('Shared secret'), { target: { value: SECRET } })
    fireEvent.click(screen.getByText('Зберегти'))
    await screen.findByText('Ключ збережено.')
    expect(api.setApiKey).toHaveBeenCalledWith(FULL_KEY, SECRET)
    expect(screen.getByLabelText('Keystring')).toHaveValue('')
    expect(screen.getByLabelText('Shared secret')).toHaveValue('')
    expect(container.innerHTML).not.toContain(FULL_KEY)
    expect(container.innerHTML).not.toContain(SECRET)
  })

  it('shows a validation error from main', async () => {
    api.setApiKey.mockResolvedValue({ ok: false, error: 'Keystring не може містити пробілів чи двокрапки.' })
    renderIt()
    fireEvent.change(screen.getByLabelText('Keystring'), { target: { value: 'a:b' } })
    fireEvent.change(screen.getByLabelText('Shared secret'), { target: { value: 's' } })
    fireEvent.click(screen.getByText('Зберегти'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/двокрапки/)
  })

  it('Перевірити ключ tests the typed values, or the stored key', async () => {
    renderIt()
    fireEvent.click(screen.getByText('Перевірити ключ'))
    expect(await screen.findByRole('status')).toHaveTextContent('Ключ працює.')
    expect(api.testApiKey).toHaveBeenLastCalledWith(undefined, undefined)
    fireEvent.change(screen.getByLabelText('Keystring'), { target: { value: 'k1' } })
    fireEvent.change(screen.getByLabelText('Shared secret'), { target: { value: 's1' } })
    api.testApiKey.mockResolvedValue({ ok: false, message: 'Etsy відхилив API-ключ (HTTP 403).' })
    fireEvent.click(screen.getByText('Перевірити ключ'))
    await waitFor(() => expect(api.testApiKey).toHaveBeenLastCalledWith('k1', 's1'))
    expect(await screen.findByRole('status')).toHaveTextContent(/відхилив/)
  })

  it('warns when the key is stored without encryption', () => {
    useStore.setState({ keyStatus: { ...withKey, encrypted: false } })
    renderIt()
    expect(screen.getByText(/без шифрування/)).toBeInTheDocument()
  })

  it('no key: says so, and the test button needs input', () => {
    useStore.setState({ keyStatus: noKey })
    renderIt()
    expect(screen.getByText('Ключ не задано.')).toBeInTheDocument()
    expect(screen.getByText('Перевірити ключ')).toBeDisabled()
    expect(screen.queryByText('Видалити ключ')).toBeNull()
  })

  it('Видалити ключ confirms, then clears', async () => {
    renderIt()
    fireEvent.click(screen.getByText('Видалити ключ'))
    fireEvent.click(await screen.findByText('Підтвердити'))
    await waitFor(() => expect(api.clearApiKey).toHaveBeenCalled())
    await waitFor(() => expect(useStore.getState().keyStatus).toEqual(noKey))
  })

  it('includes the Etsy trademark notice', () => {
    renderIt()
    expect(screen.getByText(/is a trademark of Etsy, Inc/)).toBeInTheDocument()
  })
})
