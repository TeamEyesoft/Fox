import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Cache } from "../cache";

describe("Cache", () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache(1000);
  });

  afterEach(() => {
    cache.stop();
  });

  it("stores and retrieves a value", () => {
    cache.set("key", "value");
    expect(cache.get<string>("key")).toBe("value");
  });

  it("returns undefined for a missing key", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns undefined for an expired entry", async () => {
    cache.set("key", "value", 1); // 1ms TTL
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get("key")).toBeUndefined();
  });

  it("getOrSet returns cached value on second call without calling fetcher", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return "result";
    };
    await cache.getOrSet("key", fetcher);
    await cache.getOrSet("key", fetcher);
    expect(calls).toBe(1);
  });

  it("getOrSet calls fetcher again after TTL expires", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return "result";
    };
    await cache.getOrSet("key", fetcher, 1); // 1ms TTL
    await new Promise((r) => setTimeout(r, 10));
    await cache.getOrSet("key", fetcher, 1);
    expect(calls).toBe(2);
  });

  it("sweep removes expired entries", async () => {
    cache.set("expired", "value", 1);
    cache.set("live", "value", 60_000);
    await new Promise((r) => setTimeout(r, 10));
    cache.sweep();
    expect(cache.size).toBe(1);
    expect(cache.get<string>("live")).toBe("value");
  });

  it("evicts oldest entries when maxSize is reached", () => {
    const small = new Cache(60_000, 3);
    small.set("a", 1);
    small.set("b", 2);
    small.set("c", 3);
    small.set("d", 4); // should evict "a"
    expect(small.get("a")).toBeUndefined();
    expect(small.get<number>("b")).toBeDefined();
    expect(small.get<number>("d")).toBe(4);
    small.stop();
  });

  it("prefers evicting expired entries before oldest live entries", async () => {
    const small = new Cache(60_000, 3);
    small.set("live1", 1, 60_000);
    small.set("expires", 2, 1); // will expire
    small.set("live2", 3, 60_000);
    await new Promise((r) => setTimeout(r, 10));
    small.set("new", 4); // expired entry should be evicted first
    expect(small.get("expires")).toBeUndefined();
    expect(small.get<number>("live1")).toBeDefined();
    expect(small.get<number>("live2")).toBeDefined();
    expect(small.get<number>("new")).toBe(4);
    small.stop();
  });
});
