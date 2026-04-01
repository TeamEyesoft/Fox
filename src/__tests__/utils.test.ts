import { describe, expect, it } from "bun:test";
import { normalizeVersion, parseTarballVersion, firstLine } from "../utils";

describe("normalizeVersion", () => {
  it("strips leading v", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
  });

  it("leaves version without v untouched", () => {
    expect(normalizeVersion("1.2.3")).toBe("1.2.3");
  });

  it("only strips one leading v", () => {
    expect(normalizeVersion("v2.0.0-rc.1")).toBe("2.0.0-rc.1");
  });
});

describe("parseTarballVersion", () => {
  it("extracts version from a standard filename", () => {
    expect(parseTarballVersion("com.foo.bar", "com.foo.bar-1.2.3.tgz")).toBe("1.2.3");
  });

  it("handles package names containing hyphens", () => {
    expect(
      parseTarballVersion("com.foo.my-package", "com.foo.my-package-1.0.0.tgz"),
    ).toBe("1.0.0");
  });

  it("returns null when the filename prefix doesn't match the package name", () => {
    expect(parseTarballVersion("com.foo.bar", "com.other.bar-1.0.0.tgz")).toBeNull();
  });

  it("returns null when the extension is not .tgz", () => {
    expect(parseTarballVersion("com.foo.bar", "com.foo.bar-1.0.0.tar.gz")).toBeNull();
  });

  it("returns null for an empty version segment", () => {
    expect(parseTarballVersion("com.foo.bar", "com.foo.bar-.tgz")).toBeNull();
  });
});

describe("firstLine", () => {
  it("returns the first line of a multi-line string", () => {
    expect(firstLine("hello\nworld")).toBe("hello");
  });

  it("trims whitespace", () => {
    expect(firstLine("  hello  \nworld")).toBe("hello");
  });

  it("returns undefined for empty input", () => {
    expect(firstLine("")).toBeUndefined();
    expect(firstLine(null)).toBeUndefined();
    expect(firstLine(undefined)).toBeUndefined();
  });

  it("returns undefined when the first line is blank", () => {
    expect(firstLine("\nsecond line")).toBeUndefined();
  });
});
