import type { Board, BoardRef, CiState, Lane, LaneStatus } from '../types'

export type Run = (argv: readonly string[], cwd: string) => Promise<{ exitCode: number; stdout: string }>
type Check = { status?: string; conclusion?: string; state?: string }
type Post = { phase: string; body: string; at: number }
type Comment = { body: string; createdAt: string; authorAssociation?: string }

const FAILED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const POST_PREFIX = /^\s*\[(W\d+)\s*[·•-]\s*([^\]]+)\]\s*(.*)$/
const CLOUD_SESSION = /^https:\/\/claude\.ai\/code\//
const WORKER_POST = /\bgh issue comment\s+(\d+)[\s\S]*?\[(W\d+)\s*[·•-]/
const BOARD_WRITE = /\bgh issue (create|edit)\b[\s\S]*\|\s*worker\s*\|/i

export function safeJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export function clean(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
}

export function summarizeChecks(checks: readonly Check[] | null | undefined): CiState {
  if (!checks || checks.length === 0) return 'none'
  if (checks.some(c => FAILED.has(c.conclusion || c.state || ''))) return 'fail'
  const isRunning = (c: Check) => (c.status !== undefined && c.status !== 'COMPLETED') || ['PENDING', 'EXPECTED'].includes(c.state ?? '')
  return checks.some(isRunning) ? 'pending' : 'pass'
}

export function parsePrUrl(text: string): { repo: string; num: number; url: string } | undefined {
  const m = text.match(/https:\/\/github\.com\/[^/\s]+\/([^/\s]+)\/pull\/(\d+)/)
  return m ? { repo: m[1] as string, num: Number(m[2]), url: m[0] } : undefined
}

export function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

export function repoTag(name: string): string {
  if (/backend/i.test(name)) return 'be'
  if (/frontend/i.test(name)) return 'fe'
  return name
}

export function repoForName(repos: readonly string[], name: string): string | undefined {
  return repos.find(r => baseName(r) === name) ?? (repos.length === 1 ? repos[0] : undefined)
}

export async function discoverRepos(run: Run, cwd: string): Promise<string[]> {
  const top = await run(['git', 'rev-parse', '--show-toplevel'], cwd)
  if (top.exitCode === 0 && top.stdout.trim() !== '') return [top.stdout.trim()]
  const found = await run(['find', cwd, '-mindepth', '2', '-maxdepth', '2', '-name', '.git'], cwd)
  return found.stdout.split('\n').filter(Boolean).map(p => p.replace(/\/\.git$/, '')).sort()
}

export async function baseCi(run: Run, repo: string, base: string, workflow: string): Promise<CiState> {
  const res = await run(['gh', 'run', 'list', '--branch', base, '--workflow', workflow, '--limit', '1', '--json', 'status,conclusion'], repo)
  const [latest] = (res.exitCode === 0 ? safeJson<{ status: string; conclusion: string }[]>(res.stdout) : undefined) ?? []
  if (!latest) return 'none'
  if (latest.status !== 'completed') return 'pending'
  if (latest.conclusion === 'success') return 'pass'
  return ['failure', 'cancelled', 'timed_out', 'startup_failure'].includes(latest.conclusion) ? 'fail' : 'none'
}

export type PrDetails = { title: string; state: 'OPEN' | 'MERGED' | 'CLOSED'; url: string; ci: CiState; head: string; base: string }
type PrJson = { title: string; state: PrDetails['state']; url: string; headRefName: string; baseRefName: string; statusCheckRollup?: Check[] }

export async function prDetails(run: Run, repo: string, ref: number | string): Promise<PrDetails | undefined> {
  const res = await run(['gh', 'pr', 'view', String(ref), '--json', 'title,state,url,headRefName,baseRefName,statusCheckRollup'], repo)
  const p = res.exitCode === 0 ? safeJson<PrJson>(res.stdout) : undefined
  return p ? { title: p.title, state: p.state, url: p.url, head: p.headRefName, base: p.baseRefName, ci: summarizeChecks(p.statusCheckRollup) } : undefined
}

export async function behindBy(run: Run, repo: string, head: string, base: string): Promise<number> {
  const res = await run(['gh', 'api', `repos/{owner}/{repo}/compare/${encodeURIComponent(head)}...${encodeURIComponent(base)}?per_page=1`, '--jq', '.ahead_by'], repo)
  return res.exitCode === 0 ? Number(res.stdout.trim()) || 0 : 0
}

export function parseLink(cell: string): { name: string; url?: string } {
  const m = cell.match(/\[([^\]]+)\]\(([^)]+)\)/)
  return m ? { name: clean(m[1] as string), url: m[2] } : { name: clean(cell) }
}

function session(link: { name: string; url?: string }) {
  const isCloud = CLOUD_SESSION.test(link.url ?? '')
  return { name: link.name, url: isCloud ? link.url : undefined, isCloud }
}

export function parseWorkerMap(body: string): { columns: string[]; rows: string[][] } | undefined {
  const lines = body.split('\n').map(l => l.trim())
  const start = lines.findIndex(l => l.startsWith('|') && /\|\s*worker\s*\|/i.test(l))
  if (start < 0) return undefined
  const cells = (line: string) => line.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  const rows: string[][] = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    rows.push(cells(line))
  }
  return { columns: cells(lines[start] as string), rows }
}

export function latestPosts(comments: readonly Comment[]): Map<string, Post> {
  const posts = new Map<string, Post>()
  for (const c of comments) {
    if (c.authorAssociation && !TRUSTED.has(c.authorAssociation)) continue
    const m = (c.body.split('\n')[0] ?? '').match(POST_PREFIX)
    if (m) posts.set(m[1] as string, { phase: clean(m[3] ?? ''), body: c.body, at: Date.parse(c.createdAt) })
  }
  return posts
}

export function prNumFrom(text: string): number | undefined {
  const m = text.match(/\/pull\/(\d+)/) ?? text.match(/\bPR\s*(?:open\s*)?(?:→\s*)?#(\d+)/i) ?? text.match(/→\s*#(\d+)/)
  return m ? Number(m[1]) : undefined
}

export function laneStatus(post: Post | undefined): { status: LaneStatus; text: string; question?: string } {
  if (!post) return { status: 'idle', text: 'No posts yet' }
  const phase = post.phase.toLowerCase()
  const body = post.body.toLowerCase()
  const asked = post.body.split('\n').find(l => l.trim().endsWith('?'))
  const question = asked ? clean(asked).slice(0, 200) : undefined
  if (/\bblocked\b|\bquestion\b/.test(phase)) return { status: 'blocked', text: 'Blocked · waiting on you', question }
  if (/\bmerged\b/.test(phase)) return { status: 'merged', text: 'Merged' }
  if (/\bpaused\b/.test(phase)) return { status: 'paused', text: 'Paused' }
  if (/not gate-ready|not installed/.test(body)) return { status: 'not-ready', text: 'Not gate-ready' }
  if (prNumFrom(post.body) !== undefined) return { status: 'pr', text: 'PR open' }
  return { status: 'working', text: post.phase || 'Working' }
}

function laneFrom(row: string[], columns: string[], posts: Map<string, Post>): Lane {
  const worker = clean((row[0] ?? '').replace(/[*`]/g, ''))
  const sessionCol = columns.findIndex(c => /session/i.test(c))
  const link = sessionCol >= 0 ? parseLink(row[sessionCol] ?? '') : undefined
  const post = posts.get(worker)
  const status = laneStatus(post)
  return {
    worker,
    cells: row.map(c => parseLink(c).name),
    session: link && link.name !== '' ? session(link) : undefined,
    status: status.status,
    statusText: status.text,
    question: status.question,
    lastPostAt: post?.at,
  }
}

type IssueJson = { title: string; url: string; body: string; comments: Comment[] }

export async function fetchBoard(run: Run, repoPath: string, num: number, now: number): Promise<Board | undefined> {
  const res = await run(['gh', 'issue', 'view', String(num), '--json', 'title,url,body,comments'], repoPath)
  const issue = res.exitCode === 0 ? safeJson<IssueJson>(res.stdout) : undefined
  const map = issue ? parseWorkerMap(issue.body) : undefined
  if (!issue || !map) return undefined
  const posts = latestPosts(issue.comments)
  const lanes = map.rows.map(row => laneFrom(row, map.columns, posts))
  await Promise.all(lanes.map(lane => attachPr(run, repoPath, lane, posts.get(lane.worker))))
  const orchLine = issue.body.split('\n').find(l => /^\s*\**orchestrator\**\s*:/i.test(l))
  return {
    repo: baseName(repoPath), num, url: issue.url, title: clean(issue.title), columns: map.columns, lanes, fetchedAt: now,
    orchestrator: orchLine ? session(parseLink(orchLine.replace(/^[^:]*:/, ''))) : undefined,
  }
}

async function attachPr(run: Run, repoPath: string, lane: Lane, post: Post | undefined): Promise<void> {
  const num = post ? prNumFrom(post.body.split('\n').slice(0, 3).join('\n')) : undefined
  if (num === undefined) return
  const pr = await prDetails(run, repoPath, num)
  if (!pr) return
  lane.pr = { num, ci: pr.ci, url: `${pr.url}/files`, isMerged: pr.state === 'MERGED' }
  if (pr.state === 'MERGED') Object.assign(lane, { status: 'merged', statusText: 'Merged' })
  else if (lane.status === 'working' || lane.status === 'idle') Object.assign(lane, { status: 'pr', statusText: pr.ci === 'fail' ? 'PR open · CI failing' : 'PR open' })
}

function boardRepo(repos: readonly string[], tag?: string): string | undefined {
  return repos.find(r => repoTag(baseName(r)) === (tag ?? 'be')) ?? repos[0]
}

export function boardFromCommand(command: string, stdout: string, repos: readonly string[]): BoardRef | undefined {
  const repoPath = boardRepo(repos)
  if (!repoPath) return undefined
  const post = command.match(WORKER_POST)
  if (post) return { repoPath, num: Number(post[1]), role: 'worker', worker: post[2] }
  const write = command.match(BOARD_WRITE)
  if (!write) return undefined
  const num = write[1] === 'create' ? Number(stdout.match(/\/issues\/(\d+)/)?.[1]) : Number(command.match(/gh issue edit\s+(\d+)/)?.[1])
  return num ? { repoPath, num, role: 'orchestrator' } : undefined
}

export function boardFromArgs(args: readonly string[], repos: readonly string[]): BoardRef | undefined {
  const num = Number(args[1])
  const repoPath = boardRepo(repos, args.find(a => a === 'be' || a === 'fe'))
  if (!num || !repoPath) return undefined
  const worker = args.find(a => /^W\d+$/i.test(a))?.toUpperCase()
  return { repoPath, num, role: worker ? 'worker' : 'orchestrator', worker }
}
