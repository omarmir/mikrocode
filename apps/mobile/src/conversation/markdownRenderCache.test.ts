import { describe, expect, it } from "vitest";

import {
  clearMarkdownRenderCache,
  getMarkdownRenderCacheKey,
  readMarkdownRenderCache,
  writeMarkdownRenderCache,
} from "./markdownRenderCache";

describe("markdownRenderCache", () => {
  it("caches completed markdown renders by theme, id, and updatedAt", () => {
    clearMarkdownRenderCache();
    const cacheKey = getMarkdownRenderCacheKey({
      themeKey: "black:green",
      messageId: "message-1",
      updatedAt: "2026-03-24T00:00:00.000Z",
    });

    writeMarkdownRenderCache(cacheKey, ["rendered"]);

    expect(readMarkdownRenderCache(cacheKey)).toEqual(["rendered"]);
  });

  it("returns null when no cached render exists", () => {
    clearMarkdownRenderCache();

    expect(
      readMarkdownRenderCache(
        getMarkdownRenderCacheKey({
          themeKey: "black:green",
          messageId: "missing",
          updatedAt: "2026-03-24T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
  });
});
