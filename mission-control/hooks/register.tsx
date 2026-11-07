import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { UiState, View } from '../types'
import { drawBand, type El, type Handlers } from './band'
import { boardFromArgs, boardFromCommand, parsePrUrl, repoForName } from './github'
import { macroText, openTasks, ORCHESTRATOR_MACROS, parseMacros, planAddTask, planFromTodos, planUpdateTask } from './model'
import { createPoller, type Poller, type Saved } from './poller'

const EMPTY_VIEW: View = { at: 0, scope: { label: '', repos: [] }, role: 'session', plan: [], prs: [], usage: [], peers: [], repos: [], agents: { running: 0, quiet: [] }, alerts: [] }
const EMPTY_UI: UiState = { isHidden: false, planOpen: false, boardOpen: true, dismissed: [], alertIndex: 0 }
const view = atom({ plugin: 'mission-control', key: 'view' } as const, EMPTY_VIEW)
const ui = atom({ plugin: 'mission-control', key: 'ui' } as const, EMPTY_UI)

const GH_CANDIDATES = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']
const REFRESH_AFTER = /\b(git (push|merge|pull)|gh pr (merge|close|ready))(?=\s|$)/
const agentOf = (e: unknown) => (e as { agentId?: string }).agentId

export const register: Register = (on, options) => {
  const config = {
    base: String(options.baseBranch || 'development'),
    ciWorkflow: String(options.ciWorkflow || 'CI'),
    pollMs: Math.max(30, Number(options.pollSeconds) || 60) * 1000,
    quietMinutes: Math.max(1, Number(options.quietMinutes) || 8),
  }
  const macros = parseMacros(String(options.macros ?? ''))
  let poller: Poller | undefined
  let isWaiting = false

  on('session.start', async ($, e, next) => {
    const logged = new Set<string>()
    const exec = async (argv: readonly string[], cwd?: string) => {
      try {
        const { exitCode, stdout } = await $.process.run(argv, { cwd, timeoutMs: 20_000 })
        return { exitCode, stdout }
      } catch {
        return { exitCode: -1, stdout: '' }
      }
    }
    let gh: string | undefined
    const resolveGh = async () => {
      for (const candidate of GH_CANDIDATES) if ((await exec([candidate, '--version'])).exitCode === 0) return candidate
      return 'gh'
    }
    poller = createPoller(
      {
        run: async (argv, cwd) => (argv[0] === 'gh' ? exec([(gh ??= await resolveGh()), ...argv.slice(1)], cwd) : exec(argv, cwd)),
        now: () => $.clock.now(),
        sessionId: () => $.session.id(),
        cwd: await $.session.cwd(),
        home: (await $.env.get('HOME')) ?? '',
        read: path => $.fs.read(path),
        write: (path, text) => $.fs.write(path, text),
        list: async path => (await $.fs.list(path)).map(f => ({ name: f.name, mtimeMs: f.mtimeMs })),
        listAgents: async () => (await $.agent.list()).map(a => ({ id: a.id, description: a.description, type: a.type, status: a.status })),
        usage: () => $.session.usage(),
        load: async id => (await $.store.get(`mission-control:${id}`)) as Saved | undefined,
        save: (id, saved) => $.store.set(`mission-control:${id}`, saved),
        publish: async v => {
          await update($, view, () => v)
          await update($, ui, u => ({ ...u, dismissed: u.dismissed.filter(id => v.alerts.some(a => a.id === id)) }))
        },
        every: (ms, fn) => void $.clock.every(ms, fn),
        after: (ms, fn) => void $.clock.after(ms, fn),
        log: message => {
          if (logged.has(message)) return
          logged.add(message)
          $.ui.log(message)
        },
      },
      config,
    )
    await $.command.register({ name: 'mc', description: 'Mission Control strip: /mc shows or hides it; /mc board <n> [be|fe] [W<n>]; /mc board off' })
    void poller.start().catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await poller?.reset()
    else await poller?.end()
    return next(e)
  })

  on('command.run', { command: 'mc' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/).filter(Boolean)
    if (args[0] !== 'board') {
      await update($, ui, u => ({ ...u, isHidden: !u.isHidden }))
      return { text: 'Mission Control strip toggled.' }
    }
    if (args[1] === 'off') {
      poller?.setBoard(undefined)
      return { text: 'Mission Control: board view off.' }
    }
    const ref = boardFromArgs(args, poller?.repos() ?? [])
    if (!ref) return { text: 'Usage: /mc board <issue number> [be|fe] [W<n> to watch as that worker]' }
    poller?.setBoard(ref)
    return { text: `Mission Control: watching board #${ref.num} as ${ref.role === 'worker' ? ref.worker : 'orchestrator'}.` }
  })

  on('tool.call', async ($, e, next) => {
    const agentId = agentOf(e)
    if (agentId) void poller?.activity(agentId)
    else if (isWaiting) {
      isWaiting = false
      void poller?.setState('working')
    }
    return next(e)
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (poller && !e.agentId && !ran.deny) void poller.setPlan(planFromTodos(e.todos, poller.mine()))
    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task?: { id: string } } | undefined)?.task?.id
    if (poller && !e.agentId && id) void poller.setPlan(planAddTask(poller.plan(), id, e.subject, e.activeForm, poller.mine()))
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (poller && !e.agentId && !ran.deny) void poller.setPlan(planUpdateTask(poller.plan(), e))
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!poller || ran.deny || e.agentId) return ran
    const stdout = (ran.result as { stdout?: string } | undefined)?.stdout ?? ''
    const pr = /\bgh pr create\b/.test(e.command) ? parsePrUrl(stdout) : undefined
    const repo = pr ? repoForName(poller.repos(), pr.repo) : undefined
    if (pr && repo) void poller.trackPr(repo, pr.num, pr.url)
    const ref = boardFromCommand(e.command, stdout, poller.repos())
    const current = poller.boardRef()
    if (ref && (current?.num !== ref.num || current.role !== ref.role)) poller.setBoard(ref)
    else if (REFRESH_AFTER.test(e.command)) poller.nudge()
    return ran
  })

  on('classic.Notification', async ($, e, next) => {
    if (/permission/i.test(`${e.notification_type} ${e.message}`)) {
      isWaiting = true
      await poller?.setState('waiting', e.message)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    isWaiting = false
    void poller?.setState('working')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!agentOf(e) && !isWaiting) void poller?.setState('idle')
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.trigger === 'precompute' || e.agentId || compacted.skip !== undefined) return compacted
    const open = poller ? openTasks(poller.plan()) : []
    if (open.length > 0) {
      const text = `Mission Control: the plan still has ${open.length} open task(s):\n${open.map(t => `- ${t}`).join('\n')}`
      await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    }
    return compacted
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, ui)
    const current = await read($, view)
    if (state.isHidden || e.props.hasSurvey || current.at === 0) return next(e)
    const handlers: Handlers = {
      next: () => void update($, ui, u => ({ ...u, alertIndex: u.alertIndex + 1 })),
      dismiss: id => void update($, ui, u => ({ ...u, dismissed: [...u.dismissed, id], alertIndex: 0 })),
      undo: () => void update($, ui, u => ({ ...u, dismissed: [] })),
      act: alert => void (alert.action?.prompt ? $.prompt.fill({ text: alert.action.prompt, mode: 'replace' }) : undefined),
      toggle: part => void update($, ui, u => (part === 'plan' ? { ...u, planOpen: !u.planOpen } : { ...u, boardOpen: !u.boardOpen })),
      macro: m => void $.prompt.fill({ text: macroText(m), mode: 'replace' }),
      addTask: text => {
        const task = text.trim()
        if (task === '') return
        poller?.addMine(task)
        void $.prompt.submit({ text: `Add this task to the plan: ${task}` })
      },
    }
    const set = current.role === 'orchestrator' ? ORCHESTRATOR_MACROS : macros
    return drawBand($.ui.resolve(e) as El, await $.clock.now(), current, state, set, handlers, isWaiting, e.props.bodyColumns, e.surface)
  })
}
