import { signJwt, verifyJwt, parseCookies } from '../../../src/auth/session'

const SECRET = 'test-secret-that-is-long-enough-for-hs256'

describe('session', () => {
  it('signs and verifies a JWT round-trip', () => {
    const token = signJwt({ userId: 'u1', email: 'a@b.com' }, SECRET)
    const payload = verifyJwt(token, SECRET)
    expect(payload?.userId).toBe('u1')
    expect(payload?.email).toBe('a@b.com')
  })

  it('returns null for a tampered token', () => {
    const token = signJwt({ userId: 'u1' }, SECRET)
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(verifyJwt(tampered, SECRET)).toBeNull()
  })

  it('returns null for an expired token', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, -1) // expired 1 second ago
    expect(verifyJwt(token, SECRET)).toBeNull()
  })

  it('parseCookies extracts named cookie', () => {
    const cookies = parseCookies('session=abc123; other=xyz')
    expect(cookies['session']).toBe('abc123')
    expect(cookies['other']).toBe('xyz')
  })

  it('parseCookies handles values containing = signs', () => {
    const cookies = parseCookies('session=eyJhbGc==; other=xyz')
    expect(cookies['session']).toBe('eyJhbGc==')
    expect(cookies['other']).toBe('xyz')
  })
})
