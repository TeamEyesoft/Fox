import { describe, expect, it } from "bun:test";
import { createGunzip, gzipSync } from "node:zlib";
import { extract, pack } from "tar-stream";
import { repackSourceArchive } from "../repack";

function buildArchive(
  entries: Record<string, string>,
  directories: string[] = [],
): Promise<Buffer> {
  const packer = pack();
  for (const dir of directories) {
    packer.entry({ name: dir, type: "directory" });
  }
  for (const [name, content] of Object.entries(entries)) {
    packer.entry({ name }, content);
  }
  packer.finalize();

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    packer.on("data", (chunk: Buffer) => chunks.push(chunk));
    packer.on("end", () => resolve(gzipSync(Buffer.concat(chunks))));
    packer.on("error", reject);
  });
}

function readArchive(compressed: Buffer): Promise<Record<string, string>> {
  const extractor = extract();
  const result: Record<string, string> = {};

  return new Promise((resolve, reject) => {
    extractor.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        result[header.name] = Buffer.concat(chunks).toString();
        next();
      });
      stream.on("error", reject);
    });
    extractor.on("finish", () => resolve(result));
    extractor.on("error", reject);

    const gunzip = createGunzip();
    gunzip.on("error", reject);
    gunzip.pipe(extractor);
    gunzip.end(compressed);
  });
}

describe("repackSourceArchive", () => {
  it("strips the top-level dir and renames it to package/", async () => {
    const archive = await buildArchive({
      "repo-v1.0-abc/README.md": "hello",
      "repo-v1.0-abc/package.json": JSON.stringify({ version: "0.0.0" }),
    });

    const repacked = await repackSourceArchive(archive, "1.2.3");
    const entries = await readArchive(repacked);

    expect(Object.keys(entries).sort()).toEqual([
      "package/README.md",
      "package/package.json",
    ]);
    expect(JSON.parse(entries["package/package.json"]).version).toBe("1.2.3");
  });

  it("keeps only files under packageRoot and remaps them under package/", async () => {
    const archive = await buildArchive({
      "repo-v1.0-abc/README.md": "hello",
      "repo-v1.0-abc/Other/file.txt": "unrelated",
      "repo-v1.0-abc/Packages/com.company.pkg/package.json": JSON.stringify({
        name: "com.company.pkg",
        version: "0.0.0",
      }),
      "repo-v1.0-abc/Packages/com.company.pkg/Runtime/Foo.cs": "class Foo {}",
    });

    const repacked = await repackSourceArchive(
      archive,
      "1.2.3",
      "Packages/com.company.pkg",
    );
    const entries = await readArchive(repacked);

    expect(Object.keys(entries).sort()).toEqual([
      "package/Runtime/Foo.cs",
      "package/package.json",
    ]);
    expect(JSON.parse(entries["package/package.json"]).version).toBe("1.2.3");
    expect(entries["package/Runtime/Foo.cs"]).toBe("class Foo {}");
  });

  it("tolerates leading/trailing slashes in packageRoot", async () => {
    const archive = await buildArchive({
      "repo-v1.0-abc/Packages/com.company.pkg/package.json": JSON.stringify({
        version: "0.0.0",
      }),
    });

    const repacked = await repackSourceArchive(
      archive,
      "1.2.3",
      "/Packages/com.company.pkg/",
    );
    const entries = await readArchive(repacked);

    expect(Object.keys(entries)).toEqual(["package/package.json"]);
  });

  it("drops directory entries, which real npm tarballs never contain", async () => {
    const archive = await buildArchive(
      {
        "repo-v1.0-abc/package.json": JSON.stringify({ version: "0.0.0" }),
        "repo-v1.0-abc/Editor/Foo.cs": "class Foo {}",
      },
      ["repo-v1.0-abc/", "repo-v1.0-abc/Editor/"],
    );

    const repacked = await repackSourceArchive(archive, "1.2.3");
    const entries = await readArchive(repacked);

    expect(Object.keys(entries).sort()).toEqual([
      "package/Editor/Foo.cs",
      "package/package.json",
    ]);
  });
});
