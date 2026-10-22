import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { composeApiKey, createKeyStore, maskKeystring } from '../../src/main/settings'
import { fakeSafeStorage } from '../helpers/safeStorage'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etsy-settings-'))
  file = join(dir, 'sub', 'settings.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const KEY = 'abcd1234efgh5678wxyz'
const SECRET = 'supersecretvalue'

describe('maskKeystring', () => {
  it('keeps the first and last 4 chars', () => {
    expect(maskKeystring(KEY)).toBe('abcd…wxyz')
  })
  it('hides short keystrings completely', () => {
    expect(maskKeystring('abcdefgh')).toBe('••••')
  })
})

describe('composeApiKey', () => {
  it('joins keystring:shared_secret, trimming', () => {
    expect(composeApiKey(` ${KEY} `, ` ${SECRET}\n`)).toBe(`${KEY}:${SECRET}`)
  })
  it.each([
    ['', SECRET, /Keystring/],
    [KEY, '', /Shared secret/],
    ['ab:cd', SECRET, /двокрапки/],
    ['ab cd', SECRET, /пробілів/],
    [KEY, 'a b', /пробілів/]
  ])('rejects %j / %j', (k, s, err) => {
    expect(() => composeApiKey(k, s)).toThrow(err)
  })
})

describe('key store with safeStorage available', () => {
  it('stores encrypted, returns only a masked status, decrypts for main', () => {
    const store = createKeyStore(file, fakeSafeStorage(true))
    expect(store.status()).toEqual({ hasKey: false, masked: null, encrypted: false })
    const st = store.setKey(KEY, SECRET)
    expect(st).toEqual({ hasKey: true, masked: 'abcd…wxyz', encrypted: true })
    expect(JSON.stringify(st)).not.toContain(SECRET)
    expect(JSON.stringify(st)).not.toContain(KEY)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain(KEY)
    expect(store.getKey()).toBe(`${KEY}:${SECRET}`)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('reports encrypted: false for the basic_text backend (hardcoded password)', () => {
    const store = createKeyStore(file, fakeSafeStorage(true, 'basic_text'))
    expect(store.setKey(KEY, SECRET).encrypted).toBe(false)
  })

  it('clear() removes the key', () => {
    const store = createKeyStore(file, fakeSafeStorage(true))
    store.setKey(KEY, SECRET)
    expect(store.clear()).toEqual({ hasKey: false, masked: null, encrypted: false })
    expect(store.getKey()).toBeNull()
  })

  it('an undecryptable key is reported as unreadable, not as "no key"', () => {
    const store = createKeyStore(file, fakeSafeStorage(true))
    store.setKey(KEY, SECRET)
    writeFileSync(file, JSON.stringify({ apiKey: { data: Buffer.from('garbage').toString('base64'), encrypted: true } }))
    expect(store.getKey()).toBeNull()
    expect(store.status()).toEqual({ hasKey: false, masked: null, encrypted: false, unreadable: true })
    // Re-entering the key fixes it.
    expect(store.setKey(KEY, SECRET)).toEqual({ hasKey: true, masked: 'abcd…wxyz', encrypted: true })
  })

  it('a keyring that refuses to decrypt (e.g. locked) is also unreadable', () => {
    const safe = fakeSafeStorage(true)
    const store = createKeyStore(file, safe)
    store.setKey(KEY, SECRET)
    safe.decryptString = () => {
      throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    }
    expect(store.status().unreadable).toBe(true)
    expect(store.clear()).toEqual({ hasKey: false, masked: null, encrypted: false })
  })
})

describe('key store without safeStorage', () => {
  it('falls back to plaintext and says so', () => {
    const safe = fakeSafeStorage(false)
    const store = createKeyStore(file, safe)
    expect(store.setKey(KEY, SECRET)).toEqual({ hasKey: true, masked: 'abcd…wxyz', encrypted: false })
    expect(safe.encryptString).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(file, 'utf8')).apiKey).toEqual({
      data: `${KEY}:${SECRET}`,
      encrypted: false
    })
    expect(store.getKey()).toBe(`${KEY}:${SECRET}`)
  })

  it('a corrupt settings file reads as empty', () => {
    const store = createKeyStore(file, fakeSafeStorage(false))
    store.setKey(KEY, SECRET)
    writeFileSync(file, '{not json')
    expect(store.status().hasKey).toBe(false)
  })
})
