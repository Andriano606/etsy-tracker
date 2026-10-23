// Secrets storage (settings.json): the Etsy API key and the MinIO settings.
// Secrets live only in main: encrypted with Electron safeStorage when an OS
// keyring backend is available, plaintext otherwise (the UI warns). The
// renderer only ever sees `KeyStatus` (a masked keystring) and `MinioStatus`
// (no secret at all). safeStorage is injected so tests run without Electron.

import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { KeyStatus, McpSettingsInput, MinioSettingsInput, MinioStatus } from '../shared/types'
import { DEFAULT_BUYER_COUNTRY, normalizeCountry } from '../shared/countries'
import { MCP_DEFAULT_PORT, validateMcpPort } from '../shared/mcpConfig'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
  /** Linux only: 'basic_text' means a hardcoded password, i.e. not really protected. */
  getSelectedStorageBackend?(): string
}

interface StoredKey {
  /** base64 ciphertext (encrypted) or the plain `keystring:secret`. */
  data: string
  encrypted: boolean
}

interface StoredMinio {
  enabled?: boolean
  endpoint?: string
  accessKey?: string
  bucket?: string
  /** Same shape as the API key: encrypted with safeStorage when possible. */
  secretKey?: StoredKey
}

interface SettingsFile {
  apiKey?: StoredKey
  minio?: StoredMinio
  /** ISO 3166-1 alpha-2 buyer country for Etsy's buyer-facing prices (not a secret). */
  buyerCountry?: string
  mcp?: StoredMcp
}

interface StoredMcp {
  enabled?: boolean
  port?: number
  /** The bearer token MCP clients send, sealed like the API key. */
  token?: StoredKey
}

/** Read settings.json; a missing or corrupt file reads as empty. */
function readSettings(filePath: string): SettingsFile {
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as SettingsFile
  } catch {
    return {}
  }
}

/** Atomic write (tmp + rename), mode 0600. Other sections of the file are kept by callers. */
function writeSettings(filePath: string, data: SettingsFile): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, filePath)
}

function seal(safe: SafeStorageLike, plain: string): StoredKey {
  return safe.isEncryptionAvailable()
    ? { data: safe.encryptString(plain).toString('base64'), encrypted: true }
    : { data: plain, encrypted: false }
}

/** Decrypt a stored secret; null when it cannot be read. */
function unseal(safe: SafeStorageLike, k: StoredKey | undefined): string | null {
  if (!k?.data) return null
  if (!k.encrypted) return k.data
  try {
    return safe.decryptString(Buffer.from(k.data, 'base64'))
  } catch {
    return null
  }
}

export interface KeyStore {
  status(): KeyStatus
  /** The full `keystring:shared_secret` header value, or null. Main only. */
  getKey(): string | null
  setKey(keystring: string, sharedSecret: string): KeyStatus
  clear(): KeyStatus
}

/** `abcd…wxyz` — enough to recognise a key, useless to anyone reading the screen. */
export function maskKeystring(keystring: string): string {
  const k = keystring.trim()
  if (k.length <= 8) return '••••'
  return `${k.slice(0, 4)}…${k.slice(-4)}`
}

/** Validate and join the two halves into the `x-api-key` value. Throws a Ukrainian message. */
export function composeApiKey(keystring: string, sharedSecret: string): string {
  const k = (keystring ?? '').trim()
  const s = (sharedSecret ?? '').trim()
  if (!k) throw new Error('Вставте Keystring.')
  if (!s) throw new Error('Вставте Shared secret.')
  if (k.includes(':') || /\s/.test(k)) throw new Error('Keystring не може містити пробілів чи двокрапки.')
  if (/\s/.test(s)) throw new Error('Shared secret не може містити пробілів.')
  return `${k}:${s}`
}

function realEncryption(safe: SafeStorageLike): boolean {
  if (!safe.isEncryptionAvailable()) return false
  const backend = safe.getSelectedStorageBackend?.()
  return backend !== 'basic_text' && backend !== 'unknown'
}

export function createKeyStore(filePath: string, safe: SafeStorageLike): KeyStore {
  const read = (): SettingsFile => readSettings(filePath)
  const write = (data: SettingsFile): void => writeSettings(filePath, data)

  function getKey(): string | null {
    return unseal(safe, read().apiKey)
  }

  function status(): KeyStatus {
    const stored = read().apiKey
    const key = getKey()
    if (stored?.data && stored.encrypted && !key) {
      // Not "no key": tell the user the stored one exists but can't be read.
      return { hasKey: false, masked: null, encrypted: false, unreadable: true }
    }
    if (!stored || !key) return { hasKey: false, masked: null, encrypted: false }
    return {
      hasKey: true,
      masked: maskKeystring(key.split(':')[0]),
      encrypted: stored.encrypted && realEncryption(safe)
    }
  }

  return {
    status,
    getKey,
    setKey(keystring, sharedSecret) {
      const key = composeApiKey(keystring, sharedSecret)
      const data = read()
      data.apiKey = seal(safe, key)
      write(data)
      return status()
    },
    clear() {
      const data = read()
      delete data.apiKey
      write(data)
      return status()
    }
  }
}

// ---------------------------------------------------------------------- MinIO

/**
 * Defaults = the docker-compose.yml defaults (MINIO_ROOT_USER /
 * MINIO_ROOT_PASSWORD, S3 API on 127.0.0.1:9100), so a fresh install works
 * against `docker compose up -d` without touching Settings.
 */
export const MINIO_DEFAULTS = {
  enabled: true,
  endpoint: 'http://127.0.0.1:9100',
  accessKey: 'etsytracker',
  secretKey: 'etsytracker-minio-secret',
  bucket: 'etsy-tracker'
} as const

/** Everything main needs to talk to MinIO. Never sent to the renderer. */
export interface MinioConfig {
  enabled: boolean
  endpoint: string
  accessKey: string
  secretKey: string
  bucket: string
}

export interface MinioSettingsStore {
  /** Renderer-safe view: no secret, only where it comes from. */
  status(): MinioStatus
  /** Full config incl. the secret, or null when a stored secret can't be decrypted. Main only. */
  getConfig(): MinioConfig | null
  /** Validate + save; an empty `secretKey` keeps the stored one. Throws a Ukrainian message. */
  set(input: MinioSettingsInput): MinioStatus
  /** Forget the stored secret (back to the docker-compose default). */
  resetSecret(): MinioStatus
}

/** Normalise and validate the S3 endpoint: http(s)://host[:port], no path. */
export function normalizeMinioEndpoint(raw: string): string {
  const v = (raw ?? '').trim()
  if (!v) throw new Error('Вкажіть адресу MinIO, напр. http://127.0.0.1:9100.')
  let u: URL
  try {
    u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `http://${v}`)
  } catch {
    throw new Error('Некоректна адреса MinIO.')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Адреса MinIO має починатися з http:// або https://.')
  }
  if (u.pathname !== '/' && u.pathname !== '') throw new Error('Адреса MinIO — без шляху, лише хост і порт.')
  return `${u.protocol}//${u.host}`
}

/** S3 bucket naming rules (3–63 chars, lowercase letters, digits, dots, hyphens). */
export function validateBucketName(raw: string): string {
  const b = (raw ?? '').trim()
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(b) || b.includes('..')) {
    throw new Error('Назва бакета: 3–63 символи, малі латинські літери, цифри, крапки та дефіси.')
  }
  return b
}

export function createMinioSettingsStore(filePath: string, safe: SafeStorageLike): MinioSettingsStore {
  const read = (): SettingsFile => readSettings(filePath)

  function status(): MinioStatus {
    const m = read().minio ?? {}
    const stored = m.secretKey
    const secret = unseal(safe, stored)
    const unreadable = !!stored?.data && secret == null
    return {
      enabled: m.enabled ?? MINIO_DEFAULTS.enabled,
      endpoint: m.endpoint ?? MINIO_DEFAULTS.endpoint,
      accessKey: m.accessKey ?? MINIO_DEFAULTS.accessKey,
      bucket: m.bucket ?? MINIO_DEFAULTS.bucket,
      secretSource: stored?.data ? 'stored' : 'default',
      encrypted: !!stored?.data && stored.encrypted && !unreadable && realEncryption(safe),
      ...(unreadable ? { unreadable: true } : {})
    }
  }

  function getConfig(): MinioConfig | null {
    const m = read().minio ?? {}
    const secret = m.secretKey?.data ? unseal(safe, m.secretKey) : MINIO_DEFAULTS.secretKey
    if (secret == null) return null
    return {
      enabled: m.enabled ?? MINIO_DEFAULTS.enabled,
      endpoint: m.endpoint ?? MINIO_DEFAULTS.endpoint,
      accessKey: m.accessKey ?? MINIO_DEFAULTS.accessKey,
      secretKey: secret,
      bucket: m.bucket ?? MINIO_DEFAULTS.bucket
    }
  }

  return {
    status,
    getConfig,
    set(input) {
      const data = read()
      const m: StoredMinio = { ...(data.minio ?? {}) }
      if (input.enabled !== undefined) m.enabled = !!input.enabled
      if (input.endpoint !== undefined) m.endpoint = normalizeMinioEndpoint(input.endpoint)
      if (input.accessKey !== undefined) {
        const k = input.accessKey.trim()
        if (k.length < 3 || /\s/.test(k)) throw new Error('Access key: щонайменше 3 символи, без пробілів.')
        m.accessKey = k
      }
      if (input.bucket !== undefined) m.bucket = validateBucketName(input.bucket)
      const secret = (input.secretKey ?? '').trim()
      if (secret) {
        if (secret.length < 8 || /\s/.test(secret)) {
          throw new Error('Secret key: щонайменше 8 символів, без пробілів.')
        }
        m.secretKey = seal(safe, secret)
      }
      data.minio = m
      writeSettings(filePath, data)
      return status()
    },
    resetSecret() {
      const data = read()
      if (data.minio) delete data.minio.secretKey
      writeSettings(filePath, data)
      return status()
    }
  }
}

// ------------------------------------------------------------- buyer country

export interface BuyerCountryStore {
  /** The saved country, else `DEFAULT_BUYER_COUNTRY` (also for a corrupt saved value). */
  get(): string
  /** Validate (ISO 3166-1 alpha-2, uppercased; "UK" = GB) and save. Throws a Ukrainian message. */
  set(raw: unknown): string
}

export const BUYER_COUNTRY_ERROR =
  'Вкажіть двобуквений код країни за ISO 3166-1 (напр. UA, US, DE, GB).'

/**
 * Settings → "Країна покупця", in settings.json next to the secrets (it isn't
 * one, so plain). Read by the scanner at the start of every scan.
 */
export function createBuyerCountryStore(filePath: string): BuyerCountryStore {
  return {
    get() {
      return normalizeCountry(readSettings(filePath).buyerCountry) ?? DEFAULT_BUYER_COUNTRY
    },
    set(raw) {
      const c = normalizeCountry(raw)
      if (!c) throw new Error(BUYER_COUNTRY_ERROR)
      const data = readSettings(filePath)
      data.buyerCountry = c
      writeSettings(filePath, data)
      return c
    }
  }
}

// ------------------------------------------------------------------- MCP server

/** What main needs to run the MCP server. The token is shown in the MCP modal (clients need it). */
export interface McpConfig {
  enabled: boolean
  port: number
  /** null = never generated, or the stored one can't be decrypted. */
  token: string | null
  /** The stored token is protected by a real OS keyring. */
  tokenEncrypted: boolean
}

export interface McpSettingsStore {
  get(): McpConfig
  /** Validate + save; throws a Ukrainian message. */
  set(input: McpSettingsInput): McpConfig
  /** The token, generating (and saving) one when there is none or it can't be read. */
  ensureToken(): string
  /** A new token: every connected client has to be configured again. */
  regenerateToken(): string
}

/** 32 random bytes, base64url: safe inside a shell's double quotes and an HTTP header. */
export function newMcpToken(): string {
  return randomBytes(32).toString('base64url')
}

export function createMcpSettingsStore(filePath: string, safe: SafeStorageLike): McpSettingsStore {
  function get(): McpConfig {
    const m = readSettings(filePath).mcp ?? {}
    let port = MCP_DEFAULT_PORT
    try {
      port = validateMcpPort(m.port ?? MCP_DEFAULT_PORT)
    } catch {
      // A corrupt saved port reads as the default.
    }
    const token = unseal(safe, m.token)
    return {
      enabled: m.enabled ?? false,
      port,
      token,
      tokenEncrypted: !!token && !!m.token?.encrypted && realEncryption(safe)
    }
  }

  function saveToken(token: string): string {
    const data = readSettings(filePath)
    data.mcp = { ...(data.mcp ?? {}), token: seal(safe, token) }
    writeSettings(filePath, data)
    return token
  }

  return {
    get,
    set(input) {
      const data = readSettings(filePath)
      const m: StoredMcp = { ...(data.mcp ?? {}) }
      if (input.port !== undefined) m.port = validateMcpPort(input.port)
      if (input.enabled !== undefined) m.enabled = !!input.enabled
      data.mcp = m
      writeSettings(filePath, data)
      return get()
    },
    ensureToken() {
      return get().token ?? saveToken(newMcpToken())
    },
    regenerateToken() {
      return saveToken(newMcpToken())
    }
  }
}
