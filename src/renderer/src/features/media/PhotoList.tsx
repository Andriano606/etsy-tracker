// The listing's photos in rank order: alt text, move up / make main, replace,
// delete (with "Повернути" — Etsy keeps a deleted photo re-attachable), add.

import { useState } from 'react'
import { MAX_ALT_TEXT, type MediaPhoto } from '@shared/features/media'
import { MAX_IMAGES } from '@shared/myShop'
import type { MediaOps } from './MediaSection'

function AltText({ photo, ops, watermarked }: { photo: MediaPhoto; ops: MediaOps; watermarked: boolean }): JSX.Element {
  const [alt, setAlt] = useState(photo.altText)
  return (
    <div className="media-alt">
      <input
        aria-label={`Alt-текст фото №${photo.position}`}
        placeholder="Alt-текст (опис для незрячих)"
        value={alt}
        maxLength={MAX_ALT_TEXT}
        onChange={(e) => setAlt(e.target.value)}
      />
      <button
        className="btn small"
        disabled={ops.busy || alt === photo.altText}
        onClick={() =>
          void ops.run(
            'setAltText',
            { imageId: photo.id, altText: alt, watermarked },
            `Alt-текст фото №${photo.position} збережено.`,
            ops.liveConfirm(`Змінити alt-текст фото №${photo.position}?`)
          )
        }
      >
        Зберегти
      </button>
    </div>
  )
}

export function PhotoList({ photos, ops }: { photos: MediaPhoto[]; ops: MediaOps }): JSX.Element {
  const [watermarked, setWatermarked] = useState(false)
  const [deleted, setDeleted] = useState<MediaPhoto | null>(null)
  const full = photos.length >= MAX_IMAGES

  const move = (p: MediaPhoto, toPosition: number): void =>
    void ops.run(
      'movePhoto',
      { imageId: p.id, toPosition, watermarked },
      toPosition === 1 ? 'Фото стало головним.' : `Фото пересунуто на позицію ${toPosition}.`,
      ops.liveConfirm(`Пересунути фото №${p.position} на позицію ${toPosition}?`)
    )

  const replace = async (p: MediaPhoto): Promise<void> => {
    const [f] = (await ops.pick('photo')) ?? []
    if (!f) return
    await ops.run(
      'replacePhoto',
      // The old alt text describes the old picture — the new one starts without it.
      { position: p.position, token: f.token, altText: '', watermarked },
      `Фото №${p.position} замінено. Додайте alt-текст для нового фото.`,
      `Замінити фото №${p.position} на «${f.name}»? Старе фото буде знято з лістингу, а alt-текст нового буде порожнім.`
    )
  }

  const remove = async (p: MediaPhoto): Promise<void> => {
    if (await ops.run('deletePhoto', { imageId: p.id }, `Фото №${p.position} видалено.`, `Видалити фото №${p.position} з лістингу?`)) {
      setDeleted(p)
    }
  }

  const restore = async (p: MediaPhoto): Promise<void> => {
    const at = Math.min(p.position, photos.length + 1)
    const ok = await ops.run(
      'restorePhoto',
      { imageId: p.id, position: at, altText: p.altText, watermarked },
      'Фото повернуто.',
      ops.liveConfirm(`Повернути видалене фото на позицію ${at}?`)
    )
    if (ok) setDeleted(null)
  }

  const add = async (): Promise<void> => {
    const files = await ops.pick('photo')
    if (!files) return
    if (photos.length + files.length > MAX_IMAGES) {
      ops.fail(`У лістингу може бути до ${MAX_IMAGES} фото: зараз ${photos.length}, можна додати ще ${MAX_IMAGES - photos.length}.`)
      return
    }
    await ops.run(
      'addPhotos',
      { tokens: files.map((f) => f.token), watermarked },
      `Додано фото: ${files.length}.`,
      ops.liveConfirm(`Додати ${files.length} фото в кінець галереї?`)
    )
  }

  return (
    <div data-testid="media-photos">
      <h4>
        Фото: {photos.length} з {MAX_IMAGES}
      </h4>
      {photos.length === 0 ? (
        <div className="hint">Фото немає — без фото лістинг не можна опублікувати.</div>
      ) : (
        <ul className="media-photos">
          {photos.map((p) => {
            const src = p.url170 ?? p.url570 ?? p.url75
            return (
              <li key={p.id} data-testid={`media-photo-${p.id}`}>
                {src ? <img src={src} alt={p.altText || `Фото №${p.position}`} /> : <div className="media-thumb-empty" />}
                <div className="media-meta">
                  №{p.position}
                  {p.position === 1 && ' · головне'}
                  {p.width && p.height ? ` · ${p.width}×${p.height}` : ''}
                </div>
                <AltText key={p.altText} photo={p} ops={ops} watermarked={watermarked} />
                <div className="media-actions">
                  <button className="btn small" title="Пересунути вище" disabled={ops.busy || p.position === 1} onClick={() => move(p, p.position - 1)}>
                    ↑ Вище
                  </button>
                  <button className="btn small" disabled={ops.busy || p.position === 1} onClick={() => move(p, 1)}>
                    Зробити головним
                  </button>
                  <button className="btn small" disabled={ops.busy} onClick={() => void replace(p)}>
                    Замінити
                  </button>
                  <button className="btn small danger" disabled={ops.busy} onClick={() => void remove(p)}>
                    Видалити
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {deleted && (
        <div className="hint warn">
          Фото №{deleted.position} видалено. Etsy зберігає його копію, тож його можна повернути.{' '}
          <button className="btn small" disabled={ops.busy || full} onClick={() => void restore(deleted)}>
            Повернути
          </button>
        </div>
      )}
      <div className="settings-actions">
        <button className="btn small" disabled={ops.busy || full} onClick={() => void add()}>
          + Додати фото
        </button>
        <label className="check">
          <input type="checkbox" checked={watermarked} onChange={(e) => setWatermarked(e.target.checked)} /> З водяним знаком
        </label>
      </div>
      <div className="hint">
        JPG, PNG або GIF, до 20 МБ; до {MAX_IMAGES} фото. Etsy не вміє переставляти фото напряму: «Вище» ставить фото на
        нову позицію й одразу повертає те, що там стояло, на наступну. Etsy не повідомляє, чи фото позначене «з водяним
        знаком», а зміна alt-тексту, перестановка й повернення зберігають фото заново — позначку буде взято з перемикача «З
        водяним знаком».
      </div>
    </div>
  )
}
