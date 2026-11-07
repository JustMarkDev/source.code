import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { configPath } from './config'

/**
 * What `sx auth login` leaves behind: an OAuth client, an access token and a
 * refresh token for one API. Kept beside the settings, readable only by you.
 * `SX_TOKEN` in the environment always wins over this file.
 */
export type Credentials = {
  api: string
  client_id: string
  access_token: string
  refresh_token: string
  /** Milliseconds since the epoch. */
  expires_at: number
  scope: string
}

const file = () => join(dirname(configPath()), 'credentials.json')

export function readCredentials(api: string): Credentials | null {
  const p = file()
  if (!existsSync(p)) return null
  try {
    const c = JSON.parse(readFileSync(p, 'utf8')) as Credentials
    return c.api === api ? c : null
  } catch {
    return null
  }
}

export function writeCredentials(c: Credentials) {
  const p = file()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 })
  chmodSync(p, 0o600)
}

export function clearCredentials() {
  rmSync(file(), { force: true })
}
