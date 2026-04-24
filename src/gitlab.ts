import type { Cache } from "./cache";
import type { FoxConfig } from "./config";
import { logger } from "./logger";
import { repackSourceArchive } from "./repack";
import type { GitLabProject, GitLabRelease, GitLabTag } from "./types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RELEASES_PER_PAGE = 100;
const RETRY_DELAY_MS = 1_000;

export class GitLabClient {
  private headers: Record<string, string>;

  constructor(
    private config: FoxConfig,
    private cache: Cache,
  ) {
    this.headers = config.gitlab.token
      ? { "PRIVATE-TOKEN": config.gitlab.token }
      : {};
  }

  private apiUrl(path: string): string {
    return `${this.config.gitlab.baseUrl}/api/v4${path}`;
  }

  /** Fetch with timeout and one retry on 5xx. */
  private async rawFetch(url: string): Promise<Response> {
    const signal = AbortSignal.timeout(this.config.registry.fetchTimeoutMs);
    const res = await fetch(url, { headers: this.headers, signal });

    if (res.status >= 500) {
      logger.warn("GitLab upstream error, retrying", {
        status: res.status,
        url,
      });
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return fetch(url, {
        headers: this.headers,
        signal: AbortSignal.timeout(this.config.registry.fetchTimeoutMs),
      });
    }

    return res;
  }

  getProject(id: number | string): Promise<GitLabProject> {
    const encoded = encodeURIComponent(String(id));
    return this.cache.getOrSet(`gl:project:${id}`, async () => {
      const res = await this.rawFetch(this.apiUrl(`/projects/${encoded}`));
      if (!res.ok)
        throw new Error(`GitLab API ${res.status} fetching project ${id}`);
      return res.json() as Promise<GitLabProject>;
    });
  }

  getReleases(id: number | string): Promise<GitLabRelease[]> {
    return this.cache.getOrSet(
      `gl:releases:${id}`,
      () => this.fetchAllReleases(id),
      this.config.registry.ttlSeconds * 1000,
    );
  }

  getTags(id: number | string): Promise<GitLabTag[]> {
    return this.cache.getOrSet(
      `gl:tags:${id}`,
      async () => {
        const encoded = encodeURIComponent(String(id));
        const res = await this.rawFetch(
          this.apiUrl(
            `/projects/${encoded}/repository/tags?per_page=100&order_by=version&sort=desc`,
          ),
        );
        if (!res.ok)
          throw new Error(
            `GitLab API ${res.status} fetching tags for project ${id}`,
          );
        return res.json() as Promise<GitLabTag[]>;
      },
      this.config.registry.ttlSeconds * 1000,
    );
  }

  private async fetchAllReleases(
    id: number | string,
  ): Promise<GitLabRelease[]> {
    const encoded = encodeURIComponent(String(id));
    const all: GitLabRelease[] = [];
    let page = 1;

    while (true) {
      const url = this.apiUrl(
        `/projects/${encoded}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
      );
      const res = await this.rawFetch(url);
      if (!res.ok)
        throw new Error(
          `GitLab API ${res.status} fetching releases for project ${id}`,
        );

      const batch = (await res.json()) as GitLabRelease[];
      all.push(...batch);
      if (batch.length < RELEASES_PER_PAGE) break;
      page++;
    }

    return all;
  }

  async getPackageJson(
    id: number | string,
    ref: string,
  ): Promise<Record<string, unknown> | null> {
    const encoded = encodeURIComponent(String(id));
    const cacheKey = `gl:pkgjson:${id}:${ref}`;
    try {
      return await this.cache.getOrSet(
        cacheKey,
        async () => {
          const url = `${this.apiUrl(
            `/projects/${encoded}/repository/files/package.json/raw`,
          )}?ref=${encodeURIComponent(ref)}`;
          const res = await this.rawFetch(url);
          if (!res.ok) return null;
          return res.json() as Promise<Record<string, unknown>>;
        },
        ref === "HEAD" ? this.config.registry.ttlSeconds * 1000 : ONE_DAY_MS,
      );
    } catch {
      return null;
    }
  }

  async proxyTarball(
    id: number | string,
    tagName: string,
    version: string,
  ): Promise<Response> {
    // Always use the source archive so the tarball is always at the exact
    // tagged commit. We also patch package.json to the registry version because
    // developers sometimes commit a future version number before tagging.
    const url = `${this.apiUrl(
      `/projects/${encodeURIComponent(String(id))}/repository/archive.tar.gz`,
    )}?sha=${encodeURIComponent(tagName)}`;

    const upstream = await this.rawFetch(url);
    if (!upstream.ok) return upstream;

    logger.info("Repackaging source archive for Unity compatibility", {
      projectId: id,
      tag: tagName,
    });

    const repackaged = await repackSourceArchive(
      Buffer.from(await upstream.arrayBuffer()),
      version,
    );

    return new Response(repackaged, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
}
