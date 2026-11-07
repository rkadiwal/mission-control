import { describe, expect, test } from 'claude-code/testing'

import { ago, macroText, metersFrom, parseMacros, planAddTask, planFromTodos, planSummary, planUpdateTask, until, DEFAULT_MACROS } from '../hooks/model'

describe('plan', () => {
  test('maps TodoWrite statuses and flags tasks the user added', () => {
    const plan = planFromTodos(
      [
        { content: 'Audit e2e specs', status: 'completed' },
        { content: 'Run organization e2e', status: 'in_progress', activeForm: 'Running organization e2e' },
        { content: 'Self review then merge', status: 'pending' },
      ],
      ['self review then merge'],
    )
    expect(plan.map(p => p.status)).toEqual(['done', 'now', 'todo'])
    expect(plan[2]?.isMine).toBe(true)
    expect(planSummary(plan)).toEqual({ done: 1, total: 3, now: 'Running organization e2e' })
  })

  test('follows TaskCreate and TaskUpdate, including deletes', () => {
    let plan = planAddTask([], '1', 'Write migration', 'Writing migration', [])
    plan = planAddTask(plan, '2', 'Open PR', undefined, [])
    expect(planSummary(plan).now).toBe('Next: Write migration')
    plan = planUpdateTask(plan, { taskId: '1', status: 'in_progress' })
    expect(planSummary(plan).now).toBe('Writing migration')
    plan = planUpdateTask(plan, { taskId: '1', status: 'completed' })
    plan = planUpdateTask(plan, { taskId: '2', status: 'deleted' })
    expect(plan).toHaveLength(1)
    expect(planSummary(plan)).toEqual({ done: 1, total: 1, now: undefined })
  })
})

describe('usage and time', () => {
  test('reads 5-hour, weekly and context meters', () => {
    const meters = metersFrom({ context: { percent: 45.6 }, rateLimits: [{ kind: 'five_hour', percentUsed: 61.7, resetsAt: '2026-10-06T14:20:00Z' }, { kind: 'seven_day', percentUsed: 38 }] })
    expect(meters.map(m => [m.kind, m.pct])).toEqual([['time', 62], ['week', 38], ['context', 46]])
  })

  test('formats ages and time until reset', () => {
    expect(ago(8 * 60_000)).toBe('8m')
    expect(ago(3 * 3_600_000)).toBe('3h')
    const now = Date.parse('2026-10-06T12:00:00Z')
    expect(until('2026-10-06T13:40:00Z', now)).toBe('1h 40m')
    expect(until('2026-10-06T11:00:00Z', now)).toBeUndefined()
  })
})

describe('macros', () => {
  test('falls back to the built-in seven on empty or bad JSON', () => {
    expect(parseMacros('')).toBe(DEFAULT_MACROS)
    expect(parseMacros('{not json')).toBe(DEFAULT_MACROS)
    expect(parseMacros('[{"label":"ship","prompt":"ship it"}]')).toEqual([{ key: '1', label: 'ship', prompt: 'ship it', skills: [] }])
  })

  test('prefixes attached skills', () => {
    const commit = DEFAULT_MACROS.find(m => m.key === '6')
    expect(macroText(commit!)).toMatch(/^Use the mattpocock-skills:pr and mattpocock-skills:code-review skills\. commit/)
    expect(macroText(DEFAULT_MACROS[0]!)).toBe('continue')
  })
})
