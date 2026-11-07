# Mission Control — build plan

Design source: canvas "Mission Control prototypes", artboards `Strip-TickerPlus` (session / worker)
and `Strip-Orchestrator` (orchestrator / worker). Dark theme, icons, one shared layout:
alert card → status line → plan|board row → macros + usage (+ Open PRs) → prompt.

## Surface
- An `AbovePrompt` band (not a pane). `/mc` toggles it; `/mc board <n>` / `/mc board off` override board detection.
- Desktop: `Svg` icons. Terminal: glyph fallback (no `Svg` there).

## Phase 1 — this session
| Part | Source |
|---|---|
| Plan row (done/now/paused/todo, add-to-plan) | `tool.call` hooks on `TodoWrite`, `TaskCreate`, `TaskUpdate`; kept in `$.state` + `$.store` so it survives `/compact`; reminds Claude of open tasks after compaction |
| Add to plan | `$.prompt.submit("Add to the plan: …")` — Claude stays the source of truth |
| Macros 1–7 | Buttons with hotkeys; fill the prompt; skills prepended as "Use the X skill(s)."; list in `userConfig` |
| Usage meters | `$.session.usage()` → `rateLimits` (5h, 7d) + context %; amber ≥70, orange ≥85 |
| Open PRs (this session, ≤4, hidden if none) | `gh pr create` captured in `tool.call`; state/CI polled with `gh pr view` |
| Alerts (ticker, Next, ×, Undo) | CI red on base / own PRs, PR behind base, agent quiet > N min (`agent.list` + last tool call per agent), usage ≥85% (dismiss until 95% or reset) |
| Status line | scope (repo or parent folder be + fe), agents, sessions, open PRs, failing tests, CI |

## Phase 2 — all local sessions
- Each session writes `~/.claude/mission-control/sessions/<sessionId>.json`:
  `{ name, cwd, branch, state: working|waiting|idle, waitingFor?, plan: {done,total,now}, updatedAt }`
  (`waiting` from `classic.Notification` / `classic.PermissionRequest`).
- Every strip reads the folder every 5 s → "session X is waiting on you" alerts + session count.

## Phase 3 — orchestrator / worker
- Board = GitHub issue with a worker-map table. Orchestrator = session that created/edited it;
  worker = session posting `[W<n> · module]` comments; override with `/mc board <n>`.
- Board row: lanes from the worker map (dynamic columns) + live Status, PR·CI (link to `/files`), Last.
- Poll every 60 s (configurable); refresh after this session's `gh`/`git` commands.
- Worker view: own plan + lane chip + orchestrator button.
- Protocol lines for the orchestrator prompt: add `Session` (name + link) to the worker map;
  one status comment per worker, edited after each step.

## Decisions (2026-10-06)
- Build all three phases in one go.
- Load in this session only (hot reload); install for every session later.
- Local session names are display-only; only cloud sessions link out.

## Known limits
- A mod cannot switch the desktop app to another local session: local names are display-only;
  cloud sessions open on claude.ai/code.
- Cloud sessions don't run local mods — watch them through the board.
- Usage figures appear after the session's first API response.

## Tests (`claude plugin test`)
Parsers (worktree, PR, board table, worker comments), alert rules, plan reducer, usage colours,
macro prompt building; UI mounts on `terminal` and `desktop` for each band state.
