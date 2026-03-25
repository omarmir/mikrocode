import type { ReactNode } from "react";

const MAX_CACHED_MARKDOWN_RENDERS = 64;

type MarkdownRenderCacheEntry = {
  readonly elements: ReadonlyArray<ReactNode>;
};

const markdownRenderCache = new Map<string, MarkdownRenderCacheEntry>();

function touchCacheEntry(cacheKey: string, entry: MarkdownRenderCacheEntry) {
  markdownRenderCache.delete(cacheKey);
  markdownRenderCache.set(cacheKey, entry);
}

function evictOldestEntry() {
  const oldestKey = markdownRenderCache.keys().next().value;
  if (typeof oldestKey === "string") {
    markdownRenderCache.delete(oldestKey);
  }
}

export function getMarkdownRenderCacheKey(input: {
  readonly themeKey: string;
  readonly messageId: string;
  readonly updatedAt: string;
}) {
  return `${input.themeKey}:${input.messageId}:${input.updatedAt}`;
}

export function clearMarkdownRenderCache() {
  markdownRenderCache.clear();
}

export function readMarkdownRenderCache(cacheKey: string) {
  const cached = markdownRenderCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  touchCacheEntry(cacheKey, cached);
  return cached.elements;
}

export function writeMarkdownRenderCache(cacheKey: string, elements: ReadonlyArray<ReactNode>) {
  const entry = { elements };
  touchCacheEntry(cacheKey, entry);
  while (markdownRenderCache.size > MAX_CACHED_MARKDOWN_RENDERS) {
    evictOldestEntry();
  }
}
