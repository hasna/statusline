# statusline

Tiny, composable statusline CLI for AI coding agents. Pre-built segments you toggle
on and off — machine name, project + branch, model, context remaining, session cost,
and more — rendered as a single line for your agent's status bar.

```
apple03 · statusline (main) · 12h · 1.2k · fable 5 [1m] · 90% left · $0.04
```

Zero runtime dependencies. Built with [Bun](https://bun.sh) + TypeScript. Apache-2.0.

## Install

```bash
bun install -g @hasna/statusline
statusline install claude        # wires it into ~/.claude/settings.json
```

That's it — Claude Code picks it up on the next status refresh (no restart needed).

## Segments

`statusline list` is compact by default so it stays friendly in agent terminals:

```
Segments: 7 enabled / 18 total (showing 12 of 18)
state  default  id
on     yes      machine
on     yes      project
on     yes      commit-age
on     yes      loc
on     yes      model-context
on     yes      context-remaining
on     yes      cost
off    no       project-name
off    no       git-branch
off    no       current-dir
off    no       model
off    no       context-used
Hint: use `--all` for all matching rows, `statusline show <id>` for details, `--verbose` for descriptions, `--json` for machines.
```

Use gradual disclosure when you need more:

```bash
statusline list --verbose             # include descriptions, still capped
statusline list --all --verbose       # include every row with descriptions
statusline list --all                 # show every segment row
statusline list --limit 5             # cap rows explicitly
statusline list --enabled             # only enabled segments
statusline list --disabled            # only disabled segments
statusline list --search token        # filter by id or description
statusline list --json                # structured output for tooling
statusline show model-context         # full details for one segment
statusline inspect used-tokens --json # JSON detail path
```

`statusline list --json` returns `{ total, matching, showing, limited, segments, next }`.
Each segment has `{ id, description, enabled, defaultEnabled }`; `next` is `null`
unless the result is limited.

## Usage

```bash
statusline list                          # compact segment summary
statusline enable used-tokens duration    # turn segments on (appended at the end)
statusline disable loc                    # turn segments off
statusline order machine project model-context cost   # exact order = enabled set
statusline separator " | "                # change the separator
statusline preview                        # render a sample line from the current dir
statusline reset                          # back to defaults
```

Config lives at `~/.config/statusline/config.json` (override with `$STATUSLINE_CONFIG`):

```json
{
  "separator": " · ",
  "segments": ["machine", "project", "commit-age", "loc", "model-context", "context-remaining", "cost"]
}
```

## How it works

Claude Code pipes a JSON payload (cwd, model, session cost, transcript path, …) to the
configured `statusLine` command on every status refresh. `statusline render` parses it,
renders each enabled segment, drops anything unavailable, and prints one line. Segments
that need more than the payload offers (e.g. `context-remaining`) read the session
transcript to compute it. A segment failure is never fatal — it's simply omitted.

## Providers

| Agent | Status |
|-------|--------|
| Claude Code | ✅ `statusline install claude` |
| OpenCode | ⏳ no statusline/footer hook in its config as of v1.3.x — the renderer is provider-agnostic (`src/providers/`), so an adapter slots in the moment one exists |
| Codex CLI | Codex ships its own built-in segment picker; no external command hook |

Adding a provider means one small parser: agent payload → `StatusContext`
(`src/providers/types.ts`). PRs welcome.

## Development

```bash
bun install
bun test
echo '{"cwd":"'$PWD'","model":{"id":"claude-fable-5[1m]"}}' | bun src/index.ts render
```

## License

[Apache-2.0](LICENSE)
