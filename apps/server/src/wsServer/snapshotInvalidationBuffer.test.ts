import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  buildSnapshotInvalidation,
  createSnapshotInvalidationBuffer,
  mergeSnapshotInvalidations,
} from "./snapshotInvalidationBuffer";

const now = "2026-03-25T12:00:00.000Z";

function makeThreadEvent(input: {
  readonly sequence: number;
  readonly threadId: ThreadId;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`event-${input.sequence}`),
    aggregateKind: "thread",
    aggregateId: input.threadId,
    occurredAt: now,
    commandId: CommandId.makeUnsafe(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(`command-${input.sequence}`),
    metadata: {},
    type: "thread.session-stop-requested",
    payload: {
      threadId: input.threadId,
      createdAt: now,
    },
  };
}

describe("snapshotInvalidationBuffer", () => {
  it("builds invalidations from thread events", () => {
    const threadId = ThreadId.makeUnsafe("thread-1");

    expect(buildSnapshotInvalidation(makeThreadEvent({ sequence: 9, threadId }))).toEqual({
      snapshotSequence: 9,
      threadIds: [threadId],
    });
  });

  it("merges snapshot sequences and thread ids", () => {
    const threadA = ThreadId.makeUnsafe("thread-a");
    const threadB = ThreadId.makeUnsafe("thread-b");

    expect(
      mergeSnapshotInvalidations(
        {
          snapshotSequence: 10,
          threadIds: [threadA],
        },
        {
          snapshotSequence: 13,
          threadIds: [threadA, threadB],
        },
      ),
    ).toEqual({
      snapshotSequence: 13,
      threadIds: [threadA, threadB],
    });
  });

  it("coalesces rapid invalidations into one timed flush", () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const onFlush = vi.fn();
    const threadA = ThreadId.makeUnsafe("thread-a");
    const threadB = ThreadId.makeUnsafe("thread-b");

    const buffer = createSnapshotInvalidationBuffer({
      windowMs: 75,
      maxWaitMs: 150,
      onFlush,
      scheduler: {
        now: () => nowMs,
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: (timeout) => clearTimeout(timeout),
      },
    });

    buffer.push({ snapshotSequence: 10, threadIds: [threadA] });
    nowMs = 40;
    buffer.push({ snapshotSequence: 11, threadIds: [threadB] });
    nowMs = 100;
    buffer.push({ snapshotSequence: 12, threadIds: [threadA] });

    vi.advanceTimersByTime(49);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({
      snapshotSequence: 12,
      threadIds: [threadA, threadB],
    });

    vi.useRealTimers();
  });

  it("builds empty thread lists for project-scoped events", () => {
    const event: OrchestrationEvent = {
      sequence: 5,
      eventId: EventId.makeUnsafe("event-project"),
      aggregateKind: "project",
      aggregateId: ProjectId.makeUnsafe("project-1"),
      occurredAt: now,
      commandId: CommandId.makeUnsafe("command-project"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("command-project"),
      metadata: {},
      type: "project.deleted",
      payload: {
        projectId: ProjectId.makeUnsafe("project-1"),
        deletedAt: now,
      },
    };

    expect(buildSnapshotInvalidation(event)).toEqual({
      snapshotSequence: 5,
      threadIds: [],
    });
  });
});
