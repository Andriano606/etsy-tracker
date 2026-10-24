// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SettingsModal } from '../../../src/renderer/src/components/SettingsModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { useStore } from '../../../src/renderer/src/store'
import { GLOSSARY } from '../../../src/shared/glossary'
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

const button = (name: string) => screen.getByRole('button', { name })
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))

describe('SettingsModal: layout', () => {
  it('a dialog with four tabs; "Доступ до Etsy" is open first', () => {
    renderIt()
    expect(screen.getByRole('dialog', { name: 'Налаштування' })).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Доступ до Etsy', 'Ціни для покупця', 'Фото', 'Про програму'])
    expect(screen.getByRole('tab', { name: 'Доступ до Etsy' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Ключ доступу до Etsy')
    // Other sections are hidden, not shown below each other.
    expect(screen.queryByRole('button', { name: 'Зберегти країну' })).toBeNull()
  })

  it('switching tabs keeps what was typed (panels stay mounted)', () => {
    renderIt()
    fireEvent.change(screen.getByLabelText('Keystring'), { target: { value: 'typed-key' } })
    openTab('Фото')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Копії фото на цьому комп’ютері')
    expect(screen.queryByRole('button', { name: 'Зберегти ключ' })).toBeNull()
    openTab('Доступ до Etsy')
    expect(screen.getByLabelText('Keystring')).toHaveValue('typed-key')
  })

  it('closes on "Закрити", × and Escape', () => {
    renderIt()
    fireEvent.click(screen.getByText('Закрити'))
    expect(useStore.getState().showSettings).toBe(false)
    act(() => useStore.setState({ showSettings: true }))
    fireEvent.click(screen.getByTitle('Закрити (Esc)'))
    expect(useStore.getState().showSettings).toBe(false)
    act(() => useStore.setState({ showSettings: true }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useStore.getState().showSettings).toBe(false)
  })

  it('explains the terms: the key fields have glossary tips', () => {
    renderIt()
    expect(screen.getByRole('button', { name: 'Що таке «Keystring»?' })).toHaveAccessibleDescription(GLOSSARY.keystring.short)
    expect(screen.getByRole('button', { name: 'Що таке «Shared secret»?' })).toHaveAccessibleDescription(GLOSSARY.sharedSecret.short)
    expect(screen.getByLabelText('Keystring')).toHaveAccessibleDescription('Перша, відкрита частина ключа.')
  })
})

describe('SettingsModal: Доступ до Etsy', () => {
  it('a stored key that cannot be decrypted is reported, not shown as "not set"', () => {
    useStore.setState({ keyStatus: { hasKey: false, masked: null, encrypted: false, unreadable: true } })
    renderIt()
    expect(screen.getByTestId('key-status')).toHaveTextContent(/не вдалося розшифрувати.*введіть ключ ще раз/)
    expect(screen.getByTestId('key-status')).not.toHaveTextContent('Ключ не задано.')
    expect(screen.queryByRole('button', { name: 'Видалити ключ' })).toBeNull()
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

  it('the step-by-step help is open without a key and folded once a key is saved', () => {
    const { unmount } = renderIt()
    const how = () => screen.getByText('Як отримати ключ — покроково').closest('details')!
    expect(how()).not.toHaveAttribute('open')
    expect(how()).toHaveTextContent('etsy.com/developers/register')
    unmount()
    useStore.setState({ keyStatus: noKey })
    renderIt()
    expect(how()).toHaveAttribute('open')
  })

  it('saves both halves, then clears the inputs — the full key never shows', async () => {
    const { container } = renderIt()
    fireEvent.change(screen.getByLabelText('Keystring'), { target: { value: FULL_KEY } })
    fireEvent.change(screen.getByLabelText('Shared secret'), { target: { value: SECRET } })
    fireEvent.click(button('Зберегти ключ'))
    await screen.findByText('Ключ збережено.')
    expect(api.setApiKey).toHaveBeenCalledWith(FULL_KEY, SECRET)
    expect(screen.getByLabelText('Keystring')).toHaveValue('')
    expect(screen.getByLabelText('Shared secret')).toHaveValue('')
    expect(container.innerHTML).not.toContain(FULL_KEY)
    expect(container.innerHTML).not.toContain(SECRET)
  })

  it('"Зберегти ключ" needs both halves', () => {
    renderIt()
    expect(button('Зберегти ключ')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Keystring'), { target: { value: 'k' } })
    expect(button('Зберегти ключ')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Shared secret'), { target: { value: 's' } })
    expect(button('Зберегти ключ')).toBeEnabled()
  })

  it('shows a validation error from main', async () => {
    api.setApiKey.mockResolvedValue({ ok: false, error: 'Keystring не може містити пробілів чи двокрапки.' })
    renderIt()
    fireEvent.change(screen.getByLabelText('Keystring'), { target: { value: 'a:b' } })
    fireEvent.change(screen.getByLabelText('Shared secret'), { target: { value: 's' } })
    fireEvent.click(button('Зберегти ключ'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/двокрапки/)
  })

  it('Перевірити ключ tests the typed values, or the stored key', async () => {
    renderIt()
    fireEvent.click(button('Перевірити ключ'))
    expect(await screen.findByRole('status')).toHaveTextContent('Ключ працює.')
    expect(api.testApiKey).toHaveBeenLastCalledWith(undefined, undefined)
    fireEvent.change(screen.getByLabelText('Keystring'), { target: { value: 'k1' } })
    fireEvent.change(screen.getByLabelText('Shared secret'), { target: { value: 's1' } })
    api.testApiKey.mockResolvedValue({ ok: false, message: 'Etsy відхилив API-ключ (HTTP 403).' })
    fireEvent.click(button('Перевірити ключ'))
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
    expect(button('Перевірити ключ')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Видалити ключ' })).toBeNull()
  })

  it('Видалити ключ confirms (saying what is lost, with a red "Видалити ключ"), then clears', async () => {
    renderIt()
    fireEvent.click(button('Видалити ключ'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Видалення ключа' })
    expect(dialog).toHaveTextContent(/Без нього програма не зможе сканувати магазини/)
    expect(within(dialog).getByRole('button', { name: 'Скасувати' })).toHaveFocus()
    // Cancelled: nothing happens.
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Скасувати' }))
    })
    expect(api.clearApiKey).not.toHaveBeenCalled()
    expect(useStore.getState().keyStatus).toEqual(withKey)
    fireEvent.click(button('Видалити ключ'))
    const again = await screen.findByRole('alertdialog', { name: 'Видалення ключа' })
    const ok = within(again).getByRole('button', { name: 'Видалити ключ' })
    expect(ok).toHaveClass('stop') // danger-solid
    await act(async () => {
      fireEvent.click(ok)
    })
    await waitFor(() => expect(api.clearApiKey).toHaveBeenCalled())
    await waitFor(() => expect(useStore.getState().keyStatus).toEqual(noKey))
    expect(screen.getByText('Ключ не задано.')).toBeInTheDocument()
  })
})

describe('SettingsModal: Про програму', () => {
  it('includes the Etsy trademark notice', () => {
    renderIt()
    openTab('Про програму')
    expect(screen.getByText(/is a trademark of Etsy, Inc/)).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/не старші за 6 годин/)
  })
})

describe('SettingsModal: Фото (MinIO)', () => {
  const MSECRET = 'minio-typed-secret'

  it('a beginner sees one switch; the docker-compose defaults sit under "Для досвідчених"; the password starts empty', () => {
    renderIt()
    openTab('Фото')
    const sec = screen.getByTestId('minio-section')
    expect(sec).toHaveTextContent('Копії фото на цьому комп’ютері')
    expect(screen.getByRole('switch', { name: 'Зберігати копії фото' })).toBeChecked()
    expect(screen.getByText(/Для досвідчених:/, { selector: 'summary' }).closest('details')).not.toHaveAttribute('open')
    expect(screen.getByLabelText('Адреса сховища')).toHaveValue('http://127.0.0.1:9100')
    expect(screen.getByLabelText('Логін')).toHaveValue('etsytracker')
    expect(screen.getByLabelText('Тека для фото')).toHaveValue('etsy-tracker')
    expect(screen.getByLabelText('Пароль')).toHaveValue('')
    expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'password')
    expect(screen.getByTestId('minio-secret-status')).toHaveTextContent(/типовий пароль.*загальновідомий/)
  })

  it('how to start the store: a docker run command for the installed app, compose only for the source code', () => {
    renderIt()
    openTab('Фото')
    const run = screen.getByTestId('copy-minio-run')
    expect(run).toHaveTextContent(/встановлена програма \(без вихідного коду\)/)
    expect(run.querySelector('pre')!.textContent).toMatch(/^docker run -d --name etsy-tracker-minio /)
    expect(run.querySelector('pre')!.textContent).toContain('-p 127.0.0.1:9100:9000 -p 127.0.0.1:9101:9001')
    expect(run.querySelector('pre')!.textContent).toContain('MINIO_ROOT_USER=etsytracker')
    expect(screen.getByTestId('copy-minio-compose').querySelector('pre')!.textContent).toBe('docker compose up -d')
    expect(screen.getByTestId('minio-section')).toHaveTextContent(/у встановленій програмі його немає/)
    expect(screen.getByText('Docker')).toHaveAccessibleDescription(GLOSSARY['settings.docker'].short)
  })

  it('the switch is saved at once with the saved address — typed changes stay unsaved', async () => {
    api.setMinio.mockResolvedValueOnce({ ok: true, status: { ...minioDefault, enabled: false } })
    renderIt()
    openTab('Фото')
    fireEvent.change(screen.getByLabelText('Тека для фото'), { target: { value: 'typed-bucket' } })
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: MSECRET } })
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Зберігати копії фото' }))
    })
    expect(api.setMinio).toHaveBeenCalledTimes(1)
    expect(api.setMinio).toHaveBeenLastCalledWith({
      enabled: false,
      endpoint: 'http://127.0.0.1:9100',
      accessKey: 'etsytracker',
      bucket: 'etsy-tracker'
    })
    expect(screen.getByRole('switch', { name: 'Зберігати копії фото' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Зберігати копії фото' })).toHaveAccessibleDescription(/прямо з Etsy.*Зміна діє одразу/)
    expect(screen.getByText('Копіювання фото вимкнено.')).toBeInTheDocument()
    expect(screen.getByLabelText('Тека для фото')).toHaveValue('typed-bucket')
    expect(screen.getByLabelText('Пароль')).toHaveValue(MSECRET)
    expect(screen.getByText(/Є незбережені зміни/)).toBeInTheDocument()
    expect(button('Зберегти налаштування фото')).toBeEnabled()
  })

  it('a switch main refuses shows the error and stays as saved', async () => {
    api.setMinio.mockResolvedValueOnce({ ok: false, error: 'Не вдалося записати налаштування.' })
    renderIt()
    openTab('Фото')
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Зберігати копії фото' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося записати налаштування.')
    expect(screen.getByRole('switch', { name: 'Зберігати копії фото' })).toBeChecked()
  })

  it('the save button is off until something changes; unsaved changes are flagged', () => {
    renderIt()
    openTab('Фото')
    expect(button('Зберегти налаштування фото')).toBeDisabled()
    expect(screen.queryByText(/Є незбережені зміни/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Адреса сховища'), { target: { value: 'http://127.0.0.1:9200' } })
    expect(button('Зберегти налаштування фото')).toBeEnabled()
    expect(screen.getByText(/Є незбережені зміни/)).toBeInTheDocument()
    // Typed back to the saved value: nothing to save again.
    fireEvent.change(screen.getByLabelText('Адреса сховища'), { target: { value: 'http://127.0.0.1:9100' } })
    expect(button('Зберегти налаштування фото')).toBeDisabled()
    expect(screen.queryByText(/Є незбережені зміни/)).toBeNull()
    // A typed password is a change too.
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'x' } })
    expect(button('Зберегти налаштування фото')).toBeEnabled()
  })

  it('saves (password only when typed), then shows what was saved and clears the password input', async () => {
    const { container } = renderIt()
    openTab('Фото')
    fireEvent.change(screen.getByLabelText('Тека для фото'), { target: { value: 'photos' } })
    api.setMinio.mockResolvedValueOnce({ ok: true, status: { ...minioDefault, bucket: 'photos' } })
    await act(async () => {
      fireEvent.click(button('Зберегти налаштування фото'))
    })
    await screen.findByText('Налаштування фото збережено.')
    expect(api.setMinio).toHaveBeenLastCalledWith({
      enabled: true,
      endpoint: 'http://127.0.0.1:9100',
      accessKey: 'etsytracker',
      bucket: 'photos'
    })
    expect(screen.getByLabelText('Тека для фото')).toHaveValue('photos')
    expect(button('Зберегти налаштування фото')).toBeDisabled()
    expect(screen.queryByText(/Є незбережені зміни/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: MSECRET } })
    await act(async () => {
      fireEvent.click(button('Зберегти налаштування фото'))
    })
    await waitFor(() => expect(api.setMinio).toHaveBeenLastCalledWith(expect.objectContaining({ secretKey: MSECRET, enabled: true })))
    await waitFor(() => expect(screen.getByLabelText('Пароль')).toHaveValue(''))
    expect(container.innerHTML).not.toContain(MSECRET)
    expect(screen.getByTestId('minio-secret-status')).toHaveTextContent(/Пароль збережено, зашифровано/)
  })

  it('shows a validation error from main', async () => {
    api.setMinio.mockResolvedValue({ ok: false, error: 'Назва бакета: 3–63 символи' })
    renderIt()
    openTab('Фото')
    fireEvent.change(screen.getByLabelText('Тека для фото'), { target: { value: 'x' } })
    fireEvent.click(button('Зберегти налаштування фото'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Назва бакета/)
    expect(screen.getByLabelText('Тека для фото')).toHaveValue('x')
  })

  it('Перевірити з’єднання tests the typed values', async () => {
    api.testMinio.mockResolvedValue({ ok: false, message: 'MinIO недоступний (ECONNREFUSED). Запустіть: docker compose up -d' })
    renderIt()
    openTab('Фото')
    fireEvent.change(screen.getByLabelText('Адреса сховища'), { target: { value: 'http://127.0.0.1:9999' } })
    fireEvent.click(button('Перевірити з’єднання'))
    expect(await screen.findByRole('status')).toHaveTextContent(/ECONNREFUSED/)
    expect(api.testMinio).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'http://127.0.0.1:9999' }))
  })

  it('an unreadable stored password is reported and "Для досвідчених" opens by itself', () => {
    useStore.setState({ minioStatus: { ...minioDefault, secretSource: 'stored', unreadable: true } })
    renderIt()
    openTab('Фото')
    expect(screen.getByTestId('minio-secret-status')).toHaveTextContent(/не вдалося розшифрувати/)
    expect(screen.getByText(/Для досвідчених:/, { selector: 'summary' }).closest('details')).toHaveAttribute('open')
  })
})

describe('SettingsModal: Ціни для покупця', () => {
  it('shows the current country, saves another common one and says it applies from the next scan', async () => {
    useStore.setState({ buyerCountry: 'UA' })
    renderIt()
    openTab('Ціни для покупця')
    const section = screen.getByTestId('buyer-country-section')
    expect(section).toHaveTextContent('Зараз: Україна (UA)')
    expect(section).toHaveTextContent(/2,50 USD.*3,00 USD.*1,20 USD/)
    const select = screen.getByLabelText('Країна') as HTMLSelectElement
    expect(select.value).toBe('UA')
    // Nothing to save while the country is the current one.
    expect(button('Зберегти країну')).toBeDisabled()
    fireEvent.change(select, { target: { value: 'DE' } })
    fireEvent.click(button('Зберегти країну'))
    await waitFor(() => expect(api.setBuyerCountry).toHaveBeenCalledWith('DE'))
    expect(await screen.findByText('Збережено. Нова країна застосується з наступного сканування.')).toBeInTheDocument()
    expect(useStore.getState().buyerCountry).toBe('DE')
    expect(button('Зберегти країну')).toBeDisabled()
  })

  it('"Інша…": free input, uppercased, validated before saving', async () => {
    useStore.setState({ buyerCountry: 'UA' })
    renderIt()
    openTab('Ціни для покупця')
    fireEvent.change(screen.getByLabelText('Країна'), { target: { value: '__other' } })
    const input = screen.getByLabelText('Код країни') as HTMLInputElement
    const save = button('Зберегти країну')
    fireEvent.change(input, { target: { value: 'xx' } })
    expect(input.value).toBe('XX')
    expect(save).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Невідомий код країни/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(input, { target: { value: 'jp' } })
    expect(save).toBeEnabled()
    expect(input).toHaveAccessibleDescription(/Це .*\(JP\)/)
    fireEvent.click(save)
    await waitFor(() => expect(api.setBuyerCountry).toHaveBeenCalledWith('JP'))
    await waitFor(() => expect(useStore.getState().buyerCountry).toBe('JP'))
  })

  it('a stored country outside the short list opens on "Інша…" with the code filled in', () => {
    useStore.setState({ buyerCountry: 'NO' })
    renderIt()
    openTab('Ціни для покупця')
    expect((screen.getByLabelText('Країна') as HTMLSelectElement).value).toBe('__other')
    expect((screen.getByLabelText('Код країни') as HTMLInputElement).value).toBe('NO')
  })

  it('an error from main is shown and the country is kept', async () => {
    api.setBuyerCountry.mockResolvedValue({ ok: false, error: 'Вкажіть двобуквений код країни за ISO 3166-1 (напр. UA, US, DE, GB).' })
    useStore.setState({ buyerCountry: 'UA' })
    renderIt()
    openTab('Ціни для покупця')
    fireEvent.change(screen.getByLabelText('Країна'), { target: { value: 'PL' } })
    fireEvent.click(button('Зберегти країну'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ISO 3166-1/)
    expect(useStore.getState().buyerCountry).toBe('UA')
  })

  it('before the setting is loaded the default UA is shown', () => {
    renderIt()
    openTab('Ціни для покупця')
    expect(screen.getByTestId('buyer-country-section')).toHaveTextContent('Зараз: Україна (UA)')
  })
})
