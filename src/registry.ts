import type { FoxConfig, ProjectConfig } from "./config";
import type { GitLabClient } from "./gitlab";
import type { GitLabRelease, NpmPackument, NpmVersionManifest } from "./types";
import { normalizeVersion, firstLine } from "./utils";
import { logger } from "./logger";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function findTgzAsset(release: GitLabRelease): string | undefined {
  return release.assets.links.find(
    (l) => l.name.endsWith(".tgz") || l.link_type === "package",
  )?.url;
}

export class Registry {
  /** package name → project config */
  private projectByName = new Map<string, ProjectConfig>();
  private initPromise: Promise<void> | null = null;
  /** Lazily computed tarball integrity hashes: "name@version" → "sha512-<base64>" */
  private integrityStore = new Map<string, string>();

  constructor(
    private config: FoxConfig,
    private gitlab: GitLabClient,
  ) {}

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
      this.config.projects.map(async (proj) => {
        try {
          const name = await this.resolvePackageName(proj);
          this.projectByName.set(name, proj);
        } catch (err) {
          logger.error("Failed to resolve package name, skipping project", {
            projectId: proj.id,
            error: (err as Error).message,
          });
        }
      }),
    );

    if (this.projectByName.size === 0) {
      throw new Error(
        "No projects could be resolved. Check your GitLab token and project IDs.",
      );
    }
  }

  private async resolvePackageName(proj: ProjectConfig): Promise<string> {
    if (proj.nameOverride) return proj.nameOverride;

    const pkgJson = await this.gitlab.getPackageJson(proj.id, "HEAD");
    if (typeof pkgJson?.name === "string") return pkgJson.name;

    const project = await this.gitlab.getProject(proj.id);
    return project.path;
  }

  private buildVersionManifest(
    name: string,
    release: GitLabRelease,
    pkgJson: Record<string, unknown> | null,
  ): NpmVersionManifest {
    const version = normalizeVersion(release.tag_name);
    const tarball = `${this.config.registry.baseUrl}/${name}/-/${name}-${version}.tgz`;
    const integrity = this.integrityStore.get(`${name}@${version}`);

    return {
      name,
      version,
      description:
        typeof pkgJson?.description === "string"
          ? pkgJson.description
          : firstLine(release.description),
      unity: typeof pkgJson?.unity === "string" ? pkgJson.unity : undefined,
      unityRelease:
        typeof pkgJson?.unityRelease === "string"
          ? pkgJson.unityRelease
          : undefined,
      dependencies:
        pkgJson?.dependencies != null &&
        typeof pkgJson.dependencies === "object" &&
        !Array.isArray(pkgJson.dependencies)
          ? (pkgJson.dependencies as Record<string, string>)
          : undefined,
      dist: { tarball, ...(integrity ? { integrity } : {}) },
    };
  }

  setIntegrity(name: string, version: string, integrity: string): void {
    this.integrityStore.set(`${name}@${version}`, integrity);
  }

  getIntegrity(name: string, version: string): string | undefined {
    return this.integrityStore.get(`${name}@${version}`);
  }

  async getPackument(name: string): Promise<NpmPackument | null> {
    await this.ensureInitialized();
    const proj = this.projectByName.get(name);
    if (!proj) return null;

    const releases = await this.gitlab.getReleases(proj.id);
    if (releases.length === 0) return null;

    const versions: Record<string, NpmVersionManifest> = {};
    const time: Record<string, string> = {};

    await Promise.all(
      releases.map(async (release) => {
        const version = normalizeVersion(release.tag_name);
        const pkgJson = await this.gitlab.getPackageJson(proj.id, release.tag_name);
        versions[version] = this.buildVersionManifest(name, release, pkgJson);
        time[version] = release.released_at ?? release.created_at;
      }),
    );

    const latest = normalizeVersion(releases[0].tag_name);

    return {
      name,
      description: firstLine(releases[0].description),
      "dist-tags": { latest },
      versions,
      time,
    };
  }

  async getVersionManifest(
    name: string,
    version: string,
  ): Promise<NpmVersionManifest | null> {
    await this.ensureInitialized();
    const proj = this.projectByName.get(name);
    if (!proj) return null;

    const releases = await this.gitlab.getReleases(proj.id);
    const release = releases.find(
      (r) => normalizeVersion(r.tag_name) === version,
    );
    if (!release) return null;

    const pkgJson = await this.gitlab.getPackageJson(proj.id, release.tag_name);
    return this.buildVersionManifest(name, release, pkgJson);
  }

  async getTarballSource(
    name: string,
    version: string,
  ): Promise<{ projectId: number | string; tagName: string; assetUrl?: string } | null> {
    await this.ensureInitialized();
    const proj = this.projectByName.get(name);
    if (!proj) return null;

    const releases = await this.gitlab.getReleases(proj.id);
    const release = releases.find(
      (r) => normalizeVersion(r.tag_name) === version,
    );
    if (!release) return null;

    return {
      projectId: proj.id,
      tagName: release.tag_name,
      assetUrl: findTgzAsset(release),
    };
  }

  async getAllPackuments(): Promise<Record<string, NpmPackument>> {
    await this.ensureInitialized();
    const result: Record<string, NpmPackument> = {};

    await Promise.all(
      Array.from(this.projectByName.keys()).map(async (name) => {
        const packument = await this.getPackument(name);
        if (packument) result[name] = packument;
      }),
    );

    return result;
  }
}
