export type CiState = 'pass' | 'fail' | 'pending' | 'none'
export type Tone = 'amber' | 'red' | 'grey' | 'blue'
export type Role = 'session' | 'orchestrator' | 'worker'
export type PlanStatus = 'done' | 'now' | 'paused' | 'todo'

export type PlanItem = { id: string; text: string; status: PlanStatus; isMine?: boolean; activeText?: string }

export type AlertAction = { label: string; prompt?: string; url?: string }
export type Alert = { id: string; tag: string; tone: Tone; text: string; meta: string; action?: AlertAction }

export type SessionPr = {
  repo: string
  tag: string
  num: number
  title: string
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  ci: CiState
  base: string
  behind: number
  createdAt: number
}

export type UsageMeter = { kind: 'time' | 'week' | 'context'; pct: number; resetsAt?: string }

export type PeerSession = {
  id: string
  name: string
  cwd: string
  branch?: string
  state: 'working' | 'waiting' | 'idle'
  waitingFor?: string
  waitingSince?: number
  isEnded?: boolean
  plan?: { done: number; total: number; now?: string }
  updatedAt: number
}

export type LaneStatus = 'working' | 'blocked' | 'not-ready' | 'pr' | 'merged' | 'paused' | 'idle'
export type Lane = {
  worker: string
  cells: string[]
  session?: { name: string; url?: string; isCloud: boolean }
  status: LaneStatus
  statusText: string
  pr?: { num: number; ci: CiState; url: string; isMerged: boolean }
  lastPostAt?: number
  question?: string
}

export type Board = {
  repo: string
  num: number
  url: string
  title: string
  columns: string[]
  lanes: Lane[]
  orchestrator?: { name: string; url?: string; isCloud: boolean }
  fetchedAt: number
}

export type BoardRef = { repoPath: string; num: number; role: 'orchestrator' | 'worker'; worker?: string }

export type RepoHealth = { tag: string; path: string; baseCi: CiState }

export type View = {
  at: number
  scope: { label: string; repos: string[] }
  role: Role
  plan: PlanItem[]
  prs: SessionPr[]
  usage: UsageMeter[]
  peers: PeerSession[]
  repos: RepoHealth[]
  agents: { running: number; quiet: { id: string; name: string }[] }
  board?: Board
  boardRef?: BoardRef
  alerts: Alert[]
}

export type UiState = {
  isHidden: boolean
  planOpen: boolean
  boardOpen: boolean
  dismissed: string[]
  alertIndex: number
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': { view: View; ui: UiState }
  }
}
