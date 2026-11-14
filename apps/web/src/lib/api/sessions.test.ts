import { describe, expect, test } from 'bun:test'
import { AppSessions } from './sessions'

const request = (cookie?: string) =>
  new Request('http://localhost:3000/api/v1/oauth/device', {
    headers: cookie ? { cookie } : {},
  })

describe('the OAuth pages use the app session', () => {
  const sessions = new AppSessions()

  test('no session cookie is nobody, without asking sign-in', async () => {
    expect(await sessions.current(request())).toBeNull()
    expect(await sessions.current(request('theme=dark'))).toBeNull()
    expect(sessions.csrf(request('theme=dark'))).toBeNull()
  })

  test('the form token follows the session cookie and nothing else', () => {
    const a = sessions.csrf(request('better-auth.session_token=aaa.sig'))
    const again = sessions.csrf(
      request('theme=dark; better-auth.session_token=aaa.sig'),
    )
    const b = sessions.csrf(request('better-auth.session_token=bbb.sig'))
    const secure = sessions.csrf(
      request('__Secure-better-auth.session_token=aaa.sig'),
    )
    expect(a).toBe(again)
    expect(a).toBe(secure)
    expect(a).not.toBe(b)
    // Never the cookie itself: the token is printed into a page.
    expect(a).not.toContain('aaa')
  })

  test('a signed-out visitor goes to the app sign-in and comes back', () => {
    expect(sessions.logins()).toEqual([])
    expect(sessions.start()).toBeNull()
    expect(
      sessions.signInUrl('/api/v1/oauth/authorize?client_id=cl_1&state=a b'),
    ).toBe(
      '/sign-in?redirect=%2Fapi%2Fv1%2Foauth%2Fauthorize%3Fclient_id%3Dcl_1%26state%3Da%20b',
    )
  })
})
