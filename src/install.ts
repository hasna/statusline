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
  const configDir = env.CLAUDE_CONFIG_DIR?.trim() || join(env.HOME || homedir(), ".claude");
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
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    copyFileSync(settingsPath, `${settingsPath}.bak-statusline`);
  }
  settings.statusLine = { type: "command", command: `${binary} render` };
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return settingsPath;
}
