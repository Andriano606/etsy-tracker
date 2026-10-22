import { vi } from 'vitest'
import type { SafeStorageLike } from '../../src/main/settings'

/**
 * A stand-in for Electron's safeStorage. "Encryption" is a reversible marker so
 * tests can assert the file never holds the plain key.
 */
export function fakeSafeStorage(available = true, backend = 'gnome_libsecret'): SafeStorageLike {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((s: string) => Buffer.from(`ENC(${[...s].reverse().join('')})`, 'utf8')),
    decryptString: vi.fn((b: Buffer) => {
      const t = b.toString('utf8')
      if (!t.startsWith('ENC(')) throw new Error('bad ciphertext')
      return [...t.slice(4, -1)].reverse().join('')
    }),
    getSelectedStorageBackend: vi.fn(() => backend)
  }
}
