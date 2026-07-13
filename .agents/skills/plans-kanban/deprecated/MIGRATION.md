# plans-kanban Migration

`plans-kanban` no longer runs a standalone server.

## What changed

- Old behavior: `plans-kanban` started its own HTTP server, renderer, assets bundle, and PID-managed background process.
- New behavior: `plans-kanban` is a thin launcher for the ClaudeKit CLI dashboard at `http://localhost:3456/plans`.

## Current workflow

```bash
node .agents/skills/plans-kanban/scripts/open-dashboard.cjs
```

If the dashboard is not already running, the launcher starts:

```bash
claudekit config ui --port 3456 --no-open
```

## Legacy flag mapping

| Legacy usage | Replacement |
|-------------|-------------|
| `--dir ./plans` | No replacement needed. Dashboard auto-discovers plans. |
| `--plans ./plans` | No replacement needed. |
| `--port 3500` | Use the integrated dashboard default: `3456`. |
| `--host 0.0.0.0` | Run `claudekit config ui --host 0.0.0.0` directly. |
| `--background` | Launcher starts the dashboard in a detached process when needed. |
| `--foreground` | Run `ck config ui --port 3456` directly. |
| `--stop` | Stops the launcher-managed dashboard process; otherwise stop the manual `claudekit config ui` terminal. |

## Related CLI commands

```bash
claudekit config ui
claudekit config ui --host 0.0.0.0
claudekit plan create --title "Example" --phases "Research,Implement,Test"
claudekit plan check 1 --start --dir /abs/path/to/plan-dir
claudekit plan check 1 --dir /abs/path/to/plan-dir
claudekit plan uncheck 1 --dir /abs/path/to/plan-dir
```
