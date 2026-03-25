import { describe, expect, it, vi } from "vitest";

import { createConversationAutoScrollController } from "./autoScrollController";

describe("createConversationAutoScrollController", () => {
  it("coalesces multiple content-size changes into one scheduled scroll", () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const onScrollToBottom = vi.fn();
    const controller = createConversationAutoScrollController({
      requestAnimationFrame: (callback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        frames.set(frameId, callback);
        return frameId;
      },
      cancelAnimationFrame: (frameId) => {
        frames.delete(frameId);
      },
      onScrollToBottom,
      stickyThreshold: 72,
    });

    controller.requestScrollToBottom({ force: true });
    controller.handleContentSizeChange(240);
    controller.handleContentSizeChange(320);

    expect(frames.size).toBe(1);

    const callback = frames.values().next().value;
    expect(callback).toBeTypeOf("function");
    if (!callback) {
      throw new Error("Expected a queued animation frame.");
    }
    callback(16);

    expect(onScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("respects the sticky threshold unless a forced scroll is requested", () => {
    const onScrollToBottom = vi.fn();
    const controller = createConversationAutoScrollController({
      requestAnimationFrame: (callback) => {
        callback(16);
        return 0;
      },
      cancelAnimationFrame: () => {},
      onScrollToBottom,
      stickyThreshold: 24,
    });

    controller.handleLayout(200);
    controller.handleScroll({
      contentHeight: 500,
      viewportHeight: 200,
      offsetY: 0,
    });
    controller.handleContentSizeChange(520);

    expect(onScrollToBottom).not.toHaveBeenCalled();

    controller.requestScrollToBottom({ force: true });

    expect(onScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending scroll frame", () => {
    let cancelledFrameId: number | null = null;
    const controller = createConversationAutoScrollController({
      requestAnimationFrame: () => 42,
      cancelAnimationFrame: (frameId) => {
        cancelledFrameId = frameId;
      },
      onScrollToBottom: vi.fn(),
      stickyThreshold: 72,
    });

    controller.requestScrollToBottom({ force: true });
    controller.cancelPendingScroll();

    expect(cancelledFrameId).toBe(42);
  });
});
