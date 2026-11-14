/**
 * The services an account can connect. What each one is, in words and logos,
 * is the web app's to say; the API only needs to know which exist, whether
 * they can be connected yet, and which take a key instead of a sign-in.
 */
export const integrations: ReadonlyArray<{
  id: string
  status: 'available' | 'planned'
  credential: boolean
}> = [
  ['greptile', 'planned', false],
  ['macroscope', 'planned', false],
  ['coderabbit', 'available', false],
  ['bugbot', 'planned', false],
  ['claudereview', 'planned', false],
  ['qodo', 'planned', false],
  ['selfhostedreviewer', 'available', false],
  ['blacksmith', 'available', false],
  ['namespace', 'planned', false],
  ['depot', 'planned', false],
  ['warpbuild', 'planned', false],
  ['selfhosted', 'available', false],
  ['t3code', 'available', true],
  ['boat', 'available', true],
  ['e2b', 'planned', true],
  ['daytona', 'planned', true],
  ['vercel', 'planned', true],
  ['cloudflare', 'planned', true],
  ['varlock', 'available', false],
  ['linear', 'planned', false],
  ['sentry', 'planned', false],
].map(([id, status, credential]) => ({
  id: id as string,
  status: status as 'available' | 'planned',
  credential: credential as boolean,
}))
