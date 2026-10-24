// The local MCP server (main/mcpServer.ts) as other apps connect to it: its
// neutral name, address and the ready-to-paste client configs the MCP modal
// shows. The name and everything a client sees say "store/product", never the
// marketplace the data comes from.

import { FEATURE_TOOL_SUMMARY } from './features'

/** The server's name in a client's config and in `serverInfo`. */
export const MCP_SERVER_NAME = 'shop-catalog'

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

/** The same after a new token / port: `add` refuses a name that exists, so remove it first. */
export function claudeCodeReplaceCommand(port: number, token: string): string {
  return `claude mcp remove --scope user ${MCP_SERVER_NAME} 2>/dev/null; ${claudeCodeCommand(port, token)}`
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
  { name: 'list_stores', text: 'список магазинів з головними цифрами й останнім скануванням' },
  { name: 'get_store', text: 'профіль магазину: оголошення, політики, відпустка, цифри та їх зміна' },
  { name: 'search_products', text: 'пошук товарів (назва, теги, опис), сортування, фільтри «нові», «зі знижкою», «зниклі»' },
  { name: 'get_product', text: 'усе про товар: опис, ціни, знижка, теги, матеріали, атрибути, фото, відгуки' },
  { name: 'get_product_history', text: 'історія товару: популярність і ціни по скануваннях, акції, усі зміни' },
  { name: 'list_snapshots', text: 'історія сканувань магазину' },
  { name: 'get_snapshot_changes', text: 'що нового: додані, зниклі, змінені товари, нові відгуки, акції' },
  { name: 'list_reviews', text: 'відгуки покупців з фільтрами за оцінкою, датою, текстом' },
  { name: 'get_store_stats', text: 'статистика магазину за період (те саме, що «📊 Статистика»)' },
  { name: 'get_product_image', text: 'фото товару як картинка' },
  { name: 'get_store_logo', text: 'логотип або банер магазину як картинка' },
  { name: 'get_product_video_preview', text: 'кадр-прев’ю відео товару як картинка' },
  { name: 'get_review_photo', text: 'фото з відгуку як картинка' },
  { name: 'list_my_products', text: 'мій магазин: товари в будь-якому стані (чернетки, неактивні…)' },
  { name: 'find_categories', text: 'пошук категорії для нового товару' },
  { name: 'get_product_options', text: 'допустимі значення, ліміти, профілі доставки й обробки' },
  { name: 'create_product', text: 'створити товар з фото й файлами (чернетка або публікація)', write: true },
  { name: 'update_my_product', text: 'змінити назву, опис, теги, матеріали; увімкнути / вимкнути', write: true },
  { name: 'add_product_media', text: 'додати фото чи файли до товару', write: true },
  { name: 'update_my_store', text: 'змінити тексти магазину', write: true },
  { name: 'prepare_product', text: 'підготувати чернетку в програмі — ви переглядаєте й надсилаєте самі (працює без дозволу на зміни)' },
  { name: 'list_prepared_products', text: 'чернетки в програмі, що чекають перевірки' },
  { name: 'delete_prepared_product', text: 'видалити чернетку в програмі' },
  { name: 'send_prepared_product', text: 'надіслати чернетку з програми в магазин', write: true },
  ...FEATURE_TOOL_SUMMARY
]
