import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { allScopes } from './auth'
import { captureExamples, exampleless, generateReference } from './docs'
import { errorCatalog } from './problem'
import { pools } from './limiter'
import { sampleTokens } from './sample'
import { harness } from './testing'
import { allOperations } from './index'

const root = new URL('../../../apps/web/content/docs/', import.meta.url)
  .pathname
const read = (p: string) => readFileSync(join(root, p), 'utf8')

function mdxFiles(dir: string): Array<string> {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory()
      ? mdxFiles(p)
      : p.endsWith('.mdx')
        ? [p]
        : []
  })
}

/** Every event type the code can write, found in its source. */
function allEventTypes(): Array<string> {
  const dir = new URL('.', import.meta.url).pathname
  const sources = [
    ...readdirSync(dir + 'domain').map((f) => `domain/${f}`),
    'webhooks.ts',
  ]
  const types = new Set<string>()
  for (const f of sources) {
    const text = readFileSync(dir + f, 'utf8')
    for (const m of text.matchAll(
      /(?:emit|changeEvent)\([^)]*?'((?:issue|change|finding|check|ci|operation|webhook|repo|run|release)\.[a-z_]+)'/gs,
    ))
      types.add(m[1])
    if (f.startsWith('domain/'))
      for (const m of text.matchAll(
        /'(change\.[a-z_]+|issue\.[a-z_]+|finding\.resolved|check\.reported|ci\.failed|operation\.finished|repo\.[a-z_]+|run\.[a-z_]+|release\.[a-z_]+)'/g,
      ))
        types.add(m[1])
  }
  types.add('webhook.disabled')
  return [...types]
}

describe('the API documentation', () => {
  test('the generated reference matches the code (run: bun scripts/api-docs.ts)', async () => {
    const files = await generateReference()
    expect(files.size).toBe(15)
    for (const [file, text] of files)
      expect(read(`api/${file}`), file).toBe(text)
    // The sidebar lists every reference page, and only those.
    const nav = (
      JSON.parse(read('api/reference/meta.json')) as { pages: Array<string> }
    ).pages
    const pages = [...files.keys()]
      .filter((f) => f.startsWith('reference/'))
      .map((f) => f.slice('reference/'.length).replace(/\.mdx$/, ''))
    expect([...nav].sort()).toEqual(pages.sort())
  })

  test('examples never publish a token, webhook secret or signed URL', async () => {
    const files = await generateReference()
    for (const [file, text] of files) {
      expect(text, file).not.toMatch(
        /(?:sxp|sxb|sxr|sxo|sxf)_[A-Za-z0-9_+/=-]{8,}|whsec_[A-Za-z0-9_+/=-]{8,}|[?&]sig=[A-Za-z0-9_+/=-]{8,}/,
      )
      expect(text, file).not.toMatch(/whsec_…[A-Za-z0-9_+/=]/)
    }
  })

  test('every operation has a real example in the reference', async () => {
    // The event stream is a live connection, documented in prose.
    expect(await exampleless()).toEqual(['events.stream'])
  })

  test('every recorded example is a successful response', async () => {
    const examples = await captureExamples()
    for (const [id, rec] of examples) {
      expect(rec.status, id).toBeGreaterThanOrEqual(200)
      expect(rec.status, id).toBeLessThan(300)
    }
  })

  test('every error code has a section on the errors page, and nothing else does', () => {
    const page = read('api/errors.mdx')
    const documented = [...page.matchAll(/^### `([a-z_]+)`$/gm)].map(
      (m) => m[1],
    )
    expect(documented.sort()).toEqual(Object.keys(errorCatalog).sort())
    for (const [code, e] of Object.entries(errorCatalog)) {
      const section = page.split(`### \`${code}\``)[1].split('\n###')[0]
      expect(section, code).toContain(`**${e.status}.**`)
      expect(section, code).toContain(`CLI exit code ${e.exit}`)
    }
  })

  test('every scope and every rate-limit pool is explained', () => {
    const auth = read('api/authentication.mdx')
    for (const scope of allScopes) expect(auth, scope).toContain(`\`${scope}\``)
    const limits = read('api/rate-limits.mdx')
    for (const [name, p] of Object.entries(pools)) {
      expect(limits, name).toContain(`\`${name}\``)
      if (name !== 'anonymous')
        expect(limits, name).toContain(
          `${p.limit.toLocaleString('en-US')} per minute`,
        )
    }
  })

  test('every sample token in the docs is the real one, and none is missing', () => {
    const auth = read('api/authentication.mdx')
    for (const token of Object.values(sampleTokens))
      expect(auth, token).toContain(token)
  })

  test('the pages link only to pages and error codes that exist', () => {
    const exists = (url: string) => {
      const [path] = url.split('#')
      const rel = path.replace(/^\/docs\/?/, '')
      return (
        rel === '' ||
        existsSync(join(root, `${rel}.mdx`)) ||
        existsSync(join(root, rel, 'index.mdx'))
      )
    }
    const broken: Array<string> = []
    for (const file of mdxFiles(join(root, 'api'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(
        /\]\((\/docs[^)\s]*)\)/g,
      )) {
        if (!exists(m[1])) broken.push(`${file.replace(root, '')} -> ${m[1]}`)
        const anchor = m[1].split('#')[1]
        if (m[1].startsWith('/docs/api/errors#') && !(anchor in errorCatalog))
          broken.push(`${file.replace(root, '')} -> ${m[1]}`)
      }
    }
    expect(broken).toEqual([])
  })

  test('the section is registered, and every page in it is listed', () => {
    const top = JSON.parse(read('meta.json')) as { pages: Array<string> }
    expect(top.pages).toContain('api')
    const meta = JSON.parse(read('api/meta.json')) as { pages: Array<string> }
    const onDisk = readdirSync(join(root, 'api'))
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => f.replace('.mdx', ''))
    expect(meta.pages.filter((p) => p !== 'reference').sort()).toEqual(
      onDisk.sort(),
    )
    const ref = JSON.parse(read('api/reference/meta.json')) as {
      pages: Array<string>
    }
    const refOnDisk = readdirSync(join(root, 'api/reference'))
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => f.replace('.mdx', ''))
    expect(ref.pages.sort()).toEqual(refOnDisk.sort())
  })

  test('the numbers quoted in prose are the real ones', () => {
    const h = harness()
    const ops = allOperations()
    expect(read('api/compared.mdx')).toContain(
      `We have ${ops.length} operations`,
    )
    expect(read('api/compared.mdx')).toContain(
      `${new Set(allEventTypes()).size} event types`,
    )
    expect(h.api.ops.length).toBe(ops.length)
  })

  test('the quickstart tells the truth about identity and the refusal', async () => {
    const h = harness()
    const page = read('api/quickstart.mdx')
    const principal = (await h.call('GET', '/auth/principal')).json
    const shown = /"scopes": (\[[^\]]*\])/.exec(page)?.[1]
    expect(JSON.parse(shown ?? 'null')).toEqual(principal.scopes)
    const blocked = (
      await h.call('POST', '/repos/dana/gitfs/changes/216/land', {
        body: { expected_tree: '9c4d7e1' },
      })
    ).json
    expect(page).toContain(blocked.detail)
    expect(page).toContain(blocked.hint)
    expect(blocked.retryable).toBe(false)
    expect(blocked.exit_code).toBe(5)
  })

  test('HEAD answers like GET without a body', async () => {
    const h = harness()
    const res = await h.api.fetch(
      new Request('https://api.test/v1/limits', { method: 'HEAD' }),
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(res.headers.get('etag')).toBeTruthy()
  })
})
