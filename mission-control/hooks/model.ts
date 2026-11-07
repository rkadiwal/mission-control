import type { PlanItem, PlanStatus, UsageMeter } from '../types'

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }
export type TaskPatch = { taskId: string; status?: string; subject?: string; activeForm?: string }
export type Macro = { key: string; label: string; prompt: string; skills: string[] }

const TODO_STATUS: Record<string, PlanStatus> = { pending: 'todo', in_progress: 'now', completed: 'done' }

function isMineText(text: string, mine: readonly string[]): boolean {
  const t = text.trim().toLowerCase()
  return t !== '' && mine.some(m => m !== '' && (t.includes(m) || m.includes(t)))
}

export function planFromTodos(todos: readonly Todo[], mine: readonly string[]): PlanItem[] {
  return todos.map((t, i) => ({
    id: `todo-${i}`,
    text: t.content,
    activeText: t.activeForm,
    status: TODO_STATUS[t.status] ?? 'todo',
    isMine: isMineText(t.content, mine),
  }))
}

export function planAddTask(plan: readonly PlanItem[], id: string, subject: string, activeForm: string | undefined, mine: readonly string[]): PlanItem[] {
  const item: PlanItem = { id, text: subject, activeText: activeForm, status: 'todo', isMine: isMineText(subject, mine) }
  return [...plan.filter(p => p.id !== id), item]
}

export function planUpdateTask(plan: readonly PlanItem[], patch: TaskPatch): PlanItem[] {
  if (patch.status === 'deleted') return plan.filter(p => p.id !== patch.taskId)
  return plan.map(p =>
    p.id !== patch.taskId
      ? p
      : {
          ...p,
          text: patch.subject ?? p.text,
          activeText: patch.activeForm ?? p.activeText,
          status: patch.status ? TODO_STATUS[patch.status] ?? p.status : p.status,
        },
  )
}

export function planSummary(plan: readonly PlanItem[]): { done: number; total: number; now?: string } {
  const current = plan.find(p => p.status === 'now')
  const next = plan.find(p => p.status === 'todo')
  const done = plan.filter(p => p.status === 'done').length
  const now = current ? current.activeText || current.text : next ? `Next: ${next.text}` : undefined
  return { done, total: plan.length, now }
}

export function openTasks(plan: readonly PlanItem[]): string[] {
  return plan.filter(p => p.status !== 'done').map(p => p.text)
}

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }
type UsageInput = { context?: { percent?: number }; rateLimits?: readonly RateLimit[] }

export function metersFrom(usage: UsageInput): UsageMeter[] {
  const limit = (kind: string) => usage.rateLimits?.find(r => r.kind === kind)
  const meters: UsageMeter[] = []
  const five = limit('five_hour')
  const week = limit('seven_day')
  if (five) meters.push({ kind: 'time', pct: Math.round(five.percentUsed), resetsAt: five.resetsAt })
  if (week) meters.push({ kind: 'week', pct: Math.round(week.percentUsed), resetsAt: week.resetsAt })
  if (usage.context?.percent !== undefined) meters.push({ kind: 'context', pct: Math.round(usage.context.percent) })
  return meters
}

export function ago(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

export function until(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  const minutes = Math.round(ms / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export const DEFAULT_MACROS: Macro[] = [
  { key: '1', label: 'continue', prompt: 'continue', skills: [] },
  { key: '2', label: 'lets go', prompt: 'lets go', skills: [] },
  { key: '3', label: 'status', prompt: 'whats the status? list what is done, what is running, and what is left', skills: [] },
  { key: '4', label: 'what’s next', prompt: 'whats next? recommend the next task and why', skills: [] },
  { key: '5', label: 'run all tests', prompt: 're-run the full test suite including e2e against the seeded db; start servers if needed; report anything red', skills: ['ecc:e2e-testing'] },
  { key: '6', label: 'commit + PR', prompt: 'commit, merge latest development into this branch, make sure CI is green for both repos, then create the PR', skills: ['mattpocock-skills:pr', 'mattpocock-skills:code-review'] },
  { key: '7', label: 'review + merge', prompt: 'self review the PR with the review agents, fix what they find, then merge into development', skills: ['review-pr'] },
]

export const ORCHESTRATOR_MACROS: Macro[] = [
  { key: '1', label: 'status of all lanes', prompt: 'status of all lanes on the board: what is merged, running, blocked, and next', skills: [] },
  { key: '2', label: 'answer blocked', prompt: 'read the open questions on the board and answer each blocked worker', skills: [] },
  { key: '3', label: 'dispatch next lane', prompt: 'dispatch the next lane on the board to a new worker session and add it to the worker map', skills: [] },
  { key: '4', label: 'merge green PRs', prompt: 'review and merge every lane PR on the board whose CI is green', skills: ['review-pr'] },
  { key: '5', label: 'continue', prompt: 'continue', skills: [] },
]

export function parseMacros(json: string): Macro[] {
  if (json.trim() === '') return DEFAULT_MACROS
  try {
    const raw = JSON.parse(json) as unknown
    if (!Array.isArray(raw)) return DEFAULT_MACROS
    const used = new Set<string>()
    const macros = (raw as Partial<Macro>[])
      .filter(m => typeof m?.label === 'string' && typeof m.prompt === 'string')
      .map((m, i) => {
        const wanted = String(m.key ?? i + 1).toLowerCase()
        const key = /^[0-9a-z]$/.test(wanted) && !used.has(wanted) ? wanted : ''
        used.add(key)
        const skills = Array.isArray(m.skills) ? m.skills.filter((s): s is string => typeof s === 'string') : []
        return { key, label: m.label as string, prompt: m.prompt as string, skills }
      })
    return macros.length > 0 ? macros : DEFAULT_MACROS
  } catch {
    return DEFAULT_MACROS
  }
}

export function macroText(macro: Macro): string {
  if (macro.skills.length === 0) return macro.prompt
  const noun = macro.skills.length === 1 ? 'skill' : 'skills'
  return `Use the ${macro.skills.join(' and ')} ${noun}. ${macro.prompt}`
}
