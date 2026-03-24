import { describe, expect, it, vi } from "vitest";

import { createSnapshotRefreshController } from "./snapshotRefreshController";

describe("createSnapshotRefreshController", () => {
  it("coalesces rapid event refresh requests", () => {
    vi.useFakeTimers();
    let now = 0;
    const onFlush = vi.fn();
    const controller = createSnapshotRefreshController({
      eventWindowMs: 180,
      eventMaxWaitMs: 250,
      onFlush,
      scheduler: {
        now: () => now,
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (timeout) => clearTimeout(timeout),
      },
    });

    controller.request("event");
    now = 100;
    controller.request("event");
    now = 220;
    controller.request("event");

    vi.advanceTimersByTime(29);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith("event");

    vi.useRealTimers();
  });

  it("flushes manual requests immediately", () => {
    const onFlush = vi.fn();
    const controller = createSnapshotRefreshController({
      eventWindowMs: 180,
      eventMaxWaitMs: 250,
      onFlush,
    });

    controller.request("manual");

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith("manual");
  });
});
