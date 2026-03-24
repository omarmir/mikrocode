export type RefreshTrigger = "event" | "manual" | "bootstrap";

export interface SnapshotRefreshScheduler {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (timeout: ReturnType<typeof setTimeout>) => void;
}

export interface SnapshotRefreshController {
  readonly request: (trigger: RefreshTrigger) => void;
  readonly cancel: () => void;
}

export function createSnapshotRefreshController(input: {
  readonly eventWindowMs: number;
  readonly eventMaxWaitMs: number;
  readonly onFlush: (trigger: RefreshTrigger) => void;
  readonly scheduler?: SnapshotRefreshScheduler;
}): SnapshotRefreshController {
  const scheduler =
    input.scheduler ??
    ({
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (timeout) => clearTimeout(timeout),
    } satisfies SnapshotRefreshScheduler);

  let firstEventAt: number | null = null;
  let eventTimer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (eventTimer !== null) {
      scheduler.clearTimeout(eventTimer);
      eventTimer = null;
    }
    firstEventAt = null;
  };

  const flushEvent = () => {
    eventTimer = null;
    firstEventAt = null;
    input.onFlush("event");
  };

  const request = (trigger: RefreshTrigger) => {
    if (trigger !== "event") {
      cancel();
      input.onFlush(trigger);
      return;
    }

    const now = scheduler.now();
    if (firstEventAt === null) {
      firstEventAt = now;
    }

    const deadline = Math.min(firstEventAt + input.eventMaxWaitMs, now + input.eventWindowMs);
    const delayMs = Math.max(0, deadline - now);

    if (eventTimer !== null) {
      scheduler.clearTimeout(eventTimer);
    }
    eventTimer = scheduler.setTimeout(flushEvent, delayMs);
  };

  return {
    request,
    cancel,
  };
}
