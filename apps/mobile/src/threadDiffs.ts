import type {
  OrchestrationCheckpointFile,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationThread,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";

type ThreadTimelineMessageEntry = {
  readonly kind: "message";
  readonly id: string;
  readonly createdAt: string;
  readonly message: OrchestrationMessage;
};

type ThreadTimelineProposedPlanEntry = {
  readonly kind: "proposedPlan";
  readonly id: string;
  readonly createdAt: string;
  readonly proposedPlan: OrchestrationProposedPlan;
};

export type ThreadDiffState = "streaming" | "ready" | "missing" | "error";

export type ThreadDiffEntry = {
  readonly kind: "diff";
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turnId: string;
  readonly state: ThreadDiffState;
  readonly checkpointTurnCount: number | null;
  readonly assistantMessageId: string | null;
  readonly files: ReadonlyArray<OrchestrationCheckpointFile>;
  readonly previewUnifiedDiff: string | null;
  readonly previewTruncated: boolean;
};

type ThreadTimelineActivityGroupEntry = {
  readonly kind: "activityGroup";
  readonly id: string;
  readonly createdAt: string;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
};

export type ThreadTimelineEntry =
  | ThreadTimelineMessageEntry
  | ThreadTimelineProposedPlanEntry
  | ThreadDiffEntry
  | ThreadTimelineActivityGroupEntry;

export type ParsedUnifiedDiffLineKind = "meta" | "hunk" | "context" | "addition" | "deletion";

export type ParsedUnifiedDiffLine = {
  readonly id: string;
  readonly kind: ParsedUnifiedDiffLineKind;
  readonly text: string;
};

export type ParsedUnifiedDiffFile = {
  readonly id: string;
  readonly path: string;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly lines: ReadonlyArray<ParsedUnifiedDiffLine>;
};

type ActivityPlaceholderEntry = {
  readonly kind: "activity";
  readonly activity: OrchestrationThreadActivity;
};

const INLINE_ACTIVITY_KINDS = new Set([
  "content.delta",
  "runtime.warning",
  "runtime.error",
  "turn.diff.updated",
  "turn.plan.updated",
  "task.started",
  "task.progress",
  "task.completed",
  "tool.started",
  "tool.updated",
  "tool.completed",
]);

function sortReadonlyArray<T>(items: ReadonlyArray<T>, compare: (left: T, right: T) => number) {
  // React Native/Hermes in this app does not guarantee modern Array helpers such
  // as toSorted(). Copy first, then sort the copy.
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...items].sort(compare);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readPayloadString(payload: unknown, key: string) {
  const record = asRecord(payload);
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readPayloadBoolean(payload: unknown, key: string) {
  const record = asRecord(payload);
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function readPayloadStreamKind(activity: OrchestrationThreadActivity) {
  return readPayloadString(activity.payload, "streamKind");
}

function isDiffActivity(activity: OrchestrationThreadActivity) {
  return (
    activity.kind === "turn.diff.updated" ||
    (activity.kind === "content.delta" && readPayloadStreamKind(activity) === "file_change_output")
  );
}

function shouldRenderInlineActivity(activity: OrchestrationThreadActivity) {
  return INLINE_ACTIVITY_KINDS.has(activity.kind) && !isDiffActivity(activity);
}

function timelineMessagePriority(message: OrchestrationMessage) {
  switch (message.role) {
    case "user":
      return 0;
    case "assistant":
      return 3;
    default:
      return 4;
  }
}

function compareInlineActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
) {
  if (
    left.sequence !== undefined &&
    right.sequence !== undefined &&
    left.sequence !== right.sequence
  ) {
    return left.sequence - right.sequence;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }
  return left.id.localeCompare(right.id);
}

function compareTimelineEntries(
  left:
    | ThreadTimelineMessageEntry
    | ThreadTimelineProposedPlanEntry
    | ThreadTimelineActivityGroupEntry
    | ThreadDiffEntry,
  right:
    | ThreadTimelineMessageEntry
    | ThreadTimelineProposedPlanEntry
    | ThreadTimelineActivityGroupEntry
    | ThreadDiffEntry,
) {
  if (left.kind === "activityGroup" && right.kind === "activityGroup") {
    const leftActivity = left.activities[0];
    const rightActivity = right.activities[0];
    if (leftActivity && rightActivity) {
      return compareInlineActivities(leftActivity, rightActivity);
    }
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt);
  }

  const leftPriority =
    left.kind === "message"
      ? timelineMessagePriority(left.message)
      : left.kind === "activityGroup"
        ? 1
        : left.kind === "diff"
          ? 2
          : 3;
  const rightPriority =
    right.kind === "message"
      ? timelineMessagePriority(right.message)
      : right.kind === "activityGroup"
        ? 1
        : right.kind === "diff"
          ? 2
          : 3;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.id.localeCompare(right.id);
}

function toComparableEntry(
  entry:
    | ThreadTimelineMessageEntry
    | ThreadTimelineProposedPlanEntry
    | ThreadDiffEntry
    | ActivityPlaceholderEntry,
):
  | ThreadTimelineMessageEntry
  | ThreadTimelineProposedPlanEntry
  | ThreadDiffEntry
  | ThreadTimelineActivityGroupEntry {
  return entry.kind === "activity"
    ? {
        kind: "activityGroup",
        id: `activity-group:${entry.activity.id}`,
        createdAt: entry.activity.createdAt,
        activities: [entry.activity],
      }
    : entry;
}

export function buildThreadDiffEntries(
  thread: OrchestrationThread | null,
): ReadonlyArray<ThreadDiffEntry> {
  if (!thread) {
    return [];
  }

  const diffEntriesByTurnId = new Map<string, ThreadDiffEntry>();
  const activeTurnId =
    thread.latestTurn?.state === "running" || thread.latestTurn?.state === "interrupted"
      ? thread.latestTurn.turnId
      : null;

  for (const activity of sortReadonlyArray(thread.activities, compareInlineActivities)) {
    if (!isDiffActivity(activity) || !activity.turnId) {
      continue;
    }

    const delta = readPayloadString(activity.payload, "delta");
    const previous = diffEntriesByTurnId.get(activity.turnId);
    const previewUnifiedDiff =
      activity.kind === "turn.diff.updated"
        ? delta
        : previous?.previewUnifiedDiff && delta
          ? `${previous.previewUnifiedDiff}${delta}`
          : (previous?.previewUnifiedDiff ?? delta);

    diffEntriesByTurnId.set(activity.turnId, {
      kind: "diff",
      id: previous?.id ?? `diff:${activity.turnId}`,
      createdAt: previous?.createdAt ?? activity.createdAt,
      updatedAt: activity.createdAt,
      turnId: activity.turnId,
      state: activity.turnId === activeTurnId ? "streaming" : (previous?.state ?? "streaming"),
      checkpointTurnCount: previous?.checkpointTurnCount ?? null,
      assistantMessageId: previous?.assistantMessageId ?? null,
      files: previous?.files ?? [],
      previewUnifiedDiff: previewUnifiedDiff ?? null,
      previewTruncated:
        previous?.previewTruncated === true ||
        readPayloadBoolean(activity.payload, "truncated") === true,
    });
  }

  for (const checkpoint of thread.checkpoints) {
    const previous = diffEntriesByTurnId.get(checkpoint.turnId);
    const state: ThreadDiffState =
      checkpoint.status === "ready"
        ? "ready"
        : checkpoint.status === "error"
          ? "error"
          : checkpoint.turnId === activeTurnId && previous?.previewUnifiedDiff
            ? "streaming"
            : "missing";

    diffEntriesByTurnId.set(checkpoint.turnId, {
      kind: "diff",
      id: previous?.id ?? `diff:${checkpoint.turnId}`,
      createdAt: previous?.createdAt ?? checkpoint.completedAt,
      updatedAt:
        previous && previous.updatedAt > checkpoint.completedAt
          ? previous.updatedAt
          : checkpoint.completedAt,
      turnId: checkpoint.turnId,
      state,
      checkpointTurnCount: checkpoint.checkpointTurnCount,
      assistantMessageId: checkpoint.assistantMessageId,
      files: checkpoint.files,
      previewUnifiedDiff: previous?.previewUnifiedDiff ?? null,
      previewTruncated: previous?.previewTruncated ?? false,
    });
  }

  return sortReadonlyArray(Array.from(diffEntriesByTurnId.values()), (left, right) =>
    left.createdAt !== right.createdAt
      ? left.createdAt.localeCompare(right.createdAt)
      : left.id.localeCompare(right.id),
  );
}

export function buildThreadTimelineEntries(input: {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly proposedPlans: ReadonlyArray<OrchestrationProposedPlan>;
  readonly diffs: ReadonlyArray<ThreadDiffEntry>;
}): ReadonlyArray<ThreadTimelineEntry> {
  const merged = sortReadonlyArray<
    | ThreadTimelineMessageEntry
    | ThreadTimelineProposedPlanEntry
    | ThreadDiffEntry
    | ActivityPlaceholderEntry
  >(
    [
      ...input.messages.map(
        (message) =>
          ({
            kind: "message",
            id: message.id,
            createdAt: message.createdAt,
            message,
          }) satisfies ThreadTimelineMessageEntry,
      ),
      ...input.proposedPlans.map(
        (proposedPlan) =>
          ({
            kind: "proposedPlan",
            id: `proposed-plan:${proposedPlan.id}`,
            createdAt: proposedPlan.createdAt,
            proposedPlan,
          }) satisfies ThreadTimelineProposedPlanEntry,
      ),
      ...input.diffs,
      ...input.activities
        .filter((activity) => shouldRenderInlineActivity(activity))
        .map((activity) => ({
          kind: "activity" as const,
          activity,
        })),
    ],
    (left, right) => {
      if (left.kind === "activity" && right.kind === "activity") {
        return compareInlineActivities(left.activity, right.activity);
      }
      return compareTimelineEntries(toComparableEntry(left), toComparableEntry(right));
    },
  );

  const timeline: ThreadTimelineEntry[] = [];
  let bufferedActivities: OrchestrationThreadActivity[] = [];

  const flushBufferedActivities = () => {
    const firstActivity = bufferedActivities[0];
    const lastActivity = bufferedActivities[bufferedActivities.length - 1];
    if (!firstActivity || !lastActivity) {
      bufferedActivities = [];
      return;
    }

    timeline.push({
      kind: "activityGroup",
      id: `activity-group:${firstActivity.id}:${lastActivity.id}`,
      createdAt: firstActivity.createdAt,
      activities: bufferedActivities,
    });
    bufferedActivities = [];
  };

  for (const entry of merged) {
    if (entry.kind === "activity") {
      bufferedActivities = [...bufferedActivities, entry.activity];
      continue;
    }

    flushBufferedActivities();
    timeline.push(entry);
  }

  flushBufferedActivities();
  return timeline;
}

function stripGitPathPrefix(value: string) {
  if (value === "/dev/null") {
    return value;
  }
  return value.replace(/^[ab]\//u, "");
}

function finalizeParsedFile(
  files: ParsedUnifiedDiffFile[],
  nextFile: {
    id: string;
    path: string | null;
    oldPath: string | null;
    newPath: string | null;
    lines: ParsedUnifiedDiffLine[];
    additions: number;
    deletions: number;
  } | null,
) {
  if (!nextFile) {
    return;
  }

  const resolvedPath = nextFile.path ?? nextFile.newPath ?? nextFile.oldPath ?? nextFile.id;
  files.push({
    id: nextFile.id,
    path: resolvedPath,
    oldPath: nextFile.oldPath,
    newPath: nextFile.newPath,
    additions: nextFile.additions,
    deletions: nextFile.deletions,
    lines: nextFile.lines,
  });
}

export function parseUnifiedDiff(diff: string): ReadonlyArray<ParsedUnifiedDiffFile> {
  const normalized = diff.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized) {
    return [];
  }

  const files: ParsedUnifiedDiffFile[] = [];
  let currentFile: {
    id: string;
    path: string | null;
    oldPath: string | null;
    newPath: string | null;
    lines: ParsedUnifiedDiffLine[];
    additions: number;
    deletions: number;
  } | null = null;
  let fileIndex = 0;
  let lineIndex = 0;

  const ensureCurrentFile = () => {
    if (currentFile) {
      return currentFile;
    }

    fileIndex += 1;
    currentFile = {
      id: `diff-file:${fileIndex}`,
      path: null,
      oldPath: null,
      newPath: null,
      lines: [],
      additions: 0,
      deletions: 0,
    };
    return currentFile;
  };

  for (const rawLine of normalized.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      finalizeParsedFile(files, currentFile);
      fileIndex += 1;
      currentFile = {
        id: `diff-file:${fileIndex}`,
        path: null,
        oldPath: null,
        newPath: null,
        lines: [],
        additions: 0,
        deletions: 0,
      };
    }

    const file = ensureCurrentFile();
    lineIndex += 1;

    if (rawLine.startsWith("--- ")) {
      file.oldPath = stripGitPathPrefix(rawLine.slice(4).trim());
    } else if (rawLine.startsWith("+++ ")) {
      file.newPath = stripGitPathPrefix(rawLine.slice(4).trim());
      if (file.newPath !== "/dev/null") {
        file.path = file.newPath;
      } else if (file.oldPath && file.oldPath !== "/dev/null") {
        file.path = file.oldPath;
      }
    } else if (rawLine.startsWith("rename to ")) {
      file.path = rawLine.slice("rename to ".length).trim();
      file.newPath = file.path;
    } else if (rawLine.startsWith("rename from ")) {
      file.oldPath = rawLine.slice("rename from ".length).trim();
    }

    let kind: ParsedUnifiedDiffLineKind = "meta";
    if (rawLine.startsWith("@@")) {
      kind = "hunk";
    } else if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      kind = "addition";
      file.additions += 1;
    } else if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      kind = "deletion";
      file.deletions += 1;
    } else if (rawLine.startsWith(" ")) {
      kind = "context";
    }

    file.lines.push({
      id: `${file.id}:line:${lineIndex}`,
      kind,
      text: rawLine,
    });
  }

  finalizeParsedFile(files, currentFile);
  return files;
}
