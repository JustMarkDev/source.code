import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { parse } from './args'
import { run } from './main'
import { scrub } from './secrets'

async function sx(...argv: Array<string>) {
  let out = ''
  let err = ''
  const code = await run([...argv, '--json'], {
    out: (s) => (out += s),
    err: (s) => (err += s),
  })
  return { code, out, err }
}

describe('parse', () => {
  test('flags, shorts and positionals', () => {
    const p = parse(['change', 'view', '-R', 'dana/gitfs', '--json', 'ch_1'])
    expect(p.positionals).toEqual(['change', 'view', 'ch_1'])
    expect(p.flags).toEqual({ repo: 'dana/gitfs', json: true })
  })
})

describe('scrub', () => {
  test('replaces long values and their encodings everywhere', () => {
    expect(scrub('token=hunter2 again hunter2', { TOKEN: 'hunter2' })).toBe(
      'token=«TOKEN» again «TOKEN»',
    )
    expect(
      scrub(Buffer.from('hunter2').toString('base64'), { TOKEN: 'hunter2' }),
    ).toBe('«TOKEN»')
  })

  test('redacts short values only where they stand alone', () => {
    expect(scrub('pin 42 port 421 42x', { PIN: '42' })).toBe(
      'pin «PIN» port 421 42x',
    )
    expect(scrub('a cat', { A: 'a' })).toBe('«A» cat')
    expect(scrub('path/to', { SLASH: '/' })).toBe('path/to')
    expect(scrub('at https://example.com/a', { SLASH: '/' })).toBe('at https://example.com/a')
    expect(scrub('a / b', { SLASH: '/' })).toBe('a «SLASH» b')
    expect(
      scrub('run --flag and -- again', { DASHES: '--' }),
    ).toBe('run --flag and «DASHES» again')
    expect(scrub('a.b and a.c', { DOT: 'a.' })).toBe('a.b and a.c')
    expect(scrub('see a. now', { DOT: 'a.' })).toBe('see «DOT» now')
    expect(scrub('{"pin":42}', { PIN: '42' })).toBe('{"pin":«PIN»}')
    expect(scrub(':42', { PIN: '42' })).toBe(':«PIN»')
    expect(scrub('42=', { PIN: '42' })).toBe('«PIN»=')
  })

  test('leaves empty values alone', () => {
    expect(scrub('text', { EMPTY: '' })).toBe('text')
  })
})

describe('sx', () => {
  test('never prompts: a missing repo is an error with a hint', async () => {
    const r = await sx('change', 'list')
    // Outside a clone with no -R the repo cannot be known.
    if (r.code !== 0) {
      expect(r.code).toBe(2)
      expect(JSON.parse(r.err).error.code).toBe('repo_unknown')
      expect(JSON.parse(r.err).error.hint).toContain('-R')
    }
  })

  test('creating a change twice adds a patch set, not a duplicate', async () => {
    const args = [
      'change',
      'create',
      '-R',
      'dana/gitfs',
      '--branch',
      'x',
      '--title',
      'T',
    ]
    const first = JSON.parse((await sx(...args)).out)
    const second = JSON.parse((await sx(...args)).out)
    expect(first.action).toBe('created')
    expect(second.action).toBe('patch_set_added')
    expect(second.id).toBe(first.id)
    expect(second.patch_set_count).toBe(2)
  })

  test('landing a blocked change exits 5 and says why', async () => {
    const r = await sx('change', 'land', '216', '-R', 'dana/gitfs')
    expect(r.code).toBe(5)
    expect(JSON.parse(r.err).error.code).toBe('policy_blocked')
  })

  test('--dry-run changes nothing', async () => {
    const r = await sx(
      'issue',
      'create',
      'Brand new',
      '-R',
      'dana/gitfs',
      '--dry-run',
    )
    expect(JSON.parse(r.out).created).toBe(true)
    const list = JSON.parse(
      (await sx('issue', 'list', '--state', 'all', '-R', 'dana/gitfs')).out,
    )
    expect(list.some((i: { title: string }) => i.title === 'Brand new')).toBe(
      false,
    )
  })

  test('env list never contains values', async () => {
    const r = await sx('env', 'list', '-R', 'dana/gitfs')
    expect(r.out).not.toContain('value')
    expect(JSON.parse(r.out)[0]).toMatchObject({
      name: 'DATABASE_URL',
      secret: true,
      environments: ['development', 'production'],
    })
  })
})

describe('agent support', () => {
  test('every documented command has a handler', async () => {
    const { schema } = await import('./schema')
    for (const c of schema) {
      const r = await sx(...c.command.split(' '), '--help')
      expect(r.code).toBe(0)
    }
    const top = JSON.parse((await sx('commands')).out) as {
      commands: Array<{ command: string }>
    }
    expect(top.commands.length).toBe(schema.length)
  })

  test('a mistyped command suggests the right one', async () => {
    const r = await sx('chnge', 'list')
    expect(r.code).toBe(2)
    expect(JSON.parse(r.err).error.hint).toContain('sx change')
  })

  test('the skill installs once and is then unchanged', async () => {
    const { installSkill } = await import('./skill')
    const dir = mkdtempSync(join(tmpdir(), 'sx-'))
    expect(installSkill(dir, 'claude').action).toBe('created')
    expect(installSkill(dir, 'claude').action).toBe('unchanged')
    expect(installSkill(dir, 'agents').action).toBe('created')
    expect(installSkill(dir, 'agents').action).toBe('unchanged')
  })
})

describe('mcp', () => {
  async function client() {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } =
      await import('@modelcontextprotocol/sdk/inMemory.js')
    const { createSxMcpServer } = await import('./mcp')
    const [a, b] = InMemoryTransport.createLinkedPair()
    await createSxMcpServer().connect(b)
    const c = new Client({ name: 'test', version: '0' })
    await c.connect(a)
    return c
  }
  const text = (r: unknown) =>
    (r as { content: Array<{ text: string }> }).content[0].text

  test('lists tools with read-only hints and reads a change', async () => {
    const c = await client()
    const { tools } = await c.listTools()
    expect(tools.map((t) => t.name)).toContain('get_change')
    expect(
      tools.find((t) => t.name === 'get_change')?.annotations?.readOnlyHint,
    ).toBe(true)
    expect(
      tools.find((t) => t.name === 'land_change')?.annotations?.destructiveHint,
    ).toBe(true)
    const r = await c.callTool({
      name: 'get_change',
      arguments: { repo: 'dana/gitfs', id: '216' },
    })
    expect(JSON.parse(text(r)).blockers.length).toBeGreaterThan(0)
  })

  test('a blocked landing is an error with a hint, not a crash', async () => {
    const c = await client()
    const r = await c.callTool({
      name: 'land_change',
      arguments: { repo: 'dana/gitfs', id: '216' },
    })
    expect((r as { isError?: boolean }).isError).toBe(true)
    expect(JSON.parse(text(r)).error.code).toBe('policy_blocked')
  })

  test('serves the skill as a resource', async () => {
    const c = await client()
    const r = await c.readResource({ uri: 'sx://skill' })
    expect((r.contents[0] as { text: string }).text).toContain('sx context')
  })
})

describe('agent access to secrets', () => {
  const asAgent = async <T>(fn: () => Promise<T>) => {
    process.env.SX_ACTOR = 'agent'
    try {
      return await fn()
    } finally {
      delete process.env.SX_ACTOR
    }
  }

  test('an agent with no grant is stopped with exit 6 and told what to run', async () => {
    const r = await asAgent(() =>
      sx('env', 'run', '-R', 'dana/gitfs', '--', 'echo', 'hi'),
    )
    expect(r.code).toBe(6)
    const e = JSON.parse(r.err).error
    expect(e.code).toBe('grant_required')
    expect(e.hint).toContain('sx env grant request')
  })

  test('production is never available to an agent, even with a grant', async () => {
    const r = await asAgent(() =>
      sx(
        'env',
        'run',
        '--env',
        'production',
        '-R',
        'dana/gitfs',
        '--',
        'echo',
        'hi',
      ),
    )
    expect(r.code).toBe(6)
    expect(JSON.parse(r.err).error.code).toBe('human_required')
  })

  test('request, approve by a person, run: values are injected and scrubbed from output', async () => {
    const req = await asAgent(() =>
      sx('env', 'grant', 'request', '-R', 'dana/gitfs', '--reason', 'tests'),
    )
    expect(req.code).toBe(6)
    const id =
      /grt_[0-9a-z]+/.exec(JSON.parse(req.err).error.message)?.[0] ?? ''
    // An agent cannot approve its own request.
    const self = await asAgent(() =>
      sx('env', 'grant', 'approve', id, '-R', 'dana/gitfs'),
    )
    // The agent's token has no secrets:write, and an agent could not approve anyway.
    expect(JSON.parse(self.err).error.code).toBe('insufficient_scope')
    // A person can.
    expect(
      (
        await sx(
          'env',
          'grant',
          'approve',
          id,
          '-R',
          'dana/gitfs',
          '--ttl',
          '15m',
        )
      ).code,
    ).toBe(0)

    const ran = await asAgent(() =>
      sx(
        'env',
        'run',
        '-R',
        'dana/gitfs',
        '--',
        'sh',
        '-c',
        'echo "db=$DATABASE_URL port=$API_PORT stripe=[$STRIPE_KEY]"; printf %s "$DATABASE_URL" | base64',
      ),
    )
    expect(ran.code).toBe(0)
    const out = JSON.parse(ran.out)
    expect(out.stdout).toContain('db=«DATABASE_URL»')
    // Production-only values are simply not there in development.
    expect(out.stdout).toContain('stripe=[]')
    expect(out.stdout).toContain('port=8080') // public values are not scrubbed
    expect(ran.out).not.toContain('hunter2')
    expect(ran.out).not.toContain(
      Buffer.from(
        'postgres://dev:hunter2-dev-only@localhost:5432/gitfs',
      ).toString('base64'),
    )
    expect(out.redacted).toContain('DATABASE_URL')
  })

  test('revoking ends access immediately', async () => {
    const list = JSON.parse(
      (await sx('env', 'grant', 'list', '-R', 'dana/gitfs')).out,
    ) as Array<{ id: string }>
    await sx('env', 'grant', 'revoke', list[0].id, '-R', 'dana/gitfs')
    const r = await asAgent(() =>
      sx('env', 'run', '-R', 'dana/gitfs', '--', 'echo', 'hi'),
    )
    expect(JSON.parse(r.err).error.code).toBe('grant_required')
  })
})

describe('accounts', () => {
  let dir = ''
  beforeEach(() => {
    // Settings go to a folder of their own, so a test never touches yours.
    dir = mkdtempSync(join(tmpdir(), 'sx-accounts-'))
    process.env.SX_CONFIG_DIR = dir
    delete process.env.SX_ACCOUNT
    delete process.env.SX_REPO
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.SX_CONFIG_DIR
    delete process.env.SX_ACCOUNT
    delete process.env.SX_REPO
  })
  const json = (r: { out: string }) => JSON.parse(r.out)

  test('list shows yourself and your organizations, with your role in each', async () => {
    const rows = json(await sx('account', 'list')) as Array<{
      handle: string
      kind: string
      role: string
      active: boolean
    }>
    expect(rows.map((r) => [r.handle, r.kind, r.role])).toEqual([
      ['dana', 'person', 'owner'],
      ['northwind', 'organization', 'owner'],
      ['lumen-studio', 'organization', 'member'],
    ])
    expect(rows.filter((r) => r.active).map((r) => r.handle)).toEqual(['dana'])
  })

  test('by default you act as yourself, and it says why', async () => {
    const cur = json(await sx('account', 'current'))
    expect(cur).toMatchObject({
      handle: 'dana',
      kind: 'person',
      from: 'default',
      login: 'dana',
    })
  })

  test('-A acts as another account for one command, and saves nothing', async () => {
    const cur = json(await sx('account', 'current', '-A', 'northwind'))
    expect(cur).toMatchObject({ handle: 'northwind', from: 'flag' })
    expect(json(await sx('account', 'current')).handle).toBe('dana')
  })

  test('an account you cannot act as is an error with a hint, exit 3', async () => {
    const r = await sx('account', 'current', '-A', 'someone-else')
    expect(r.code).toBe(3)
    const e = JSON.parse(r.err).error
    expect(e.code).toBe('account_not_found')
    expect(e.hint).toContain('sx account list')
    expect((await sx('account', 'switch', 'someone-else')).code).toBe(3)
  })

  test('switch is saved, and repeating it changes nothing', async () => {
    const first = json(await sx('account', 'switch', 'northwind'))
    expect(first).toMatchObject({
      handle: 'northwind',
      switched: true,
      previous: 'dana',
    })
    expect(json(await sx('account', 'current'))).toMatchObject({
      handle: 'northwind',
      from: 'config',
    })
    const again = json(await sx('account', 'switch', 'northwind'))
    expect(again.switched).toBe(false)
    // Back to yourself is the same kind of switch.
    expect(json(await sx('account', 'switch', 'dana')).switched).toBe(true)
  })

  test('--dry-run switches nothing', async () => {
    const r = json(await sx('account', 'switch', 'northwind', '--dry-run'))
    expect(r.switched).toBe(true)
    expect(json(await sx('account', 'current')).handle).toBe('dana')
  })

  test('in a clone you act as the repository owner, with no switching', async () => {
    const cur = json(await sx('account', 'current', '-R', 'northwind/relay'))
    expect(cur).toMatchObject({ handle: 'northwind', from: 'repo' })
    // A saved switch does not beat the repository you are working in.
    await sx('account', 'switch', 'dana')
    process.env.SX_REPO = 'northwind/relay'
    expect(json(await sx('account', 'current')).from).toBe('repo')
  })

  test('precedence: flag, SX_ACCOUNT, repository, saved, you', async () => {
    await sx('account', 'switch', 'lumen-studio')
    expect(json(await sx('account', 'current')).from).toBe('config')
    process.env.SX_REPO = 'northwind/relay'
    expect(json(await sx('account', 'current')).handle).toBe('northwind')
    process.env.SX_ACCOUNT = 'dana'
    expect(json(await sx('account', 'current'))).toMatchObject({
      handle: 'dana',
      from: 'env',
    })
    expect(
      json(await sx('account', 'current', '-A', 'lumen-studio')),
    ).toMatchObject({ handle: 'lumen-studio', from: 'flag' })
  })

  test('switching says so when SX_ACCOUNT would still win', async () => {
    process.env.SX_ACCOUNT = 'dana'
    const r = json(await sx('account', 'switch', 'northwind'))
    expect(r.overriddenBy).toBe('SX_ACCOUNT')
  })

  test('repo list is the account you act as; --all is every account', async () => {
    const mine = json(await sx('repo', 'list')) as Array<{ slug: string }>
    expect(mine.map((r) => r.slug).sort()).toEqual([
      'dana/gitfs',
      'dana/notes',
      'dana/tinyqueue',
    ])
    const org = json(await sx('repo', 'list', '-A', 'northwind')) as Array<{
      slug: string
    }>
    expect(org.map((r) => r.slug)).toEqual(['northwind/relay'])
    const all = json(await sx('repo', 'list', '--all')) as Array<{
      slug: string
    }>
    expect(all.map((r) => r.slug).sort()).toEqual([
      'dana/gitfs',
      'dana/notes',
      'dana/tinyqueue',
      'northwind/relay',
    ])
  })

  test('a bare repo name is created in the account you act as', async () => {
    const r = json(
      await sx('repo', 'create', 'tools', '-A', 'northwind', '--dry-run'),
    )
    expect(r.slug).toBe('northwind/tools')
    const own = json(await sx('repo', 'create', 'notes', '--dry-run'))
    expect(own.slug).toBe('dana/notes')
  })

  test('members cannot create in an organization; the hint says who can', async () => {
    const r = await sx('repo', 'create', 'lumen-studio/x', '--dry-run')
    expect(r.code).toBe(5)
    const e = JSON.parse(r.err).error
    expect(e.code).toBe('forbidden')
    expect(e.hint).toContain('owner or admin')
  })

  test('creating under an account you cannot act as is not found', async () => {
    const r = await sx('repo', 'create', 'stranger/x', '--dry-run')
    expect(r.code).toBe(3)
    expect(JSON.parse(r.err).error.code).toBe('not_found')
  })

  test('context and auth status name the account', async () => {
    const ctx = json(await sx('context', '-R', 'northwind/relay'))
    expect(ctx.account).toEqual({
      handle: 'northwind',
      kind: 'organization',
      role: 'owner',
    })
    process.env.SX_TOKEN = 'sxt_test'
    try {
      expect(json(await sx('auth', 'status', '-A', 'northwind')).account).toBe(
        'northwind',
      )
    } finally {
      delete process.env.SX_TOKEN
    }
  })

  test('the MCP server can list accounts', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } =
      await import('@modelcontextprotocol/sdk/inMemory.js')
    const { createSxMcpServer } = await import('./mcp')
    const [a, b] = InMemoryTransport.createLinkedPair()
    await createSxMcpServer().connect(b)
    const c = new Client({ name: 'test', version: '0' })
    await c.connect(a)
    const { tools } = await c.listTools()
    expect(
      tools.find((t) => t.name === 'list_accounts')?.annotations?.readOnlyHint,
    ).toBe(true)
    const r = (await c.callTool({ name: 'list_accounts', arguments: {} })) as {
      content: Array<{ text: string }>
    }
    expect(
      (JSON.parse(r.content[0].text) as Array<{ handle: string }>).map(
        (x) => x.handle,
      ),
    ).toContain('northwind')
  })
})
