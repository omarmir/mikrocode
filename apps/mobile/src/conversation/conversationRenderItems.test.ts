import { describe, expect, it } from "vitest";
import type { OrchestrationMessage } from "@t3tools/contracts";

import {
  buildConversationRenderItems,
  getConversationRenderItemType,
} from "./conversationRenderItems";

function createMessage(input: {
  readonly id: string;
  readonly role?: "assistant" | "user";
  readonly text?: string;
  readonly streaming?: boolean;
  readonly updatedAt?: string;
}) {
  return {
    id: input.id,
    role: input.role ?? "assistant",
    text: input.text ?? "Hello",
    turnId: null,
    streaming: input.streaming ?? false,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-03-24T00:00:00.000Z",
  } as OrchestrationMessage;
}

describe("buildConversationRenderItems", () => {
  it("emits empty-state rows when there is no content", () => {
    expect(
      buildConversationRenderItems({
        timelineEntries: [],
        hiddenHistorySummary: null,
        pinnedQueuedMessages: [],
        showWaitingIndicator: false,
        highlightedAssistantMessageId: null,
        expandedAssistantMessageIds: {},
        expandedActivityGroupIds: {},
        expandedDiffIds: {},
        expandedDiffFileIds: {},
        hydratedTurnDiffs: {},
        revealedMessageId: null,
        selectedThreadConversationId: null,
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
          message: createMessage({ id: "message-1" }),
        },
      ],
      hiddenHistorySummary: null,
      pinnedQueuedMessages: [
        {
          badgeLabel: "Queued 1",
          message: createMessage({ id: "message-2", role: "user", text: "Queued" }),
        },
      ],
      showWaitingIndicator: true,
      highlightedAssistantMessageId: "message-1",
      expandedAssistantMessageIds: {},
      expandedActivityGroupIds: {},
      expandedDiffIds: {},
      expandedDiffFileIds: {},
      hydratedTurnDiffs: {},
      revealedMessageId: null,
      selectedThreadConversationId: "thread-1",
    });

    expect(items.map((item) => item.kind)).toEqual(["message", "queued", "waiting"]);
  });

  it("reuses row identities when the view model is unchanged", () => {
    const timelineEntries = [
      {
        kind: "message" as const,
        id: "message-1",
        createdAt: "2026-03-24T00:00:00.000Z",
        message: createMessage({ id: "message-1" }),
      },
    ];
    const firstPass = buildConversationRenderItems({
      timelineEntries,
      hiddenHistorySummary: null,
      pinnedQueuedMessages: [],
      showWaitingIndicator: false,
      highlightedAssistantMessageId: null,
      expandedAssistantMessageIds: {},
      expandedActivityGroupIds: {},
      expandedDiffIds: {},
      expandedDiffFileIds: {},
      hydratedTurnDiffs: {},
      revealedMessageId: null,
      selectedThreadConversationId: "thread-1",
    });
    const secondPass = buildConversationRenderItems({
      previousItems: firstPass,
      timelineEntries,
      hiddenHistorySummary: null,
      pinnedQueuedMessages: [],
      showWaitingIndicator: false,
      highlightedAssistantMessageId: null,
      expandedAssistantMessageIds: {},
      expandedActivityGroupIds: {},
      expandedDiffIds: {},
      expandedDiffFileIds: {},
      hydratedTurnDiffs: {},
      revealedMessageId: null,
      selectedThreadConversationId: "thread-1",
    });

    expect(secondPass[0]).toBe(firstPass[0]);
  });

  it("emits granular recycle types for different message row shapes", () => {
    expect(
      getConversationRenderItemType({
        kind: "message",
        id: "user-message",
        message: createMessage({ id: "user-message", role: "user" }),
        badgeLabel: null,
        highlighted: false,
        expandable: false,
        expanded: true,
        isMetaRevealed: false,
      }),
    ).toBe("message-user");

    expect(
      getConversationRenderItemType({
        kind: "message",
        id: "assistant-message",
        message: createMessage({ id: "assistant-message", role: "assistant" }),
        badgeLabel: null,
        highlighted: false,
        expandable: true,
        expanded: false,
        isMetaRevealed: false,
      }),
    ).toBe("message-assistant-collapsed");

    expect(
      getConversationRenderItemType({
        kind: "queued",
        id: "queued:assistant-message",
        message: createMessage({ id: "assistant-message", role: "assistant" }),
        badgeLabel: "Queued 1",
        isMetaRevealed: false,
      }),
    ).toBe("message-queued");
  });

  it("prepends a show-more row when older history is hidden", () => {
    const items = buildConversationRenderItems({
      timelineEntries: [
        {
          kind: "message",
          id: "message-1",
          createdAt: "2026-03-24T00:00:00.000Z",
          message: createMessage({ id: "message-1" }),
        },
      ],
      hiddenHistorySummary: {
        hiddenEntryCount: 12,
        hiddenTurnCount: 6,
        revealTurnCount: 6,
      },
      pinnedQueuedMessages: [],
      showWaitingIndicator: false,
      highlightedAssistantMessageId: null,
      expandedAssistantMessageIds: {},
      expandedActivityGroupIds: {},
      expandedDiffIds: {},
      expandedDiffFileIds: {},
      hydratedTurnDiffs: {},
      revealedMessageId: null,
      selectedThreadConversationId: "thread-1",
    });

    expect(items.map((item) => item.kind)).toEqual(["show-more-history", "message"]);
  });
});
