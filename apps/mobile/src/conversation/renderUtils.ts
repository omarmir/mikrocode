import type {
  OrchestrationGetTurnDiffResult,
  OrchestrationMessage,
  OrchestrationProposedPlan,
  OrchestrationThread,
  OrchestrationThreadActivity,
  UserInputQuestion,
} from "@t3tools/contracts";

import type { ThreadDiffEntry } from "../threadDiffs";

export type PendingApprovalRequest = {
  readonly requestId: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly requestKind: string | null;
};

export type PendingUserInputRequest = {
  readonly requestId: string;
  readonly questions: ReadonlyArray<UserInputQuestion>;
};

export type HydratedTurnDiffState = {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly updatedAt: string | null;
  readonly result: OrchestrationGetTurnDiffResult | null;
  readonly errorMessage: string | null;
};

export type TimelineCodeBlockBody = {
  readonly kind: "code" | "text";
  readonly language: string | null;
  readonly value: string;
};

export const DIFF_FILE_LINE_LIMIT = 200;
const ASSISTANT_MESSAGE_PREVIEW_LINE_LIMIT = 10;
const ASSISTANT_MESSAGE_PREVIEW_CHAR_LIMIT = 480;

export const EMPTY_EXPANDED_DIFF_FILE_IDS: Readonly<Record<string, true>> = Object.freeze({});

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

function readPlanStepLines(payload: unknown) {
  const payloadRecord = asRecord(payload);
  const plan = Array.isArray(payloadRecord?.plan) ? payloadRecord.plan : [];
  return plan.flatMap((entry) => {
    const stepRecord = asRecord(entry);
    const step =
      typeof stepRecord?.step === "string" && stepRecord.step.trim()
        ? stepRecord.step.trim()
        : null;
    if (!step) {
      return [];
    }

    const status =
      typeof stepRecord?.status === "string" && stepRecord.status.trim()
        ? stepRecord.status.trim()
        : "pending";
    const statusLabel =
      status === "inProgress" || status === "in_progress"
        ? "in progress"
        : status === "completed"
          ? "completed"
          : "pending";
    return [`[${statusLabel}] ${step}`];
  });
}

function sortReadonlyArray<T>(items: ReadonlyArray<T>, compare: (left: T, right: T) => number) {
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...items].sort(compare);
}

export function sortActivities(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  return sortReadonlyArray(activities, (left, right) => {
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
  });
}

function reverseReadonlyArray<T>(items: ReadonlyArray<T>) {
  // Hermes compatibility: avoid toReversed().
  // oxlint-disable-next-line unicorn/no-array-reverse
  return [...items].reverse();
}

export function summarizePreviewText(value: string, limit = 140) {
  const firstNonEmptyLine = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstNonEmptyLine) {
    return null;
  }

  const compact = firstNonEmptyLine.replace(/\s+/gu, " ");
  return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

function activityPreviewText(activity: OrchestrationThreadActivity) {
  const delta = readPayloadString(activity.payload, "delta");
  if (delta) {
    return summarizePreviewText(delta);
  }

  const detail =
    readPayloadString(activity.payload, "detail") ??
    readPayloadString(activity.payload, "message") ??
    readPayloadString(activity.payload, "explanation");
  if (detail) {
    return summarizePreviewText(detail);
  }

  if (activity.kind === "turn.plan.updated") {
    return summarizePreviewText(readPlanStepLines(activity.payload).join(" / "));
  }

  return null;
}

export function activityGroupTitle(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  const lastActivity = activities[activities.length - 1];
  if (!lastActivity) {
    return "Runtime updates";
  }

  return activities.length === 1 ? lastActivity.summary : `${activities.length} runtime updates`;
}

export function activityGroupPreview(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  for (const activity of reverseReadonlyArray(activities)) {
    const preview = activityPreviewText(activity);
    if (preview) {
      return preview;
    }
  }

  const summaries = Array.from(new Set(activities.map((activity) => activity.summary)));
  if (summaries.length === 0) {
    return null;
  }

  return summaries.slice(Math.max(0, summaries.length - 3)).join(" / ");
}

export function formatThreadDiffStateLabel(entry: ThreadDiffEntry) {
  switch (entry.state) {
    case "streaming":
      return "Streaming";
    case "ready":
      return "Ready";
    case "error":
      return "Error";
    default:
      return "Unavailable";
  }
}

export function formatThreadDiffStats(
  files: ReadonlyArray<{
    readonly additions: number;
    readonly deletions: number;
  }>,
) {
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  const fileLabel = `${files.length} file${files.length === 1 ? "" : "s"}`;
  return `${fileLabel} / +${additions} -${deletions}`;
}

export function summarizeThreadDiffPreview(entry: ThreadDiffEntry) {
  if (entry.files.length > 0) {
    return entry.files
      .slice(0, 3)
      .map((file) => file.path)
      .join(" / ");
  }

  if (entry.previewUnifiedDiff) {
    return summarizePreviewText(entry.previewUnifiedDiff);
  }

  return null;
}

export function shouldCollapseAssistantMessage(input: {
  readonly highlighted: boolean;
  readonly message: OrchestrationMessage;
}) {
  if (input.highlighted || input.message.role !== "assistant" || input.message.streaming) {
    return false;
  }

  const text = input.message.text.trim();
  if (!text) {
    return false;
  }

  return (
    text.length > ASSISTANT_MESSAGE_PREVIEW_CHAR_LIMIT ||
    /(^|\n)\s*```/u.test(text) ||
    /(^|\n)\s{0,3}(?:[-*+]|\d+\.)\s/u.test(text) ||
    /(^|\n)\s{0,3}#{1,6}\s/u.test(text) ||
    /\|.+\|/u.test(text)
  );
}

export function buildAssistantMessagePreview(value: string) {
  const normalized = value.replace(/\r\n/gu, "\n").trim();
  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n").slice(0, ASSISTANT_MESSAGE_PREVIEW_LINE_LIMIT).join("\n");
  return lines.length > ASSISTANT_MESSAGE_PREVIEW_CHAR_LIMIT
    ? `${lines.slice(0, ASSISTANT_MESSAGE_PREVIEW_CHAR_LIMIT - 3)}...`
    : lines;
}

export function threadDiffCacheKey(threadId: string, turnId: string) {
  return `${threadId}:${turnId}`;
}

export function activityIcon(activity: OrchestrationThreadActivity) {
  const streamKind = readPayloadString(activity.payload, "streamKind");
  if (streamKind === "file_change_output") {
    return "edit-3";
  }
  if (streamKind === "command_output") {
    return "terminal";
  }
  if (streamKind === "reasoning_text" || streamKind === "reasoning_summary_text") {
    return "cpu";
  }
  if (streamKind === "plan_text" || activity.kind === "turn.plan.updated") {
    return "list";
  }
  if (activity.kind === "runtime.warning" || activity.kind === "runtime.error") {
    return "alert-triangle";
  }
  if (activity.kind.startsWith("tool.")) {
    return "tool";
  }
  if (activity.kind.startsWith("task.")) {
    return "activity";
  }
  return "activity";
}

export function activityEyebrow(activity: OrchestrationThreadActivity) {
  const streamKind = readPayloadString(activity.payload, "streamKind");
  switch (streamKind) {
    case "file_change_output":
      return "Edit";
    case "command_output":
      return "Command";
    case "reasoning_text":
      return "Reasoning";
    case "reasoning_summary_text":
      return "Summary";
    case "plan_text":
      return "Plan";
    default:
      break;
  }

  if (activity.kind.startsWith("tool.")) {
    return "Tool";
  }
  if (activity.kind.startsWith("task.")) {
    return "Task";
  }
  if (activity.kind === "runtime.warning") {
    return "Warning";
  }
  if (activity.kind === "runtime.error") {
    return "Error";
  }
  if (activity.kind === "turn.plan.updated") {
    return "Plan";
  }
  return "Activity";
}

export function activityBody(activity: OrchestrationThreadActivity): TimelineCodeBlockBody | null {
  const streamKind = readPayloadString(activity.payload, "streamKind");
  const delta = readPayloadString(activity.payload, "delta");
  if (delta) {
    return {
      kind:
        streamKind === "file_change_output" || streamKind === "command_output" ? "code" : "text",
      language:
        streamKind === "file_change_output"
          ? "diff"
          : streamKind === "command_output"
            ? "bash"
            : null,
      value: delta,
    };
  }

  if (activity.kind === "turn.plan.updated") {
    const lines: string[] = [];
    const explanation = readPayloadString(activity.payload, "explanation");
    if (explanation) {
      lines.push(explanation);
    }

    const planLines = readPlanStepLines(activity.payload);
    if (planLines.length > 0) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(...planLines);
    }

    if (lines.length > 0) {
      return {
        kind: "text",
        language: null,
        value: lines.join("\n"),
      };
    }
  }

  const detail =
    readPayloadString(activity.payload, "detail") ?? readPayloadString(activity.payload, "message");
  if (!detail) {
    return null;
  }

  return {
    kind: "text",
    language: null,
    value: detail,
  };
}

export function formatProposedPlanStatus(proposedPlan: OrchestrationProposedPlan) {
  if (proposedPlan.implementedAt) {
    return `Implemented ${formatTimestamp(proposedPlan.implementedAt)}`;
  }
  return "Ready to implement";
}

export function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function findPendingApprovalRequest(
  thread: OrchestrationThread | null,
): PendingApprovalRequest | null {
  if (!thread) {
    return null;
  }

  const resolvedRequestIds = new Set<string>();

  for (const activity of reverseReadonlyArray(sortActivities(thread.activities))) {
    const requestId = readPayloadString(activity.payload, "requestId");
    if (!requestId) {
      continue;
    }

    if (activity.kind === "approval.resolved") {
      resolvedRequestIds.add(requestId);
      continue;
    }

    if (activity.kind !== "approval.requested" || resolvedRequestIds.has(requestId)) {
      continue;
    }

    return {
      requestId,
      summary: activity.summary,
      detail: readPayloadString(activity.payload, "detail"),
      requestKind: readPayloadString(activity.payload, "requestKind"),
    };
  }

  return null;
}

export function findPendingUserInputRequest(
  thread: OrchestrationThread | null,
): PendingUserInputRequest | null {
  if (!thread) {
    return null;
  }

  const resolvedRequestIds = new Set<string>();

  for (const activity of reverseReadonlyArray(sortActivities(thread.activities))) {
    const requestId = readPayloadString(activity.payload, "requestId");
    if (!requestId) {
      continue;
    }

    if (activity.kind === "user-input.resolved") {
      resolvedRequestIds.add(requestId);
      continue;
    }

    if (activity.kind !== "user-input.requested" || resolvedRequestIds.has(requestId)) {
      continue;
    }

    const questions = readPayloadQuestions(activity.payload);
    if (questions.length === 0) {
      continue;
    }

    return {
      requestId,
      questions,
    };
  }

  return null;
}

function readPayloadQuestions(payload: unknown): ReadonlyArray<UserInputQuestion> {
  const record = asRecord(payload);
  const rawQuestions = Array.isArray(record?.questions) ? record.questions : [];

  return rawQuestions.flatMap((entry) => {
    const question = asRecord(entry);
    if (!question) {
      return [];
    }

    const id = typeof question.id === "string" && question.id.trim() ? question.id.trim() : null;
    const header =
      typeof question.header === "string" && question.header.trim() ? question.header.trim() : null;
    const prompt =
      typeof question.question === "string" && question.question.trim()
        ? question.question.trim()
        : null;
    const options = (Array.isArray(question.options) ? question.options : []).flatMap((option) => {
      const optionRecord = asRecord(option);
      if (!optionRecord) {
        return [];
      }

      const label =
        typeof optionRecord.label === "string" && optionRecord.label.trim()
          ? optionRecord.label.trim()
          : null;
      const description =
        typeof optionRecord.description === "string" && optionRecord.description.trim()
          ? optionRecord.description.trim()
          : null;
      return label && description ? [{ label, description }] : [];
    });

    if (!id || !header || !prompt || options.length === 0) {
      return [];
    }

    return [
      {
        id,
        header,
        question: prompt,
        options,
        ...(readPayloadBoolean(question, "multiSelect") ? { multiSelect: true } : {}),
      } satisfies UserInputQuestion,
    ];
  });
}
