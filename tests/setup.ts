import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react')
    cleanup()
  }
})
