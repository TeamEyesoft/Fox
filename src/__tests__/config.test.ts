import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// loadConfig reads the filesystem, so we write real temp files per test.

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "fox-test-"));
  delete process.env.GITLAB_TOKEN;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true });
  delete process.env.FOX_CONFIG;
  delete process.env.GITLAB_TOKEN;
});

function writeConfig(obj: unknown): string {
  const path = join(tmpDir, "fox.config.json");
  writeFileSync(path, JSON.stringify(obj));
  process.env.FOX_CONFIG = path;
  return path;
}

async function loadConfig() {
  // Re-import fresh each time to avoid module cache issues
  const mod = await import("../config?t=" + Date.now());
  return mod.loadConfig();
}

describe("loadConfig", () => {
  it("throws when the config file is missing", async () => {
    process.env.FOX_CONFIG = join(tmpDir, "missing.json");
    await expect(loadConfig()).rejects.toThrow("Failed to load config");
  });

  it("throws when gitlab token is missing", async () => {
    writeConfig({ projects: [{ id: 1 }], gitlab: {} });
    await expect(loadConfig()).rejects.toThrow("GitLab token is required");
  });

  it("throws when projects array is empty", async () => {
    writeConfig({ projects: [], gitlab: { token: "tok" } });
    await expect(loadConfig()).rejects.toThrow("No projects configured");
  });

  it("throws when a project has no id", async () => {
    writeConfig({ projects: [{}], gitlab: { token: "tok" } });
    await expect(loadConfig()).rejects.toThrow('must have a non-empty "id"');
  });

  it("reads GITLAB_TOKEN from env over config file", async () => {
    writeConfig({
      projects: [{ id: 1 }],
      gitlab: { token: "config-token" },
    });
    process.env.GITLAB_TOKEN = "env-token";
    const cfg = await loadConfig();
    expect(cfg.gitlab.token).toBe("env-token");
  });

  it("normalizes trailing slashes from baseUrl", async () => {
    writeConfig({
      projects: [{ id: 1 }],
      gitlab: { token: "tok", baseUrl: "https://gitlab.example.com/" },
      registry: { baseUrl: "http://localhost:3000/" },
    });
    const cfg = await loadConfig();
    expect(cfg.gitlab.baseUrl).toBe("https://gitlab.example.com");
    expect(cfg.registry.baseUrl).toBe("http://localhost:3000");
  });

  it("applies defaults for optional fields", async () => {
    writeConfig({ projects: [{ id: 42 }], gitlab: { token: "tok" } });
    const cfg = await loadConfig();
    expect(cfg.port).toBe(3000);
    expect(cfg.registry.ttlSeconds).toBe(60);
    expect(cfg.registry.fetchTimeoutMs).toBe(10_000);
    expect(cfg.registry.maxCacheSize).toBe(1000);
    expect(cfg.gitlab.baseUrl).toBe("https://gitlab.com");
  });
});
