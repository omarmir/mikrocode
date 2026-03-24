import type { OrchestrationMessage } from "@t3tools/contracts";

import type { ThreadTimelineEntry } from "../threadDiffs";

export type PinnedConversationMessage = {
  readonly badgeLabel: string;
  readonly message: OrchestrationMessage;
};

export type ConversationRenderItem =
  | {
      readonly kind: "timeline";
      readonly id: string;
      readonly entry: ThreadTimelineEntry;
    }
  | {
      readonly kind: "queued";
      readonly id: string;
      readonly badgeLabel: string;
      readonly message: OrchestrationMessage;
    }
  | {
      readonly kind: "waiting";
      readonly id: "waiting-indicator";
    }
  | {
      readonly kind: "empty";
      readonly id: "empty-state";
    };

export function buildConversationRenderItems(input: {
  readonly timelineEntries: ReadonlyArray<ThreadTimelineEntry>;
  readonly pinnedQueuedMessages: ReadonlyArray<PinnedConversationMessage>;
  readonly showWaitingIndicator: boolean;
}): ReadonlyArray<ConversationRenderItem> {
  const items: ConversationRenderItem[] = [];

  for (const entry of input.timelineEntries) {
    items.push({
      kind: "timeline",
      id: `timeline:${entry.id}`,
      entry,
    });
  }

  for (const queuedMessage of input.pinnedQueuedMessages) {
    items.push({
      kind: "queued",
      id: `queued:${queuedMessage.message.id}`,
      badgeLabel: queuedMessage.badgeLabel,
      message: queuedMessage.message,
    });
  }

  if (items.length === 0) {
    items.push({
      kind: "empty",
      id: "empty-state",
    });
  }

  if (input.showWaitingIndicator) {
    items.push({
      kind: "waiting",
      id: "waiting-indicator",
    });
  }

  return items;
}
