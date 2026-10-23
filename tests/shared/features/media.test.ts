import { describe, expect, it } from 'vitest'
import {
  MAX_ALT_TEXT,
  MAX_VIDEO_BYTES,
  MEDIA_TOOL_SUMMARY,
  formatBytes,
  mediaProblem,
  mediaProblemEnglish,
  mediaProblemText
} from '../../../src/shared/features/media'

const MB = 1024 * 1024

describe('media limits', () => {
  it('photos: JPG/PNG/GIF up to 20 MB (case-insensitive extension)', () => {
    expect(mediaProblem('photo', 'a.JPG', MB)).toBeNull()
    expect(mediaProblem('photo', 'a.jpeg', 20 * MB)).toBeNull()
    expect(mediaProblem('photo', 'a.webp', MB)).toBe('type')
    expect(mediaProblem('photo', 'noext', MB)).toBe('type')
    expect(mediaProblem('photo', 'a.png', 20 * MB + 1)).toBe('size')
  })

  it('videos: the picker formats up to 100 MB; files: any type up to 20 MB', () => {
    expect(mediaProblem('video', 'clip.MOV', MAX_VIDEO_BYTES)).toBeNull()
    expect(mediaProblem('video', 'clip.gif', MB)).toBe('type')
    expect(mediaProblem('video', 'clip.mp4', MAX_VIDEO_BYTES + 1)).toBe('size')
    expect(mediaProblem('file', 'anything.xyz', 20 * MB)).toBeNull()
    expect(mediaProblem('file', 'big.zip', 20 * MB + 1)).toBe('size')
  })

  it('Ukrainian and English texts', () => {
    expect(mediaProblemText('photo', 'a.bmp', 1)).toBe('«a.bmp»: фото має бути JPG, JPEG, PNG, GIF.')
    expect(mediaProblemText('video', 'a.gif', 1)).toBe('«a.gif»: відео має бути MP4, MOV, M4V, WEBM, AVI, MKV.')
    expect(mediaProblemText('file', 'a.zip', 21 * MB)).toBe('«a.zip» більший за 20 МБ.')
    expect(mediaProblemText('file', 'a.zip', 1)).toBeNull()
    expect(mediaProblemEnglish('photo', 'a.bmp', 1)).toBe('"a.bmp": a photo must be JPG, JPEG, PNG, GIF.')
    expect(mediaProblemEnglish('video', 'a.mp4', 101 * MB)).toBe('"a.mp4" is larger than 100 MB.')
    expect(mediaProblemEnglish('video', 'a.mp4', 1)).toBeNull()
    expect(MAX_ALT_TEXT).toBe(500)
  })

  it('formatBytes', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(834)).toBe('834 Б')
    expect(formatBytes(12_800)).toBe('12,5 КБ')
    expect(formatBytes(3.4 * MB)).toBe('3,4 МБ')
  })

  it('MEDIA_TOOL_SUMMARY: unique names, Ukrainian texts, only list_my_product_media is read-only', () => {
    const names = MEDIA_TOOL_SUMMARY.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(MEDIA_TOOL_SUMMARY.filter((t) => !t.write).map((t) => t.name)).toEqual(['list_my_product_media'])
    for (const t of MEDIA_TOOL_SUMMARY) expect(t.text).toMatch(/[а-яіїєґ]/)
  })
})
