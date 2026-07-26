import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Which account is *this* session running as?
 *
 * The host agent's statusline payload carries no account or profile field, so
 * the answer has to come from the process environment. Tools that manage
 * several logins (`@hasna/accounts`, and Claude Code itself) isolate each
 * login in its own config dir and point the child process at it via
 * `CLAUDE_CONFIG_DIR`. That variable is per-process, so it is the only signal
 * that stays correct when several sessions run under different accounts at the
 * same time.
 *
 * Deliberately NOT used: any "active"/"current"/"applied" profile pointer.
 * Those are global — every concurrent session would report whichever profile
 * was switched to last, which is the staleness this module exists to avoid.
 */
export interface SessionAccount {
  /** Config dir this session is running against (canonicalized). */
  configDir: string;
  /** Managed profile name owning that dir, when it can be resolved. */
  profile: string | null;
  /** Tool id the profile belongs to (e.g. "claude"), when known. */
  tool: string | null;
  /** How `profile` was resolved — surfaced for diagnostics, not for display. */
  source: "registry" | "layout" | null;
}

/** Env var Claude Code uses to point a process at an isolated config dir. */
const CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";
/** Config dir the agent uses when it was not pointed at an isolated one. */
const DEFAULT_CONFIG_SUBDIR = ".claude";

/**
 * `@hasna/accounts` state layout. Both env vars are that package's own
 * documented overrides, and the paths below are its defaults, so relocating
 * accounts state relocates this lookup with it. We read the registry file
 * rather than shelling out to the CLI: against a cloud-backed registry the CLI
 * costs ~1.4s, which a statusline cannot spend on every render.
 */
const STORE_PATH_ENV = "ACCOUNTS_STORE_PATH";
const ACCOUNTS_HOME_ENV = "ACCOUNTS_HOME";
const DEFAULT_ACCOUNTS_HOME = [".hasna", "accounts"];
const STORE_FILE = "accounts.json";
const PROFILES_SUBDIR = "profiles";

/** File the host agent keeps its own account record in, inside the config dir. */
const AGENT_STATE_FILE = ".claude.json";

type Env = Record<string, string | undefined>;

interface RegistryEntry {
  name?: unknown;
  tool?: unknown;
  email?: unknown;
  dir?: unknown;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** `$HOME` wins over the passwd entry, as it does for every other path here. */
function home(env: Env): string {
  return str(env.HOME) ?? homedir();
}

function expandHome(path: string, env: Env): string {
  return path === "~" || path.startsWith(`~${sep}`) ? join(home(env), path.slice(1)) : path;
}

/**
 * Resolve to a comparable absolute path. Symlinks are followed when the path
 * exists, so a config dir and a registry entry that differ only by a symlink
 * still match; a path that does not exist is just normalized.
 */
function canonical(path: string, env: Env): string {
  const abs = resolve(expandHome(path, env));
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function accountsHome(env: Env): string {
  return str(env[ACCOUNTS_HOME_ENV]) ?? join(home(env), ...DEFAULT_ACCOUNTS_HOME);
}

function storePath(env: Env): string {
  return str(env[STORE_PATH_ENV]) ?? join(accountsHome(env), STORE_FILE);
}

/** The registry entry recorded for this config dir, if the registry has one. */
function registryEntry(env: Env, configDir: string): RegistryEntry | null {
  const store = storePath(env);
  if (!existsSync(store)) return null;
  const entries = readJson(store)?.profiles;
  if (!Array.isArray(entries)) return null;
  for (const entry of entries as RegistryEntry[]) {
    const dir = str(entry?.dir);
    if (dir && canonical(dir, env) === configDir) return entry;
  }
  return null;
}

/**
 * Layout fallback. Managed profile dirs are created as
 * `<accountsHome>/profiles/<tool>/<name>`, so a dir sitting exactly two levels
 * under the profiles root names its own tool and profile. This covers dirs the
 * local registry has no entry for — the registry may be a partial view of a
 * shared store, while the dir the process was handed is always real. Dirs
 * outside that root (an imported or hand-pointed config dir) yield null rather
 * than a guess.
 */
function layoutProfile(env: Env, configDir: string): SessionAccount | null {
  const prefix = canonical(join(accountsHome(env), PROFILES_SUBDIR), env) + sep;
  if (!configDir.startsWith(prefix)) return null;
  const parts = configDir.slice(prefix.length).split(sep);
  if (parts.length !== 2) return null;
  const [tool, profile] = parts;
  if (!tool || !profile) return null;
  return { configDir, profile, tool, source: "layout" };
}

/** Config dir the current process is bound to. */
export function sessionConfigDir(env: Env = process.env): string {
  return canonical(str(env[CONFIG_DIR_ENV]) ?? join(home(env), DEFAULT_CONFIG_SUBDIR), env);
}

/** Resolve the profile owning this session. Never throws. */
export function sessionAccount(env: Env = process.env): SessionAccount {
  const configDir = sessionConfigDir(env);
  const unresolved: SessionAccount = { configDir, profile: null, tool: null, source: null };
  try {
    const entry = registryEntry(env, configDir);
    const name = str(entry?.name);
    if (name) return { configDir, profile: name, tool: str(entry?.tool), source: "registry" };
    return layoutProfile(env, configDir) ?? unresolved;
  } catch {
    return unresolved;
  }
}

/**
 * Email this session is logged in as. The host agent's own record for this
 * config dir wins over the registry's copy, which can lag behind a re-login.
 * Read separately from `sessionAccount` because it parses the agent's state
 * blob, which is large enough to only touch when a segment asks for it.
 */
export function sessionAccountEmail(
  env: Env = process.env,
  configDir = sessionConfigDir(env),
): string | null {
  try {
    const live = str(readJson(join(configDir, AGENT_STATE_FILE))?.oauthAccount?.emailAddress);
    return live ?? str(registryEntry(env, configDir)?.email);
  } catch {
    return null;
  }
}
