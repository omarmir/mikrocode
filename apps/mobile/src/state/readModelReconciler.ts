import type {
  ChatAttachment,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointSummary,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationProject,
  OrchestrationProposedPlan,
  OrchestrationQueuedTurn,
  OrchestrationReadModel,
  OrchestrationSession,
  OrchestrationThread,
  OrchestrationThreadActivity,
  ProjectScript,
} from "@t3tools/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shallowArrayEqual<T>(
  left: ReadonlyArray<T>,
  right: ReadonlyArray<T>,
  equal: (leftItem: T, rightItem: T) => boolean,
) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (!leftItem || !rightItem || !equal(leftItem, rightItem)) {
      return false;
    }
  }

  return true;
}

function deepEqualUnknown(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqualUnknown(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) {
      return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (const key of leftKeys) {
      if (!(key in right) || !deepEqualUnknown(left[key], right[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function equalProjectScript(left: ProjectScript, right: ProjectScript) {
  return (
    left.name === right.name &&
    left.command === right.command &&
    left.icon === right.icon &&
    left.runOnWorktreeCreate === right.runOnWorktreeCreate
  );
}

function equalProject(left: OrchestrationProject, right: OrchestrationProject) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.workspaceRoot === right.workspaceRoot &&
    left.defaultModel === right.defaultModel &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.deletedAt === right.deletedAt &&
    shallowArrayEqual(left.scripts, right.scripts, equalProjectScript)
  );
}

function equalChatAttachment(left: ChatAttachment, right: ChatAttachment) {
  return (
    left.type === right.type &&
    left.id === right.id &&
    left.name === right.name &&
    left.mimeType === right.mimeType &&
    left.sizeBytes === right.sizeBytes
  );
}

function equalMessage(left: OrchestrationMessage, right: OrchestrationMessage) {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.text === right.text &&
    left.turnId === right.turnId &&
    left.streaming === right.streaming &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    shallowArrayEqual(left.attachments ?? [], right.attachments ?? [], equalChatAttachment)
  );
}

function equalProposedPlan(left: OrchestrationProposedPlan, right: OrchestrationProposedPlan) {
  return (
    left.id === right.id &&
    left.turnId === right.turnId &&
    left.planMarkdown === right.planMarkdown &&
    left.implementedAt === right.implementedAt &&
    left.implementationThreadId === right.implementationThreadId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  );
}

function equalSession(
  left: OrchestrationSession | null,
  right: OrchestrationSession | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.threadId === right.threadId &&
    left.status === right.status &&
    left.providerName === right.providerName &&
    left.runtimeMode === right.runtimeMode &&
    left.activeTurnId === right.activeTurnId &&
    left.lastError === right.lastError &&
    left.updatedAt === right.updatedAt
  );
}

function equalCheckpointFile(
  left: OrchestrationCheckpointFile,
  right: OrchestrationCheckpointFile,
) {
  return (
    left.path === right.path &&
    left.kind === right.kind &&
    left.additions === right.additions &&
    left.deletions === right.deletions
  );
}

function equalCheckpoint(
  left: OrchestrationCheckpointSummary,
  right: OrchestrationCheckpointSummary,
) {
  return (
    left.turnId === right.turnId &&
    left.checkpointTurnCount === right.checkpointTurnCount &&
    left.checkpointRef === right.checkpointRef &&
    left.status === right.status &&
    left.assistantMessageId === right.assistantMessageId &&
    left.completedAt === right.completedAt &&
    shallowArrayEqual(left.files, right.files, equalCheckpointFile)
  );
}

function equalActivity(left: OrchestrationThreadActivity, right: OrchestrationThreadActivity) {
  return (
    left.id === right.id &&
    left.tone === right.tone &&
    left.kind === right.kind &&
    left.summary === right.summary &&
    left.turnId === right.turnId &&
    left.sequence === right.sequence &&
    left.createdAt === right.createdAt &&
    deepEqualUnknown(left.payload, right.payload)
  );
}

function equalLatestTurn(
  left: OrchestrationLatestTurn | null,
  right: OrchestrationLatestTurn | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.turnId === right.turnId &&
    left.state === right.state &&
    left.requestedAt === right.requestedAt &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.assistantMessageId === right.assistantMessageId &&
    left.sourceProposedPlan?.threadId === right.sourceProposedPlan?.threadId &&
    left.sourceProposedPlan?.planId === right.sourceProposedPlan?.planId
  );
}

function equalQueuedTurn(left: OrchestrationQueuedTurn, right: OrchestrationQueuedTurn) {
  return (
    left.messageId === right.messageId &&
    left.dispatchMode === right.dispatchMode &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.interactionMode === right.interactionMode &&
    left.createdAt === right.createdAt &&
    deepEqualUnknown(left.modelOptions ?? null, right.modelOptions ?? null) &&
    deepEqualUnknown(left.providerOptions ?? null, right.providerOptions ?? null)
  );
}

function reconcileArrayByKey<T>(
  previous: ReadonlyArray<T>,
  next: ReadonlyArray<T>,
  getKey: (item: T) => string,
  equal: (left: T, right: T) => boolean,
) {
  if (previous.length === 0) {
    return next;
  }

  const previousByKey = new Map(previous.map((item) => [getKey(item), item] as const));
  let changed = previous.length !== next.length;
  const reconciled = next.map((item, index) => {
    const previousItem = previousByKey.get(getKey(item));
    if (!previousItem) {
      changed = true;
      return item;
    }

    const stableItem = equal(previousItem, item) ? previousItem : item;
    if (stableItem !== previousItem || previous[index] !== stableItem) {
      changed = true;
    }
    return stableItem;
  });

  return changed ? reconciled : previous;
}

function reconcileCheckpointArray(
  previous: ReadonlyArray<OrchestrationCheckpointSummary>,
  next: ReadonlyArray<OrchestrationCheckpointSummary>,
) {
  if (previous.length === 0) {
    return next;
  }

  const previousByTurnId = new Map(previous.map((item) => [item.turnId, item] as const));
  let changed = previous.length !== next.length;
  const reconciled = next.map((item, index) => {
    const previousItem = previousByTurnId.get(item.turnId);
    if (!previousItem) {
      changed = true;
      return item;
    }

    const stableItem = equalCheckpoint(previousItem, item) ? previousItem : item;
    if (stableItem !== previousItem || previous[index] !== stableItem) {
      changed = true;
    }
    return stableItem;
  });

  return changed ? reconciled : previous;
}

function reconcileThread(previous: OrchestrationThread, next: OrchestrationThread) {
  const messages = reconcileArrayByKey(
    previous.messages,
    next.messages,
    (message) => message.id,
    equalMessage,
  );
  const proposedPlans = reconcileArrayByKey(
    previous.proposedPlans,
    next.proposedPlans,
    (plan) => plan.id,
    equalProposedPlan,
  );
  const activities = reconcileArrayByKey(
    previous.activities,
    next.activities,
    (activity) => activity.id,
    equalActivity,
  );
  const checkpoints = reconcileCheckpointArray(previous.checkpoints, next.checkpoints);
  const queuedTurns = reconcileArrayByKey(
    previous.queuedTurns,
    next.queuedTurns,
    (queuedTurn) => queuedTurn.messageId,
    equalQueuedTurn,
  );
  const session = equalSession(previous.session, next.session) ? previous.session : next.session;
  const latestTurn = equalLatestTurn(previous.latestTurn, next.latestTurn)
    ? previous.latestTurn
    : next.latestTurn;

  const unchanged =
    previous.id === next.id &&
    previous.projectId === next.projectId &&
    previous.title === next.title &&
    previous.model === next.model &&
    previous.runtimeMode === next.runtimeMode &&
    previous.interactionMode === next.interactionMode &&
    previous.branch === next.branch &&
    previous.worktreePath === next.worktreePath &&
    previous.createdAt === next.createdAt &&
    previous.updatedAt === next.updatedAt &&
    previous.deletedAt === next.deletedAt &&
    messages === previous.messages &&
    queuedTurns === previous.queuedTurns &&
    proposedPlans === previous.proposedPlans &&
    activities === previous.activities &&
    checkpoints === previous.checkpoints &&
    session === previous.session &&
    latestTurn === previous.latestTurn;

  if (unchanged) {
    return previous;
  }

  return {
    ...next,
    messages,
    queuedTurns,
    proposedPlans,
    activities,
    checkpoints,
    session,
    latestTurn,
  };
}

export function reconcileReadModel(
  previous: OrchestrationReadModel | null,
  next: OrchestrationReadModel,
): OrchestrationReadModel {
  if (!previous) {
    return next;
  }

  const projects = reconcileArrayByKey(
    previous.projects,
    next.projects,
    (project) => project.id,
    equalProject,
  );
  const previousThreadsById = new Map(
    previous.threads.map((thread) => [thread.id, thread] as const),
  );
  let threadsChanged = previous.threads.length !== next.threads.length;
  const threads = next.threads.map((thread, index) => {
    const previousThread = previousThreadsById.get(thread.id);
    if (!previousThread) {
      threadsChanged = true;
      return thread;
    }

    const stableThread = reconcileThread(previousThread, thread);
    if (stableThread !== previousThread || previous.threads[index] !== stableThread) {
      threadsChanged = true;
    }
    return stableThread;
  });

  if (
    previous.snapshotSequence === next.snapshotSequence &&
    previous.updatedAt === next.updatedAt &&
    projects === previous.projects &&
    !threadsChanged
  ) {
    return previous;
  }

  return {
    ...next,
    projects,
    threads: threadsChanged ? threads : previous.threads,
  };
}
