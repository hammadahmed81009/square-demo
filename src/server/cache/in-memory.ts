import "server-only";

export type ServerCacheSource = "upstream" | "server-cache" | "server-stale";

export interface ServerCachePolicy {
  readonly freshForMs: number;
  readonly staleForMs: number;
}

export interface ServerCacheResult<T> {
  readonly value: T;
  readonly source: ServerCacheSource;
  readonly fetchedAt: Date;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly fetchedAt: Date;
}

interface InFlightLoad<T> {
  readonly promise: Promise<CacheEntry<T>>;
}

/**
 * Best-effort process-local cache. It deliberately has no persistence: callers
 * must still tolerate a cold process and should never treat cached inventory as
 * authoritative outside its short freshness window.
 */
export class InMemoryTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, InFlightLoad<T>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getOrLoad(
    key: string,
    policy: ServerCachePolicy,
    load: () => Promise<T>,
  ): Promise<ServerCacheResult<T>> {
    const now = this.now();
    const entry = this.entries.get(key);

    if (entry !== undefined && this.ageMs(entry, now) <= policy.freshForMs) {
      return { value: entry.value, source: "server-cache", fetchedAt: entry.fetchedAt };
    }

    const existingLoad = this.inFlight.get(key);
    if (existingLoad !== undefined) {
      const loaded = await existingLoad.promise;
      return { value: loaded.value, source: "upstream", fetchedAt: loaded.fetchedAt };
    }

    const loadPromise = load().then((value) => {
      const loaded = { value, fetchedAt: this.now() };
      this.entries.set(key, loaded);
      return loaded;
    });
    this.inFlight.set(key, { promise: loadPromise });

    try {
      const loaded = await loadPromise;
      return { value: loaded.value, source: "upstream", fetchedAt: loaded.fetchedAt };
    } catch (error) {
      if (entry !== undefined && this.ageMs(entry, now) <= policy.staleForMs) {
        return {
          value: entry.value,
          source: "server-stale",
          fetchedAt: entry.fetchedAt,
        };
      }

      throw error;
    } finally {
      this.inFlight.delete(key);
    }
  }

  clear(key?: string): void {
    if (key === undefined) {
      this.entries.clear();
      return;
    }

    this.entries.delete(key);
  }

  private ageMs(entry: CacheEntry<T>, now: Date): number {
    return Math.max(0, now.getTime() - entry.fetchedAt.getTime());
  }
}
