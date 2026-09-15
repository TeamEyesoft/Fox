import type { FoxConfig, ProjectConfig } from "./config";
import { readProjectsFile } from "./config";
import type { GitLabClient } from "./gitlab";
import { logger } from "./logger";
import type { GitLabRelease, NpmPackument, NpmVersionManifest } from "./types";
import { firstLine, normalizeVersion } from "./utils";

export class Registry {
  /** package name → project config */
  private projectByName = new Map<string, ProjectConfig>();
  private initPromise: Promise<void> | null = null;
  /** Lazily computed tarball integrity hashes: "name@version" → "sha512-<base64>" */
  private integrityStore = new Map<string, string>();
  /** Lazily computed tarball SHA-1 shasums: "name@version" → hex string */
  private shasumStore = new Map<string, string>();
  private projects: ProjectConfig[];

  constructor(
    private config: FoxConfig,
    private gitlab: GitLabClient,
  ) {
    this.projects = [...config.projects];
  }

  /** Re-reads the projects file (if configured) and rebuilds the package name map. */
  async reload(): Promise<{ count: number; names: string[] }> {
    if (this.config.projectsFile) {
      this.projects = readProjectsFile(this.config.projectsFile);
      logger.info("Reloaded projects from file", {
        file: this.config.projectsFile,
        count: this.projects.length,
      });
    }
    this.projectByName.clear();
    this.initPromise = null;
    await this.ensureInitialized();
    const names = Array.from(this.projectByName.keys());
    return { count: names.length, names };
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.buildNameMap().catch((err) => {
        // Allow retry on next request
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async buildNameMap(): Promise<void> {
    await Promise.all(
      this.projects.map(async (proj) => {
        try {
          const name = await this.resolvePackageName(proj);
          const existing = this.projectByName.get(name);
          if (existing) {
            logger.warn(
              "Package name collision: two projects share the same name — the second will shadow the first. Use nameOverride to fix this.",
              { name, firstId: existing.id, secondId: proj.id },
            );
          }
          this.projectByName.set(name, proj);
        } catch (err) {
          logger.error("Failed to resolve package name, skipping project", {
            projectId: proj.id,
            error: (err as Error).message,
          });
        }
      }),
    );

    logger.info(
      `Resolved ${this.projectByName.size} of ${this.projects.length} configured projects`,
      { names: Array.from(this.projectByName.keys()) },
    );

    if (this.projectByName.size === 0) {
      throw new Error(
        "No projects could be resolved. Check your GitLab token and project IDs.",
      );
    }
  }

  /** Path to package.json for a project, honoring its optional packageRoot. */
  private packageJsonPath(proj: ProjectConfig): string | undefined {
    return proj.packageRoot
      ? `${proj.packageRoot.replace(/\/+$/, "")}/package.json`
      : undefined;
  }

  private async resolvePackageName(proj: ProjectConfig): Promise<string> {
    if (proj.nameOverride) return proj.nameOverride;

    const pkgJson = await this.gitlab.getPackageJson(
      proj.id,
      "HEAD",
      this.packageJsonPath(proj),
    );
    if (typeof pkgJson?.name === "string") return pkgJson.name;

    const project = await this.gitlab.getProject(proj.id);
    return project.path;
  }

  /**
   * Unity Package Manager crashes if a packument's dist.integrity is absent
   * for a version it decides to install — it doesn't tolerate the "compute on
   * first download" laziness real npm registries don't need (they always have
   * it precomputed at publish time). So we compute it here, before the
   * manifest is ever handed out, instead of waiting for a tarball request.
   */
  private async ensureIntegrity(
    name: string,
    version: string,
    proj: ProjectConfig,
    tagName: string,
  ): Promise<void> {
    const key = `${name}@${version}`;
    if (this.integrityStore.has(key)) return;

    const upstream = await this.gitlab.proxyTarball(
      proj.id,
      tagName,
      version,
      proj.packageRoot,
    );
    if (!upstream.ok) return;

    const buffer = await upstream.arrayBuffer();
    const [sha512Buffer, sha1Buffer] = await Promise.all([
      crypto.subtle.digest("SHA-512", buffer),
      crypto.subtle.digest("SHA-1", buffer),
    ]);
    this.integrityStore.set(
      key,
      `sha512-${Buffer.from(sha512Buffer).toString("base64")}`,
    );
    this.shasumStore.set(key, Buffer.from(sha1Buffer).toString("hex"));
  }

  private async buildVersionManifest(
    name: string,
    release: GitLabRelease,
    pkgJson: Record<string, unknown> | null,
    proj: ProjectConfig,
  ): Promise<NpmVersionManifest> {
    const version = normalizeVersion(release.tag_name);
    const tarball = `${this.config.registry.baseUrl}/${name}/-/${name}-${version}.tgz`;
    await this.ensureIntegrity(name, version, proj, release.tag_name);
    const integrity = this.integrityStore.get(`${name}@${version}`);
    const shasum = this.shasumStore.get(`${name}@${version}`);

    return {
      // Pass through all package.json fields (displayName, keywords, author…)
      // so Unity Package Manager receives the same metadata as from a direct install.
      ...(pkgJson ?? {}),
      // Override registry-authoritative fields.
      name,
      version,
      _id: `${name}@${version}`,
      description:
        typeof pkgJson?.description === "string"
          ? pkgJson.description
          : firstLine(release.description),
      dist: {
        tarball,
        ...(shasum ? { shasum } : {}),
        ...(integrity ? { integrity } : {}),
      },
    };
  }

  setIntegrity(name: string, version: string, integrity: string): void {
    this.integrityStore.set(`${name}@${version}`, integrity);
  }

  getIntegrity(name: string, version: string): string | undefined {
    return this.integrityStore.get(`${name}@${version}`);
  }

  setShasum(name: string, version: string, shasum: string): void {
    this.shasumStore.set(`${name}@${version}`, shasum);
  }

  getShasum(name: string, version: string): string | undefined {
    return this.shasumStore.get(`${name}@${version}`);
  }

  private getReleases(id: number | string): Promise<GitLabRelease[]> {
    return this.gitlab.getReleases(id);
  }

  async getPackument(name: string): Promise<NpmPackument | null> {
    await this.ensureInitialized();
    const proj = this.projectByName.get(name);
    if (!proj) return null;

    const [releases, project] = await Promise.all([
      this.getReleases(proj.id),
      this.gitlab.getProject(proj.id),
    ]);
    const projectUrl = `${this.config.gitlab.baseUrl}/${project.path_with_namespace}`;

    if (releases.length === 0) {
      const pkgJson = await this.gitlab.getPackageJson(
        proj.id,
        "HEAD",
        this.packageJsonPath(proj),
      );
      return {
        name,
        displayName:
          typeof pkgJson?.displayName === "string"
            ? pkgJson.displayName
            : undefined,
        description:
          typeof pkgJson?.description === "string"
            ? pkgJson.description
            : undefined,
        "dist-tags": {},
        versions: {},
        _fox: { projectUrl, unreleased: true },
      };
    }

    const versions: Record<string, NpmVersionManifest> = {};
    const time: Record<string, string> = {};

    await Promise.all(
      releases.map(async (release) => {
        const version = normalizeVersion(release.tag_name);
        const pkgJson = await this.gitlab.getPackageJson(
          proj.id,
          release.tag_name,
          this.packageJsonPath(proj),
        );
        versions[version] = await this.buildVersionManifest(
          name,
          release,
          pkgJson,
          proj,
        );
        time[version] = release.released_at ?? release.created_at;
      }),
    );

    const latest = normalizeVersion(releases[0].tag_name);
    const latestManifest = versions[latest];

    return {
      name,
      // displayName comes from package.json (stable across versions)
      displayName:
        typeof latestManifest?.displayName === "string"
          ? latestManifest.displayName
          : undefined,
      description:
        typeof latestManifest?.description === "string"
          ? latestManifest.description
          : undefined,
      "dist-tags": { latest },
      versions,
      time,
      _fox: { projectUrl },
    };
  }

  async getVersionManifest(
    name: string,
    version: string,
  ): Promise<NpmVersionManifest | null> {
    await this.ensureInitialized();
    const proj = this.projectByName.get(name);
    if (!proj) return null;

    const releases = await this.getReleases(proj.id);
    const release = releases.find(
      (r) => normalizeVersion(r.tag_name) === version,
    );
    if (!release) return null;

    const pkgJson = await this.gitlab.getPackageJson(
      proj.id,
      release.tag_name,
      this.packageJsonPath(proj),
    );
    return this.buildVersionManifest(name, release, pkgJson, proj);
  }

  async getTarballSource(
    name: string,
    version: string,
  ): Promise<{
    projectId: number | string;
    tagName: string;
    version: string;
    packageRoot?: string;
  } | null> {
    await this.ensureInitialized();
    const proj = this.projectByName.get(name);
    if (!proj) return null;

    const releases = await this.getReleases(proj.id);
    const release = releases.find(
      (r) => normalizeVersion(r.tag_name) === version,
    );
    if (!release) return null;

    return {
      projectId: proj.id,
      tagName: release.tag_name,
      version,
      packageRoot: proj.packageRoot,
    };
  }

  async getAllPackuments(): Promise<Record<string, NpmPackument>> {
    await this.ensureInitialized();
    const result: Record<string, NpmPackument> = {};

    await Promise.all(
      Array.from(this.projectByName.keys()).map(async (name) => {
        try {
          const packument = await this.getPackument(name);
          result[name] = packument ?? { name, "dist-tags": {}, versions: {} };
        } catch (err) {
          logger.warn("Failed to fetch packument, including stub", {
            name,
            error: (err as Error).message,
          });
          result[name] = { name, "dist-tags": {}, versions: {} };
        }
      }),
    );

    return result;
  }
}
