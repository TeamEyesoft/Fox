import { Elysia } from "elysia";
import { Cache } from "./cache";
import { loadConfig } from "./config";
import { GitLabClient } from "./gitlab";
import { logger } from "./logger";
import { Registry } from "./registry";
import { parseTarballVersion } from "./utils";

const config = loadConfig();
const cache = new Cache(
  config.registry.ttlSeconds * 1000,
  config.registry.maxCacheSize,
);
const gitlab = new GitLabClient(config, cache);
const registry = new Registry(config, gitlab);

const app = new Elysia()
  .onRequest(({ request }) => {
    logger.info("request", { method: request.method, url: request.url });
  })
  .onAfterHandle(({ request, set }) => {
    logger.info("response", {
      method: request.method,
      url: request.url,
      status: set.status ?? 200,
    });
  })
  .onError(({ request, error, set }) => {
    const message = "message" in error ? error.message : String(error);
    logger.error("unhandled error", {
      method: request.method,
      url: request.url,
      status: set.status,
      error: message,
    });
  })

  // Health check
  .get("/healthz", () => ({ status: "ok" }))

  // Web UI
  .get("/", () => Bun.file("public/index.html"))
  .get("/ui", () => Bun.file("public/index.html"))

  // List all packages (Unity package discovery)
  .get("/-/all", async ({ set }) => {
    try {
      return await registry.getAllPackuments();
    } catch (err) {
      set.status = 500;
      return { error: (err as Error).message };
    }
  })

  // Package manifest (all versions)
  .get("/:name", async ({ params, set }) => {
    try {
      const packument = await registry.getPackument(params.name);
      if (!packument) {
        set.status = 404;
        return { error: "Package not found" };
      }
      return packument;
    } catch (err) {
      set.status = 500;
      return { error: (err as Error).message };
    }
  })

  // Single version manifest
  .get("/:name/:version", async ({ params, set }) => {
    try {
      const manifest = await registry.getVersionManifest(
        params.name,
        params.version,
      );
      if (!manifest) {
        set.status = 404;
        return { error: "Version not found" };
      }
      return manifest;
    } catch (err) {
      set.status = 500;
      return { error: (err as Error).message };
    }
  })

  // Tarball proxy: /:name/-/:name-:version.tgz
  .get("/:name/-/:filename", async ({ params, set }) => {
    try {
      const version = parseTarballVersion(params.name, params.filename);
      if (!version) {
        set.status = 400;
        return { error: "Invalid tarball filename" };
      }

      const source = await registry.getTarballSource(params.name, version);
      if (!source) {
        set.status = 404;
        return { error: "Package or version not found" };
      }

      const upstream = await gitlab.proxyTarball(
        source.projectId,
        source.tagName,
        source.assetUrl,
      );

      if (!upstream.ok) {
        set.status = 502;
        return {
          error: `Upstream GitLab error: ${upstream.status} ${upstream.statusText}`,
        };
      }

      // Buffer the body so we can compute the integrity hash
      const buffer = await upstream.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-512", buffer);
      const integrity = `sha512-${Buffer.from(hashBuffer).toString("base64")}`;
      registry.setIntegrity(params.name, version, integrity);

      return new Response(buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${params.filename}"`,
        },
      });
    } catch (err) {
      set.status = 500;
      return { error: (err as Error).message };
    }
  })

  .listen(config.port);

logger.info("Fox registry started", {
  url: config.registry.baseUrl,
  port: config.port,
  projects: config.projects.length,
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info("Shutting down", { signal });
  cache.stop();
  app.stop();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
