#!/usr/bin/env bun
import { defaultConfig, loadConfig, saveConfig, configPath } from "./config";
import { parseClaudeInput } from "./providers/claude";
import { renderLine } from "./render";
import { segments, getSegment } from "./segments";
import { installClaude } from "./install";
import pkg from "../package.json";

const [, , command = "render", ...args] = process.argv;
const DEFAULT_LIST_LIMIT = 12;

interface SegmentInfo {
  id: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
}

interface ListOptions {
  all: boolean;
  disabledOnly: boolean;
  enabledOnly: boolean;
  json: boolean;
  limit: number | null;
  query: string | null;
  verbose: boolean;
}

async function readStdinJson(): Promise<Record<string, any>> {
  try {
    const text = await Bun.stdin.text();
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function requireKnown(ids: string[]): string[] {
  const unknown = ids.filter((id) => !getSegment(id));
  if (unknown.length) {
    console.error(`unknown segment(s): ${unknown.join(", ")}\nrun \`statusline list --all\` to see available segments`);
    process.exit(1);
  }
  return ids;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function printListHelp(): never {
  console.log(`usage: statusline list [options] [search text]

options:
  --all              show all matching rows
  --enabled          show only enabled segments
  --disabled         show only disabled segments
  --json, -j         output structured JSON
  --limit <n>        cap rows
  --search, -s <q>   filter by id or description
  --verbose          include descriptions
  --help, -h         show this help`);
  process.exit(0);
}

function printSearchHelp(): never {
  console.log(`usage: statusline search <text> [options]

options:
  --all              show all matching rows
  --enabled          show only enabled segments
  --disabled         show only disabled segments
  --json, -j         output structured JSON
  --limit <n>        cap rows
  --verbose          include descriptions
  --help, -h         show this help`);
  process.exit(0);
}

function printShowHelp(): never {
  console.log(`usage: statusline show <segment> [options]

options:
  --json, -j         output structured JSON
  --help, -h         show this help`);
  process.exit(0);
}

function readFlagValue(raw: string[], index: number, flag: string): string {
  const value = raw[index + 1];
  if (!value || value.startsWith("-")) fail(`missing value for ${flag}`);
  return value;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) fail(`missing value for ${flag}`);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(`${flag} must be a positive integer`);
  return n;
}

function parseListArgs(raw: string[]): ListOptions {
  const opts: ListOptions = {
    all: false,
    disabledOnly: false,
    enabledOnly: false,
    json: false,
    limit: null,
    query: null,
    verbose: false,
  };
  const queryParts: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    switch (arg) {
      case "--all":
        opts.all = true;
        break;
      case "--disabled":
        opts.disabledOnly = true;
        break;
      case "--enabled":
        opts.enabledOnly = true;
        break;
      case "--json":
      case "-j":
        opts.json = true;
        break;
      case "--limit":
        opts.limit = parsePositiveInt(readFlagValue(raw, i, "--limit"), "--limit");
        i++;
        break;
      case "--search":
      case "-s":
        queryParts.push(readFlagValue(raw, i, arg));
        i++;
        break;
      case "--verbose":
        opts.verbose = true;
        break;
      case "--help":
      case "-h":
        printListHelp();
      default:
        if (arg.startsWith("-")) fail(`unknown option for list: ${arg}`);
        queryParts.push(arg);
    }
  }

  if (opts.enabledOnly && opts.disabledOnly) fail("use only one of --enabled or --disabled");
  if (opts.all && opts.limit !== null) fail("use only one of --all or --limit");
  opts.query = queryParts.length ? queryParts.join(" ").toLowerCase() : null;
  return opts;
}

function parseShowArgs(raw: string[]): { id: string | null; json: boolean } {
  let id: string | null = null;
  let json = false;
  for (const arg of raw) {
    if (arg === "--json" || arg === "-j") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      printShowHelp();
    } else if (arg.startsWith("-")) {
      fail(`unknown option for show: ${arg}`);
    } else if (!id) {
      id = arg;
    } else {
      fail("usage: statusline show <segment> [--json]");
    }
  }
  return { id, json };
}

function searchArgsForList(raw: string[]): string[] {
  const queryParts: string[] = [];
  const forwarded: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    switch (arg) {
      case "--all":
      case "--disabled":
      case "--enabled":
      case "--json":
      case "-j":
      case "--verbose":
        forwarded.push(arg);
        break;
      case "--help":
      case "-h":
        printSearchHelp();
      case "--limit":
        forwarded.push(arg, readFlagValue(raw, i, "--limit"));
        i++;
        break;
      default:
        if (arg.startsWith("-")) fail(`unknown option for search: ${arg}`);
        queryParts.push(arg);
    }
  }
  if (!queryParts.length) fail("usage: statusline search <text> [--json] [--verbose] [--limit N]");
  return ["--search", queryParts.join(" "), ...forwarded];
}

function segmentInfos(): SegmentInfo[] {
  const enabled = new Set(loadConfig().segments);
  return segments.map((s) => ({
    id: s.id,
    description: s.description,
    enabled: enabled.has(s.id),
    defaultEnabled: s.defaultEnabled,
  }));
}

function filteredSegments(opts: ListOptions): SegmentInfo[] {
  return segmentInfos().filter((s) => {
    if (opts.enabledOnly && !s.enabled) return false;
    if (opts.disabledOnly && s.enabled) return false;
    if (!opts.query) return true;
    return `${s.id} ${s.description}`.toLowerCase().includes(opts.query);
  });
}

function prioritizeEnabled(rows: SegmentInfo[]): SegmentInfo[] {
  return rows
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => Number(b.segment.enabled) - Number(a.segment.enabled) || a.index - b.index)
    .map((entry) => entry.segment);
}

function truncate(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}...` : value;
}

function printList(raw: string[]): void {
  const opts = parseListArgs(raw);
  const allRows = filteredSegments(opts);
  const displayRows = opts.json ? allRows : prioritizeEnabled(allRows);
  const showAll = opts.all || (opts.limit === null && opts.json);
  const limit = opts.limit ?? (showAll ? allRows.length : DEFAULT_LIST_LIMIT);
  const rows = displayRows.slice(0, limit);
  const enabledCount = segmentInfos().filter((s) => s.enabled).length;
  const limited = rows.length < allRows.length;

  if (opts.json) {
    console.log(JSON.stringify({
      total: segments.length,
      matching: allRows.length,
      showing: rows.length,
      limited,
      segments: rows,
      next: limited ? { all: true, limit: allRows.length } : null,
    }, null, 2));
    return;
  }

  const filterLabel = opts.query ? `, query "${opts.query}"` : "";
  console.log(`Segments: ${enabledCount} enabled / ${segments.length} total (showing ${rows.length} of ${allRows.length}${filterLabel})`);
  if (!rows.length) {
    console.log("No matching segments.");
    console.log("Try `statusline list --all` or `statusline list --search <text>`.");
    return;
  }

  const idWidth = Math.max(2, ...rows.map((s) => s.id.length));
  if (opts.verbose) {
    console.log(`state  default  ${"id".padEnd(idWidth)}  description`);
    for (const s of rows) {
      const state = s.enabled ? "on " : "off";
      const def = s.defaultEnabled ? "yes" : "no ";
      console.log(`${state.padEnd(5)}  ${def.padEnd(7)}  ${s.id.padEnd(idWidth)}  ${truncate(s.description, 72)}`);
    }
  } else {
    console.log(`state  default  ${"id".padEnd(idWidth)}`);
    for (const s of rows) {
      const state = s.enabled ? "on " : "off";
      const def = s.defaultEnabled ? "yes" : "no ";
      console.log(`${state.padEnd(5)}  ${def.padEnd(7)}  ${s.id.padEnd(idWidth)}`);
    }
  }

  const hints = ["`statusline show <id>` for details", "`--verbose` for descriptions", "`--json` for machines"];
  if (limited) hints.unshift("`--all` for all matching rows");
  console.log(`Hint: use ${hints.join(", ")}.`);
}

function printShow(raw: string[]): void {
  const { id, json } = parseShowArgs(raw);
  if (!id) fail("usage: statusline show <segment> [--json]");
  const info = segmentInfos().find((s) => s.id === id);
  if (!info) {
    console.error(`unknown segment: ${id}`);
    console.error("run `statusline list --all` to see available segments");
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log(`Segment: ${info.id}`);
  console.log(`State: ${info.enabled ? "enabled" : "disabled"}`);
  console.log(`Default: ${info.defaultEnabled ? "enabled" : "disabled"}`);
  console.log(`Description: ${info.description}`);
  console.log(`Commands: statusline ${info.enabled ? "disable" : "enable"} ${info.id} | statusline list --search ${info.id}`);
}

switch (command) {
  case "render": {
    const input = await readStdinJson();
    console.log(await renderLine(parseClaudeInput(input), loadConfig()));
    break;
  }

  case "list": {
    printList(args);
    break;
  }

  case "search": {
    printList(searchArgsForList(args));
    break;
  }

  case "show":
  case "inspect": {
    printShow(args);
    break;
  }

  case "enable": {
    const ids = requireKnown(args);
    const cfg = loadConfig();
    for (const id of ids) if (!cfg.segments.includes(id)) cfg.segments.push(id);
    saveConfig(cfg);
    console.log(`enabled: ${ids.join(", ")}\norder: ${cfg.segments.join(", ")}`);
    break;
  }

  case "disable": {
    const ids = requireKnown(args);
    const cfg = loadConfig();
    cfg.segments = cfg.segments.filter((id) => !ids.includes(id));
    saveConfig(cfg);
    console.log(`disabled: ${ids.join(", ")}\norder: ${cfg.segments.join(", ") || "(none)"}`);
    break;
  }

  case "order": {
    const ids = requireKnown(args);
    if (!ids.length) {
      console.error("usage: statusline order <segment> [segment...]");
      process.exit(1);
    }
    const cfg = loadConfig();
    cfg.segments = ids;
    saveConfig(cfg);
    console.log(`order: ${cfg.segments.join(", ")}`);
    break;
  }

  case "separator": {
    if (!args.length) {
      console.error('usage: statusline separator " · "');
      process.exit(1);
    }
    const cfg = loadConfig();
    cfg.separator = args.join(" ");
    saveConfig(cfg);
    console.log(`separator: "${cfg.separator}"`);
    break;
  }

  case "reset": {
    saveConfig(defaultConfig());
    console.log(`reset to defaults (${configPath()})`);
    break;
  }

  case "preview": {
    const sample = {
      cwd: process.cwd(),
      model: { id: "claude-fable-5[1m]", display_name: "Fable" },
      cost: { total_cost_usd: 12.34, total_duration_ms: 5400000, total_lines_added: 42, total_lines_removed: 7 },
      version: pkg.version,
      session_id: "preview0-0000-0000-0000-000000000000",
    };
    console.log(await renderLine(parseClaudeInput(sample), loadConfig()));
    break;
  }

  case "install": {
    const target = args[0] || "claude";
    if (target !== "claude") {
      console.error(`unsupported target "${target}" — only "claude" is supported today (OpenCode has no statusline hook yet)`);
      process.exit(1);
    }
    const path = installClaude();
    console.log(`installed into ${path} — Claude Code picks it up on the next status refresh`);
    break;
  }

  case "--version":
  case "-v":
  case "version": {
    console.log(pkg.version);
    break;
  }

  default: {
    console.log(`statusline ${pkg.version} — composable statusline for AI coding agents

usage:
  statusline render              read agent JSON on stdin, print the statusline (default)
  statusline list                compact segment list (default limit: ${DEFAULT_LIST_LIMIT})
  statusline list --verbose      include descriptions
  statusline list --all          show all rows
  statusline list --json         machine-readable segment list
  statusline list --limit N      cap rows explicitly
  statusline list --enabled      show only enabled segments
  statusline list --disabled     show only disabled segments
  statusline list --search text  filter by id or description
  statusline search <text>       alias for list --search
  statusline show <id>           show one segment in detail
  statusline show <id> --json    machine-readable segment detail
  statusline inspect <id>        alias for show
  statusline enable <id...>      enable segments (appended to the end)
  statusline disable <id...>     disable segments
  statusline order <id...>       set the exact segment order (also defines enabled set)
  statusline separator <str>     set the separator (default " · ")
  statusline preview             render with a sample payload from the current directory
  statusline reset               restore default config
  statusline install [claude]    wire into Claude Code (~/.claude/settings.json)
  statusline version             print version

config: ${configPath()}`);
    if (command !== "help" && command !== "--help" && command !== "-h") process.exit(1);
  }
}
