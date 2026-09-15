import { createGunzip, createGzip } from "node:zlib";
import { extract, pack } from "tar-stream";

/**
 * Repackages a GitLab source archive (.tar.gz) into a Unity-compatible .tgz.
 *
 * GitLab source archives have the project folder as root ("myrepo-v1.0-abc123/").
 * Unity Package Manager requires "package/" as the root directory.
 * This function strips the top-level directory and replaces it with "package/".
 *
 * If `packageRoot` is provided (e.g. "Packages/com.company.pkg" for a monorepo
 * where the Unity package lives in a subfolder), only entries under that
 * subfolder are kept, and it becomes the new "package/" root.
 *
 * If `version` is provided, the `version` field in `package/package.json` is
 * patched to match. GitLab release tags and the version committed in
 * package.json can diverge; Unity rejects tarballs where the two don't agree.
 */
export function repackSourceArchive(
  compressed: Buffer,
  version?: string,
  packageRoot?: string,
): Promise<Buffer> {
  const gunzip = createGunzip();
  const gzip = createGzip();
  const extractor = extract();
  const packer = pack();
  const normalizedRoot = packageRoot?.replace(/^\/+|\/+$/g, "");

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    extractor.on("entry", (header, stream, next) => {
      if (header.type !== "file") {
        // GitLab's source archive includes directory entries (and other
        // non-file types) that real npm tarballs never have. Unity's package
        // tarball extractor doesn't tolerate them, so drop everything but
        // plain files.
        stream.on("end", next);
        stream.resume();
        return;
      }

      const slash = header.name.indexOf("/");
      const relPath = slash !== -1 ? header.name.slice(slash + 1) : header.name;

      if (normalizedRoot) {
        const withinRoot =
          relPath === normalizedRoot ||
          relPath.startsWith(`${normalizedRoot}/`);
        const suffix = withinRoot
          ? relPath.slice(normalizedRoot.length).replace(/^\/+/, "")
          : "";
        if (!withinRoot || !suffix) {
          // Outside the package root, or the root directory entry itself: drop it.
          stream.on("end", next);
          stream.resume();
          return;
        }
        header.name = `package/${suffix}`;
      } else {
        header.name = `package/${relPath}`;
      }

      if (version && header.name === "package/package.json") {
        const entryChunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => entryChunks.push(chunk));
        stream.on("end", () => {
          try {
            const pkg = JSON.parse(Buffer.concat(entryChunks).toString());
            pkg.version = version;
            const patched = Buffer.from(JSON.stringify(pkg, null, 2));
            header.size = patched.length;
            packer.entry(header, patched, next);
          } catch {
            const raw = Buffer.concat(entryChunks);
            header.size = raw.length;
            packer.entry(header, raw, next);
          }
        });
        stream.on("error", reject);
      } else {
        stream.pipe(packer.entry(header, next));
      }
    });

    extractor.on("finish", () => packer.finalize());
    packer.pipe(gzip);

    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));

    const fail = (err: Error) => reject(err);
    gunzip.on("error", fail);
    extractor.on("error", fail);
    packer.on("error", fail);
    gzip.on("error", fail);

    gunzip.pipe(extractor);
    gunzip.end(compressed);
  });
}
