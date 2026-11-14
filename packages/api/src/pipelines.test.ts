import { describe, expect, test } from 'bun:test'
import { sampleTokens } from './sample'
import { harness } from './testing'

const R = '/repos/dana/gitfs'

describe('pipeline runs', () => {
  test('newest first, filtered by status', async () => {
    const h = harness()
    const list = (await h.call('GET', `${R}/pipelines`)).json.data
    expect(list[0]).toMatchObject({ object: 'pipeline_run', status: 'running' })
    expect(list[0].jobs).toBe(null)
    const failed = (await h.call('GET', `${R}/pipelines?status=failure`)).json
      .data
    expect(failed.length).toBeGreaterThan(0)
    expect(
      failed.every((r: { status: string }) => r.status === 'failure'),
    ).toBe(true)
  })

  test('one run has its jobs and steps; each step its log', async () => {
    const h = harness()
    const run = (await h.call('GET', `${R}/pipelines/1839`)).json
    expect(run.status).toBe('failure')
    expect(
      run.annotations.some((a: { level: string }) => a.level === 'error'),
    ).toBe(true)
    const step = run.jobs[0].steps[1]
    expect(step.log_url).toContain('/pipelines/1839/jobs/1/steps/2/log')
    const log = (await h.call('GET', `${R}/pipelines/1839/jobs/1/steps/2/log`))
      .json
    expect(log).toMatchObject({ object: 'pipeline_log', run: 1839 })
    expect(log.lines.length).toBe(step.lines)
    expect(
      (await h.call('GET', `${R}/pipelines/1839/jobs/9/steps/1/log`)).status,
    ).toBe(404)
  })

  test('a rerun is queued on the same commit', async () => {
    const h = harness()
    const from = (await h.call('GET', `${R}/pipelines/1839`)).json
    const again = await h.call('POST', `${R}/pipelines/1839/rerun`)
    expect(again.status).toBe(201)
    expect(again.json).toMatchObject({
      status: 'queued',
      trigger: 'manual',
      sha: from.sha,
      actor: 'dana',
    })
    expect(again.json.number).toBeGreaterThan(1842)
    const list = (await h.call('GET', `${R}/pipelines`)).json.data
    expect(list[0].number).toBe(again.json.number)
  })

  test('cancelling a running run; a finished one cannot be', async () => {
    const h = harness()
    const r = await h.call('POST', `${R}/pipelines/1840/cancel`)
    expect(r.status).toBe(200)
    expect(r.json.status).toBe('canceled')
    expect(r.json.finished_at).not.toBe(null)
    const again = await h.call('POST', `${R}/pipelines/1842/cancel`)
    expect(again.status).toBe(409)
  })

  test('reading is public; starting and cancelling need write access', async () => {
    const h = harness()
    const stranger = { token: sampleTokens.stranger }
    expect(
      (await h.call('GET', `${R}/pipelines`, { token: null })).status,
    ).toBe(200)
    expect(
      (await h.call('POST', `${R}/pipelines/1839/rerun`, stranger)).status,
    ).toBe(403)
  })
})
