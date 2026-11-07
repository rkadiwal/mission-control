import { describe, expect, test } from 'claude-code/testing'

import type { Board, SessionPr } from '../types'
import { buildAlerts, type AlertInput } from '../hooks/alerts'

const NOW = Date.parse('2026-10-06T05:00:00Z')
const base: AlertInput = { now: NOW, role: 'session', base: 'development', quietMinutes: 8, peers: [], repos: [], prs: [], quietAgents: [], usage: [] }

const board: Board = {
  repo: 'web_backend', num: 1238, url: 'https://github.com/o/be/issues/1238', title: 'Board', columns: ['Worker', 'Module'], fetchedAt: NOW,
  lanes: [
    { worker: 'W1', cells: ['W1', 'platform'], status: 'not-ready', statusText: 'Not gate-ready', lastPostAt: NOW - 41 * 60_000 },
    { worker: 'W3', cells: ['W3', 'billing'], status: 'blocked', statusText: 'Blocked', question: 'Can it go internal?', lastPostAt: NOW - 8 * 60_000 },
    { worker: 'W4', cells: ['W4', 'reports'], status: 'pr', statusText: 'PR open', pr: { num: 1253, ci: 'fail', url: 'https://x/1253/files', isMerged: false } },
  ],
}

const pr = (over: Partial<SessionPr>): SessionPr => ({ repo: 'web_frontend', tag: 'fe', num: 794, title: 'seed', url: 'u', state: 'OPEN', ci: 'pass', base: 'development', behind: 0, createdAt: NOW, ...over })

describe('alerts', () => {
  test('orchestrator sees blocked, not-ready and red lanes', () => {
    const alerts = buildAlerts({ ...base, role: 'orchestrator', board })
    expect(alerts.map(a => a.tag)).toEqual(['NOT READY', 'BLOCKED', 'CI RED'])
    expect(alerts[1]?.action?.prompt).toContain('Can it go internal?')
    expect(alerts[2]?.action?.url).toBe('https://x/1253/files')
  })

  test('a worker sees only its own wait', () => {
    const alerts = buildAlerts({ ...base, role: 'worker', board, boardRef: { repoPath: '/r', num: 1238, role: 'worker', worker: 'W3' } })
    expect(alerts.map(a => a.text)).toEqual(['Waiting for the orchestrator to answer on #1238'])
  })

  test('session alerts: waiting peers, red base CI, own PR CI and behind, quiet agents', () => {
    const alerts = buildAlerts({
      ...base,
      peers: [{ id: 'p', name: 's7', cwd: '/r/s7', state: 'waiting', waitingFor: 'Permission to run git push', updatedAt: NOW - 60_000 }],
      repos: [{ tag: 'be', path: '/r/be', baseCi: 'fail' }],
      prs: [pr({ ci: 'fail', behind: 3 })],
      quietAgents: [{ id: 'a1', name: 'e2e-runner' }],
    })
    expect(alerts.map(a => a.tag)).toEqual(['WAITING', 'CI RED', 'CI RED', 'BEHIND', 'QUIET'])
    expect(alerts[3]?.text).toBe('fe #794 is 3 commits behind development')
  })

  test('ids stay stable across polls so dismissals hold', () => {
    const at = (updatedAt: number, behind: number) =>
      buildAlerts({ ...base, peers: [{ id: 'p', name: 's7', cwd: '/r', state: 'waiting', waitingSince: NOW - 120_000, updatedAt }], prs: [pr({ behind })] }).map(a => a.id)
    expect(at(NOW, 3)).toEqual(at(NOW + 5_000, 4))
  })

  test('usage alerts re-arm at 95% and on a new window', () => {
    const at = (pct: number, resetsAt: string) => buildAlerts({ ...base, usage: [{ kind: 'time', pct, resetsAt }] })[0]?.id
    expect(at(80, 'a')).toBeUndefined()
    expect(at(88, 'a')).not.toBe(at(96, 'a'))
    expect(at(88, 'a')).not.toBe(at(88, 'b'))
  })
})
