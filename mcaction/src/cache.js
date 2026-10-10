const store = new Map();

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expireAt) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet(key, value, ttlMs = 60_000) {
  store.set(key, { value, expireAt: Date.now() + ttlMs });
  return value;
}

export async function cacheWrap(key, ttlMs, fn) {
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  return cacheSet(key, await fn(), ttlMs);
}
