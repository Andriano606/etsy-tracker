// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsModal } from '../../../src/renderer/src/components/SettingsModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { useStore } from '../../../src/renderer/src/store'
import { minioDefault, noKey, setupRenderer, withKey, type Api } from '../helpers'

const FULL_KEY = 'abcd1234efgh5678wxyz'
const SECRET = 'very-secret-value'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ showSettings: true, keyStatus: withKey, minioStatus: minioDefault })
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

describe('SettingsModal: MinIO', () => {
  const MSECRET = 'minio-typed-secret'

  it('shows the docker-compose defaults; the secret input starts empty and is a password', () => {
    renderIt()
    const sec = screen.getByTestId('minio-section')
    expect(sec).toHaveTextContent('Сховище зображень (MinIO)')
    expect(screen.getByLabelText('Адреса (S3 API)')).toHaveValue('http://127.0.0.1:9100')
    expect(screen.getByLabelText('Access key')).toHaveValue('etsytracker')
    expect(screen.getByLabelText('Бакет')).toHaveValue('etsy-tracker')
    expect(screen.getByLabelText('Secret key')).toHaveValue('')
    expect(screen.getByLabelText('Secret key')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Зберігати фото в MinIO')).toBeChecked()
    expect(screen.getByTestId('minio-secret-status')).toHaveTextContent(/типовий ключ/)
    expect(screen.getByTestId('minio-secret-status').querySelector('.warn')).toHaveTextContent(/загальновідомий/)
  })

  it('saves (secret only when typed), then clears the secret input', async () => {
    const { container } = renderIt()
    fireEvent.change(screen.getByLabelText('Бакет'), { target: { value: 'photos' } })
    fireEvent.click(screen.getByText('Зберегти MinIO'))
    await screen.findByText('Налаштування MinIO збережено.')
    expect(api.setMinio).toHaveBeenLastCalledWith({
      enabled: true,
      endpoint: 'http://127.0.0.1:9100',
      accessKey: 'etsytracker',
      bucket: 'photos'
    })
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: MSECRET } })
    fireEvent.click(screen.getByLabelText('Зберігати фото в MinIO'))
    fireEvent.click(screen.getByText('Зберегти MinIO'))
    await waitFor(() => expect(api.setMinio).toHaveBeenLastCalledWith(expect.objectContaining({ secretKey: MSECRET, enabled: false })))
    await waitFor(() => expect(screen.getByLabelText('Secret key')).toHaveValue(''))
    expect(container.innerHTML).not.toContain(MSECRET)
    expect(screen.getByTestId('minio-secret-status')).toHaveTextContent(/Збережено, зашифровано/)
  })

  it('shows a validation error from main', async () => {
    api.setMinio.mockResolvedValue({ ok: false, error: 'Назва бакета: 3–63 символи' })
    renderIt()
    fireEvent.click(screen.getByText('Зберегти MinIO'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Назва бакета/)
  })

  it('Перевірити з’єднання tests the typed values', async () => {
    api.testMinio.mockResolvedValue({ ok: false, message: 'MinIO недоступний (ECONNREFUSED). Запустіть: docker compose up -d' })
    renderIt()
    fireEvent.change(screen.getByLabelText('Адреса (S3 API)'), { target: { value: 'http://127.0.0.1:9999' } })
    fireEvent.click(screen.getByText('Перевірити з’єднання'))
    expect(await screen.findByText(/ECONNREFUSED/)).toBeInTheDocument()
    expect(api.testMinio).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://127.0.0.1:9999' }))
  })

  it('an unreadable stored secret is reported', () => {
    useStore.setState({ minioStatus: { ...minioDefault, secretSource: 'stored', unreadable: true } })
    renderIt()
    expect(screen.getByTestId('minio-secret-status')).toHaveTextContent(/не вдалося розшифрувати/)
  })
})

describe('SettingsModal: Країна покупця', () => {
  it('shows the current country, saves another common one and says it applies from the next scan', async () => {
    useStore.setState({ buyerCountry: 'UA' })
    renderIt()
    const section = screen.getByTestId('buyer-country-section')
    expect(section).toHaveTextContent('Зараз: Україна (UA)')
    const select = screen.getByLabelText('Країна') as HTMLSelectElement
    expect(select.value).toBe('UA')
    fireEvent.change(select, { target: { value: 'DE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти країну' }))
    await waitFor(() => expect(api.setBuyerCountry).toHaveBeenCalledWith('DE'))
    expect(await screen.findByText('Збережено. Нова країна застосується з наступного сканування.')).toBeInTheDocument()
    expect(useStore.getState().buyerCountry).toBe('DE')
  })

  it('"Інша…": free input, uppercased, validated before saving', async () => {
    useStore.setState({ buyerCountry: 'UA' })
    renderIt()
    fireEvent.change(screen.getByLabelText('Країна'), { target: { value: '__other' } })
    const input = screen.getByLabelText('Код країни (ISO 3166-1)') as HTMLInputElement
    const save = screen.getByRole('button', { name: 'Зберегти країну' })
    fireEvent.change(input, { target: { value: 'xx' } })
    expect(input.value).toBe('XX')
    expect(save).toBeDisabled()
    expect(screen.getByText(/Невідомий код країни/)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'jp' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(api.setBuyerCountry).toHaveBeenCalledWith('JP'))
    await waitFor(() => expect(useStore.getState().buyerCountry).toBe('JP'))
  })

  it('a stored country outside the short list opens on "Інша…" with the code filled in', () => {
    useStore.setState({ buyerCountry: 'NO' })
    renderIt()
    expect((screen.getByLabelText('Країна') as HTMLSelectElement).value).toBe('__other')
    expect((screen.getByLabelText('Код країни (ISO 3166-1)') as HTMLInputElement).value).toBe('NO')
  })

  it('an error from main is shown and the country is kept', async () => {
    api.setBuyerCountry.mockResolvedValue({ ok: false, error: 'Вкажіть двобуквений код країни за ISO 3166-1 (напр. UA, US, DE, GB).' })
    useStore.setState({ buyerCountry: 'UA' })
    renderIt()
    fireEvent.change(screen.getByLabelText('Країна'), { target: { value: 'PL' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти країну' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ISO 3166-1/)
    expect(useStore.getState().buyerCountry).toBe('UA')
  })

  it('before the setting is loaded the default UA is shown', () => {
    renderIt()
    expect(screen.getByTestId('buyer-country-section')).toHaveTextContent('Зараз: Україна (UA)')
  })
})
