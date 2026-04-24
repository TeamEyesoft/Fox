import { createGunzip, createGzip } from "node:zlib";
import { extract, pack } from "tar-stream";

/**
 * Repackages a GitLab source archive (.tar.gz) into a Unity-compatible .tgz.
 *
 * GitLab source archives have the project folder as root ("myrepo-v1.0-abc123/").
 * Unity Package Manager requires "package/" as the root directory.
 * This function strips the top-level directory and replaces it with "package/".
 *
 * If `version` is provided, the `version` field in `package/package.json` is
 * patched to match. GitLab release tags and the version committed in
 * package.json can diverge; Unity rejects tarballs where the two don't agree.
 */
export function repackSourceArchive(
  compressed: Buffer,
  version?: string,
): Promise<Buffer> {
  const gunzip = createGunzip();
  const gzip = createGzip();
  const extractor = extract();
  const packer = pack();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    extractor.on("entry", (header, stream, next) => {
      const slash = header.name.indexOf("/");
      header.name =
        slash !== -1
          ? `package${header.name.slice(slash)}`
          : `package/${header.name}`;

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
