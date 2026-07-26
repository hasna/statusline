# Changelog

All notable changes to `@hasna/statusline` are documented here.

## Unreleased

- Add `auth-profile` and `auth-email` segments that report the account **this
  session** runs as, resolved from the process's own `CLAUDE_CONFIG_DIR` rather
  than any global active-profile pointer, so concurrent sessions under different
  accounts each render their own.
- Add `model-with-reasoning`, `five-hour-limit`, and `thread-title` segments, and
  parse `effort.level`, `thinking.enabled`, `rate_limits.*`, and `session_name`
  from the Claude Code payload.
- Fix `statusline install claude` writing to `~/.claude/settings.json` even when
  the session is bound to an isolated `CLAUDE_CONFIG_DIR` — the installed
  statusline never ran. New `claudeSettingsPath()` export resolves the real target.
- Add optional per-segment colours (`statusline colors on|off`, config `colors`,
  `NO_COLOR` respected); `five-hour-limit` turns red past 80%.

## 0.0.2 - 2026-07-24

- Compact `statusline list` output by default: enabled rows first, row caps,
  totals, and hints to detail paths (#1).
- Add gradual-disclosure paths: `show`/`inspect`, `search`, and the `--verbose`,
  `--json`, `--limit`, `--all`, `--enabled`, `--disabled`, `--search` flags (#1).
- Make the git-branch segment test independent of a hard-coded local path/branch (#1).
- Extend test coverage toward 100% (#4).

## 0.0.1

- Initial release: composable statusline CLI with pre-built toggleable segments,
  provider model, SDK exports, and MCP server.
