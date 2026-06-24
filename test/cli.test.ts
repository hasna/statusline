import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { segments } from "../src/segments";

function run(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "statusline-cli-"));
  const proc = Bun.spawnSync(["bun", "src/index.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      STATUSLINE_CONFIG: join(dir, "config.json"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("cli list", () => {
  test("default output is compact and capped", () => {
    const out = run(["list"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(`Segments: ${defaultConfig().segments.length} enabled / ${segments.length} total`);
    expect(out.stdout).toContain(`showing ${Math.min(12, segments.length)} of ${segments.length}`);
    expect(out.stdout).not.toContain("Machine hostname (short)");
    expect(out.stdout).toContain("cost");
    expect(out.stdout).not.toContain("used-tokens");
    expect(out.stdout).toContain("statusline show <id>");
  });

  test("verbose output includes descriptions", () => {
    const out = run(["list", "--verbose"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(`showing ${Math.min(12, segments.length)} of ${segments.length}`);
    expect(out.stdout).toContain("description");
    expect(out.stdout).toContain("Machine hostname (short)");
  });

  test("explicit limit is honored with verbose output", () => {
    const out = run(["list", "--verbose", "--limit", "3"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("showing 3 of");
    expect(out.stdout).toContain("commit-age");
    expect(out.stdout).not.toContain("loc");
  });

  test("json output returns full structured data by default", () => {
    const out = run(["list", "--json"]);
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.total).toBe(segments.length);
    expect(parsed.showing).toBe(segments.length);
    expect(parsed.segments[0]).toEqual({
      id: "machine",
      description: "Machine hostname (short)",
      enabled: true,
      defaultEnabled: true,
    });
  });

  test("limit and search reduce human rows", () => {
    const out = run(["list", "--search", "percentage", "--limit", "2"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("showing 2 of");
    expect(out.stdout).toContain("context-used");
    expect(out.stdout).toContain("context-remaining");
    expect(out.stdout).not.toContain("used-tokens");
  });

  test("search alias forwards list flags", () => {
    const out = run(["search", "token", "--json"]);
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.matching).toBe(1);
    expect(parsed.segments[0].id).toBe("used-tokens");
  });

  test("list help exposes disclosure options", () => {
    const out = run(["list", "--help"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("--limit <n>");
    expect(out.stdout).toContain("--enabled");
    expect(out.stdout).toContain("--disabled");
  });

  test("search requires a non-flag value", () => {
    const out = run(["list", "--search", "--json"]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("missing value for --search");
  });
});

describe("cli show", () => {
  test("shows one segment in detail", () => {
    const out = run(["show", "model-context"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("Segment: model-context");
    expect(out.stdout).toContain("State: enabled");
    expect(out.stdout).toContain("Description: Model name with context-size tag");
  });

  test("supports json detail output", () => {
    const out = run(["inspect", "used-tokens", "--json"]);
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed).toEqual({
      id: "used-tokens",
      description: "Total tokens in the context window (omitted when unknown)",
      enabled: false,
      defaultEnabled: false,
    });
  });
});
