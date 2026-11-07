import type { Alert, Board, Lane, PlanItem, SessionPr, Tone, UiState, UsageMeter, View } from '../types'
import { ago, planSummary, until, type Macro } from './model'
import { alertSvg, boardSvg, planSvg, prsSvg, statusSvg, usageSvg, type Stat } from './svg'

export type El = { Box: any; Text: any; Button: any; Link?: any; Svg?: any; Input?: any }
export type Handlers = {
  next: () => void
  dismiss: (id: string) => void
  undo: () => void
  act: (alert: Alert) => void
  toggle: (part: 'plan' | 'board') => void
  macro: (m: Macro) => void
  addTask: (text: string) => void
}
type Ctx = { el: El; now: number; view: View; ui: UiState; on: Handlers }

const TONE: Record<Tone, string> = { red: 'error', amber: 'warning', grey: 'inactive', blue: 'suggestion' }
const MUTED = '#9C978D'
const ICON_PATHS: Record<string, string> = {
  folder: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z"/>',
  bot: '<rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 2.5V5M6 9h.01M10 9h.01"/>',
  sessions: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 7l2 1.5L5 10M8.5 10.5H11"/>',
  pr: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V7a2 2 0 0 0-2-2H7.5M9 3.5 7.5 5 9 6.5"/>',
  ci: '<circle cx="8" cy="8" r="5.5"/><path d="M6 6l4 4M10 6l-4 4"/>',
  plan: '<path d="M2.5 4l1 1 2-2M2.5 10l1 1 2-2M7.5 4.5h6M7.5 10.5h6"/>',
  board: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11M10 2.5v11"/>',
  time: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  week: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
  context: '<path d="M8 2.5 14 5.5 8 8.5 2 5.5zM2 8.5l6 3 6-3M2 11l6 3 6-3"/>',
  laptop: '<rect x="3" y="3.5" width="10" height="7" rx="1"/><path d="M1.5 12.5h13"/>',
  cloud: '<path d="M4.5 12.5h7a3 3 0 0 0 .4-5.97A4 4 0 0 0 4.2 7.6a2.5 2.5 0 0 0 .3 4.9z"/>',
  orchestrator: '<circle cx="8" cy="4" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="12.5" cy="12" r="1.8"/><path d="M8 5.8v2.2M8 8 4.5 10.5M8 8l3.5 2.5"/>',
}
const GLYPH: Record<string, string> = { folder: '▸', bot: '◎', sessions: '▣', pr: '⇅', ci: '✗', plan: '☰', board: '▦', time: '◷', week: '▤', context: '≡', laptop: '⌨', cloud: '☁', orchestrator: '⚑' }
const STATUS_LOOK: Record<string, { icon: string; color?: string; dim?: boolean }> = {
  done: { icon: '✓', color: 'success', dim: true },
  now: { icon: '●', color: 'suggestion' },
  paused: { icon: '‖', color: 'warning' },
  todo: { icon: '○', dim: true },
}
const LANE_LOOK: Record<string, { icon: string; color?: string }> = {
  working: { icon: '●', color: 'suggestion' }, blocked: { icon: '■', color: 'error' }, 'not-ready': { icon: '!', color: 'warning' },
  pr: { icon: '◆', color: '#A88BFF' }, merged: { icon: '✓', color: 'success' }, paused: { icon: '‖', color: 'warning' }, idle: { icon: '○' },
}
const CI_MARK: Record<string, { mark: string; color?: string }> = { pass: { mark: '✓', color: 'success' }, fail: { mark: '✗', color: 'error' }, pending: { mark: '◐', color: 'suggestion' }, none: { mark: '' } }

function icon(el: El, name: string, title: string) {
  const { Svg, Text } = el
  if (!Svg) return <Text dimColor>{GLYPH[name] ?? '•'} </Text>
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="${MUTED}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] ?? ''}</svg>`
  return <Svg source={source} alt={title} width={14} height={14} />
}

function stat(el: El, key: string, name: string, title: string, text: string, color?: string) {
  const { Box, Text } = el
  return (
    <Box key={key} gap={1}>
      {icon(el, name, title)}
      <Text color={color} dimColor={!color}>{text}</Text>
    </Box>
  )
}

export function visibleAlerts(view: View, ui: UiState): Alert[] {
  return view.alerts.filter(a => !ui.dismissed.includes(a.id))
}

function alertCard(c: Ctx) {
  const { Box, Text, Button, Link } = c.el
  const live = visibleAlerts(c.view, c.ui)
  if (live.length === 0) {
    if (c.ui.dismissed.length === 0 || c.view.alerts.length === 0) return null
    return (
      <Box gap={1}>
        <Text dimColor>{c.view.alerts.length} alert{c.view.alerts.length === 1 ? '' : 's'} dismissed</Text>
        <Button key="undo" label="Undo" plain onPress={c.on.undo} />
      </Box>
    )
  }
  const idx = c.ui.alertIndex % live.length
  const a = live[idx] as Alert
  const color = TONE[a.tone]
  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} gap={1} flexWrap="wrap" alignItems="center">
      <Text bold color={color}>{a.tag}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Text bold wrap="truncate-end">{a.text}</Text>
        <Text dimColor wrap="truncate-end">{a.meta}</Text>
      </Box>
      {a.action?.url && Link ? <Link key="act" href={a.action.url} text={a.action.label} /> : null}
      {a.action?.prompt ? <Button key="act" label={a.action.label} variant="primary" onPress={() => c.on.act(a)} /> : null}
      <Button key="next" label={`${idx + 1} of ${live.length} ›`} onPress={c.on.next} />
      <Button key="dismiss" label="×" plain onPress={() => c.on.dismiss(a.id)} />
    </Box>
  )
}

function statusLine(c: Ctx) {
  const { Box } = c.el
  const v = c.view
  const items = [stat(c.el, 's-scope', v.role === 'session' ? 'folder' : 'laptop', 'Scope', v.scope.label)]
  if (v.role === 'worker' && v.boardRef) items.push(stat(c.el, 's-lane', 'board', 'Lane on the board', `${v.boardRef.worker ?? 'lane'} · #${v.boardRef.num}`))
  if (v.agents.running > 0) items.push(stat(c.el, 's-agents', 'bot', 'Agents running', String(v.agents.running)))
  items.push(stat(c.el, 's-sessions', 'sessions', 'Sessions open', String(v.peers.length + 1)))
  if (v.prs.length > 0) items.push(stat(c.el, 's-prs', 'pr', 'Open PRs from this session', String(v.prs.length)))
  for (const r of v.repos.filter(r => r.baseCi === 'fail')) items.push(stat(c.el, `s-ci-${r.tag}`, 'ci', `${r.tag} base CI is red`, r.tag, 'error'))
  return (
    <Box gap={2} flexWrap="wrap" paddingX={1}>
      {items}
      {v.role === 'worker' && v.board?.orchestrator ? orchestratorChip(c, v.board) : null}
    </Box>
  )
}

function orchestratorChip(c: Ctx, board: Board) {
  const { Box, Text, Link } = c.el
  const o = board.orchestrator as NonNullable<Board['orchestrator']>
  return (
    <Box key="s-orch" gap={1} marginLeft={1}>
      {icon(c.el, 'orchestrator', 'Orchestrator session')}
      {o.isCloud && o.url && Link ? <Link href={o.url} text={o.name} /> : <Text color="suggestion">{o.name}</Text>}
    </Box>
  )
}

function segments(c: Ctx, colors: readonly (string | undefined)[]) {
  const { Box, Text } = c.el
  return (
    <Box>
      {colors.slice(0, 24).map((color, i) => (
        <Text key={`seg-${i}`} color={color} dimColor={!color}>▮</Text>
      ))}
    </Box>
  )
}

function planRow(c: Ctx, isWaiting: boolean) {
  const { Box, Text, Button, Input } = c.el
  const plan = c.view.plan
  const sum = planSummary(plan)
  const nowItem = plan.find(p => p.status === 'now')
  const nowLook = nowItem && isWaiting ? STATUS_LOOK.paused : nowItem ? STATUS_LOOK.now : STATUS_LOOK.todo
  return (
    <Box borderStyle="round" borderDimColor flexDirection="column" paddingX={1}>
      <Box gap={1} alignItems="center">
        {icon(c.el, 'plan', 'Plan')}
        <Text>{sum.done} / {sum.total}</Text>
        {segments(c, plan.map(p => (p.status === 'done' ? 'success' : p.status === 'now' ? (isWaiting ? 'warning' : 'suggestion') : undefined)))}
        <Text color={nowLook?.color} wrap="truncate-end">{nowLook?.icon} {sum.now ?? 'Plan complete'}</Text>
        <Box flexGrow={1} />
        <Button key="plan-toggle" label={c.ui.planOpen ? '▴' : '▾'} plain onPress={() => c.on.toggle('plan')} />
      </Box>
      {c.ui.planOpen ? planList(c, plan, isWaiting) : null}
      {c.ui.planOpen && Input ? <Input key="add-task" placeholder="Add a task to the plan…" submitLabel="Add to plan" onSubmit={(value: string) => c.on.addTask(value)} /> : null}
    </Box>
  )
}

function planList(c: Ctx, plan: readonly PlanItem[], isWaiting: boolean) {
  const { Box, Text } = c.el
  return (
    <Box flexDirection="column">
      {plan.map(p => {
        const look = (p.status === 'now' && isWaiting ? STATUS_LOOK.paused : STATUS_LOOK[p.status]) ?? STATUS_LOOK.todo
        return (
          <Box key={`plan-${p.id}`} gap={1}>
            <Text color={look?.color}>{look?.icon}</Text>
            <Text dimColor={look?.dim} strikethrough={p.status === 'done'} bold={p.status === 'now'} wrap="truncate-end">{p.status === 'now' ? p.activeText || p.text : p.text}</Text>
            {p.isMine ? <Text color="warning">added by you</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

function boardRow(c: Ctx, board: Board) {
  const { Box, Text, Button, Link } = c.el
  const merged = board.lanes.filter(l => l.status === 'merged').length
  const color = (l: Lane) => LANE_LOOK[l.status]?.color
  return (
    <Box borderStyle="round" borderDimColor flexDirection="column" paddingX={1}>
      <Box gap={1} alignItems="center">
        {icon(c.el, 'board', 'Orchestration board')}
        <Text>{merged} / {board.lanes.length}</Text>
        {segments(c, board.lanes.map(color))}
        {Link ? <Link href={board.url} text={`#${board.num}`} /> : <Text>#{board.num}</Text>}
        <Text dimColor wrap="truncate-end">{board.title}</Text>
        <Box flexGrow={1} />
        <Text dimColor>↻ {ago(c.now - board.fetchedAt)}</Text>
        <Button key="board-toggle" label={c.ui.boardOpen ? '▴' : '▾'} plain onPress={() => c.on.toggle('board')} />
      </Box>
      {c.ui.boardOpen ? laneTable(c, board) : null}
    </Box>
  )
}

function laneTable(c: Ctx, board: Board) {
  const { Box, Text, Link } = c.el
  const extra = board.columns.slice(1).filter(col => !/session/i.test(col))
  return (
    <Box flexDirection="column">
      <Text dimColor>{['WORKER', ...extra.map(x => x.toUpperCase()), 'SESSION', 'STATUS', 'PR · CI', 'LAST'].join('  ·  ')}</Text>
      {board.lanes.map(l => {
        const look = LANE_LOOK[l.status] ?? { icon: '○' }
        const cells = l.cells.slice(1).filter((_, i) => !/session/i.test(board.columns[i + 1] ?? ''))
        const ci = l.pr ? CI_MARK[l.pr.ci] : undefined
        return (
          <Box key={`lane-${l.worker}`} gap={2}>
            <Text bold>{l.worker}</Text>
            {cells.map((cell, i) => <Text key={`cell-${l.worker}-${i}`}>{cell}</Text>)}
            {l.session ? icon(c.el, l.session.isCloud ? 'cloud' : 'laptop', l.session.isCloud ? 'Runs in the cloud' : 'Runs on your laptop') : null}
            {l.session?.isCloud && l.session.url && Link ? <Link href={l.session.url} text={l.session.name} /> : <Text>{l.session?.name ?? '—'}</Text>}
            <Text color={look.color}>{look.icon} {l.statusText}</Text>
            {l.pr && Link ? <Link href={l.pr.url} text={`#${l.pr.num} ${ci?.mark ?? ''}`} /> : <Text dimColor>—</Text>}
            <Text dimColor>{l.lastPostAt ? ago(c.now - l.lastPostAt) : ''}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function meter(c: Ctx, u: UsageMeter) {
  const { Box, Text } = c.el
  const filled = Math.round(Math.min(100, u.pct) / 100 * 6)
  const color = u.pct >= 85 ? 'error' : u.pct >= 70 ? 'warning' : 'suggestion'
  const reset = u.kind === 'time' ? until(u.resetsAt, c.now) : undefined
  const title = u.kind === 'time' ? '5-hour limit' : u.kind === 'week' ? 'Weekly limit' : 'Context used'
  return (
    <Box key={`use-${u.kind}`} gap={1}>
      {icon(c.el, u.kind, title)}
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(6 - filled)}</Text>
      <Text color={u.pct >= 70 ? color : undefined}>{u.pct}%</Text>
      {reset ? <Text dimColor>↻ {reset}</Text> : null}
    </Box>
  )
}

function prList(c: Ctx, prs: readonly SessionPr[]) {
  const { Box, Text, Link } = c.el
  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      <Box gap={1}>
        {icon(c.el, 'pr', 'Open PRs')}
        <Text bold>Open PRs</Text>
        <Text dimColor>· this session</Text>
      </Box>
      {prs.map(p => {
        const ci = CI_MARK[p.ci] ?? { mark: '' }
        const label = `${p.tag} #${p.num} ${p.title}`
        return (
          <Box key={`pr-${p.tag}-${p.num}`} gap={1}>
            {Link ? <Link href={p.url} text={label} /> : <Text>{label}</Text>}
            <Text color={ci.color}>{ci.mark}</Text>
            <Text dimColor>{ago(c.now - p.createdAt)}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function bottomRow(c: Ctx, macros: readonly Macro[]) {
  const { Box, Button } = c.el
  const showPrs = c.view.role !== 'orchestrator' && c.view.prs.length > 0
  return (
    <Box gap={2} flexWrap="wrap" alignItems="flex-start">
      <Box gap={1} flexWrap="wrap" flexGrow={1} flexShrink={1}>
        {macros.map(m => (
          <Button key={`macro-${m.key || m.label}`} hotkey={m.key || undefined} label={m.skills.length > 0 ? `${m.label} +${m.skills.length}` : m.label} onPress={() => c.on.macro(m)} />
        ))}
      </Box>
      <Box flexDirection="column" gap={1} alignItems="flex-end">
        <Box gap={2}>{c.view.usage.map(u => meter(c, u))}</Box>
        {showPrs ? prList(c, c.view.prs) : null}
      </Box>
    </Box>
  )
}

function statusItems(v: View): Stat[] {
  const items: Stat[] = [{ icon: v.role === 'session' ? 'folder' : 'laptop', text: v.scope.label, tone: 'strong' }]
  if (v.role === 'worker' && v.boardRef) items.push({ icon: 'board', text: `${v.boardRef.worker ?? 'lane'} · #${v.boardRef.num}` })
  if (v.agents.running > 0) items.push({ icon: 'bot', text: String(v.agents.running) })
  items.push({ icon: 'sessions', text: String(v.peers.length + 1) })
  if (v.prs.length > 0) items.push({ icon: 'pr', text: String(v.prs.length) })
  for (const r of v.repos.filter(r => r.baseCi === 'fail')) items.push({ icon: 'ci', text: r.tag, tone: 'red' })
  return items
}

function desktopAlert(c: Ctx, w: number) {
  const { Box, Text, Button, Link, Svg } = c.el
  const live = visibleAlerts(c.view, c.ui)
  if (live.length === 0) {
    if (c.ui.dismissed.length === 0) return null
    return (
      <Box gap={1}>
        <Text dimColor>{c.ui.dismissed.length} dismissed</Text>
        <Button key="undo" label="Undo" plain onPress={c.on.undo} />
      </Box>
    )
  }
  const idx = c.ui.alertIndex % live.length
  const a = live[idx] as Alert
  return (
    <Box gap={1} alignItems="center" flexWrap="wrap">
      <Svg source={alertSvg(a, Math.max(320, w - 270))} alt={`${a.tag}: ${a.text}. ${a.meta}`} />
      <Box gap={1} alignItems="center">
        {a.action?.url && Link ? <Link key="act" href={a.action.url} text={a.action.label} /> : null}
        {a.action?.prompt ? <Button key="act" label={a.action.label} variant="primary" onPress={() => c.on.act(a)} /> : null}
        <Button key="next" label={`${idx + 1} of ${live.length} ›`} onPress={c.on.next} />
        <Button key="dismiss" label="×" plain onPress={() => c.on.dismiss(a.id)} />
      </Box>
    </Box>
  )
}

function desktopWork(c: Ctx, w: number, isWaiting: boolean) {
  const { Box, Button, Link, Input, Svg } = c.el
  const v = c.view
  if (v.role === 'orchestrator' && v.board) {
    const board = v.board
    const links = board.lanes.flatMap(l => [
      ...(l.pr ? [{ key: `lpr-${l.worker}`, href: l.pr.url, text: `${l.worker} PR #${l.pr.num}` }] : []),
      ...(l.session?.url ? [{ key: `lss-${l.worker}`, href: l.session.url, text: l.session.name }] : []),
    ])
    return (
      <Box flexDirection="column" gap={0}>
        <Box gap={1} alignItems="flex-start">
          <Svg source={boardSvg(board, c.ui.boardOpen, c.now, w - 40)} alt={`Board #${board.num}: ${board.lanes.length} lanes`} />
          <Button key="board-toggle" label={c.ui.boardOpen ? '▴' : '▾'} plain onPress={() => c.on.toggle('board')} />
        </Box>
        {c.ui.boardOpen && Link ? <Box gap={2} flexWrap="wrap">{[<Link key="board-link" href={board.url} text={`Open #${board.num}`} />, ...links.map(x => <Link key={x.key} href={x.href} text={x.text} />)]}</Box> : null}
      </Box>
    )
  }
  if (v.plan.length === 0) return null
  return (
    <Box flexDirection="column" gap={0}>
      <Box gap={1} alignItems="flex-start">
        <Svg source={planSvg(v.plan, isWaiting, c.ui.planOpen, w - 40)} alt={`Plan ${planSummary(v.plan).done} of ${v.plan.length}`} />
        <Button key="plan-toggle" label={c.ui.planOpen ? '▴' : '▾'} plain onPress={() => c.on.toggle('plan')} />
      </Box>
      {c.ui.planOpen && Input ? <Input key="add-task" placeholder="Add a task to the plan…" submitLabel="Add to plan" onSubmit={(value: string) => c.on.addTask(value)} /> : null}
    </Box>
  )
}

function desktopBottom(c: Ctx, macros: readonly Macro[]) {
  const { Box, Button, Link, Svg } = c.el
  const showPrs = c.view.role !== 'orchestrator' && c.view.prs.length > 0
  return (
    <Box gap={2} flexWrap="wrap" alignItems="flex-start">
      <Box gap={1} flexWrap="wrap" flexGrow={1} flexShrink={1}>
        {macros.map(m => (
          <Button key={`macro-${m.key || m.label}`} hotkey={m.key || undefined} label={m.skills.length > 0 ? `${m.label} +${m.skills.length}` : m.label} onPress={() => c.on.macro(m)} />
        ))}
      </Box>
      <Box flexDirection="column" gap={1} alignItems="flex-end">
        {c.view.usage.length > 0 ? <Svg source={usageSvg(c.view.usage, c.now)} alt={c.view.usage.map(u => `${u.kind} ${u.pct}%`).join(', ')} /> : null}
        {showPrs ? <Svg source={prsSvg(c.view.prs, c.now, 380)} alt={`Open PRs: ${c.view.prs.map(p => `${p.tag} #${p.num}`).join(', ')}`} /> : null}
        {showPrs && Link ? <Box gap={2}>{c.view.prs.map(p => <Link key={`pr-${p.tag}-${p.num}`} href={p.url} text={`Review ${p.tag} #${p.num}`} />)}</Box> : null}
      </Box>
    </Box>
  )
}

function drawDesktop(c: Ctx, macros: readonly Macro[], isWaiting: boolean, columns: number) {
  const { Box, Link, Svg, Text } = c.el
  const w = Math.max(520, Math.min(1000, Math.round(columns * 8)))
  const orch = c.view.role === 'worker' ? c.view.board?.orchestrator : undefined
  return (
    <Box flexDirection="column" gap={1}>
      {desktopAlert(c, w)}
      <Box gap={2} alignItems="center">
        <Svg source={statusSvg(statusItems(c.view), w - 220)} alt={`Status: ${c.view.scope.label}`} />
        {orch ? (orch.url && Link ? <Link key="orch" href={orch.url} text={`⚑ ${orch.name}`} /> : <Text color="suggestion">⚑ {orch.name}</Text>) : null}
      </Box>
      {desktopWork(c, w, isWaiting)}
      {desktopBottom(c, macros)}
    </Box>
  )
}

export function drawBand(el: El, now: number, view: View, ui: UiState, macros: readonly Macro[], on: Handlers, isWaiting: boolean, columns = 120, surface = 'terminal') {
  const { Box } = el
  const canSvg = surface === 'desktop' || surface === 'mobile'
  const c: Ctx = { el: canSvg ? el : { ...el, Svg: undefined }, now, view, ui, on }
  if (canSvg) return drawDesktop(c, macros, isWaiting, columns)
  const work = view.role === 'orchestrator' && view.board ? boardRow(c, view.board) : view.plan.length > 0 ? planRow(c, isWaiting) : null
  return (
    <Box flexDirection="column" gap={0}>
      {alertCard(c)}
      {statusLine(c)}
      {work}
      {bottomRow(c, macros)}
    </Box>
  )
}
