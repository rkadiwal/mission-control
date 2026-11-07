import type { BoardRef, PeerSession, PlanItem, RepoHealth, SessionPr, View } from '../types'
import { buildAlerts } from './alerts'
import { baseCi, baseName, behindBy, discoverRepos, fetchBoard, prDetails, repoTag, safeJson, type Run } from './github'
import { metersFrom, planSummary } from './model'

type AgentInfo = { id: string; description: string; type: string; status: string }
type UsageInput = Parameters<typeof metersFrom>[0]
type Tracked = { repoPath: string; num: number; url?: string; createdAt: number }
export type Saved = { plan: PlanItem[]; mine: string[]; tracked: Tracked[]; boardRef?: BoardRef }

export type Ports = {
  run: Run
  now: () => Promise<number>
  sessionId: () => Promise<string>
  cwd: string
  home: string
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<{ name: string; mtimeMs: number }[]>
  listAgents: () => Promise<AgentInfo[]>
  usage: () => Promise<UsageInput>
  load: (sessionId: string) => Promise<Saved | undefined>
  save: (sessionId: string, saved: Saved) => Promise<void>
  publish: (view: View) => Promise<unknown>
  every: (ms: number, fn: () => void) => void
  after: (ms: number, fn: () => void) => void
  log: (message: string) => void
}

export type Config = { base: string; ciWorkflow: string; pollMs: number; quietMinutes: number }
const LOCAL_MS = 5_000
const STALE_PEER_MS = 30_000
const GH_MIN_GAP_MS = 15_000
const MAX_TRACKED = 12
const MAX_MINE = 20
const MAX_PRS = 4
const EMPTY: Saved = { plan: [], mine: [], tracked: [] }
const prKey = (repoPath: string, num: number) => `${repoPath}#${num}`

export function createPoller(ports: Ports, config: Config) {
  let saved: Saved = EMPTY
  let repos: string[] = []
  let health: RepoHealth[] = []
  let prs: SessionPr[] = []
  let peers: PeerSession[] = []
  let board: View['board']
  let agents: View['agents'] = { running: 0, quiet: [] }
  let usage: View['usage'] = []
  let state: { kind: PeerSession['state']; waitingFor?: string; since?: number } = { kind: 'idle' }
  let branch: string | undefined
  let ghRun: Promise<void> | undefined
  let ghDirty = false
  let ghLast = 0
  let ghScheduled = false
  const lastActivity = new Map<string, number>()
  const statusDir = `${ports.home}/.claude/mission-control/sessions`
  const guard = (step: string) => (err: unknown) => ports.log(`mission-control ${step}: ${String(err)}`)

  const scope = () => {
    const tags = repos.map(r => repoTag(baseName(r)))
    const label = repos.length <= 1 ? baseName(repos[0] ?? ports.cwd) : `${baseName(ports.cwd)} · ${tags.join(' + ')}`
    return { label, repos }
  }

  const publish = async () => {
    const now = await ports.now()
    const role = saved.boardRef?.role ?? 'session'
    const alerts = buildAlerts({ now, role, base: config.base, quietMinutes: config.quietMinutes, peers, repos: health, prs, quietAgents: agents.quiet, usage, board, boardRef: saved.boardRef })
    await ports.publish({ at: now, scope: scope(), role, plan: saved.plan, prs, usage, peers, repos: health, agents, board, boardRef: saved.boardRef, alerts })
  }

  let lastId: string | undefined
  const writeStatus = async (extra: Partial<PeerSession> = {}) => {
    if (!ports.home) return
    const id = extra.id ?? (await ports.sessionId())
    lastId = id
    const me: PeerSession = { id, name: baseName(ports.cwd), cwd: ports.cwd, branch, state: state.kind, waitingFor: state.waitingFor, waitingSince: state.since, plan: planSummary(saved.plan), updatedAt: await ports.now(), ...extra }
    await ports.write(`${statusDir}/${id}.json`, JSON.stringify(me))
  }

  const readPeers = async (now: number) => {
    if (!ports.home) return
    const own = `${await ports.sessionId()}.json`
    const fresh = (await ports.list(statusDir).catch(() => [])).filter(f => f.name.endsWith('.json') && f.name !== own && now - f.mtimeMs < STALE_PEER_MS)
    const all = await Promise.all(fresh.map(f => ports.read(`${statusDir}/${f.name}`).then(t => safeJson<PeerSession>(t)).catch(() => undefined)))
    peers = all.filter((p): p is PeerSession => !!p && typeof p.id === 'string' && !p.isEnded)
  }

  const readAgents = async (now: number) => {
    const running = (await ports.listAgents()).filter(a => a.status === 'running')
    for (const id of lastActivity.keys()) if (!running.some(a => a.id === id)) lastActivity.delete(id)
    for (const a of running) if (!lastActivity.has(a.id)) lastActivity.set(a.id, now)
    const quietMs = config.quietMinutes * 60_000
    const quiet = running.filter(a => now - (lastActivity.get(a.id) ?? now) > quietMs)
    agents = { running: running.length, quiet: quiet.map(a => ({ id: a.id, name: a.type || a.description })) }
  }

  const refreshLocal = async () => {
    const now = await ports.now()
    await Promise.all([
      readPeers(now).catch(guard('peers')),
      readAgents(now).catch(guard('agents')),
      ports.usage().then(u => void (usage = metersFrom(u))).catch(guard('usage')),
      writeStatus().catch(guard('status')),
    ])
    await publish()
  }

  const prRow = async (t: Tracked): Promise<SessionPr | undefined> => {
    const pr = await prDetails(ports.run, t.repoPath, t.url ?? t.num)
    if (!pr) return prs.find(p => prKey(p.repo, p.num) === prKey(t.repoPath, t.num))
    const behind = pr.state === 'OPEN' ? await behindBy(ports.run, t.repoPath, pr.head, pr.base) : 0
    return { repo: t.repoPath, tag: repoTag(baseName(t.repoPath)), num: t.num, title: pr.title, url: `${pr.url}/files`, state: pr.state, ci: pr.ci, base: pr.base, behind, createdAt: t.createdAt }
  }

  const refreshPrs = async () => {
    const rows = (await Promise.all(saved.tracked.map(prRow))).filter((r): r is SessionPr => r !== undefined)
    const finished = new Set(rows.filter(r => r.state !== 'OPEN').map(r => prKey(r.repo, r.num)))
    saved = { ...saved, tracked: saved.tracked.filter(t => !finished.has(prKey(t.repoPath, t.num))).slice(-MAX_TRACKED) }
    prs = rows.filter(r => r.state === 'OPEN').sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PRS)
  }

  const githubOnce = async () => {
    const now = await ports.now()
    const ref = saved.boardRef
    health = await Promise.all(repos.map(async r => ({ tag: repoTag(baseName(r)), path: r, baseCi: await baseCi(ports.run, r, config.base, config.ciWorkflow) })))
    await refreshPrs().catch(guard('prs'))
    const fetched = ref ? await fetchBoard(ports.run, ref.repoPath, ref.num, now).catch(() => undefined) : undefined
    if (saved.boardRef === ref) board = fetched
    ghLast = now
    await ports.save(await ports.sessionId(), saved).catch(guard('save'))
    await publish()
  }

  const refreshGitHub = (): Promise<void> => {
    if (ghRun) {
      ghDirty = true
      return ghRun
    }
    ghRun = (async () => {
      do {
        ghDirty = false
        await githubOnce().catch(guard('github'))
      } while (ghDirty)
    })().finally(() => void (ghRun = undefined))
    return ghRun
  }

  const nudge = async () => {
    const wait = GH_MIN_GAP_MS - ((await ports.now()) - ghLast)
    if (wait <= 0) return void refreshGitHub()
    if (ghScheduled) return
    ghScheduled = true
    ports.after(wait, () => {
      ghScheduled = false
      void refreshGitHub()
    })
  }

  const saveSoon = () => void ports.sessionId().then(id => ports.save(id, saved)).catch(guard('save'))

  return {
    async start() {
      ports.every(LOCAL_MS, () => void refreshLocal().catch(guard('local')))
      ports.every(config.pollMs, () => void refreshGitHub())
      saved = { ...EMPTY, ...((await ports.load(await ports.sessionId()).catch(() => undefined)) ?? {}) }
      repos = await discoverRepos(ports.run, ports.cwd)
      const head = repos[0] ? await ports.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], repos[0]) : undefined
      branch = head?.exitCode === 0 ? head.stdout.trim() : undefined
      await publish()
      void refreshLocal().catch(guard('local'))
      void refreshGitHub()
    },
    nudge: () => void nudge().catch(guard('nudge')),
    repos: () => repos,
    plan: () => saved.plan,
    async setPlan(plan: PlanItem[]) {
      saved = { ...saved, plan }
      saveSoon()
      await Promise.all([writeStatus().catch(guard('status')), publish()])
    },
    mine: () => saved.mine,
    addMine(text: string) {
      saved = { ...saved, mine: [...saved.mine, text.trim().toLowerCase()].slice(-MAX_MINE) }
      saveSoon()
    },
    async trackPr(repoPath: string, num: number, url: string) {
      if (saved.tracked.some(t => prKey(t.repoPath, t.num) === prKey(repoPath, num))) return
      saved = { ...saved, tracked: [...saved.tracked, { repoPath, num, url, createdAt: await ports.now() }] }
      void nudge()
    },
    setBoard(ref: BoardRef | undefined) {
      saved = { ...saved, boardRef: ref }
      board = undefined
      void publish().catch(guard('publish'))
      void refreshGitHub()
    },
    boardRef: () => saved.boardRef,
    async activity(agentId: string | undefined) {
      if (agentId && lastActivity.has(agentId)) lastActivity.set(agentId, await ports.now())
    },
    async setState(kind: PeerSession['state'], waitingFor?: string) {
      if (state.kind === kind && state.waitingFor === waitingFor) return
      state = { kind, waitingFor, since: kind === 'waiting' ? await ports.now() : undefined }
      await writeStatus().catch(guard('status'))
    },
    async end() {
      if (lastId) await writeStatus({ id: lastId, isEnded: true }).catch(guard('end'))
    },
    async reset() {
      if (lastId) await writeStatus({ id: lastId, isEnded: true }).catch(guard('end'))
      saved = EMPTY
      prs = []
      board = undefined
      state = { kind: 'idle' }
      await publish()
    },
  }
}

export type Poller = ReturnType<typeof createPoller>
