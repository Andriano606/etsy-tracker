import { describe, expect, it } from 'vitest'
import { playableVideo, playableVideos, videoThumbSrc } from '../../src/renderer/src/imageUrl'
import type { ListingVideo } from '../../src/shared/types'

const vid = (id: number, over: Partial<ListingVideo> = {}): ListingVideo => ({
  id,
  width: 1280,
  height: 960,
  thumbnailUrl: `https://v.etsystatic.com/video/${id}.jpg`,
  videoUrl: `https://v.etsystatic.com/video/${id}.mp4`,
  state: 'active',
  ...over
})

describe('listing videos in the renderer', () => {
  it('the preview frame goes through main', () => {
    expect(videoThumbSrc({ id: 9 })).toBe('etsyimg://video/9/thumbnail')
  })

  it('plays only an https Etsy CDN video that Etsy shows (active, or state unknown)', () => {
    expect(playableVideo(vid(1))).toBe('https://v.etsystatic.com/video/1.mp4')
    expect(playableVideo(vid(1, { state: null }))).toBe('https://v.etsystatic.com/video/1.mp4')
    for (const state of ['inactive', 'deleted', 'flagged']) expect(playableVideo(vid(1, { state }))).toBeNull()
    for (const videoUrl of [null, '', 'http://v.etsystatic.com/v.mp4', 'https://evil.example.com/v.mp4', 'file:///etc/passwd', 'etsyimg://img/1/fullxfull'])
      expect(playableVideo(vid(1, { videoUrl }))).toBeNull()
  })

  it('playableVideos keeps Etsy’s order and drops the rest', () => {
    expect(playableVideos([vid(1), vid(2, { state: 'inactive' }), vid(3)]).map((v) => v.id)).toEqual([1, 3])
    expect(playableVideos(undefined)).toEqual([])
    expect(playableVideos(null)).toEqual([])
  })
})
