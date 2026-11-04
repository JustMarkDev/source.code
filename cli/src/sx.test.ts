import { describe, expect, test } from 'bun:test'
import { parse } from './args'
import { run } from './main'

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
    expect(second.patchSets).toBe(2)
  })

  test('landing a blocked change exits 5 and says why', async () => {
    const r = await sx('change', 'land', 'ch_7f3a', '-R', 'dana/gitfs')
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
    expect(JSON.parse(r.out)[0]).toEqual({
      name: 'DATABASE_URL',
      secret: true,
      set: ['development', 'production'],
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
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
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
      arguments: { repo: 'dana/gitfs', id: 'ch_7f3a' },
    })
    expect(JSON.parse(text(r)).blockers.length).toBeGreaterThan(0)
  })

  test('a blocked landing is an error with a hint, not a crash', async () => {
    const c = await client()
    const r = await c.callTool({
      name: 'land_change',
      arguments: { repo: 'dana/gitfs', id: 'ch_7f3a' },
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
    expect(JSON.parse(r.err).error.code).toBe('production_needs_human')
  })

  test('request, approve by a person, run: values are injected and scrubbed from output', async () => {
    const req = await asAgent(() =>
      sx('env', 'grant', 'request', '-R', 'dana/gitfs', '--reason', 'tests'),
    )
    expect(req.code).toBe(6)
    const id = /gr_[0-9a-f]+/.exec(JSON.parse(req.err).error.message)?.[0] ?? ''
    // An agent cannot approve its own request.
    const self = await asAgent(() =>
      sx('env', 'grant', 'approve', id, '-R', 'dana/gitfs'),
    )
    expect(JSON.parse(self.err).error.code).toBe('human_only')
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
