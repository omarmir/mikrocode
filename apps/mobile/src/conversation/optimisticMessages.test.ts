import { describe, expect, it } from "vitest";
import type { OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";

import {
  appendOptimisticThreadMessage,
  createOptimisticUserMessage,
  mergeOptimisticMessages,
  pruneOptimisticMessagesBySnapshot,
  removeOptimisticThreadMessage,
} from "./optimisticMessages";

const TEST_MESSAGE_ID = "message-1" as OrchestrationMessage["id"];
const TEST_THREAD_ID = "thread-1" as OrchestrationThread["id"];

function createMessage(id: string, text = "Hello"): OrchestrationMessage {
  return {
    id: id as OrchestrationMessage["id"],
    role: "user",
    text,
    turnId: null,
    streaming: false,
    createdAt: "2026-03-27T00:00:00.000Z",
    updatedAt: "2026-03-27T00:00:00.000Z",
  };
}

function createThread(
  id: string,
  messages: ReadonlyArray<OrchestrationMessage>,
): OrchestrationThread {
  return {
    id: id as OrchestrationThread["id"],
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
    messages: [...messages],
    queuedTurns: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  } as unknown as OrchestrationThread;
}

describe("optimisticMessages", () => {
  it("creates optimistic user messages with stable user-facing fields", () => {
    expect(
      createOptimisticUserMessage({
        messageId: TEST_MESSAGE_ID,
        text: "Ship it",
        createdAt: "2026-03-27T12:00:00.000Z",
      }),
    ).toEqual({
      id: "message-1",
      role: "user",
      text: "Ship it",
      attachments: undefined,
      turnId: null,
      streaming: false,
      createdAt: "2026-03-27T12:00:00.000Z",
      updatedAt: "2026-03-27T12:00:00.000Z",
    });
  });

  it("merges optimistic messages without duplicating acknowledged server messages", () => {
    const serverMessage = createMessage("message-1", "Server");
    const optimisticMessage = createMessage("message-2", "Local");

    expect(mergeOptimisticMessages([serverMessage], [serverMessage, optimisticMessage])).toEqual([
      serverMessage,
      optimisticMessage,
    ]);
  });

  it("prunes optimistic messages once the snapshot includes the same message id", () => {
    const current = {
      "thread-1": [createMessage("message-1"), createMessage("message-2")],
    };

    expect(
      pruneOptimisticMessagesBySnapshot(current, [
        createThread("thread-1", [createMessage("message-1")]),
      ]),
    ).toEqual({
      "thread-1": [createMessage("message-2")],
    });
  });

  it("can append and remove optimistic thread messages", () => {
    const appended = appendOptimisticThreadMessage(
      {},
      {
        threadId: TEST_THREAD_ID,
        message: createMessage("message-1"),
      },
    );

    expect(appended).toEqual({
      "thread-1": [createMessage("message-1")],
    });

    expect(
      removeOptimisticThreadMessage(appended, {
        threadId: TEST_THREAD_ID,
        messageId: TEST_MESSAGE_ID,
      }),
    ).toEqual({});
  });
});
