import type { ThreadTimelineEntry } from "../threadDiffs";

export type ConversationTimelineWindow = {
  readonly visibleTimelineEntries: ReadonlyArray<ThreadTimelineEntry>;
  readonly hiddenEntryCount: number;
  readonly hiddenTurnCount: number;
};

function resolveTimelineEntryTurnKey(entry: ThreadTimelineEntry) {
  switch (entry.kind) {
    case "message":
      return entry.message.turnId ?? `message:${entry.message.id}`;
    case "proposedPlan":
      return entry.proposedPlan.turnId ?? `proposed-plan:${entry.proposedPlan.id}`;
    case "diff":
      return entry.turnId;
    case "activityGroup": {
      let latestTurnId: string | null = null;
      for (let index = entry.activities.length - 1; index >= 0; index -= 1) {
        const activity = entry.activities[index];
        if (!activity || activity.turnId === null) {
          continue;
        }

        latestTurnId = activity.turnId;
        break;
      }
      return latestTurnId ?? `activity-group:${entry.id}`;
    }
  }
}

export function buildConversationTimelineWindow(input: {
  readonly timelineEntries: ReadonlyArray<ThreadTimelineEntry>;
  readonly visibleTurnCount: number;
}): ConversationTimelineWindow {
  if (input.timelineEntries.length === 0) {
    return {
      visibleTimelineEntries: input.timelineEntries,
      hiddenEntryCount: 0,
      hiddenTurnCount: 0,
    };
  }

  const clampedVisibleTurnCount = Math.max(1, Math.floor(input.visibleTurnCount));
  const orderedTurnKeys: string[] = [];
  const seenTurnKeys = new Set<string>();

  for (const entry of input.timelineEntries) {
    const turnKey = resolveTimelineEntryTurnKey(entry);
    if (seenTurnKeys.has(turnKey)) {
      continue;
    }

    seenTurnKeys.add(turnKey);
    orderedTurnKeys.push(turnKey);
  }

  if (orderedTurnKeys.length <= clampedVisibleTurnCount) {
    return {
      visibleTimelineEntries: input.timelineEntries,
      hiddenEntryCount: 0,
      hiddenTurnCount: 0,
    };
  }

  const visibleTurnKeys = new Set(orderedTurnKeys.slice(-clampedVisibleTurnCount));
  const hiddenTurnKeys = new Set<string>();
  const visibleTimelineEntries: ThreadTimelineEntry[] = [];
  let hiddenEntryCount = 0;

  for (const entry of input.timelineEntries) {
    const turnKey = resolveTimelineEntryTurnKey(entry);
    if (visibleTurnKeys.has(turnKey)) {
      visibleTimelineEntries.push(entry);
      continue;
    }

    hiddenTurnKeys.add(turnKey);
    hiddenEntryCount += 1;
  }

  return {
    visibleTimelineEntries,
    hiddenEntryCount,
    hiddenTurnCount: hiddenTurnKeys.size,
  };
}
