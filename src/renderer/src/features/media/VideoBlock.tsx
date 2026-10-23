// The listing's video (one per listing): thumbnail + state, re-check the
// state (Etsy processes an upload for a while), delete, upload / replace.

import { MAX_VIDEO_BYTES, VIDEO_STATE_LABEL, VIDEO_UPLOADS_PER_DAY, type MediaVideo, type VideoState } from '@shared/features/media'
import { featureCall } from '../call'
import type { MediaOps } from './MediaSection'

const stateLabel = (s: string | null): string => (s ? (VIDEO_STATE_LABEL[s as VideoState] ?? s) : 'невідомий')

export function VideoBlock({ videos, ops }: { videos: MediaVideo[]; ops: MediaOps }): JSX.Element {
  const video = videos.find((v) => v.state !== 'deleted') ?? null

  const recheck = async (v: MediaVideo): Promise<void> => {
    const r = await featureCall<MediaVideo>('media', 'video', { listingId: ops.listing.listingId, videoId: v.id })
    if (r.ok) ops.patchVideo(r.value)
    else ops.fail(r.error)
  }

  const upload = async (): Promise<void> => {
    const [f] = (await ops.pick('video')) ?? []
    if (!f) return
    await ops.run(
      'uploadVideo',
      { token: f.token },
      `Відео «${f.name}» завантажено. Etsy ще може його обробляти — перевірте стан за хвилину.`,
      video ? `Замінити відео лістингу на «${f.name}»? Поточне відео буде знято після того, як нове завантажиться.` : ops.liveConfirm(`Завантажити відео «${f.name}»?`)
    )
  }

  return (
    <div data-testid="media-video">
      <h4>Відео</h4>
      {video ? (
        <div className="media-video">
          {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="Кадр відео" /> : <div className="media-thumb-empty" />}
          <div>
            <div>Стан: {stateLabel(video.state)}</div>
            {video.width && video.height ? <div className="hint">{`${video.width}×${video.height}`}</div> : null}
            <div className="media-actions">
              <button className="btn small" disabled={ops.busy} onClick={() => void recheck(video)}>
                Перевірити стан
              </button>
              <button
                className="btn small danger"
                disabled={ops.busy}
                onClick={() => void ops.run('deleteVideo', { videoId: video.id }, 'Відео видалено.', 'Видалити відео з лістингу?')}
              >
                Видалити відео
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="hint">Відео немає.</div>
      )}
      <div className="settings-actions">
        <button className="btn small" disabled={ops.busy} onClick={() => void upload()}>
          {video ? 'Замінити відео' : 'Завантажити відео'}
        </button>
      </div>
      <div className="hint">
        Одне відео на лістинг: 5–15 секунд, до {MAX_VIDEO_BYTES / 1024 / 1024} МБ; не більше {VIDEO_UPLOADS_PER_DAY} завантажень
        на добу.
      </div>
    </div>
  )
}
