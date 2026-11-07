# Mission Control

A Claude Code mod that draws a live strip above the prompt: an alert ticker, a status
line, your plan or orchestration board, macro buttons, usage meters, and this session's
open PRs. It polls local git worktrees, GitHub PRs and CI, and running agents.

## Install

```
/plugin install mission-control --marketplace rkadiwal/mission-control
```

This repository is a private marketplace, so installers must have access to it on GitHub
and `gh` (or git over HTTPS) set up on their own machine.

## Commands

- `/mc` — show or hide the strip
- `/mc board <issue#> [be|fe] [W<n>]` — watch a GitHub issue board as orchestrator, or as worker `W<n>`
- `/mc board off` — stop watching a board

## Configuration

Set these in the plugin's settings after install:

| Setting | Default | Meaning |
| --- | --- | --- |
| `baseBranch` | `development` | branch your PRs target; "behind" and base CI are measured against it |
| `ciWorkflow` | `CI` | GitHub Actions workflow whose result counts as base CI |
| `pollSeconds` | `60` | how often PRs, base CI and the board are checked (min 30) |
| `quietMinutes` | `8` | a running agent silent this long raises an alert |
| `macros` | built-in seven | JSON list of `{key,label,prompt,skills[]}`; empty uses the defaults |

## Notes

- Requires the `gh` CLI and `git`. The strip stays hidden until there is data to show;
  usage meters appear after the session's first response.
- It renders on local sessions. Cloud sessions do not run local mods — follow them from a
  local session with `/mc board`.

## Develop

```
claude plugin validate mission-control
claude plugin test mission-control
```
