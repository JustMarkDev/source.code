import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const REPO = '/repos/dana/gitfs'
const CHANGE = `${REPO}/changes/216`

/** A run with the scopes it needs to push and review. */
async function startRun(h: ReturnType<typeof harness>) {
  const run = await h.call('POST', `${REPO}/runs`, {
    body: {
      task: 'Tidy the refs code',
      change: 216,
      scopes: ['repo:read', 'pulls:read', 'pulls:comment', 'pulls:write'],
    },
  })
  expect(run.status).toBe(201)
  return run.json as { id: string; token: string }
}

describe('which run made each part', () => {
  test('parts written with a run token name the run', async () => {
    const h = harness()
    const run = await startRun(h)
    const ps = await h.call('POST', `${CHANGE}/patch-sets`, {
      token: run.token,
      body: { sha: 'a'.repeat(40), kind: 'update', note: 'From the run' },
    })
    expect(ps.status).toBe(201)
    expect(ps.json.run).toBe(run.id)
    const comment = await h.call('POST', `${CHANGE}/comments`, {
      token: run.token,
      body: { body: 'Moved this out.', file: 'src/refs.rs', line: 3 },
    })
    expect(comment.json.run).toBe(run.id)
    const finding = await h.call('POST', `${CHANGE}/findings`, {
      token: run.token,
      body: { severity: 'low', file: 'src/refs.rs', line: 3, title: 'Nit' },
    })
    expect(finding.json.run).toBe(run.id)
    const review = await h.call('POST', `${CHANGE}/reviews`, {
      token: run.token,
      body: { state: 'commented', body: 'Looked it over.' },
    })
    expect(review.json.run).toBe(run.id)
    // Read back, the patch set still names it.
    const list = await h.call('GET', `${CHANGE}/patch-sets`)
    expect(list.json.data.at(-1).run).toBe(run.id)
  })

  test('parts written with a personal token, and older parts, have none', async () => {
    const h = harness()
    const ps = await h.call('POST', `${CHANGE}/patch-sets`, {
      body: { sha: 'b'.repeat(40), kind: 'update' },
    })
    expect(ps.json.run).toBeNull()
    const list = await h.call('GET', `${CHANGE}/patch-sets`)
    for (const p of list.json.data) expect(p.run).toBeNull()
  })
})

/** Uploads text and answers the upload's id. */
async function uploadText(
  h: ReturnType<typeof harness>,
  text: string,
  token?: string,
) {
  const bytes = new TextEncoder().encode(text)
  const up = await h.call('POST', '/uploads', {
    ...(token ? { token } : {}),
    body: {
      filename: 'transcript.txt',
      content_type: 'text/plain',
      size: bytes.length,
      purpose: 'transcript',
    },
  })
  expect(up.status).toBe(201)
  const put = await h.api.fetch(
    new Request(
      up.json.upload_url.replace(
        'https://api.source.code/v1',
        'https://api.test/v1',
      ),
      {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: bytes as unknown as BodyInit,
      },
    ),
  )
  expect(put.status).toBeLessThan(300)
  return up.json.id as string
}

const FAKE_TOKEN = `sxp_${'Ab3dEf7hIj9kLm1nOp5qRs'}`
const TRANSCRIPT = [
  'user: deploy it',
  `assistant: running with SOURCE_TOKEN=${FAKE_TOKEN}`,
  'assistant: export STRIPE_SECRET=Zq8vN2mK5pL9xR4tW7yB1cD6',
  'assistant: commit 0123456789abcdef0123456789abcdef01234567 is fine',
].join('\n')

describe('transcripts', () => {
  test('are off unless the repository turns them on', async () => {
    const h = harness()
    const run = await startRun(h)
    const upload = await uploadText(h, 'hello')
    const put = await h.call('PUT', `${REPO}/runs/${run.id}/transcript`, {
      token: run.token,
      body: { upload },
    })
    expect(put.status).toBe(409)
    expect(put.json.code).toBe('transcripts_disabled')
  })

  test('a fake token is stored masked, and the upload as sent is gone', async () => {
    const h = harness()
    const on = await h.call('PATCH', REPO, { body: { transcripts: 'on' } })
    expect(on.json.transcripts).toBe('on')
    expect(on.json.run_trailer).toBe('auto')
    const run = await startRun(h)
    const upload = await uploadText(h, TRANSCRIPT)
    const put = await h.call('PUT', `${REPO}/runs/${run.id}/transcript`, {
      token: run.token,
      body: { upload },
    })
    expect(put.status).toBe(200)
    expect(put.json.transcript.redactions).toBe(2)
    expect((await h.call('GET', `/uploads/${upload}`)).status).toBe(404)
    const read = await h.call('GET', `${REPO}/runs/${run.id}/transcript`)
    expect(read.status).toBe(200)
    expect(read.json.content).not.toContain(FAKE_TOKEN)
    expect(read.json.content).toContain('[redacted:source_code_token]')
    expect(read.json.content).toContain(
      'STRIPE_SECRET=[redacted:assigned_secret]',
    )
    // A commit id is not a secret.
    expect(read.json.content).toContain(
      '0123456789abcdef0123456789abcdef01234567',
    )
  })

  test('block mode refuses a transcript with secrets and names them', async () => {
    const h = harness()
    await h.call('PATCH', REPO, { body: { transcripts: 'on' } })
    const run = await startRun(h)
    const upload = await uploadText(h, TRANSCRIPT)
    const put = await h.call('PUT', `${REPO}/runs/${run.id}/transcript`, {
      token: run.token,
      body: { upload, mode: 'block' },
    })
    expect(put.status).toBe(422)
    expect(put.json.code).toBe('transcript_has_secrets')
    expect(put.json.kinds.map((k: { kind: string }) => k.kind).sort()).toEqual([
      'assigned_secret',
      'source_code_token',
    ])
    expect((await h.call('GET', `/uploads/${upload}`)).status).toBe(404)
    expect(
      (await h.call('GET', `${REPO}/runs/${run.id}`)).json.transcript,
    ).toBeNull()
  })

  test('reading one needs the runs:transcripts scope', async () => {
    const h = harness()
    await h.call('PATCH', REPO, { body: { transcripts: 'on' } })
    const run = await startRun(h)
    const upload = await uploadText(h, 'nothing secret')
    await h.call('PUT', `${REPO}/runs/${run.id}/transcript`, {
      token: run.token,
      body: { upload },
    })
    const read = await h.call('GET', `${REPO}/runs/${run.id}/transcript`, {
      token: run.token,
    })
    expect(read.status).toBe(403)
    expect(read.json.code).toBe('insufficient_scope')
  })
})

describe('what a run belongs to', () => {
  test('a run names its issue, harness and outside threads', async () => {
    const h = harness()
    const run = await startRun(h)
    const issue = (await h.call('GET', `${REPO}/issues?state=all`)).json.data[0]
      .number
    const up = await h.call('PATCH', `${REPO}/runs/${run.id}`, {
      token: run.token,
      body: {
        issue,
        harness: 'claude-code',
        links: ['https://delta.example/threads/1'],
      },
    })
    expect(up.status).toBe(200)
    expect(up.json).toMatchObject({
      issue,
      harness: 'claude-code',
      links: ['https://delta.example/threads/1'],
    })
    const bad = await h.call('PATCH', `${REPO}/runs/${run.id}`, {
      token: run.token,
      body: { issue: 99999 },
    })
    expect(bad.status).toBe(400)
  })

  test('a run lists the patch sets it pushed', async () => {
    const h = harness()
    const run = await startRun(h)
    await h.call('POST', `${CHANGE}/patch-sets`, {
      token: run.token,
      body: { sha: 'c'.repeat(40), kind: 'update' },
    })
    const got = await h.call('GET', `${REPO}/runs/${run.id}`)
    expect(got.json.patch_sets).toEqual([{ change: 216, patch_set: 4 }])
  })
})

describe('from a line of code to its conversation', () => {
  const REFS =
    'pub struct Refs {\n    disk: Disk,\n    neg: NegCache,\n}\n\nimpl Refs {\n    pub fn lookup(&self, name: &str) -> Option<Oid> {\n        if self.neg.contains(name) {\n            return None;\n        }\n        // Misses are cached, so a missing ref costs one read.\n        self.disk\n            .read_ref(name)\n            .or_else(|| self.neg.put(name))\n    }\n}\n'

  test('a run pushes a patch set, and a line it wrote leads back to the run', async () => {
    const h = harness()
    const run = await startRun(h)
    const ps = await h.call('POST', `${CHANGE}/patch-sets`, {
      token: run.token,
      body: { kind: 'update', files: { 'src/refs.rs': REFS } },
    })
    expect(ps.status).toBe(201)
    const at = (line: number) =>
      h.call(
        'GET',
        `${REPO}/provenance?path=src/refs.rs&line=${line}&change=216`,
      )
    // Line 11 is the comment the run added.
    const mine = await at(11)
    expect(mine.status).toBe(200)
    expect(mine.json).toMatchObject({
      object: 'provenance',
      ref: 'change 216',
      commit: null,
      change: { number: 216 },
      patch_set: ps.json.number,
    })
    expect(mine.json.run).toMatchObject({
      id: run.id,
      task: 'Tidy the refs code',
    })
    // Line 3 came in an earlier patch set, from no run.
    const earlier = await at(3)
    expect(earlier.json.patch_set).toBeLessThan(ps.json.number)
    expect(earlier.json.run).toBeNull()
    // Line 1 was on the base already, so git blame answers.
    const base = await at(1)
    expect(base.json.commit.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test('on a branch, blame names the commit that wrote the line', async () => {
    const h = harness()
    const r = await h.call('GET', `${REPO}/provenance?path=src/refs.rs&line=1`)
    expect(r.status).toBe(200)
    expect(r.json.commit.sha).toMatch(/^[0-9a-f]{40}$/)
    const past = await h.call(
      'GET',
      `${REPO}/provenance?path=src/refs.rs&line=9999`,
    )
    expect(past.status).toBe(400)
    const none = await h.call(
      'GET',
      `${REPO}/provenance?path=no/such.rs&line=1`,
    )
    expect(none.status).toBe(404)
  })

  test("a Run-Id trailer names the caller's own run", async () => {
    const h = harness()
    const run = await startRun(h)
    const made = await h.call('POST', `${REPO}/changes`, {
      body: {
        branch: 'trailer-test',
        title: 'From a run',
        sha: 'd'.repeat(40),
        message: `From a run\n\nRun-Id: ${run.id}\n`,
      },
    })
    expect(made.status).toBe(201)
    const sets = await h.call(
      'GET',
      `${REPO}/changes/${made.json.number}/patch-sets`,
    )
    expect(sets.json.data[0].run).toBe(run.id)
    // Someone else's trailer counts for nothing.
    const other = await h.call('POST', `${REPO}/changes`, {
      token: sampleTokens.hollis,
      body: {
        branch: 'trailer-test-2',
        sha: 'e'.repeat(40),
        message: `Not mine\n\nRun-Id: ${run.id}\n`,
      },
    })
    const theirs = await h.call(
      'GET',
      `${REPO}/changes/${other.json.number}/patch-sets`,
    )
    expect(theirs.json.data[0].run).toBeNull()
  })
})
