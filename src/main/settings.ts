// Etsy API key storage. The key lives only in main: encrypted with Electron
// safeStorage when an OS keyring backend is available, plaintext otherwise (the
// UI warns). The renderer only ever sees `KeyStatus` — a masked keystring.
// safeStorage is injected so tests run without Electron.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { KeyStatus } from '../shared/types'

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

interface SettingsFile {
  apiKey?: StoredKey
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
  function read(): SettingsFile {
    if (!existsSync(filePath)) return {}
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as SettingsFile
    } catch {
      return {}
    }
  }

  function write(data: SettingsFile): void {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, filePath)
  }

  function getKey(): string | null {
    const k = read().apiKey
    if (!k?.data) return null
    if (!k.encrypted) return k.data
    try {
      return safe.decryptString(Buffer.from(k.data, 'base64'))
    } catch {
      return null
    }
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
      if (safe.isEncryptionAvailable()) {
        data.apiKey = { data: safe.encryptString(key).toString('base64'), encrypted: true }
      } else {
        data.apiKey = { data: key, encrypted: false }
      }
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
