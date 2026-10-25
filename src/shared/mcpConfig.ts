// The local MCP server (main/mcpServer.ts) as other apps connect to it: its
// name, address and the ready-to-paste client configs the MCP modal shows.

import { FEATURE_TOOL_SUMMARY } from './features'

/** The server's name in a client's config and in `serverInfo`. */
export const MCP_SERVER_NAME = 'etsy-tracker'

/** Names earlier builds used; the replace command removes them too, so nobody keeps both. */
export const MCP_OLD_SERVER_NAMES: readonly string[] = ['shop-catalog']

/** Default port: 9100/9101 are MinIO's (docker-compose.yml). */
export const MCP_DEFAULT_PORT = 9102

/** The only path the server answers on. */
export const MCP_PATH = '/mcp'

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}${MCP_PATH}`
}

/** A port the user may pick (unprivileged, valid). Throws a Ukrainian message. */
export function validateMcpPort(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error('Порт — ціле число від 1024 до 65535.')
  }
  return n
}

const authHeader = (token: string): string => `Authorization: Bearer ${token}`

/**
 * Claude Code, available in every project (`--scope user`). `--header` takes
 * several values, so it goes last — before the name it would swallow it.
 */
export function claudeCodeCommand(port: number, token: string): string {
  return `claude mcp add --transport http --scope user ${MCP_SERVER_NAME} ${mcpUrl(port)} --header "${authHeader(token)}"`
}

/**
 * The same after a new token / port (or the rename): `add` refuses a name that
 * exists, so remove it — and the old name — first.
 */
export function claudeCodeReplaceCommand(port: number, token: string): string {
  const removes = [MCP_SERVER_NAME, ...MCP_OLD_SERVER_NAMES]
    .map((name) => `claude mcp remove --scope user ${name} 2>/dev/null; `)
    .join('')
  return `${removes}${claudeCodeCommand(port, token)}`
}

/** `.mcp.json` in a project (Claude Code) or any client that takes HTTP servers with headers. */
export function mcpJsonConfig(port: number, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: mcpUrl(port),
          headers: { Authorization: `Bearer ${token}` }
        }
      }
    },
    null,
    2
  )
}

/** Claude Desktop (claude_desktop_config.json) runs stdio servers only: bridge with mcp-remote. */
export function claudeDesktopConfig(port: number, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', mcpUrl(port), '--header', authHeader(token)]
        }
      }
    },
    null,
    2
  )
}

/**
 * What each MCP tool gives a client, in Ukrainian for the MCP modal (the tools
 * themselves are documented in English for the client's model, mcpTools.ts).
 * tests/main/mcpTools.test.ts keeps the names in step with the real tools.
 */
export const MCP_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  { name: 'open_link', text: 'відкрити посилання чи адресу з програми: товар, фото, відгук, магазин, чернетку' },
  { name: 'list_stores', text: 'відстежувані магазини Etsy з бази програми: посилання, головні цифри, останнє сканування та його помилка' },
  { name: 'get_store', text: 'профіль магазину з бази: оголошення, політики, відпустка, цифри та їх зміна, кількість і середня оцінка збережених відгуків' },
  { name: 'search_products', text: 'пошук товарів відстежуваних магазинів у базі (назва, теги, опис), сортування, фільтри «нові», «зі знижкою», «зниклі»' },
  { name: 'get_product', text: 'усе про товар з бази: опис, ціни, акція, теги, матеріали, атрибути, фото, відео, кількість і середня оцінка відгуків, посилання на Etsy' },
  { name: 'get_product_history', text: 'історія товару: популярність, залишок, кількість відгуків і ціни по скануваннях, акції, усі зміни' },
  { name: 'list_snapshots', text: 'історія сканувань магазину (успішні, з помилкою, поточне) з підсумками' },
  { name: 'get_snapshot_changes', text: 'що знайшло сканування: нові, зниклі, повернуті й змінені товари, нові відгуки, акції' },
  { name: 'list_reviews', text: 'збережені відгуки покупців з фільтрами за магазином, товаром, оцінкою, датою, текстом' },
  { name: 'get_store_stats', text: 'статистика магазину за період (те саме, що «📊 Статистика»)' },
  { name: 'get_product_image', text: 'фото товару як картинка (локальна копія, інакше з CDN Etsy)' },
  { name: 'get_store_logo', text: 'логотип або банер магазину як картинка (з CDN Etsy)' },
  { name: 'get_product_video_preview', text: 'кадр-прев’ю відео товару як картинка (з CDN Etsy)' },
  { name: 'get_review_photo', text: 'фото з відгуку як картинка (локальна копія, інакше з CDN Etsy)' },
  { name: 'list_my_products', text: 'мій магазин на Etsy наживо: товари в будь-якому стані (активні, чернетки, неактивні…)' },
  { name: 'find_categories', text: 'пошук категорії Etsy для нового товару (дерево категорій продавця)' },
  { name: 'get_product_options', text: 'допустимі значення й ліміти Etsy для нового товару, профілі доставки й обробки (наживо)' },
  { name: 'create_product', text: 'створити товар на Etsy з фото й файлами (чернетка Etsy або публікація)', write: true },
  { name: 'update_my_product', text: 'змінити на Etsy назву, опис, теги, матеріали, автопоновлення; увімкнути / вимкнути', write: true },
  { name: 'add_product_media', text: 'додати фото чи файли в кінець товару на Etsy', write: true },
  { name: 'update_my_store', text: 'змінити тексти магазину на Etsy: заголовок, оголошення, повідомлення покупцям, додаткові правила (лише ЄС)', write: true },
  { name: 'prepare_product', text: 'підготувати або змінити чернетку в програмі (і вже надіслану) — товар на Etsy зміниться лише після надсилання (працює без дозволу на зміни)' },
  { name: 'list_prepared_products', text: 'усі чернетки в програмі: чого бракує, чи надіслано на Etsy, з яким товаром пов’язано, чи є ненадіслані зміни' },
  { name: 'sync_prepared_products', text: 'підтягнути в програму чернетки, створені на сайті Etsy, і оновити пов’язані (на Etsy нічого не змінює; потрібен вхід, дозвіл на зміни — ні)' },
  { name: 'unlink_prepared_product', text: 'від’єднати чернетку від товару на Etsy, щоб надіслати її як новий товар (лише в програмі)' },
  { name: 'delete_prepared_product', text: 'видалити чернетку в програмі; на ваше прохання — і товар на Etsy (лише це потребує дозволу на зміни)' },
  { name: 'send_prepared_product', text: 'надіслати чернетку на Etsy: новий товар (чернетка Etsy або публікація) або оновлення вже надісланого', write: true },
  ...FEATURE_TOOL_SUMMARY
]
