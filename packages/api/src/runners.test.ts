import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const R = '/repos/dana/gitfs'

describe('runners', () => {
  test('start a workflow, claim its job, report every step', async () => {
    const h = harness()
    const run = await h.call('POST', `${R}/pipelines`, {
      body: { workflow: 'build' },
    })
    expect(run.status).toBe(201)
    expect(run.json.status).toBe('queued')
    // Older queued runs may exist: claim until we get this one's job.
    let job
    for (let i = 0; i < 20; i++) {
      const c = await h.call('POST', `${R}/pipelines/claim`, {
        body: { runner: 'test-runner' },
      })
      expect(c.status).toBe(200)
      if (c.json.run === run.json.number) {
        job = c.json
        break
      }
    }
    expect(job).toBeDefined()
    expect(job.object).toBe('pipeline_job')
    let last
    for (const s of job.steps)
      last = await h.call(
        'POST',
        `${R}/pipelines/${job.run}/jobs/${job.job}/steps/${s.number}`,
        {
          body: {
            status: 'success',
            lines: [{ text: `ran ${s.name}`, level: 'ok' }],
            duration_ms: 100,
          },
        },
      )
    const after = (await h.call('GET', `${R}/pipelines/${job.run}`)).json
    expect(after.jobs[job.job - 1].status).toBe('success')
    expect(after.jobs[job.job - 1].runner).toBe('test-runner')
    expect(last?.status).toBe(200)
    const log = (
      await h.call(
        'GET',
        `${R}/pipelines/${job.run}/jobs/${job.job}/steps/1/log`,
      )
    ).json
    expect(JSON.stringify(log)).toContain(`ran ${job.steps[0].name}`)
  })

  test('a failed step skips the rest and fails the job', async () => {
    const h = harness()
    const run = (
      await h.call('POST', `${R}/pipelines`, { body: { workflow: 'build' } })
    ).json
    let job
    for (let i = 0; i < 20 && !job; i++) {
      const c = (
        await h.call('POST', `${R}/pipelines/claim`, { body: { runner: 'r' } })
      ).json
      if (c.run === run.number) job = c
    }
    const out = await h.call(
      'POST',
      `${R}/pipelines/${job.run}/jobs/${job.job}/steps/1`,
      {
        body: {
          status: 'failure',
          lines: [{ text: 'error: it broke', level: 'error' }],
        },
      },
    )
    const j = out.json.jobs[job.job - 1]
    expect(j.status).toBe('failure')
    if (j.steps.length > 1) expect(j.steps[1].status).toBe('skipped')
    expect(out.json.annotations.at(-1).text).toBe('error: it broke')
  })

  test('nothing to do answers 204; a reader cannot claim', async () => {
    const h = harness()
    for (let i = 0; i < 50; i++) {
      const c = await h.call('POST', `${R}/pipelines/claim`, {
        body: { runner: 'r' },
      })
      if (c.status === 204) break
    }
    expect(
      (await h.call('POST', `${R}/pipelines/claim`, { body: { runner: 'r' } }))
        .status,
    ).toBe(204)
    expect(
      (
        await h.call('POST', `${R}/pipelines/claim`, {
          token: sampleTokens.stranger,
          body: { runner: 'r' },
        })
      ).status,
    ).toBe(403)
  })
})
