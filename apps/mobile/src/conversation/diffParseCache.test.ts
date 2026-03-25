import { describe, expect, it } from "vitest";

import { clearParsedDiffCache, getCachedParsedDiff, getParsedDiffCacheKey } from "./diffParseCache";

describe("diffParseCache", () => {
  it("reuses parsed diff arrays for the same cache key", () => {
    clearParsedDiffCache();
    const cacheKey = getParsedDiffCacheKey({
      threadId: "thread-1",
      turnId: "turn-1",
      updatedAt: "2026-03-24T00:00:00.000Z",
    });
    const diff = "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n+hello";

    const first = getCachedParsedDiff({ cacheKey, diff });
    const second = getCachedParsedDiff({ cacheKey, diff });

    expect(second).toBe(first);
  });

  it("invalidates cached parses when updatedAt changes", () => {
    clearParsedDiffCache();
    const diff = "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n+hello";
    const first = getCachedParsedDiff({
      cacheKey: getParsedDiffCacheKey({
        threadId: "thread-1",
        turnId: "turn-1",
        updatedAt: "2026-03-24T00:00:00.000Z",
      }),
      diff,
    });
    const second = getCachedParsedDiff({
      cacheKey: getParsedDiffCacheKey({
        threadId: "thread-1",
        turnId: "turn-1",
        updatedAt: "2026-03-24T01:00:00.000Z",
      }),
      diff,
    });

    expect(second).not.toBe(first);
  });
});
