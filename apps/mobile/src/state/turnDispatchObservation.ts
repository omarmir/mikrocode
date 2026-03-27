import type {
  OrchestrationMessage,
  OrchestrationReadModel,
  OrchestrationThread,
} from "@t3tools/contracts";

export function threadHasObservedDispatchedMessage(
  thread: OrchestrationThread | null | undefined,
  messageId: OrchestrationMessage["id"],
) {
  if (!thread) {
    return false;
  }

  return (
    thread.messages.some((message) => message.id === messageId) ||
    thread.queuedTurns.some((queuedTurn) => queuedTurn.messageId === messageId)
  );
}

export function snapshotHasObservedDispatchedMessage(input: {
  readonly snapshot: OrchestrationReadModel | null | undefined;
  readonly threadId: OrchestrationThread["id"];
  readonly messageId: OrchestrationMessage["id"];
}) {
  const thread = input.snapshot?.threads.find((entry) => entry.id === input.threadId) ?? null;
  return threadHasObservedDispatchedMessage(thread, input.messageId);
}
