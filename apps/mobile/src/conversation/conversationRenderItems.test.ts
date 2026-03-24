import { describe, expect, it } from "vitest";
import type { OrchestrationMessage } from "@t3tools/contracts";

import { buildConversationRenderItems } from "./conversationRenderItems";

describe("buildConversationRenderItems", () => {
  it("emits empty-state rows when there is no content", () => {
    expect(
      buildConversationRenderItems({
        timelineEntries: [],
        pinnedQueuedMessages: [],
        showWaitingIndicator: false,
      }),
    ).toEqual([{ kind: "empty", id: "empty-state" }]);
  });

  it("keeps timeline rows before queued rows and appends waiting rows last", () => {
    const items = buildConversationRenderItems({
      timelineEntries: [
        {
          kind: "message",
          id: "message-1",
          createdAt: "2026-03-24T00:00:00.000Z",
          message: {
            id: "message-1",
            role: "assistant",
            text: "Hello",
            turnId: null,
            streaming: false,
            createdAt: "2026-03-24T00:00:00.000Z",
            updatedAt: "2026-03-24T00:00:00.000Z",
          } as OrchestrationMessage,
        },
      ],
      pinnedQueuedMessages: [
        {
          badgeLabel: "Queued 1",
          message: {
            id: "message-2",
            role: "user",
            text: "Queued",
            turnId: null,
            streaming: false,
            createdAt: "2026-03-24T00:00:01.000Z",
            updatedAt: "2026-03-24T00:00:01.000Z",
          } as OrchestrationMessage,
        },
      ],
      showWaitingIndicator: true,
    });

    expect(items.map((item) => item.kind)).toEqual(["timeline", "queued", "waiting"]);
  });
});
