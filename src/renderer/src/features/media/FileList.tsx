// The buyer files of a digital listing: list, add, replace, delete. Adding the
// first file makes a physical listing digital; deleting the last one, physical.

import { formatBytes, type MediaFile } from '@shared/features/media'
import { MAX_DIGITAL_FILES } from '@shared/myShop'
import { Badge, Button, EmptyState, Icon, InfoTip } from '../../ui'
import type { MediaOps } from './MediaSection'

/** Etsy's size label in Ukrainian units: "20 KB" → "20 КБ", "1.5 MB" → "1,5 МБ". */
export function localSize(label: string): string {
  const units: Record<string, string> = { B: 'Б', KB: 'КБ', MB: 'МБ', GB: 'ГБ' }
  const m = /^\s*([\d.,]+)\s*(B|KB|MB|GB)\s*$/i.exec(label)
  return m ? `${m[1].replace('.', ',')} ${units[m[2].toUpperCase()]}` : label
}

/** "application/pdf" → "PDF"; else the file's extension; else nothing. */
function kindOf(f: MediaFile): string | null {
  const ext = /\.([a-z0-9]{1,6})$/i.exec(f.name)?.[1]
  if (ext) return ext.toUpperCase()
  const sub = f.type?.split('/')[1]
  return sub ? sub.toUpperCase() : null
}

export function FileList({ files, ops }: { files: MediaFile[]; ops: MediaOps }): JSX.Element {
  const digital = ops.listing.type === 'download' || ops.listing.type === 'both'
  const full = files.length >= MAX_DIGITAL_FILES

  const add = async (): Promise<void> => {
    const picked = await ops.pick('file')
    if (!picked) return
    if (files.length + picked.length > MAX_DIGITAL_FILES) {
      ops.fail(`У товару може бути до ${MAX_DIGITAL_FILES} файлів: зараз ${files.length}, можна додати ще ${MAX_DIGITAL_FILES - files.length}.`)
      return
    }
    const names = picked.map((f) => `«${f.name}»`).join(', ')
    const confirm =
      !files.length && !digital
        ? `Додати ${names}? Товар стане цифровим: Etsy прибере вартість доставки й варіанти товару.`
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
    const last = files.length === 1 ? '\nЦе останній файл: після видалення Etsy зробить товар фізичним (його надсилатимуть поштою).' : ''
    void ops.run('deleteFile', { fileId: f.id }, `Файл «${f.name}» видалено.`, `Видалити файл «${f.name}»?${last}`)
  }

  return (
    <section className="media-block" data-testid="media-files" aria-labelledby="media-files-title">
      <div className="media-block-head">
        <h4 id="media-files-title" className="media-block-title">
          Файли для покупця
        </h4>
        <InfoTip glossary="myshop.digitalFiles" />
        <Badge tone={full ? 'warn' : 'neutral'}>
          {files.length} з {MAX_DIGITAL_FILES}
        </Badge>
        <span className="media-block-spacer" />
        <Button
          size="sm"
          variant={digital && files.length === 0 ? 'primary' : 'secondary'}
          icon="plus"
          disabled={ops.busy || full}
          tooltip={full ? `Уже ${MAX_DIGITAL_FILES} файлів — це максимум` : undefined}
          onClick={() => void add()}
        >
          Додати файли
        </Button>
      </div>
      <p className="media-limits">
        До {MAX_DIGITAL_FILES} файлів, кожен до 20 МБ. {digital ? 'Покупець завантажить їх одразу після оплати.' : 'Перший доданий файл зробить товар цифровим.'}
      </p>
      {files.length === 0 ? (
        <EmptyState compact icon="file" title={digital ? 'Файлів немає — покупці нічого не отримають.' : 'Файлів немає (фізичний товар).'}>
          {digital ? 'Додайте хоча б один файл, інакше цифровий товар не опублікувати.' : 'Фізичний товар надсилається поштою, файли йому не потрібні.'}
        </EmptyState>
      ) : (
        <ol className="media-files">
          {files.map((f) => {
            const kind = kindOf(f)
            const size = f.sizeBytes != null ? formatBytes(f.sizeBytes) : (f.sizeLabel ? localSize(f.sizeLabel) : null)
            return (
              <li key={f.id} className="media-file">
                <span className="media-file-icon" aria-hidden="true">
                  <Icon name="file" size={18} />
                </span>
                <div className="media-file-main">
                  <div className="media-file-name truncate" title={f.name}>
                    {f.name}
                  </div>
                  <div className="media-meta">
                    №{f.rank}
                    {size ? ` · ${size}` : ''}
                    {kind ? ` · ${kind}` : ''}
                  </div>
                </div>
                <div className="media-actions">
                  <Button size="sm" icon="upload" aria-label={`Замінити «${f.name}»`} disabled={ops.busy} onClick={() => void replace(f)}>
                    Замінити
                  </Button>
                  <Button size="sm" variant="danger" icon="trash" aria-label={`Видалити «${f.name}»`} disabled={ops.busy} onClick={() => remove(f)}>
                    Видалити
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
