import { parseUnifiedDiff, type ParsedUnifiedDiffFile } from "../threadDiffs";

const MAX_CACHED_DIFFS = 32;

type ParsedDiffCacheEntry = {
  readonly files: ReadonlyArray<ParsedUnifiedDiffFile>;
};

const parsedDiffCache = new Map<string, ParsedDiffCacheEntry>();

function touchCacheEntry(cacheKey: string, entry: ParsedDiffCacheEntry) {
  parsedDiffCache.delete(cacheKey);
  parsedDiffCache.set(cacheKey, entry);
}

function evictOldestEntry() {
  const oldestKey = parsedDiffCache.keys().next().value;
  if (typeof oldestKey === "string") {
    parsedDiffCache.delete(oldestKey);
  }
}

export function getParsedDiffCacheKey(input: {
  readonly threadId: string;
  readonly turnId: string;
  readonly updatedAt: string;
}) {
  return `${input.threadId}:${input.turnId}:${input.updatedAt}`;
}

export function clearParsedDiffCache() {
  parsedDiffCache.clear();
}

export function getCachedParsedDiff(input: { readonly cacheKey: string; readonly diff: string }) {
  const cached = parsedDiffCache.get(input.cacheKey);
  if (cached) {
    touchCacheEntry(input.cacheKey, cached);
    return cached.files;
  }

  const files = parseUnifiedDiff(input.diff);
  touchCacheEntry(input.cacheKey, { files });
  while (parsedDiffCache.size > MAX_CACHED_DIFFS) {
    evictOldestEntry();
  }
  return files;
}
