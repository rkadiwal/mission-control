import { describe, expect, test } from 'claude-code/testing'

import type { View } from '../types'
import { createPoller, type Ports, type Saved } from '../hooks/poller'

type Reply = { exitCode: number; stdout: string }

function fakePorts(answer: (cmd: string) => Reply) {
  const views: View[] = []
  let saved: Saved | undefined
  let clock = 1_000_000
  const calls: string[] = []
  const ports: Ports = {
    run: async argv => {
      const cmd = argv.join(' ')
      calls.push(cmd)
      return answer(cmd)
    },
    now: async () => (clock += 20_000),
    sessionId: async () => 's1',
    cwd: '/r/appointmental_frontend',
    home: '',
    read: async () => '',
    write: async () => undefined,
    list: async () => [],
    listAgents: async () => [],
    usage: async () => ({ rateLimits: [] }),
    load: async () => saved,
    save: async (_id, s) => void (saved = s),
    publish: async v => void views.push(v),
    every: () => undefined,
    after: (_ms, fn) => fn(),
    log: () => undefined,
  }
  return { ports, views, calls, saved: () => saved }
}

const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve()
}
const config = { base: 'development', ciWorkflow: 'CI', pollMs: 60_000, quietMinutes: 8 }
const OPEN = JSON.stringify({ title: 'seed', state: 'OPEN', url: 'https://github.com/o/fe/pull/794', headRefName: 'f', baseRefName: 'development', statusCheckRollup: [] })
const MERGED = OPEN.replace('"OPEN"', '"MERGED"')
const topLevel = (cmd: string): Reply | undefined => (cmd.startsWith('git rev-parse --show-toplevel') ? { exitCode: 0, stdout: '/r/appointmental_frontend\n' } : undefined)

describe('poller', () => {
  test('keeps a tracked PR when GitHub is unreachable, drops it once merged', async () => {
    let pr: Reply = { exitCode: 0, stdout: OPEN }
    const fake = fakePorts(cmd => topLevel(cmd) ?? (cmd.startsWith('gh pr view') ? pr : { exitCode: 1, stdout: '' }))
    const poller = createPoller(fake.ports, config)
    await poller.start()
    await poller.trackPr('/r/appointmental_frontend', 794, 'https://github.com/o/fe/pull/794')
    await settle()
    expect(fake.views.at(-1)?.prs.map(p => p.num)).toEqual([794])
    pr = { exitCode: 1, stdout: '' }
    poller.setBoard(undefined)
    await settle()
    expect(fake.saved()?.tracked.map(t => t.num)).toEqual([794])
    pr = { exitCode: 0, stdout: MERGED }
    poller.setBoard(undefined)
    await settle()
    expect(fake.saved()?.tracked).toEqual([])
    expect(fake.views.at(-1)?.prs).toEqual([])
  })

  test('coalesces overlapping GitHub refreshes', async () => {
    const fake = fakePorts(cmd => topLevel(cmd) ?? { exitCode: 1, stdout: '' })
    const poller = createPoller(fake.ports, config)
    await poller.start()
    await settle()
    const before = fake.calls.filter(c => c.startsWith('gh run list')).length
    poller.setBoard(undefined)
    poller.setBoard(undefined)
    poller.setBoard(undefined)
    await settle()
    expect(fake.calls.filter(c => c.startsWith('gh run list')).length - before).toBeLessThanOrEqual(2)
  })
})
