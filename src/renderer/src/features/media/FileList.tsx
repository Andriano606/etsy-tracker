// The buyer files of a digital listing: list, add, replace, delete. Adding the
// first file makes a physical listing digital; deleting the last one, physical.

import { formatBytes, type MediaFile } from '@shared/features/media'
import { MAX_DIGITAL_FILES } from '@shared/myShop'
import type { MediaOps } from './MediaSection'

export function FileList({ files, ops }: { files: MediaFile[]; ops: MediaOps }): JSX.Element {
  const digital = ops.listing.type === 'download' || ops.listing.type === 'both'

  const add = async (): Promise<void> => {
    const picked = await ops.pick('file')
    if (!picked) return
    if (files.length + picked.length > MAX_DIGITAL_FILES) {
      ops.fail(`У лістингу може бути до ${MAX_DIGITAL_FILES} файлів: зараз ${files.length}, можна додати ще ${MAX_DIGITAL_FILES - files.length}.`)
      return
    }
    const names = picked.map((f) => `«${f.name}»`).join(', ')
    const confirm =
      !files.length && !digital
        ? `Додати ${names}? Лістинг стане цифровим: Etsy прибере вартість доставки й варіації товару.`
        : ops.liveConfirm(`Додати ${names} до файлів для покупця?`)
    await ops.run('addFiles', { tokens: picked.map((f) => f.token) }, `Додано файлів: ${picked.length}.`, confirm)
  }

  const replace = async (f: MediaFile): Promise<void> => {
    const [n] = (await ops.pick('file')) ?? []
    if (!n) return
    await ops.run(
      'replaceFile',
      { fileId: f.id, token: n.token },
      `Файл «${f.name}» замінено на «${n.name}».`,
      `Замінити «${f.name}» на «${n.name}»? Покупці отримуватимуть новий файл.`
    )
  }

  const remove = (f: MediaFile): void => {
    const last = files.length === 1 ? '\nЦе останній файл: після видалення Etsy зробить лістинг фізичним товаром.' : ''
    void ops.run('deleteFile', { fileId: f.id }, `Файл «${f.name}» видалено.`, `Видалити файл «${f.name}»?${last}`)
  }

  return (
    <div data-testid="media-files">
      <h4>
        Файли для покупця: {files.length} з {MAX_DIGITAL_FILES}
      </h4>
      {files.length === 0 ? (
        <div className="hint">{digital ? 'Файлів немає — покупці нічого не отримають.' : 'Файлів немає (фізичний товар).'}</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Файл</th>
              <th>Розмір</th>
              <th>Тип</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>{f.rank}</td>
                <td>{f.name}</td>
                <td>{f.sizeBytes != null ? formatBytes(f.sizeBytes) : (f.sizeLabel ?? '—')}</td>
                <td>{f.type ?? '—'}</td>
                <td className="media-actions">
                  <button className="btn small" disabled={ops.busy} onClick={() => void replace(f)}>
                    Замінити
                  </button>
                  <button className="btn small danger" disabled={ops.busy} onClick={() => remove(f)}>
                    Видалити
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="settings-actions">
        <button className="btn small" disabled={ops.busy || files.length >= MAX_DIGITAL_FILES} onClick={() => void add()}>
          + Додати файли
        </button>
      </div>
      <div className="hint">До {MAX_DIGITAL_FILES} файлів, кожен до 20 МБ.</div>
    </div>
  )
}
