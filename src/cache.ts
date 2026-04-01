interface Entry<T> {
  value: T;
  expiresAt: number;
}

const SWEEP_INTERVAL_MS = 60_000;

export class Cache {
  private store = new Map<string, Entry<unknown>>();
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private defaultTtlMs: number,
    private maxSize: number = 1000,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Don't keep the process alive just for cache sweeps
    this.sweepTimer.unref();
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as Entry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this.evictIfNeeded();
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Remove all expired entries. */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  stop(): void {
    clearInterval(this.sweepTimer);
  }

  get size(): number {
    return this.store.size;
  }

  private evictIfNeeded(): void {
    if (this.store.size < this.maxSize) return;
    // First pass: remove expired entries
    this.sweep();
    if (this.store.size < this.maxSize) return;
    // Second pass: remove oldest entries (Map preserves insertion order)
    const excess = this.store.size - this.maxSize + 1;
    let removed = 0;
    for (const key of this.store.keys()) {
      this.store.delete(key);
      if (++removed >= excess) break;
    }
  }
}
