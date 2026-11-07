import type { Alert, Board, BoardRef, PeerSession, RepoHealth, Role, SessionPr, UsageMeter } from '../types'
import { ago, until } from './model'

export type AlertInput = {
  now: number
  role: Role
  base: string
  quietMinutes: number
  peers: readonly PeerSession[]
  repos: readonly RepoHealth[]
  prs: readonly SessionPr[]
  quietAgents: readonly { id: string; name: string }[]
  usage: readonly UsageMeter[]
  board?: Board
  boardRef?: BoardRef
}

function hash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function boardAlerts(board: Board, now: number): Alert[] {
  const out: Alert[] = []
  for (const lane of board.lanes) {
    const who = `${lane.worker} · ${lane.cells[1] ?? ''}`.trim()
    const when = lane.lastPostAt ? ` · ${ago(now - lane.lastPostAt)} ago` : ''
    if (lane.status === 'blocked') {
      const ask = lane.question ? `Answer ${lane.worker}'s question on #${board.num}: "${lane.question}"` : `Read ${lane.worker}'s latest post on #${board.num} and answer it`
      out.push({ id: `lane-blocked-${lane.worker}-${hash(lane.question ?? lane.statusText)}`, tag: 'BLOCKED', tone: 'red', text: `${who} is waiting for your answer`, meta: `#${board.num}${lane.question ? ` · “${lane.question}”` : ''}${when}`, action: { label: `Answer ${lane.worker}`, prompt: ask } })
    } else if (lane.status === 'not-ready') {
      out.push({ id: `lane-notready-${lane.worker}`, tag: 'NOT READY', tone: 'amber', text: `${who} cannot run its gate`, meta: `#${board.num}${when}`, action: { label: 'Open board', url: board.url } })
    } else if (lane.pr && lane.pr.ci === 'fail' && !lane.pr.isMerged) {
      out.push({ id: `lane-ci-${lane.worker}-${lane.pr.num}`, tag: 'CI RED', tone: 'red', text: `${who} PR #${lane.pr.num} failed CI`, meta: `#${board.num}${when}`, action: { label: 'Review PR', url: lane.pr.url } })
    }
  }
  return out
}

function workerAlerts(board: Board, ref: BoardRef, now: number): Alert[] {
  const lane = board.lanes.find(l => l.worker === ref.worker)
  if (!lane || lane.status !== 'blocked') return []
  const when = lane.lastPostAt ? `asked ${ago(now - lane.lastPostAt)} ago` : 'asked'
  return [{ id: `self-waiting-${hash(lane.question ?? '')}`, tag: 'WAITING', tone: 'amber', text: `Waiting for the orchestrator to answer on #${board.num}`, meta: `${when}${lane.question ? ` · “${lane.question}”` : ''}`, action: { label: `Open #${board.num}`, url: board.url } }]
}

function prAlerts(prs: readonly SessionPr[]): Alert[] {
  const out: Alert[] = []
  for (const pr of prs.filter(p => p.state === 'OPEN')) {
    if (pr.ci === 'fail') out.push({ id: `prci-${pr.tag}-${pr.num}`, tag: 'CI RED', tone: 'red', text: `${pr.tag} #${pr.num} — CI failing`, meta: pr.title, action: { label: 'Fix CI', prompt: `CI is failing on ${pr.tag} PR #${pr.num} (${pr.url}). Investigate the failing checks and fix them.` } })
    if (pr.behind > 0) out.push({ id: `behind-${pr.tag}-${pr.num}`, tag: 'BEHIND', tone: 'amber', text: `${pr.tag} #${pr.num} is ${pr.behind} commit${pr.behind === 1 ? '' : 's'} behind ${pr.base}`, meta: `merge ${pr.base} before review`, action: { label: 'Sync', prompt: `Merge the latest origin/${pr.base} into the branch of ${pr.tag} PR #${pr.num}, resolve conflicts, keep tests green, and push.` } })
  }
  return out
}

function usageAlerts(usage: readonly UsageMeter[], now: number): Alert[] {
  return usage
    .filter(u => u.kind !== 'context' && u.pct >= 85)
    .map(u => {
      const name = u.kind === 'time' ? '5-hour' : 'weekly'
      const reset = until(u.resetsAt, now)
      return { id: `limit-${u.kind}-${u.pct >= 95 ? 95 : 85}-${u.resetsAt ?? ''}`, tag: 'LIMIT', tone: 'amber' as const, text: `${u.pct}% of your ${name} limit used`, meta: reset ? `resets in ${reset}` : 'resets soon', action: { label: 'Switch to Sonnet', prompt: '/model sonnet' } }
    })
}

export function buildAlerts(i: AlertInput): Alert[] {
  const alerts: Alert[] = []
  if (i.board && i.role === 'orchestrator') alerts.push(...boardAlerts(i.board, i.now))
  if (i.board && i.boardRef && i.role === 'worker') alerts.push(...workerAlerts(i.board, i.boardRef, i.now))
  for (const p of i.peers.filter(p => p.state === 'waiting')) {
    const since = p.waitingSince ?? p.updatedAt
    alerts.push({ id: `peer-${p.id}-${since}`, tag: 'WAITING', tone: 'amber', text: `${p.name} is waiting for you`, meta: `${p.waitingFor ?? 'needs input'} · ${ago(i.now - since)}` })
  }
  for (const r of i.repos.filter(r => r.baseCi === 'fail')) {
    alerts.push({ id: `baseci-${r.tag}`, tag: 'CI RED', tone: 'red', text: `${r.tag} ${i.base} CI is red`, meta: r.path, action: { label: 'Investigate', prompt: `CI on ${i.base} is red in ${r.path}. Find the failing run with gh run list --branch ${i.base}, find the cause and propose a fix.` } })
  }
  alerts.push(...prAlerts(i.prs))
  for (const agent of i.quietAgents) {
    alerts.push({ id: `quiet-${agent.id}`, tag: 'QUIET', tone: 'grey', text: `${agent.name} has had no output for ${i.quietMinutes}+ minutes`, meta: 'agent', action: { label: 'Check on it', prompt: `Check on the ${agent.name} agent: is it stuck? If so, stop it and tell me what it was doing.` } })
  }
  alerts.push(...usageAlerts(i.usage, i.now))
  return alerts
}
