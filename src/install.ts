import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Settings file the running agent actually reads. When a session is bound to
 * an isolated config dir (multi-account setups export `CLAUDE_CONFIG_DIR`),
 * `~/.claude/settings.json` is never loaded — installing there wires up a
 * statusline that silently never runs.
 */
export function claudeSettingsPath(env: Record<string, string | undefined> = process.env): string {
  const home = env.HOME || homedir();
  const raw = env.CLAUDE_CONFIG_DIR?.trim();
  const configDir = raw ? (raw === "~" || raw.startsWith("~/") ? join(home, raw.slice(1)) : raw) : join(home, ".claude");
  return join(configDir, "settings.json");
}

/**
 * Wire the statusline into Claude Code's user settings. Existing settings
 * are preserved; the previous file is backed up alongside it.
 */
export function installClaude(settingsPath = claudeSettingsPath()): string {
  const binary = Bun.which("statusline") || "statusline";
  let settings: Record<string, any> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (error) {
      throw new Error(`${settingsPath} is not valid JSON — fix or move it first`);
    }
    copyFileSync(settingsPath, `${settingsPath}.bak-statusline`);
  }
  // keep any other keys the host understands on the statusLine (padding, …)
  settings.statusLine = { ...settings.statusLine, type: "command", command: `${binary} render` };
  const configDir = dirname(settingsPath);
  if (!existsSync(configDir)) {
    // Creating the dir is right for a first install into the default location,
    // but an isolated config dir is created by whoever owns the profile. If it
    // is missing we are pointed somewhere wrong — writing would fabricate a
    // profile tree (and, driven from a registry listing, other machines' paths).
    if (process.env.CLAUDE_CONFIG_DIR?.trim()) {
      throw new Error(`config dir ${configDir} does not exist — create the profile first`);
    }
    mkdirSync(configDir, { recursive: true });
  }
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return settingsPath;
}
