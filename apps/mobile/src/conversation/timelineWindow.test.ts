import { describe, expect, it } from "vitest";
import type { OrchestrationMessage, OrchestrationThreadActivity } from "@t3tools/contracts";

import { buildConversationTimelineWindow } from "./timelineWindow";

function createMessage(input: { readonly id: string; readonly turnId: string | null }) {
  return {
    id: input.id,
    role: "assistant",
    text: input.id,
    turnId: input.turnId,
    streaming: false,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
  } as OrchestrationMessage;
}

function createActivity(input: { readonly id: string; readonly turnId: string | null }) {
  return {
    id: input.id,
    tone: "info",
    kind: "task.progress",
    summary: input.id,
    payload: null,
    turnId: input.turnId,
    createdAt: "2026-03-24T00:00:00.000Z",
  } as OrchestrationThreadActivity;
}

describe("buildConversationTimelineWindow", () => {
  it("keeps the newest visible turns and hides older turns", () => {
    const timelineEntries = Array.from({ length: 12 }, (_, index) => ({
      kind: "message" as const,
      id: `message-${index + 1}`,
      createdAt: `2026-03-24T00:00:${String(index).padStart(2, "0")}.000Z`,
      message: createMessage({
        id: `message-${index + 1}`,
        turnId: `turn-${index + 1}`,
      }),
    }));

    const result = buildConversationTimelineWindow({
      timelineEntries,
      visibleTurnCount: 10,
    });

    expect(result.hiddenTurnCount).toBe(2);
    expect(result.hiddenEntryCount).toBe(2);
    expect(result.visibleTimelineEntries.map((entry) => entry.id)).toEqual([
      "message-3",
      "message-4",
      "message-5",
      "message-6",
      "message-7",
      "message-8",
      "message-9",
      "message-10",
      "message-11",
      "message-12",
    ]);
  });

  it("keeps all entries that belong to a visible turn", () => {
    const timelineEntries = [
      {
        kind: "message" as const,
        id: "message-1",
        createdAt: "2026-03-24T00:00:00.000Z",
        message: createMessage({ id: "message-1", turnId: "turn-1" }),
      },
      {
        kind: "message" as const,
        id: "message-2",
        createdAt: "2026-03-24T00:00:01.000Z",
        message: createMessage({ id: "message-2", turnId: "turn-2" }),
      },
      {
        kind: "activityGroup" as const,
        id: "activity-group:turn-2",
        createdAt: "2026-03-24T00:00:02.000Z",
        activities: [
          createActivity({ id: "activity-1", turnId: "turn-2" }),
          createActivity({ id: "activity-2", turnId: "turn-2" }),
        ],
      },
      {
        kind: "diff" as const,
        id: "diff:turn-2",
        createdAt: "2026-03-24T00:00:03.000Z",
        updatedAt: "2026-03-24T00:00:03.000Z",
        turnId: "turn-2",
        state: "ready" as const,
        checkpointTurnCount: 2,
        assistantMessageId: "message-2",
        files: [],
        previewUnifiedDiff: null,
        previewTruncated: false,
      },
    ];

    const result = buildConversationTimelineWindow({
      timelineEntries,
      visibleTurnCount: 1,
    });

    expect(result.hiddenTurnCount).toBe(1);
    expect(result.hiddenEntryCount).toBe(1);
    expect(result.visibleTimelineEntries.map((entry) => entry.id)).toEqual([
      "message-2",
      "activity-group:turn-2",
      "diff:turn-2",
    ]);
  });
});
