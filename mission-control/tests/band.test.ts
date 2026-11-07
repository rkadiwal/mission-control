import { describe, expect, test } from 'claude-code/testing'

import type { UiState, View } from '../types'

const NOW = Date.parse('2026-10-06T05:00:00Z')
const VIEW: View = {
  at: NOW,
  scope: { label: 'appointmental · be + fe', repos: ['/r/be', '/r/fe'] },
  role: 'session',
  plan: [
    { id: '1', text: 'Audit e2e specs', status: 'done' },
    { id: '2', text: 'Run organization e2e', activeText: 'Running organization e2e', status: 'now' },
    { id: '3', text: 'Self review then merge', status: 'todo', isMine: true },
  ],
  prs: [{ repo: 'appointmental_frontend', tag: 'fe', num: 794, title: 'seed 12 patients', url: 'https://x/794/files', state: 'OPEN', ci: 'pending', base: 'development', behind: 0, createdAt: NOW - 6 * 60_000 }],
  usage: [{ kind: 'time', pct: 62 }, { kind: 'week', pct: 38 }, { kind: 'context', pct: 46 }],
  peers: [],
  repos: [{ tag: 'be', path: '/r/be', baseCi: 'fail' }],
  agents: { running: 2, quiet: [] },
  alerts: [{ id: 'baseci-be', tag: 'CI RED', tone: 'red', text: 'be development CI is red', meta: '/r/be', action: { label: 'Investigate', prompt: 'look' } }],
}
const UI: UiState = { isHidden: false, planOpen: true, boardOpen: true, dismissed: [], alertIndex: 0 }
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 24, bodyColumns: 140, scroll: { offset: 0, bodyRows: 24 }, view: {} }

describe('band', () => {
  test('draws alert, status, plan, macros, usage and open PRs on terminal and desktop', async ($, on) => {
    on('state.get', ($, e) => ({ value: { value: e.key === 'view' ? VIEW : UI, version: 1 } }))
    on('clock.now', () => ({ value: NOW }))
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ plugin: 'mission-control', surface, component: 'AbovePrompt', props: PROPS })
      if (surface === 'terminal') {
        const texts = [/be development CI is red/, /1 \/ 3/, /Running organization e2e/, /added by you/, /62%/, /Open PRs/]
        const missing: string[] = []
        for (const text of texts) if (!(await band.find({ text }))) missing.push(String(text))
        expect(missing).toEqual([])
      } else {
        const svg = await band.find({ type: 'Svg' })
        expect(String(svg?.props.alt)).toContain('CI RED: be development CI is red')
        expect(await band.find({ key: 'add-task' })).toBeDefined()
      }
      expect((await band.find({ key: 'next' }))?.props.label).toBe('1 of 1 ›')
      expect((await band.find({ key: 'macro-6' }))?.props.label).toBe('commit + PR +2')
      if (surface === 'terminal') expect(await band.find({ key: 'pr-fe-794' })).toBeDefined()
      await band.unmount()
    }
  })

  test('stays out of the way when hidden or before the first refresh', async ($, on) => {
    on('state.get', ($, e) => ({ value: { value: e.key === 'view' ? { ...VIEW, at: 0 } : UI, version: 1 } }))
    on('clock.now', () => ({ value: NOW }))
    on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] }) as never)
    const band = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect(await band.find({ text: /CI is red/ })).toBeUndefined()
    await band.unmount()
  })
})
