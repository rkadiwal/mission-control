import type { Alert, Board, PlanItem, SessionPr, Tone, UsageMeter } from '../types'
import { ago, planSummary, until } from './model'

export const C = {
  card: '#1F2127', line: '#343741', soft: '#2A2C33', track: '#383B44',
  text: '#ECEAE5', text2: '#DCD9D2', text3: '#C8C4BB', muted: '#9C978D', muted2: '#A59F95',
  blue: '#7192F5', blueText: '#A3B8FF', teal: '#33B8AA', tealText: '#6AD3C6',
  amber: '#E3A23B', amberText: '#F2B862', orange: '#F07040', orangeText: '#FF9B73', purple: '#A88BFF',
}
const TONES: Record<Tone, { tag: string; bg: string; border: string }> = {
  amber: { tag: '#9A5400', bg: '#2B2214', border: '#5C4421' },
  red: { tag: '#B4380B', bg: '#2D1913', border: '#6B3424' },
  grey: { tag: '#4A4D57', bg: '#22242A', border: '#343741' },
  blue: { tag: '#2E55C9', bg: '#1B2440', border: '#34467A' },
}
const SANS = `-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif`
const MONO = `'SF Mono', Menlo, monospace`

export const ICONS: Record<string, string> = {
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

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)
const width = (s: string, size: number, mono = false) => s.length * size * (mono ? 0.62 : 0.5)
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
type TextOpts = { size?: number; fill?: string; weight?: number; mono?: boolean; strike?: boolean }
function text(x: number, y: number, s: string, o: TextOpts = {}): string {
  const deco = o.strike ? ' text-decoration="line-through"' : ''
  return `<text x="${x}" y="${y}" font-family="${o.mono ? MONO : SANS}" font-size="${o.size ?? 13}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? C.text}"${deco}>${esc(s)}</text>`
}
function icon(name: string, x: number, y: number, color = C.muted): string {
  return `<g transform="translate(${x} ${y}) scale(0.875)" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</g>`
}
function segments(x: number, y: number, total: number, colors: readonly string[], span = 200): string {
  const n = Math.max(1, Math.min(total, 30))
  const seg = (span - 3 * (n - 1)) / n
  return colors.slice(0, n).map((c, i) => `<rect x="${x + i * (seg + 3)}" y="${y}" width="${seg}" height="6" rx="3" fill="${c}"/>`).join('')
}

export function alertSvg(a: Alert, w: number): string {
  const t = TONES[a.tone]
  const tagW = width(a.tag, 11.5, true) + 16
  const chars = Math.floor((w - tagW - 40) / 7.6)
  return svg(w, 56, [
    `<rect x="0.5" y="0.5" width="${w - 1}" height="55" rx="12" fill="${t.bg}" stroke="${t.border}"/>`,
    `<rect x="12" y="16" width="${tagW}" height="22" rx="6" fill="${t.tag}"/>`,
    text(20, 31, a.tag, { size: 11.5, fill: '#FFFFFF', weight: 600, mono: true }),
    text(tagW + 26, 25, fit(a.text, chars), { size: 14.5, weight: 600 }),
    text(tagW + 26, 43, fit(a.meta, Math.floor(chars * 1.1)), { size: 12, fill: C.muted, mono: true }),
  ].join(''))
}

export type Stat = { icon: string; text: string; tone?: 'strong' | 'red' | 'blue' }
export function statusSvg(items: readonly Stat[], w: number): string {
  let x = 4
  const parts = items.map(s => {
    const fill = s.tone === 'red' ? C.orangeText : s.tone === 'strong' ? C.text3 : s.tone === 'blue' ? C.blueText : C.muted2
    const out = icon(s.icon, x, 4, s.tone === 'red' ? C.orangeText : C.muted) + text(x + 20, 16, s.text, { size: 12.5, fill, weight: s.tone === 'strong' ? 600 : 400 })
    x += 20 + width(s.text, 12.5) + 18
    return out
  })
  return svg(w, 22, parts.join(''))
}

const PLAN_LOOK: Record<string, { glyph: string; color: string; textFill: string; strike?: boolean; weight?: number }> = {
  done: { glyph: '✓', color: C.teal, textFill: C.muted, strike: true },
  now: { glyph: '●', color: C.blue, textFill: C.text, weight: 600 },
  paused: { glyph: '‖', color: C.amber, textFill: C.amberText, weight: 600 },
  todo: { glyph: '○', color: '#8F8A80', textFill: C.text2 },
}

export function planSvg(plan: readonly PlanItem[], isWaiting: boolean, isOpen: boolean, w: number): string {
  const sum = planSummary(plan)
  const look = (p: PlanItem) => PLAN_LOOK[p.status === 'now' && isWaiting ? 'paused' : p.status] ?? PLAN_LOOK.todo!
  const nowItem = plan.find(p => p.status === 'now')
  const nowLook = nowItem ? look(nowItem) : PLAN_LOOK.todo!
  const rows = isOpen ? plan.length : 0
  const h = 44 + (rows > 0 ? rows * 24 + 14 : 0)
  const head = [
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.card}" stroke="${C.line}"/>`,
    icon('plan', 14, 14),
    text(38, 27, `${sum.done} / ${sum.total}`, { size: 12.5, mono: true, weight: 500 }),
    segments(92, 19, plan.length, plan.map(p => (p.status === 'done' ? C.teal : p.status === 'now' ? (isWaiting ? C.amber : C.blue) : C.track))),
    text(306, 27, nowLook.glyph, { size: 12, fill: nowLook.color, mono: true }),
    text(322, 27, fit(sum.now ?? 'Plan complete', Math.floor((w - 340) / 7.2)), { size: 13, fill: nowLook.textFill, weight: 600 }),
  ]
  const list = plan.slice(0, rows).map((p, i) => {
    const l = look(p)
    const y = 66 + i * 24
    const label = fit(p.status === 'now' ? p.activeText || p.text : p.text, Math.floor((w - 160) / 7.2))
    const mine = p.isMine ? `<rect x="${44 + width(label, 13) + 10}" y="${y - 13}" width="86" height="18" rx="4" fill="#3A2C14"/>${text(44 + width(label, 13) + 16, y, 'added by you', { size: 11, fill: C.amberText, weight: 600 })}` : ''
    return text(18, y, l.glyph, { size: 12, fill: l.color, mono: true }) + text(44, y, label, { size: 13, fill: l.textFill, weight: l.weight, strike: l.strike }) + mine
  })
  const divider = rows > 0 ? `<line x1="12" y1="44" x2="${w - 12}" y2="44" stroke="${C.soft}"/>` : ''
  return svg(w, h, [...head, divider, ...list].join(''))
}

const LANE: Record<string, { glyph: string; color: string }> = {
  working: { glyph: '●', color: C.blue }, blocked: { glyph: '■', color: C.orangeText }, 'not-ready': { glyph: '!', color: C.amberText },
  pr: { glyph: '◆', color: C.purple }, merged: { glyph: '✓', color: C.teal }, paused: { glyph: '‖', color: C.amberText }, idle: { glyph: '○', color: C.muted },
}
const CI: Record<string, { mark: string; color: string }> = { pass: { mark: '✓', color: C.tealText }, fail: { mark: '✗', color: C.orangeText }, pending: { mark: '◐', color: C.blueText }, none: { mark: '', color: C.muted } }

export function boardSvg(board: Board, isOpen: boolean, now: number, w: number): string {
  const merged = board.lanes.filter(l => l.status === 'merged').length
  const extra = board.columns.slice(1).map((c, i) => ({ c, i: i + 1 })).filter(x => !/session/i.test(x.c)).slice(0, 2)
  const rows = isOpen ? board.lanes.length : 0
  const h = 44 + (rows > 0 ? 30 + rows * 26 + 8 : 0)
  const head = [
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.card}" stroke="${C.line}"/>`,
    icon('board', 14, 14),
    text(38, 27, `${merged} / ${board.lanes.length}`, { size: 12.5, mono: true, weight: 500 }),
    segments(92, 19, board.lanes.length, board.lanes.map(l => LANE[l.status]?.color ?? C.track)),
    text(306, 27, `#${board.num}`, { size: 12.5, fill: C.blueText, mono: true }),
    text(356, 27, fit(board.title, Math.floor((w - 460) / 7)), { size: 13, fill: C.muted }),
    text(w - 70, 27, `↻ ${ago(now - board.fetchedAt)}`, { size: 11.5, fill: C.muted, mono: true }),
  ]
  if (rows === 0) return svg(w, h, head.join(''))
  const cols = { worker: 16, extra: 70, session: 70 + extra.length * 92, status: 70 + extra.length * 92 + 170, pr: w - 130, last: w - 40 }
  const header = [
    text(cols.worker, 64, 'WORKER', { size: 10.5, fill: C.muted, weight: 700 }),
    ...extra.map((x, k) => text(cols.extra + k * 92, 64, x.c.toUpperCase(), { size: 10.5, fill: C.muted, weight: 700 })),
    text(cols.session, 64, 'SESSION', { size: 10.5, fill: C.muted, weight: 700 }),
    text(cols.status, 64, 'STATUS', { size: 10.5, fill: C.blueText, weight: 700 }),
    text(cols.pr, 64, 'PR · CI', { size: 10.5, fill: C.blueText, weight: 700 }),
  ]
  const lanes = board.lanes.map((l, i) => {
    const y = 94 + i * 26
    const look = LANE[l.status] ?? LANE.idle!
    const ci = l.pr ? CI[l.pr.ci] ?? CI.none! : undefined
    return [
      `<line x1="12" y1="${y - 18}" x2="${w - 12}" y2="${y - 18}" stroke="#262830"/>`,
      `<rect x="${cols.worker - 4}" y="${y - 14}" width="32" height="19" rx="4" fill="${C.soft}"/>`,
      text(cols.worker, y, l.worker, { size: 12, mono: true }),
      ...extra.map((x, k) => text(cols.extra + k * 92, y, fit(l.cells[x.i] ?? '', 12), { size: 13, weight: k === 0 ? 600 : 400, mono: k > 0 })),
      l.session ? icon(l.session.isCloud ? 'cloud' : 'laptop', cols.session, y - 12, l.session.isCloud ? C.blueText : C.text3) + text(cols.session + 20, y, fit(l.session.name, 20), { size: 12, mono: true }) : text(cols.session, y, '—', { fill: C.muted }),
      text(cols.status, y, look.glyph, { size: 12, fill: look.color, mono: true }),
      text(cols.status + 18, y, fit(l.statusText, Math.floor((cols.pr - cols.status - 34) / 7)), { size: 13, fill: l.status === 'blocked' || l.status === 'not-ready' ? look.color : C.text2, weight: l.status === 'blocked' ? 600 : 400 }),
      l.pr ? text(cols.pr, y, `#${l.pr.num} ${ci?.mark ?? ''}`, { size: 12, fill: ci?.color, mono: true }) : text(cols.pr, y, '—', { fill: C.muted }),
      text(cols.last, y, l.lastPostAt ? ago(now - l.lastPostAt) : '', { size: 12, fill: C.muted, mono: true }),
    ].join('')
  })
  return svg(w, h, [...head, `<line x1="12" y1="44" x2="${w - 12}" y2="44" stroke="${C.soft}"/>`, ...header, ...lanes].join(''))
}

export function usageSvg(meters: readonly UsageMeter[], now: number): string {
  let x = 0
  const parts = meters.map(u => {
    const bar = u.pct >= 85 ? C.orange : u.pct >= 70 ? C.amber : C.blue
    const tone = u.pct >= 85 ? C.orangeText : u.pct >= 70 ? C.amberText : C.text3
    const reset = u.kind === 'time' ? until(u.resetsAt, now) : undefined
    const out = [
      icon(u.kind, x, 4),
      `<rect x="${x + 20}" y="9" width="52" height="4" rx="2" fill="${C.track}"/>`,
      `<rect x="${x + 20}" y="9" width="${Math.round(Math.min(100, u.pct) * 0.52)}" height="4" rx="2" fill="${bar}"/>`,
      text(x + 78, 15, `${u.pct}%`, { size: 12, fill: tone, mono: true }),
      reset ? text(x + 112, 15, `↻ ${reset}`, { size: 11, fill: C.muted, mono: true }) : '',
    ].join('')
    x += reset ? 190 : 124
    return out
  })
  return svg(Math.max(1, x), 22, parts.join(''))
}

export function prsSvg(prs: readonly SessionPr[], now: number, w: number): string {
  const h = 34 + prs.length * 22
  const rows = prs.map((p, i) => {
    const y = 50 + i * 22
    const ci = CI[p.ci] ?? CI.none!
    return [
      icon('pr', 10, y - 12, C.teal),
      text(30, y, p.tag, { size: 10.5, fill: C.muted, mono: true }),
      text(52, y, `#${p.num}`, { size: 12, fill: C.text3, mono: true }),
      text(100, y, fit(p.title, Math.floor((w - 170) / 7)), { size: 12.5, fill: C.text2 }),
      text(w - 56, y, ci.mark, { size: 12, fill: ci.color, mono: true }),
      text(w - 36, y, ago(now - p.createdAt), { size: 11, fill: C.muted, mono: true }),
    ].join('')
  })
  return svg(w, h, [
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${C.card}" stroke="${C.line}"/>`,
    icon('pr', 10, 9),
    text(30, 21, 'Open PRs', { size: 12, fill: C.text3, weight: 600 }),
    text(w - 86, 21, 'this session', { size: 11, fill: C.muted, mono: true }),
    ...rows,
  ].join(''))
}
