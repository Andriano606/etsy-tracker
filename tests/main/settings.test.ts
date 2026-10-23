import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BUYER_COUNTRY_ERROR,
  MINIO_DEFAULTS,
  composeApiKey,
  createBuyerCountryStore,
  createKeyStore,
  createMinioSettingsStore,
  maskKeystring,
  normalizeMinioEndpoint,
  validateBucketName
} from '../../src/main/settings'
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

describe('MinIO settings', () => {
  const MSECRET = 'minio-super-secret-42'

  it('defaults match docker-compose.yml, with the default secret, before anything is saved', () => {
    const m = createMinioSettingsStore(file, fakeSafeStorage(true))
    expect(m.status()).toEqual({
      enabled: true,
      endpoint: 'http://127.0.0.1:9100',
      accessKey: 'etsytracker',
      bucket: 'etsy-tracker',
      secretSource: 'default',
      encrypted: false
    })
    expect(m.getConfig()).toEqual({ ...MINIO_DEFAULTS })
  })

  it('MINIO_DEFAULTS agree with docker-compose.yml and .env.example (port, credentials)', () => {
    const root = join(__dirname, '..', '..')
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
    const env = Object.fromEntries(
      readFileSync(join(root, '.env.example'), 'utf8')
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
    )
    const composeDefault = (name: string): string | undefined =>
      compose.match(new RegExp(`\\$\\{${name}:-([^}]+)\\}`))?.[1]
    const url = new URL(MINIO_DEFAULTS.endpoint)
    expect(url.hostname).toBe('127.0.0.1')
    expect(compose).toContain(`"127.0.0.1:\${MINIO_API_PORT:-${url.port}}:9000"`)
    expect(composeDefault('MINIO_ROOT_USER')).toBe(MINIO_DEFAULTS.accessKey)
    expect(composeDefault('MINIO_ROOT_PASSWORD')).toBe(MINIO_DEFAULTS.secretKey)
    expect(env).toMatchObject({
      MINIO_ROOT_USER: MINIO_DEFAULTS.accessKey,
      MINIO_ROOT_PASSWORD: MINIO_DEFAULTS.secretKey,
      MINIO_API_PORT: url.port
    })
    // Browsers may only call the S3 API from the console's origin.
    expect(composeDefault('MINIO_CORS_ALLOW_ORIGIN')).toBe(`http://127.0.0.1:${composeDefault('MINIO_CONSOLE_PORT')}`)
    expect(env.MINIO_CORS_ALLOW_ORIGIN).toBe(composeDefault('MINIO_CORS_ALLOW_ORIGIN'))
  })

  it('stores the secret encrypted; status never contains it; main can read it back', () => {
    const safe = fakeSafeStorage(true)
    const m = createMinioSettingsStore(file, safe)
    const st = m.set({ secretKey: ` ${MSECRET} `, accessKey: 'admin', endpoint: 'localhost:9100/', bucket: 'photos', enabled: false })
    expect(st).toEqual({
      enabled: false,
      endpoint: 'http://localhost:9100',
      accessKey: 'admin',
      bucket: 'photos',
      secretSource: 'stored',
      encrypted: true
    })
    expect(JSON.stringify(st)).not.toContain(MSECRET)
    expect(readFileSync(file, 'utf8')).not.toContain(MSECRET)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(m.getConfig()).toMatchObject({ secretKey: MSECRET, enabled: false })
    // An empty secret on the next save keeps the stored one.
    m.set({ bucket: 'photos2', secretKey: '' })
    expect(m.getConfig()).toMatchObject({ secretKey: MSECRET, bucket: 'photos2' })
    expect(m.resetSecret().secretSource).toBe('default')
    expect(m.getConfig()!.secretKey).toBe(MINIO_DEFAULTS.secretKey)
  })

  it('shares settings.json with the API key without clobbering it', () => {
    const keys = createKeyStore(file, fakeSafeStorage(true))
    const m = createMinioSettingsStore(file, fakeSafeStorage(true))
    keys.setKey(KEY, SECRET)
    m.set({ secretKey: MSECRET })
    expect(keys.getKey()).toBe(`${KEY}:${SECRET}`)
    keys.clear()
    expect(m.getConfig()!.secretKey).toBe(MSECRET)
  })

  it('a secret that cannot be decrypted is reported unreadable and getConfig is null', () => {
    const safe = fakeSafeStorage(true)
    const m = createMinioSettingsStore(file, safe)
    m.set({ secretKey: MSECRET })
    safe.decryptString = () => {
      throw new Error('locked')
    }
    expect(m.status()).toMatchObject({ unreadable: true, secretSource: 'stored', encrypted: false })
    expect(m.getConfig()).toBeNull()
  })

  it('without a keyring the secret is stored in plain text and says so; basic_text is not "encrypted"', () => {
    const plain = createMinioSettingsStore(file, fakeSafeStorage(false))
    expect(plain.set({ secretKey: MSECRET }).encrypted).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8')).minio.secretKey).toEqual({ data: MSECRET, encrypted: false })
    const basic = createMinioSettingsStore(file, fakeSafeStorage(true, 'basic_text'))
    expect(basic.set({ secretKey: MSECRET }).encrypted).toBe(false)
  })

  it('validates input with Ukrainian messages', () => {
    const m = createMinioSettingsStore(file, fakeSafeStorage(true))
    expect(() => m.set({ secretKey: 'short' })).toThrow(/8 символів/)
    expect(() => m.set({ accessKey: 'a b' })).toThrow(/Access key/)
    expect(() => m.set({ bucket: 'Upper' })).toThrow(/бакета/)
    expect(() => m.set({ endpoint: 'ftp://x' })).toThrow(/http/)
    expect(() => m.set({ endpoint: 'http://x:9100/path' })).toThrow(/без шляху/)
    expect(m.status().secretSource).toBe('default') // nothing half-saved
  })

  it('normalizeMinioEndpoint / validateBucketName', () => {
    expect(normalizeMinioEndpoint('127.0.0.1:9100')).toBe('http://127.0.0.1:9100')
    expect(normalizeMinioEndpoint('https://s3.example.com/')).toBe('https://s3.example.com')
    expect(() => normalizeMinioEndpoint('')).toThrow(/адресу/)
    expect(validateBucketName(' etsy-tracker ')).toBe('etsy-tracker')
    expect(() => validateBucketName('ab')).toThrow()
    expect(() => validateBucketName('a..b')).toThrow()
  })
})

describe('buyer country store (settings.json, not a secret)', () => {
  it('defaults to UA while nothing (or something corrupt) is saved', () => {
    expect(createBuyerCountryStore(file).get()).toBe('UA')
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ buyerCountry: 'zz' }))
    expect(createBuyerCountryStore(join(dir, 'x.json')).get()).toBe('UA')
    writeFileSync(join(dir, 'y.json'), '{not json')
    expect(createBuyerCountryStore(join(dir, 'y.json')).get()).toBe('UA')
  })

  it('validates ISO 3166-1 alpha-2, uppercases, maps UK to GB, and saves in plain text', () => {
    const s = createBuyerCountryStore(file)
    expect(s.set(' us ')).toBe('US')
    expect(s.get()).toBe('US')
    expect(s.set('uk')).toBe('GB')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ buyerCountry: 'GB' })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    for (const bad of ['', 'U', 'USA', 'XX', 'U1', 42, null, undefined]) {
      expect(() => s.set(bad)).toThrow(BUYER_COUNTRY_ERROR)
    }
    expect(s.get()).toBe('GB')
  })

  it('keeps the API key and MinIO sections of the same file', () => {
    const keys = createKeyStore(file, fakeSafeStorage())
    keys.setKey(KEY, SECRET)
    createMinioSettingsStore(file, fakeSafeStorage()).set({ bucket: 'my-bucket' })
    createBuyerCountryStore(file).set('DE')
    expect(keys.getKey()).toBe(`${KEY}:${SECRET}`)
    expect(createMinioSettingsStore(file, fakeSafeStorage()).status().bucket).toBe('my-bucket')
    // …and saving a secret keeps the country.
    keys.setKey(KEY, 'anothersecret')
    expect(createBuyerCountryStore(file).get()).toBe('DE')
  })
})
