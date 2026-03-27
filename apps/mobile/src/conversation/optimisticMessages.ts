import type { ChatAttachment, OrchestrationMessage, OrchestrationThread } from "@t3tools/contracts";

export type OptimisticMessagesByThreadId = Readonly<
  Record<string, ReadonlyArray<OrchestrationMessage>>
>;

export function createOptimisticUserMessage(input: {
  readonly messageId: OrchestrationMessage["id"];
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly createdAt?: string;
}): OrchestrationMessage {
  const timestamp = input.createdAt ?? new Date().toISOString();

  return {
    id: input.messageId,
    role: "user",
    text: input.text,
    attachments: input.attachments ? [...input.attachments] : undefined,
    turnId: null,
    streaming: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function appendOptimisticThreadMessage(
  current: OptimisticMessagesByThreadId,
  input: {
    readonly threadId: OrchestrationThread["id"];
    readonly message: OrchestrationMessage;
  },
): OptimisticMessagesByThreadId {
  const existingMessages = current[input.threadId] ?? [];
  if (existingMessages.some((message) => message.id === input.message.id)) {
    return current;
  }

  return {
    ...current,
    [input.threadId]: [...existingMessages, input.message],
  };
}

export function removeOptimisticThreadMessage(
  current: OptimisticMessagesByThreadId,
  input: {
    readonly threadId: OrchestrationThread["id"];
    readonly messageId: OrchestrationMessage["id"];
  },
): OptimisticMessagesByThreadId {
  const existingMessages = current[input.threadId];
  if (!existingMessages) {
    return current;
  }

  const nextMessages = existingMessages.filter((message) => message.id !== input.messageId);
  if (nextMessages.length === existingMessages.length) {
    return current;
  }

  if (nextMessages.length === 0) {
    const next = { ...current };
    delete next[input.threadId];
    return next;
  }

  return {
    ...current,
    [input.threadId]: nextMessages,
  };
}

export function mergeOptimisticMessages(
  serverMessages: ReadonlyArray<OrchestrationMessage>,
  optimisticMessages: ReadonlyArray<OrchestrationMessage>,
): ReadonlyArray<OrchestrationMessage> {
  if (optimisticMessages.length === 0) {
    return serverMessages;
  }

  const serverMessageIds = new Set(serverMessages.map((message) => message.id));
  const mergedMessages = [...serverMessages];
  let appendedOptimisticMessage = false;

  for (const optimisticMessage of optimisticMessages) {
    if (serverMessageIds.has(optimisticMessage.id)) {
      continue;
    }

    mergedMessages.push(optimisticMessage);
    appendedOptimisticMessage = true;
  }

  return appendedOptimisticMessage ? mergedMessages : serverMessages;
}

export function pruneOptimisticMessagesBySnapshot(
  current: OptimisticMessagesByThreadId,
  threads: ReadonlyArray<OrchestrationThread>,
): OptimisticMessagesByThreadId {
  let next: Record<string, ReadonlyArray<OrchestrationMessage>> | null = null;
  const serverMessageIdsByThreadId = new Map(
    threads.map((thread) => [thread.id, new Set(thread.messages.map((message) => message.id))]),
  );

  for (const [threadId, optimisticMessages] of Object.entries(current)) {
    const serverMessageIds = serverMessageIdsByThreadId.get(threadId as OrchestrationThread["id"]);
    if (!serverMessageIds) {
      continue;
    }

    const nextMessages = optimisticMessages.filter((message) => !serverMessageIds.has(message.id));
    if (nextMessages.length === optimisticMessages.length) {
      continue;
    }

    if (next === null) {
      next = { ...current };
    }

    if (nextMessages.length === 0) {
      delete next[threadId];
      continue;
    }

    next[threadId] = nextMessages;
  }

  return next ?? current;
}
