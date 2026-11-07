import { describe, expect, test } from 'claude-code/testing'

import { boardFromArgs, boardFromCommand, fetchBoard, laneStatus, latestPosts, parsePrUrl, parseWorkerMap, repoForName, summarizeChecks, type Run } from '../hooks/github'

const BODY = [
  'Coordination board for Phase 7, run across worker sessions by an orchestrator session.',
  'Orchestrator: [p7-orchestrator](https://claude.ai/code/session_orch)',
  '',
  '## Worker map (batch 1)',
  '| Worker | Module | Pin | Session |',
  '|---|---|---|---|',
  '| W1 | platform | 8 | [p7-w1-platform](https://claude.ai/code/session_w1) |',
  '| W3 | chiro | 7 | [p7-w3-chiro](https://claude.ai/code/session_w3) |',
  '| W4 | engagement | 11 | p7-w4-engagement |',
  '',
  '## Protocol',
].join('\n')

const COMMENTS = [
  { body: '[W1 · platform] dry-run\n\n| `dotnet` | ✗ **not installed** — Not gate-ready |', createdAt: '2026-10-06T03:00:00Z' },
  { body: '[W3 · chiro] blocked\n\nDoes FhirRoleCoding count as used by composition?\nSTOP until answered.', createdAt: '2026-10-06T04:00:00Z' },
  { body: '[W4 · engagement] start', createdAt: '2026-10-06T03:30:00Z' },
  { body: '[W4 · engagement] finish — PR open → #1253', createdAt: '2026-10-06T04:05:00Z' },
]

describe('pull requests', () => {
  test('summarizes check rollups worst-first', () => {
    expect(summarizeChecks([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'FAILURE' }])).toBe('fail')
    expect(summarizeChecks([{ status: 'IN_PROGRESS', conclusion: '' }])).toBe('pending')
    expect(summarizeChecks(null)).toBe('none')
  })

  test('reads the repo and number from gh pr create output', () => {
    expect(parsePrUrl('Creating pull request\nhttps://github.com/rkadiwal/appointmental_frontend/pull/794\n')).toEqual({ repo: 'appointmental_frontend', num: 794, url: 'https://github.com/rkadiwal/appointmental_frontend/pull/794' })
    expect(repoForName(['/r/appointmental_backend', '/r/appointmental_frontend'], 'appointmental_frontend')).toBe('/r/appointmental_frontend')
    expect(repoForName(['/r/.worktrees/s7'], 'appointmental_frontend')).toBe('/r/.worktrees/s7')
    expect(repoForName(['/r/appointmental_backend', '/r/appointmental_frontend'], 'other_repo')).toBeUndefined()
  })
})

describe('board detection', () => {
  const repos = ['/r/appointmental_backend', '/r/appointmental_frontend']

  test('recognises worker posts and orchestrator board writes', () => {
    expect(boardFromCommand(`gh issue comment 1238 --body "[W3 · chiro] blocked"`, '', repos)).toEqual({ repoPath: '/r/appointmental_backend', num: 1238, role: 'worker', worker: 'W3' })
    expect(boardFromCommand('gh issue create --title Board --body "| Worker | Module |"', 'https://github.com/o/be/issues/1300\n', repos)).toMatchObject({ num: 1300, role: 'orchestrator' })
    expect(boardFromCommand('gh issue list', '', repos)).toBeUndefined()
  })

  test('parses /mc board arguments', () => {
    expect(boardFromArgs(['board', '1238', 'fe', 'w3'], repos)).toEqual({ repoPath: '/r/appointmental_frontend', num: 1238, role: 'worker', worker: 'W3' })
    expect(boardFromArgs(['board', 'x'], repos)).toBeUndefined()
  })

  test('ignores posts from people outside the repo', () => {
    const posts = latestPosts([{ body: '[W3 · chiro] blocked', createdAt: '2026-10-06T04:00:00Z', authorAssociation: 'NONE' }])
    expect(posts.size).toBe(0)
  })
})

describe('board', () => {
  test('parses the worker map with dynamic columns', () => {
    const map = parseWorkerMap(BODY)
    expect(map?.columns).toEqual(['Worker', 'Module', 'Pin', 'Session'])
    expect(map?.rows.map(r => r[0])).toEqual(['W1', 'W3', 'W4'])
  })

  test('derives lane status from each worker latest post', () => {
    const posts = latestPosts(COMMENTS)
    expect(laneStatus(posts.get('W1')).status).toBe('not-ready')
    expect(laneStatus(posts.get('W3'))).toMatchObject({ status: 'blocked', question: 'Does FhirRoleCoding count as used by composition?' })
    expect(laneStatus(posts.get('W4')).status).toBe('pr')
    expect(laneStatus(undefined).status).toBe('idle')
  })

  test('fetches the board, attaches lane PRs and the orchestrator', async () => {
    const run: Run = async argv => {
      const cmd = argv.join(' ')
      if (cmd.startsWith('gh issue view')) return { exitCode: 0, stdout: JSON.stringify({ title: 'Phase 7 orchestration board', url: 'https://github.com/o/be/issues/1238', body: BODY, comments: COMMENTS }) }
      if (cmd.startsWith('gh pr view 1253')) return { exitCode: 0, stdout: JSON.stringify({ title: 'W4', state: 'OPEN', url: 'https://github.com/o/be/pull/1253', headRefName: 'w4', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }) }
      return { exitCode: 1, stdout: '' }
    }
    const board = await fetchBoard(run, '/r/appointmental_backend', 1238, 0)
    expect(board?.orchestrator).toEqual({ name: 'p7-orchestrator', url: 'https://claude.ai/code/session_orch', isCloud: true })
    const w4 = board?.lanes.find(l => l.worker === 'W4')
    expect(w4?.pr).toEqual({ num: 1253, ci: 'fail', url: 'https://github.com/o/be/pull/1253/files', isMerged: false })
    expect(w4?.session).toEqual({ name: 'p7-w4-engagement', isCloud: false })
    expect(board?.lanes.find(l => l.worker === 'W3')?.session?.isCloud).toBe(true)
  })
})
