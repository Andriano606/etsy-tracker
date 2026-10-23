// MCP tools of feature "media": neutral ("product", "photo", "video", "file"),
// no URLs — photos are described by id, position, size, alt text and colour.

import { MAX_ALT_TEXT, mediaProblemEnglish, type ListingMedia, type MediaKind } from '../../../shared/features/media'
import { MAX_DIGITAL_FILES, MAX_IMAGES } from '../../../shared/myShop'
import { type JsonSchema, type McpTool, type McpToolResult, ToolInputError, errorResult, textResult } from '../../mcpProtocol'
import { MEDIA_ITEM, resolveMedia } from '../../mcpStoreTools'
import { neutralText } from '../../neutral'
import { mcpFail, mcpOwnShop, mcpWritable, neutralError } from '../common'
import type { FeatureMcpDeps } from '../types'
import {
  type MediaPart,
  MediaError,
  READ_SCOPES,
  WRITE_SCOPES,
  type Upload,
  deleteFile,
  deletePhoto,
  deleteVideo,
  loadMedia,
  mimeFor,
  replaceFile,
  replacePhoto,
  replaceVideo,
  setAltText
} from './ops'

const WRITE_NOTE = "Changes the user's live store — only call it when the user asked for this change."

const PART_EN: Record<MediaPart, string> = { photos: 'photos', videos: 'video', files: 'files' }

/** One MEDIA_ITEM → bytes to send, checked like the app checks a picked file. */
async function oneUpload(deps: FeatureMcpDeps, item: unknown, kind: MediaKind): Promise<Upload> {
  const own = {
    client: deps.client!,
    status: deps.authStatus,
    writesAllowed: deps.writesAllowed,
    taxonomy: deps.taxonomy,
    readFile: deps.readFile,
    statFile: deps.statFile
  }
  const photo = kind === 'photo'
  const m = await resolveMedia(own, photo ? [item] : [], photo ? [] : [item])
  const f = m.registry.get(photo ? m.photos[0] : m.files[0])!
  const problem = mediaProblemEnglish(kind, f.name, f.size)
  // The file name is the user's text — it may name the marketplace.
  if (problem) throw new ToolInputError(neutralText(problem))
  return { data: await m.readFile(f.path), name: f.name, type: mimeFor(kind, f.name) }
}

function mediaOut(m: ListingMedia) {
  const video = m.videos?.find((v) => v.state !== 'deleted') ?? null
  return {
    product_id: m.listingId,
    photos:
      m.photos?.map((p) => ({
        id: p.id,
        position: p.position,
        width: p.width,
        height: p.height,
        sizes: [p.url75 && 'thumbnail_75', p.url170 && 'thumbnail_170', p.url570 && 'medium_570', p.urlFull && 'full'].filter(Boolean),
        alt_text: neutralText(p.altText),
        average_color_hex: p.hexCode,
        black_and_white: p.isBlackAndWhite
      })) ?? null,
    max_photos: MAX_IMAGES,
    video: video && { id: video.id, state: video.state, width: video.width, height: video.height },
    files:
      m.files?.map((f) => ({
        id: f.id,
        position: f.rank,
        name: neutralText(f.name),
        size_bytes: f.sizeBytes,
        size: f.sizeLabel,
        type: f.type
      })) ?? null,
    max_files: MAX_DIGITAL_FILES,
    notes: m.notes.map((n) => neutralText(n))
  }
}

const fresh = (deps: FeatureMcpDeps, shopId: number, productId: number): Promise<ListingMedia> =>
  loadMedia(deps.client!, shopId, productId, (part, e) => `The ${PART_EN[part]} could not be read: ${neutralError(e)}`)

function fail(e: unknown): McpToolResult {
  if (e instanceof MediaError) return errorResult(neutralText(e.cause ? `${e.en}: ${neutralError(e.cause)}` : e.en))
  return mcpFail(e)
}

const PRODUCT_ID: JsonSchema = { type: 'integer', minimum: 1, description: 'The product id (from list_my_products).' }
const WATERMARKED: JsonSchema = {
  type: 'boolean',
  description: 'Mark the photo as watermarked (default false). The store does not report this mark, so it is always set anew.'
}
const watermarked = (a: Record<string, unknown>): boolean => a.watermarked === true

/** A write tool: own store + changes allowed; answers the product's media afterwards. */
function writeTool(
  deps: FeatureMcpDeps,
  t: Omit<McpTool, 'run' | 'readOnly'> & { change: (shopId: number, productId: number, a: Record<string, unknown>) => Promise<string> }
): McpTool {
  const { change, ...tool } = t
  return {
    ...tool,
    readOnly: false,
    run: async (a) => {
      try {
        const shopId = mcpWritable(deps, WRITE_SCOPES)
        const productId = Number(a.product_id)
        const done = await change(shopId, productId, a)
        return textResult({ done, ...mediaOut(await fresh(deps, shopId, productId)) })
      } catch (e) {
        return fail(e)
      }
    }
  }
}

export function mediaTools(deps: FeatureMcpDeps): McpTool[] {
  const client = () => deps.client!
  return [
    {
      name: 'list_my_product_media',
      title: 'Photos, video and files of my product',
      description: `The photos (id, position — 1 is the main photo, full width/height, available sizes, alt text, average colour), the video (id, state: active/inactive/deleted/flagged, width/height) and the buyer files of digital products (id, position, name, size, type) of a product in the user's own store. At most ${MAX_IMAGES} photos, 1 video and ${MAX_DIGITAL_FILES} files. A part that could not be read is null with a note.`,
      inputSchema: { type: 'object', properties: { product_id: PRODUCT_ID }, required: ['product_id'], additionalProperties: false },
      run: async (a) => {
        try {
          const shopId = mcpOwnShop(deps, READ_SCOPES)
          return textResult(mediaOut(await fresh(deps, shopId, Number(a.product_id))))
        } catch (e) {
          return fail(e)
        }
      }
    },
    writeTool(deps, {
      name: 'delete_my_product_photo',
      title: 'Delete a photo of my product',
      destructive: true,
      description: `${WRITE_NOTE} Removes one photo (photo_id from list_my_product_media) from a product of the user's own store; the photos after it move up. Returns the product's media afterwards.`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, photo_id: { type: 'integer', minimum: 1 } },
        required: ['product_id', 'photo_id'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        await deletePhoto(client(), shop, id, Number(a.photo_id))
        return `photo ${a.photo_id} deleted`
      }
    }),
    writeTool(deps, {
      name: 'replace_my_product_photo',
      title: 'Replace a photo of my product',
      destructive: true,
      description: `${WRITE_NOTE} Uploads a new photo (JPG/PNG/GIF, up to 20 MB) in place of the photo at \`position\` (1 = the main photo) of a product in the user's own store; the old photo is taken off. alt_text = the new photo's description for screen readers (empty when omitted — the old photo's text is not carried over); watermarked = whether it carries a watermark (default false). Returns the product's media afterwards.`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: PRODUCT_ID,
          position: { type: 'integer', minimum: 1, maximum: MAX_IMAGES },
          photo: MEDIA_ITEM,
          alt_text: { type: 'string', maxLength: MAX_ALT_TEXT },
          watermarked: WATERMARKED
        },
        required: ['product_id', 'position', 'photo'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        const image = await oneUpload(deps, a.photo, 'photo')
        await replacePhoto(client(), shop, id, Number(a.position), image, {
          altText: typeof a.alt_text === 'string' ? a.alt_text : '',
          watermarked: watermarked(a)
        })
        return `photo at position ${a.position} replaced`
      }
    }),
    writeTool(deps, {
      name: 'set_my_photo_alt_text',
      title: 'Set the alt text of a photo',
      description: `${WRITE_NOTE} Sets the alt text (the description screen readers read, up to ${MAX_ALT_TEXT} characters; empty clears it) of one photo of a product in the user's own store. The photo keeps its position. The photo is saved anew, so its "watermarked" mark is set to \`watermarked\` (default false — pass true for a watermarked photo). Returns the product's media afterwards.`,
      inputSchema: {
        type: 'object',
        properties: {
          product_id: PRODUCT_ID,
          photo_id: { type: 'integer', minimum: 1 },
          alt_text: { type: 'string', maxLength: MAX_ALT_TEXT },
          watermarked: WATERMARKED
        },
        required: ['product_id', 'photo_id', 'alt_text'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        await setAltText(client(), shop, id, Number(a.photo_id), String(a.alt_text), { watermarked: watermarked(a) })
        return `alt text of photo ${a.photo_id} set`
      }
    }),
    writeTool(deps, {
      name: 'upload_my_product_video',
      title: 'Upload the video of my product',
      destructive: true,
      description: `${WRITE_NOTE} Uploads the product video (MP4/MOV/M4V/WEBM/AVI/MKV, up to 100 MB; 5–15 seconds recommended) of a product in the user's own store. A product has one video: the new one is uploaded first and the current one is removed only after that succeeded, so a failed upload (the limit of 10 video uploads per product per day included) keeps the current video. Only if the store refuses a second video is the current one removed first and put back when the upload fails (should that put-back fail too, the product is left without a video and the error says so). The new video may show state "inactive" while it is processed. Returns the product's media afterwards.`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, video: MEDIA_ITEM },
        required: ['product_id', 'video'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        const video = await oneUpload(deps, a.video, 'video')
        await replaceVideo(client(), shop, id, video)
        return `video "${neutralText(video.name)}" uploaded`
      }
    }),
    writeTool(deps, {
      name: 'delete_my_product_video',
      title: 'Delete the video of my product',
      destructive: true,
      description: `${WRITE_NOTE} Removes the video (video_id from list_my_product_media) from a product of the user's own store. Returns the product's media afterwards.`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, video_id: { type: 'integer', minimum: 1 } },
        required: ['product_id', 'video_id'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        await deleteVideo(client(), shop, id, Number(a.video_id))
        return `video ${a.video_id} deleted`
      }
    }),
    writeTool(deps, {
      name: 'delete_my_product_file',
      title: 'Delete a buyer file of my product',
      destructive: true,
      description: `${WRITE_NOTE} Removes one buyer file (file_id from list_my_product_media) from a digital product of the user's own store. Deleting the LAST file turns the product into a physical product — ask the user first. Returns the product's media afterwards.`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, file_id: { type: 'integer', minimum: 1 } },
        required: ['product_id', 'file_id'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        await deleteFile(client(), shop, id, Number(a.file_id))
        return `file ${a.file_id} deleted`
      }
    }),
    writeTool(deps, {
      name: 'replace_my_product_file',
      title: 'Replace a buyer file of my product',
      destructive: true,
      description: `${WRITE_NOTE} Uploads a new buyer file (up to 20 MB) in place of the file file_id (from list_my_product_media) of a digital product in the user's own store, at the same position; buyers get the new file from then on. Returns the product's media afterwards.`,
      inputSchema: {
        type: 'object',
        properties: { product_id: PRODUCT_ID, file_id: { type: 'integer', minimum: 1 }, file: MEDIA_ITEM },
        required: ['product_id', 'file_id', 'file'],
        additionalProperties: false
      },
      change: async (shop, id, a) => {
        const file = await oneUpload(deps, a.file, 'file')
        await replaceFile(client(), shop, id, Number(a.file_id), file)
        return `file ${a.file_id} replaced with "${neutralText(file.name)}"`
      }
    })
  ]
}
