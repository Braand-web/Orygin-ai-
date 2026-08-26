// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllEnvs()
})

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    vi.stubEnv('ORYGIN_CLIENT_TITLE', 'Orygin')
    document.title = 'stale title'
    const mounted = render(<DocumentTitle />)
    expect(document.title).toBe('Orygin')
    mounted.rerender(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — Orygin')
    mounted.rerender(<DocumentTitle title="Revised title" />)
    expect(document.title).toBe('Revised title — Orygin')
    mounted.rerender(<DocumentTitle />)
    expect(document.title).toBe('Orygin')
    mounted.unmount()
    expect(document.title).toBe('Orygin')
  })

  it('uses the generic title when the build provides no title', () => {
    vi.stubEnv('ORYGIN_CLIENT_TITLE', '')
    delete process.env.ORYGIN_CLIENT_TITLE
    const mounted = render(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — ORYGIN Local Build')
    mounted.unmount()
    expect(document.title).toBe('ORYGIN Local Build')
  })
})
