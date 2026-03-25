import type {
  OrchestrationEvent,
  OrchestrationSnapshotInvalidationPayload,
} from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";

export interface SnapshotInvalidationScheduler {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (timeout: ReturnType<typeof setTimeout>) => void;
}

export interface SnapshotInvalidationBuffer {
  readonly push: (payload: OrchestrationSnapshotInvalidationPayload) => void;
  readonly flush: () => void;
  readonly cancel: () => void;
}

export function buildSnapshotInvalidation(
  event: OrchestrationEvent,
): OrchestrationSnapshotInvalidationPayload {
  return {
    snapshotSequence: event.sequence,
    threadIds: event.aggregateKind === "thread" ? [ThreadId.makeUnsafe(event.aggregateId)] : [],
  };
}

export function mergeSnapshotInvalidations(
  left: OrchestrationSnapshotInvalidationPayload,
  right: OrchestrationSnapshotInvalidationPayload,
): OrchestrationSnapshotInvalidationPayload {
  const threadIds = new Set(left.threadIds);
  for (const threadId of right.threadIds) {
    threadIds.add(threadId);
  }

  return {
    snapshotSequence: Math.max(left.snapshotSequence, right.snapshotSequence),
    threadIds: Array.from(threadIds),
  };
}

export function createSnapshotInvalidationBuffer(input: {
  readonly windowMs: number;
  readonly maxWaitMs: number;
  readonly onFlush: (payload: OrchestrationSnapshotInvalidationPayload) => void;
  readonly scheduler?: SnapshotInvalidationScheduler;
}): SnapshotInvalidationBuffer {
  const scheduler =
    input.scheduler ??
    ({
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (timeout) => clearTimeout(timeout),
    } satisfies SnapshotInvalidationScheduler);

  let firstPushAt: number | null = null;
  let bufferedPayload: OrchestrationSnapshotInvalidationPayload | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (flushTimer !== null) {
      scheduler.clearTimeout(flushTimer);
      flushTimer = null;
    }
    firstPushAt = null;
    bufferedPayload = null;
  };

  const flush = () => {
    const payload = bufferedPayload;
    if (flushTimer !== null) {
      scheduler.clearTimeout(flushTimer);
      flushTimer = null;
    }
    firstPushAt = null;
    bufferedPayload = null;

    if (payload !== null) {
      input.onFlush(payload);
    }
  };

  const push = (payload: OrchestrationSnapshotInvalidationPayload) => {
    const now = scheduler.now();
    bufferedPayload =
      bufferedPayload === null ? payload : mergeSnapshotInvalidations(bufferedPayload, payload);

    if (firstPushAt === null) {
      firstPushAt = now;
    }

    const deadline = Math.min(firstPushAt + input.maxWaitMs, now + input.windowMs);
    const delayMs = Math.max(0, deadline - now);

    if (flushTimer !== null) {
      scheduler.clearTimeout(flushTimer);
    }
    flushTimer = scheduler.setTimeout(flush, delayMs);
  };

  return {
    push,
    flush,
    cancel,
  };
}
