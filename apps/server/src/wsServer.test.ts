import {
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type ProviderRuntimeTurnCompletedEvent,
  CheckpointRef,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildDomainNotification, buildRuntimeTurnNotification } from "./wsServer";

const now = "2026-03-23T20:00:00.000Z";
const projectId = ProjectId.makeUnsafe("project-1");
const threadId = ThreadId.makeUnsafe("thread-1");
const turnId = TurnId.makeUnsafe("turn-1");

function makeReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: now,
    projects: [
      {
        id: projectId,
        title: "mikrocode",
        workspaceRoot: "/tmp/mikrocode",
        defaultModel: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: threadId,
        projectId,
        title: "Notifications",
        model: "gpt-5.4",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          assistantMessageId: MessageId.makeUnsafe("assistant-1"),
        },
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        messages: [],
        queuedTurns: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: turnId,
          lastError: "Provider session error",
          updatedAt: now,
        },
      },
    ],
  };
}

function makeTurnCompletedEvent(
  state: ProviderRuntimeTurnCompletedEvent["payload"]["state"],
): ProviderRuntimeTurnCompletedEvent {
  return {
    eventId: EventId.makeUnsafe(`evt-turn-completed-${state}`),
    provider: "codex",
    threadId,
    turnId,
    createdAt: now,
    type: "turn.completed",
    payload: {
      state,
      ...(state === "failed" ? { errorMessage: "Turn failed" } : {}),
    },
  };
}

describe("server notifications", () => {
  it("builds terminal notifications from runtime turn completion", () => {
    const notification = buildRuntimeTurnNotification(
      makeTurnCompletedEvent("completed"),
      makeReadModel(),
    );

    expect(notification).toEqual({
      notificationId: "notification:turn-1:turn.completed:evt-turn-completed-completed",
      kind: "turn.completed",
      projectId,
      threadId,
      turnId,
      title: "mikrocode / Notifications",
      message: "Turn completed",
      createdAt: now,
    });
  });

  it("does not notify on interrupted or cancelled turns", () => {
    expect(
      buildRuntimeTurnNotification(makeTurnCompletedEvent("interrupted"), makeReadModel()),
    ).toBeNull();
    expect(
      buildRuntimeTurnNotification(makeTurnCompletedEvent("cancelled"), makeReadModel()),
    ).toBeNull();
  });

  it("does not treat checkpoint completion as turn completion", () => {
    const event: OrchestrationEvent = {
      sequence: 42,
      eventId: EventId.makeUnsafe("evt-diff-complete"),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: CommandId.makeUnsafe("server:checkpoint-turn-diff-complete:uuid"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("server:checkpoint-turn-diff-complete:uuid"),
      metadata: {},
      type: "thread.turn-diff-completed",
      payload: {
        threadId,
        turnId,
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.makeUnsafe("checkpoint:1"),
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: now,
      },
    };

    expect(buildDomainNotification(event, makeReadModel())).toBeNull();
  });

  it("preserves session error notifications for mid-turn failures", () => {
    const event: OrchestrationEvent = {
      sequence: 43,
      eventId: EventId.makeUnsafe("evt-session-error"),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: CommandId.makeUnsafe("provider:evt-runtime-error:runtime-error-session-set:uuid"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe(
        "provider:evt-runtime-error:runtime-error-session-set:uuid",
      ),
      metadata: {},
      type: "thread.session-set",
      payload: {
        threadId,
        session: {
          threadId,
          status: "error",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: turnId,
          lastError: "Provider session error",
          updatedAt: now,
        },
      },
    };

    expect(buildDomainNotification(event, makeReadModel())).toEqual({
      notificationId: "notification:turn-1:turn.error:43",
      kind: "turn.error",
      projectId,
      threadId,
      turnId,
      title: "mikrocode / Notifications",
      message: "Provider session error",
      createdAt: now,
    });
  });
});
