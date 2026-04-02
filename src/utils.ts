/** Strip leading "v" from a git tag to get a semver string. */
export function normalizeVersion(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/** Return the first non-empty line of a string, or undefined. */
export function firstLine(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const line = text.split("\n")[0].trim();
  return line || undefined;
}

/**
 * Extract the version from a tarball filename.
 * e.g. parseTarballVersion("com.foo.bar", "com.foo.bar-1.2.3.tgz") → "1.2.3"
 * Returns null if the filename doesn't match the expected pattern.
 */
export function parseTarballVersion(
  packageName: string,
  filename: string,
): string | null {
  const prefix = `${packageName}-`;
  if (!filename.startsWith(prefix) || !filename.endsWith(".tgz")) return null;
  const version = filename.slice(prefix.length, -".tgz".length);
  return version || null;
}
