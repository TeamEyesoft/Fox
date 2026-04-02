import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProjectConfig {
  /** GitLab project ID (number) or path with namespace (e.g. "mygroup/myproject") */
  id: number | string;
  /** Override the package name; otherwise read from the project's root package.json */
  nameOverride?: string;
}

export interface FoxConfig {
  gitlab: {
    /** GitLab instance base URL, e.g. "https://gitlab.com" */
    baseUrl: string;
    /** Personal access token or deploy token (can also be set via GITLAB_TOKEN env) */
    token: string;
  };
  registry: {
    /** Public base URL of this server (used to build tarball URLs) */
    baseUrl: string;
    /** How long to cache GitLab API responses, in seconds (default: 60) */
    ttlSeconds: number;
    /** Timeout for outbound GitLab API requests, in ms (default: 10000) */
    fetchTimeoutMs: number;
    /** Maximum number of entries in the in-memory cache (default: 1000) */
    maxCacheSize: number;
  };
  projects: ProjectConfig[];
  port: number;
}

export function loadConfig(): FoxConfig {
  const configPath =
    process.env.FOX_CONFIG ?? join(process.cwd(), "fox.config.json");

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Failed to load config from ${configPath}: ${(err as Error).message}`,
    );
  }

  const gitlabRaw = raw.gitlab as Record<string, unknown> | undefined;
  const registryRaw = raw.registry as Record<string, unknown> | undefined;

  const token =
    process.env.GITLAB_TOKEN ??
    (typeof gitlabRaw?.token === "string" ? gitlabRaw.token : "");

  if (!token) {
    throw new Error(
      "GitLab token is required. Set gitlab.token in the config file or GITLAB_TOKEN env var.",
    );
  }

  const projects = Array.isArray(raw.projects)
    ? (raw.projects as ProjectConfig[])
    : [];

  if (projects.length === 0) {
    throw new Error(
      "No projects configured. Add at least one entry to the projects array in the config file.",
    );
  }

  for (const proj of projects) {
    if (proj.id === undefined || proj.id === null || proj.id === "") {
      throw new Error(
        `Invalid project entry: each project must have a non-empty "id" field.`,
      );
    }
  }

  const rawBaseUrl =
    typeof registryRaw?.baseUrl === "string"
      ? registryRaw.baseUrl
      : "http://localhost:3000";

  return {
    gitlab: {
      baseUrl:
        typeof gitlabRaw?.baseUrl === "string"
          ? gitlabRaw.baseUrl.replace(/\/$/, "")
          : "https://gitlab.com",
      token,
    },
    registry: {
      baseUrl: rawBaseUrl.replace(/\/$/, ""),
      ttlSeconds:
        typeof registryRaw?.ttlSeconds === "number"
          ? registryRaw.ttlSeconds
          : 60,
      fetchTimeoutMs:
        typeof registryRaw?.fetchTimeoutMs === "number"
          ? registryRaw.fetchTimeoutMs
          : 10_000,
      maxCacheSize:
        typeof registryRaw?.maxCacheSize === "number"
          ? registryRaw.maxCacheSize
          : 1000,
    },
    projects,
    port: typeof raw.port === "number" ? raw.port : 3000,
  };
}
