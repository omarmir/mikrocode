import { describe, expect, it } from "vitest";
import type { OrchestrationReadModel, OrchestrationThread } from "@t3tools/contracts";

import { reconcileReadModel } from "./readModelReconciler";

function createThread(
  id: string,
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationThread {
  return {
    id,
    projectId: "project-1",
    title: `Thread ${id}`,
    model: "gpt-5.4",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    queuedTurns: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } as unknown as OrchestrationThread;
}

function createReadModel(threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-03-24T00:00:00.000Z",
    projects: [
      {
        id: "project-1",
        title: "Project",
        workspaceRoot: "/workspace",
        defaultModel: "gpt-5.4",
        scripts: [],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [...threads],
  } as unknown as OrchestrationReadModel;
}

describe("reconcileReadModel", () => {
  it("reuses unchanged thread references", () => {
    const firstThread = createThread("thread-1");
    const secondThread = createThread("thread-2");
    const previous = createReadModel([firstThread, secondThread]);
    const next = createReadModel([
      {
        ...firstThread,
      },
      {
        ...secondThread,
      },
    ]);

    const reconciled = reconcileReadModel(previous, next);

    expect(reconciled.threads[0]).toBe(firstThread);
    expect(reconciled.threads[1]).toBe(secondThread);
    expect(reconciled.projects).toBe(previous.projects);
  });

  it("only replaces the changed thread", () => {
    const firstThread = createThread("thread-1");
    const secondThread = createThread("thread-2");
    const previous = createReadModel([firstThread, secondThread]);
    const next = {
      ...createReadModel([
        {
          ...firstThread,
          updatedAt: "2026-03-24T00:00:01.000Z",
          messages: [
            {
              id: "message-1",
              role: "assistant",
              text: "Updated",
              turnId: null,
              streaming: false,
              createdAt: "2026-03-24T00:00:01.000Z",
              updatedAt: "2026-03-24T00:00:01.000Z",
            },
          ] as unknown as OrchestrationThread["messages"],
        },
        {
          ...secondThread,
        },
      ]),
      snapshotSequence: 2,
      updatedAt: "2026-03-24T00:00:01.000Z",
    };

    const reconciled = reconcileReadModel(previous, next);

    expect(reconciled.threads[0]).not.toBe(firstThread);
    expect(reconciled.threads[1]).toBe(secondThread);
  });
});
