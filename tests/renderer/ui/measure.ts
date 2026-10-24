import { act } from '@testing-library/react'
import { vi } from 'vitest'

// jsdom has no layout: fake element widths by class and capture ResizeObserver
// callbacks so a test can "resize" a container.

export interface FakeLayout {
  /** Change a width and notify every observer. */
  resize: (cls: string, width: number) => void
  restore: () => void
}

export function fakeLayout(widths: Record<string, number>, byRole: Record<string, number> = {}): FakeLayout {
  const observers: Array<() => void> = []
  const origRO = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    cb: () => void
    constructor(cb: () => void) {
      this.cb = cb
      observers.push(cb)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
      const i = observers.indexOf(this.cb)
      if (i >= 0) observers.splice(i, 1)
    }
  } as unknown as typeof ResizeObserver
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    let w = 0
    for (const [cls, v] of Object.entries(widths)) if (this.classList.contains(cls)) w = v
    const role = this.getAttribute('role')
    if (role && byRole[role] != null && !Object.keys(widths).some((c) => this.classList.contains(c))) w = byRole[role]
    return { width: w, height: 20, top: 0, left: 0, right: w, bottom: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
  return {
    resize(cls, width) {
      widths[cls] = width
      act(() => observers.forEach((cb) => cb()))
    },
    restore() {
      spy.mockRestore()
      globalThis.ResizeObserver = origRO
    }
  }
}
