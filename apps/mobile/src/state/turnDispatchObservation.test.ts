import { describe, expect, it } from "vitest";
import type {
  OrchestrationMessage,
  OrchestrationReadModel,
  OrchestrationThread,
} from "@t3tools/contracts";

import {
  snapshotHasObservedDispatchedMessage,
  threadHasObservedDispatchedMessage,
} from "./turnDispatchObservation";

function createMessage(id: string): OrchestrationMessage {
  return {
    id: id as OrchestrationMessage["id"],
    role: "user",
    text: "Hello",
    turnId: null,
    streaming: false,
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
  };
}

function createThread(input: {
  readonly id?: string;
  readonly messages?: ReadonlyArray<OrchestrationMessage>;
  readonly queuedMessageIds?: ReadonlyArray<string>;
}): OrchestrationThread {
  return {
    id: (input.id ?? "thread-1") as OrchestrationThread["id"],
    projectId: "project-1",
    title: "Thread",
    model: "gpt-5.4",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
    deletedAt: null,
    messages: [...(input.messages ?? [])],
    queuedTurns: (input.queuedMessageIds ?? []).map((messageId) => ({
      messageId: messageId as OrchestrationMessage["id"],
      dispatchMode: "queue",
      createdAt: "2026-03-27T00:00:00.000Z",
    })),
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  } as unknown as OrchestrationThread;
}

function createSnapshot(threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-03-27T00:00:00.000Z",
    projects: [],
    threads: [...threads],
  } as unknown as OrchestrationReadModel;
}

describe("turnDispatchObservation", () => {
  it("observes a dispatched message once it exists in thread messages", () => {
    expect(
      threadHasObservedDispatchedMessage(
        createThread({
          messages: [createMessage("message-1")],
        }),
        "message-1" as OrchestrationMessage["id"],
      ),
    ).toBe(true);
  });

  it("observes a dispatched message once it appears in queued turns", () => {
    expect(
      threadHasObservedDispatchedMessage(
        createThread({
          queuedMessageIds: ["message-1"],
        }),
        "message-1" as OrchestrationMessage["id"],
      ),
    ).toBe(true);
  });

  it("checks the selected thread within a snapshot", () => {
    expect(
      snapshotHasObservedDispatchedMessage({
        snapshot: createSnapshot([
          createThread({
            id: "thread-1",
            messages: [createMessage("message-1")],
          }),
        ]),
        threadId: "thread-1" as OrchestrationThread["id"],
        messageId: "message-1" as OrchestrationMessage["id"],
      }),
    ).toBe(true);
  });
});
