import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionAccount, sessionAccountEmail, sessionConfigDir } from "../src/accounts";

let home: string;

/** A fake accounts home: registry file plus managed profile dirs. */
function accountsHome(profiles: { name: string; tool: string; email?: string; dir?: string }[]) {
  const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
  const entries = profiles.map((p) => {
    const dir = p.dir ?? join(root, "profiles", p.tool, p.name);
    mkdirSync(dir, { recursive: true });
    return { ...p, dir };
  });
  writeFileSync(join(root, "accounts.json"), JSON.stringify({ version: 1, profiles: entries }));
  return { root, entries };
}

function env(root: string, configDir: string) {
  return { ACCOUNTS_HOME: root, CLAUDE_CONFIG_DIR: configDir };
}

/** Write the agent's own account record into a config dir. */
function login(configDir: string, emailAddress: string) {
  writeFileSync(join(configDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress } }));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "statusline-home-"));
});

describe("sessionConfigDir", () => {
  test("uses CLAUDE_CONFIG_DIR when set", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-cfg-"));
    expect(sessionConfigDir({ CLAUDE_CONFIG_DIR: dir })).toBe(sessionConfigDir({ CLAUDE_CONFIG_DIR: dir }));
    expect(sessionConfigDir({ CLAUDE_CONFIG_DIR: dir })).toContain("statusline-cfg-");
  });

  test("falls back to the default config dir when unset", () => {
    expect(sessionConfigDir({})).toContain(".claude");
  });

  test("ignores a blank CLAUDE_CONFIG_DIR", () => {
    expect(sessionConfigDir({ CLAUDE_CONFIG_DIR: "   " })).toContain(".claude");
  });
});

describe("sessionAccount", () => {
  test("resolves the profile owning this session from the registry", () => {
    const { root, entries } = accountsHome([
      { name: "account001", tool: "claude", email: "one@example.com" },
      { name: "account088", tool: "claude", email: "two@example.com" },
    ]);
    const account = sessionAccount(env(root, entries[1]!.dir));
    expect(account.profile).toBe("account088");
    expect(account.tool).toBe("claude");
    expect(account.source).toBe("registry");
  });

  test("two config dirs resolve to their own profiles, not a shared pointer", () => {
    const { root, entries } = accountsHome([
      { name: "account001", tool: "claude" },
      { name: "account088", tool: "claude" },
    ]);
    const first = sessionAccount(env(root, entries[0]!.dir));
    const second = sessionAccount(env(root, entries[1]!.dir));
    expect(first.profile).toBe("account001");
    expect(second.profile).toBe("account088");
  });

  test("falls back to the managed layout when the registry has no entry", () => {
    const { root } = accountsHome([{ name: "account001", tool: "claude" }]);
    const unregistered = join(root, "profiles", "claude", "account042");
    mkdirSync(unregistered, { recursive: true });
    const account = sessionAccount(env(root, unregistered));
    expect(account.profile).toBe("account042");
    expect(account.tool).toBe("claude");
    expect(account.source).toBe("layout");
  });

  test("does not name a profile for a config dir that does not exist", () => {
    const { root } = accountsHome([{ name: "account001", tool: "claude" }]);
    const ghost = join(root, "profiles", "claude", "never-created");
    const account = sessionAccount(env(root, ghost));
    expect(account.profile).toBeNull();
    expect(account.source).toBeNull();
  });

  test("does not guess for a dir outside the managed layout", () => {
    const { root } = accountsHome([{ name: "account001", tool: "claude" }]);
    const outside = mkdtempSync(join(tmpdir(), "statusline-outside-"));
    const account = sessionAccount(env(root, outside));
    expect(account.profile).toBeNull();
    expect(account.source).toBeNull();
  });

  test("matches a registry entry reached through a symlink", () => {
    const { root, entries } = accountsHome([{ name: "account001", tool: "claude" }]);
    const link = join(mkdtempSync(join(tmpdir(), "statusline-link-")), "live");
    symlinkSync(entries[0]!.dir, link);
    expect(sessionAccount(env(root, link)).profile).toBe("account001");
  });

  test("resolves a registry entry with a home-relative dir", () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    const dir = join(home, "custom-profile");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(root, "accounts.json"),
      JSON.stringify({ profiles: [{ name: "imported", tool: "claude", dir: "~/custom-profile" }] }),
    );
    expect(sessionAccount({ ...env(root, dir), HOME: home }).profile).toBe("imported");
  });

  test("degrades to unresolved when the registry is missing", () => {
    const missing = join(tmpdir(), `statusline-absent-${Date.now()}`);
    const account = sessionAccount({ ACCOUNTS_HOME: missing, CLAUDE_CONFIG_DIR: home });
    expect(account.profile).toBeNull();
    expect(account.configDir).toContain("statusline-home-");
  });

  test("degrades to unresolved when the registry is corrupt", () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    writeFileSync(join(root, "accounts.json"), "{not json");
    expect(sessionAccount(env(root, home)).profile).toBeNull();
  });

  test("ignores registry entries missing a name or dir", () => {
    const root = mkdtempSync(join(tmpdir(), "statusline-accounts-"));
    writeFileSync(
      join(root, "accounts.json"),
      JSON.stringify({ profiles: [{ tool: "claude", dir: home }, { name: "nodir", tool: "claude" }] }),
    );
    expect(sessionAccount(env(root, home)).profile).toBeNull();
  });
});

describe("sessionAccountEmail", () => {
  test("prefers the agent's own record over the registry copy", () => {
    const { root, entries } = accountsHome([{ name: "account006", tool: "claude", email: "stale@example.com" }]);
    login(entries[0]!.dir, "live@example.com");
    expect(sessionAccountEmail(env(root, entries[0]!.dir))).toBe("live@example.com");
  });

  test("falls back to the registry when the agent has no record", () => {
    const { root, entries } = accountsHome([{ name: "account006", tool: "claude", email: "registry@example.com" }]);
    expect(sessionAccountEmail(env(root, entries[0]!.dir))).toBe("registry@example.com");
  });

  test("null when neither source knows", () => {
    const { root } = accountsHome([{ name: "account006", tool: "claude" }]);
    expect(sessionAccountEmail(env(root, home))).toBeNull();
  });

  test("null when the agent record is corrupt", () => {
    const { root, entries } = accountsHome([{ name: "account006", tool: "claude" }]);
    writeFileSync(join(entries[0]!.dir, ".claude.json"), "{broken");
    expect(sessionAccountEmail(env(root, entries[0]!.dir))).toBeNull();
  });
});
