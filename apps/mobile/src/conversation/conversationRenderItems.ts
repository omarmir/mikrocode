import type { OrchestrationMessage, OrchestrationProposedPlan } from "@t3tools/contracts";

import type { ThreadDiffEntry, ThreadTimelineEntry } from "../threadDiffs";
import {
  EMPTY_EXPANDED_DIFF_FILE_IDS,
  shouldCollapseAssistantMessage,
  threadDiffCacheKey,
  type HydratedTurnDiffState,
} from "./renderUtils";

export type PinnedConversationMessage = {
  readonly badgeLabel: string;
  readonly message: OrchestrationMessage;
};

export type ConversationMessageRowItem = {
  readonly kind: "message";
  readonly id: string;
  readonly message: OrchestrationMessage;
  readonly badgeLabel: string | null;
  readonly highlighted: boolean;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly isMetaRevealed: boolean;
};

export type ConversationQueuedRowItem = {
  readonly kind: "queued";
  readonly id: string;
  readonly message: OrchestrationMessage;
  readonly badgeLabel: string;
  readonly isMetaRevealed: boolean;
};

export type ConversationActivityGroupRowItem = {
  readonly kind: "activity-group";
  readonly id: string;
  readonly entry: Extract<ThreadTimelineEntry, { readonly kind: "activityGroup" }>;
  readonly expanded: boolean;
};

export type ConversationDiffRowItem = {
  readonly kind: "diff";
  readonly id: string;
  readonly entry: ThreadDiffEntry;
  readonly expanded: boolean;
  readonly expandedFileIds: Readonly<Record<string, true>>;
  readonly hydratedDiff: HydratedTurnDiffState | null;
};

export type ConversationPlanRowItem = {
  readonly kind: "plan";
  readonly id: string;
  readonly proposedPlan: OrchestrationProposedPlan;
};

export type ConversationWaitingRowItem = {
  readonly kind: "waiting";
  readonly id: "waiting-indicator";
};

export type ConversationEmptyRowItem = {
  readonly kind: "empty";
  readonly id: "empty-state";
};

export type ConversationRenderItem =
  | ConversationMessageRowItem
  | ConversationQueuedRowItem
  | ConversationActivityGroupRowItem
  | ConversationDiffRowItem
  | ConversationPlanRowItem
  | ConversationWaitingRowItem
  | ConversationEmptyRowItem;

function reuseItemIfUnchanged<T extends ConversationRenderItem>(
  previousItemsById: Map<string, ConversationRenderItem>,
  nextItem: T,
  isEqual: (previousItem: T, nextItem: T) => boolean,
) {
  const previousItem = previousItemsById.get(nextItem.id);
  if (previousItem && previousItem.kind === nextItem.kind && isEqual(previousItem as T, nextItem)) {
    return previousItem as T;
  }

  return nextItem;
}

function equalMessageRow(
  previousItem: ConversationMessageRowItem,
  nextItem: ConversationMessageRowItem,
) {
  return (
    previousItem.message === nextItem.message &&
    previousItem.badgeLabel === nextItem.badgeLabel &&
    previousItem.highlighted === nextItem.highlighted &&
    previousItem.expandable === nextItem.expandable &&
    previousItem.expanded === nextItem.expanded &&
    previousItem.isMetaRevealed === nextItem.isMetaRevealed
  );
}

function equalQueuedRow(
  previousItem: ConversationQueuedRowItem,
  nextItem: ConversationQueuedRowItem,
) {
  return (
    previousItem.message === nextItem.message &&
    previousItem.badgeLabel === nextItem.badgeLabel &&
    previousItem.isMetaRevealed === nextItem.isMetaRevealed
  );
}

function equalActivityGroupRow(
  previousItem: ConversationActivityGroupRowItem,
  nextItem: ConversationActivityGroupRowItem,
) {
  return previousItem.entry === nextItem.entry && previousItem.expanded === nextItem.expanded;
}

function equalDiffRow(previousItem: ConversationDiffRowItem, nextItem: ConversationDiffRowItem) {
  return (
    previousItem.entry === nextItem.entry &&
    previousItem.expanded === nextItem.expanded &&
    previousItem.expandedFileIds === nextItem.expandedFileIds &&
    previousItem.hydratedDiff === nextItem.hydratedDiff
  );
}

function equalPlanRow(previousItem: ConversationPlanRowItem, nextItem: ConversationPlanRowItem) {
  return previousItem.proposedPlan === nextItem.proposedPlan;
}

function buildDiffRowItem(input: {
  readonly entry: ThreadDiffEntry;
  readonly expandedDiffIds: Readonly<Record<string, true>>;
  readonly expandedDiffFileIds: Readonly<Record<string, Readonly<Record<string, true>>>>;
  readonly hydratedTurnDiffs: Readonly<Record<string, HydratedTurnDiffState>>;
  readonly selectedThreadConversationId: string | null;
}) {
  const hydratedDiff =
    input.selectedThreadConversationId === null
      ? null
      : (input.hydratedTurnDiffs[
          threadDiffCacheKey(input.selectedThreadConversationId, input.entry.turnId)
        ] ?? null);

  return {
    kind: "diff",
    id: input.entry.id,
    entry: input.entry,
    expanded: input.expandedDiffIds[input.entry.id] === true,
    expandedFileIds: input.expandedDiffFileIds[input.entry.id] ?? EMPTY_EXPANDED_DIFF_FILE_IDS,
    hydratedDiff,
  } satisfies ConversationDiffRowItem;
}

export function getConversationRenderItemType(item: ConversationRenderItem) {
  switch (item.kind) {
    case "message":
      if (item.message.role === "user") {
        return "message-user";
      }
      if (item.message.streaming) {
        return "message-assistant-streaming";
      }
      return item.expandable && !item.expanded
        ? "message-assistant-collapsed"
        : "message-assistant";
    case "queued":
      return "message-queued";
    case "activity-group":
      return item.expanded ? "activity-group-expanded" : "activity-group";
    case "diff":
      return item.expanded ? "diff-expanded" : "diff";
    case "plan":
      return "plan";
    case "waiting":
      return "waiting";
    case "empty":
      return "empty";
  }
}

export function buildConversationRenderItems(input: {
  readonly previousItems?: ReadonlyArray<ConversationRenderItem>;
  readonly timelineEntries: ReadonlyArray<ThreadTimelineEntry>;
  readonly pinnedQueuedMessages: ReadonlyArray<PinnedConversationMessage>;
  readonly showWaitingIndicator: boolean;
  readonly highlightedAssistantMessageId: string | null;
  readonly expandedAssistantMessageIds: Readonly<Record<string, true>>;
  readonly expandedActivityGroupIds: Readonly<Record<string, true>>;
  readonly expandedDiffIds: Readonly<Record<string, true>>;
  readonly expandedDiffFileIds: Readonly<Record<string, Readonly<Record<string, true>>>>;
  readonly hydratedTurnDiffs: Readonly<Record<string, HydratedTurnDiffState>>;
  readonly revealedMessageId: string | null;
  readonly selectedThreadConversationId: string | null;
}): ReadonlyArray<ConversationRenderItem> {
  const items: ConversationRenderItem[] = [];
  const previousItemsById = new Map((input.previousItems ?? []).map((item) => [item.id, item]));

  for (const entry of input.timelineEntries) {
    if (entry.kind === "activityGroup") {
      items.push(
        reuseItemIfUnchanged(
          previousItemsById,
          {
            kind: "activity-group",
            id: entry.id,
            entry,
            expanded: input.expandedActivityGroupIds[entry.id] === true,
          } satisfies ConversationActivityGroupRowItem,
          equalActivityGroupRow,
        ),
      );
      continue;
    }

    if (entry.kind === "diff") {
      items.push(
        reuseItemIfUnchanged(
          previousItemsById,
          buildDiffRowItem({
            entry,
            expandedDiffIds: input.expandedDiffIds,
            expandedDiffFileIds: input.expandedDiffFileIds,
            hydratedTurnDiffs: input.hydratedTurnDiffs,
            selectedThreadConversationId: input.selectedThreadConversationId,
          }),
          equalDiffRow,
        ),
      );
      continue;
    }

    if (entry.kind === "proposedPlan") {
      items.push(
        reuseItemIfUnchanged(
          previousItemsById,
          {
            kind: "plan",
            id: entry.id,
            proposedPlan: entry.proposedPlan,
          } satisfies ConversationPlanRowItem,
          equalPlanRow,
        ),
      );
      continue;
    }

    const highlighted =
      entry.message.role === "assistant" &&
      entry.message.id === input.highlightedAssistantMessageId;
    const expandable = shouldCollapseAssistantMessage({
      highlighted,
      message: entry.message,
    });

    items.push(
      reuseItemIfUnchanged(
        previousItemsById,
        {
          kind: "message",
          id: entry.message.id,
          message: entry.message,
          badgeLabel: null,
          highlighted,
          expandable,
          expanded: !expandable || input.expandedAssistantMessageIds[entry.message.id] === true,
          isMetaRevealed: input.revealedMessageId === entry.message.id,
        } satisfies ConversationMessageRowItem,
        equalMessageRow,
      ),
    );
  }

  for (const queuedMessage of input.pinnedQueuedMessages) {
    items.push(
      reuseItemIfUnchanged(
        previousItemsById,
        {
          kind: "queued",
          id: `queued:${queuedMessage.message.id}`,
          badgeLabel: queuedMessage.badgeLabel,
          message: queuedMessage.message,
          isMetaRevealed: input.revealedMessageId === queuedMessage.message.id,
        } satisfies ConversationQueuedRowItem,
        equalQueuedRow,
      ),
    );
  }

  if (items.length === 0) {
    items.push(
      reuseItemIfUnchanged(
        previousItemsById,
        {
          kind: "empty",
          id: "empty-state",
        },
        () => true,
      ),
    );
  }

  if (input.showWaitingIndicator) {
    items.push(
      reuseItemIfUnchanged(
        previousItemsById,
        {
          kind: "waiting",
          id: "waiting-indicator",
        },
        () => true,
      ),
    );
  }

  return items;
}
