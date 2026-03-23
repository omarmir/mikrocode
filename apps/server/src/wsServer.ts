/**
 * Server - HTTP/WebSocket server service interface.
 *
 * Owns startup and shutdown lifecycle of the HTTP server and WebSocket request routing.
 *
 * @module Server
 */
import http from "node:http";
import type { Duplex } from "node:stream";

import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ProjectId,
  type ServerAppNotification,
  type ServerNotificationDelivery,
  ThreadId,
  TurnId,
  WS_CHANNELS,
  WS_METHODS,
  WebSocketRequest,
  type WsResponse as WsResponseMessage,
  WsResponse,
  type WsPushEnvelopeBase,
} from "@t3tools/contracts";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Ref,
  Result,
  Schema,
  Scope,
  ServiceMap,
  Stream,
  Struct,
} from "effect";
import { clamp } from "effect/Number";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { WebSocketServer, type WebSocket } from "ws";

import { createLogger } from "./logger";
import { GitManager } from "./git/Services/GitManager.ts";
import { listWorkspaceDirectories, searchWorkspaceEntries } from "./workspaceEntries";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor";
import type { ProviderService } from "./provider/Services/ProviderService";
import { ProviderHealth } from "./provider/Services/ProviderHealth";
import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore.ts";
import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths";
import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";
import { parseBase64DataUrl } from "./imageMime.ts";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService.ts";
import { expandHomePath } from "./os-jank.ts";
import { buildServerConversationCapabilities } from "./serverConversationCapabilities.ts";
import { makeServerPushBus } from "./wsServer/pushBus.ts";
import { makeServerReadiness } from "./wsServer/readiness.ts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";
import { NotificationSettingsService } from "./notifications/Services/NotificationSettings.ts";

export interface ServerShape {
  readonly start: Effect.Effect<
    http.Server,
    ServerLifecycleError,
    Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >;
  readonly stopSignal: Effect.Effect<void, never>;
}

export class Server extends ServiceMap.Service<Server, ServerShape>()("t3/wsServer/Server") {}

const isServerNotRunningError = (error: Error): boolean => {
  const maybeCode = (error as NodeJS.ErrnoException).code;
  return (
    maybeCode === "ERR_SERVER_NOT_RUNNING" || error.message.toLowerCase().includes("not running")
  );
};

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusCode === 401 ? "Unauthorized" : "Bad Request"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "\r\n" +
      message,
  );
}

function websocketRawToString(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(new Uint8Array(raw)).toString("utf8");
  if (!Array.isArray(raw)) return null;
  const chunks: string[] = [];
  for (const chunk of raw) {
    if (typeof chunk === "string") chunks.push(chunk);
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk).toString("utf8"));
    else if (chunk instanceof ArrayBuffer)
      chunks.push(Buffer.from(new Uint8Array(chunk)).toString("utf8"));
    else return null;
  }
  return chunks.join("");
}

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function resolveWorkspaceWritePath(params: {
  workspaceRoot: string;
  relativePath: string;
  path: Path.Path;
}): Effect.Effect<{ absolutePath: string; relativePath: string }, RouteRequestError> {
  const normalizedInputPath = params.relativePath.trim();
  if (params.path.isAbsolute(normalizedInputPath)) {
    return Effect.fail(
      new RouteRequestError({
        message: "Workspace file path must be relative to the project root.",
      }),
    );
  }

  const absolutePath = params.path.resolve(params.workspaceRoot, normalizedInputPath);
  const relativeToRoot = toPosixRelativePath(
    params.path.relative(params.workspaceRoot, absolutePath),
  );
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot === "." ||
    relativeToRoot.startsWith("../") ||
    relativeToRoot === ".." ||
    params.path.isAbsolute(relativeToRoot)
  ) {
    return Effect.fail(
      new RouteRequestError({
        message: "Workspace file path must stay within the project root.",
      }),
    );
  }

  return Effect.succeed({
    absolutePath,
    relativePath: relativeToRoot,
  });
}

function stripRequestTag<T extends { _tag: string }>(body: T) {
  return Struct.omit(body, ["_tag"]);
}

function extractRequestIdForDecodeFailure(messageText: string): string {
  try {
    const parsed = JSON.parse(messageText) as { id?: unknown };
    return typeof parsed?.id === "string" && parsed.id.trim().length > 0 ? parsed.id : "unknown";
  } catch {
    return "unknown";
  }
}

const encodeWsResponse = Schema.encodeEffect(Schema.fromJsonString(WsResponse));
const decodeWebSocketRequest = decodeJsonResult(WebSocketRequest);

export type ServerCoreRuntimeServices =
  | OrchestrationEngineService
  | ProjectionSnapshotQuery
  | CheckpointDiffQuery
  | OrchestrationReactor
  | ProviderService
  | ProviderHealth;

export type ServerRuntimeServices =
  | ServerCoreRuntimeServices
  | GitManager
  | GitCore
  | AnalyticsService
  | NotificationSettingsService
  | HttpClient.HttpClient;

export class ServerLifecycleError extends Schema.TaggedErrorClass<ServerLifecycleError>()(
  "ServerLifecycleError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

class RouteRequestError extends Schema.TaggedErrorClass<RouteRequestError>()("RouteRequestError", {
  message: Schema.String,
}) {}

class PushoverDeliveryError extends Schema.TaggedErrorClass<PushoverDeliveryError>()(
  "PushoverDeliveryError",
  {
    detail: Schema.String,
    statusCode: Schema.Int,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const APP_NOTIFICATION_CONFIRM_TIMEOUT_MS = 2_500;
const MAX_TRACKED_TERMINAL_TURN_NOTIFICATIONS = 5_000;
const PUSHOVER_MESSAGES_URL = "https://api.pushover.net/1/messages.json";
const PUSHOVER_MESSAGE_MAX_CHARS = 1_024;

function truncateNotificationText(input: string, maxChars: number): string {
  const trimmed = input.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function buildScopedThreadTitle(projectTitle: string, threadTitle: string): string {
  if (projectTitle === threadTitle) {
    return projectTitle;
  }
  return `${projectTitle} / ${threadTitle}`;
}

function formatPushoverErrorMessage(statusCode: number, bodyText: string): string {
  const trimmedBody = bodyText.trim();
  if (trimmedBody.length > 0) {
    try {
      const parsed = JSON.parse(trimmedBody) as {
        readonly errors?: ReadonlyArray<unknown>;
      };
      const errors = Array.isArray(parsed.errors)
        ? parsed.errors.filter(
            (error): error is string => typeof error === "string" && error.trim().length > 0,
          )
        : [];
      if (errors.length > 0) {
        return truncateNotificationText(
          `Pushover rejected the notification: ${errors.join("; ")}`,
          PUSHOVER_MESSAGE_MAX_CHARS,
        );
      }
    } catch {
      // Fall through to the plain-text error message.
    }

    return truncateNotificationText(
      `Pushover rejected the notification (HTTP ${statusCode}): ${trimmedBody}`,
      PUSHOVER_MESSAGE_MAX_CHARS,
    );
  }

  return `Pushover rejected the notification (HTTP ${statusCode}).`;
}

function formatRequestFailure(cause: Cause.Cause<unknown>): string {
  const failure = Cause.squash(cause);
  if (Schema.is(RouteRequestError)(failure)) {
    return failure.message;
  }
  return Cause.pretty(cause);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPayloadString(payload: unknown, key: string): string | null {
  const record = asRecord(payload);
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readFirstUserInputQuestion(payload: unknown): string | null {
  const questions = asRecord(payload)?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }

  for (const question of questions) {
    const prompt = readPayloadString(question, "question");
    if (prompt !== null) {
      return prompt;
    }
  }

  return null;
}

function resolveNotificationContext(
  threadId: string,
  readModel: OrchestrationReadModel,
): {
  readonly project: OrchestrationReadModel["projects"][number];
  readonly thread: OrchestrationReadModel["threads"][number];
} | null {
  const thread = readModel.threads.find((entry) => entry.id === threadId);
  if (!thread || thread.deletedAt !== null) {
    return null;
  }

  const project = readModel.projects.find((entry) => entry.id === thread.projectId);
  if (!project || project.deletedAt !== null) {
    return null;
  }

  return { project, thread };
}

function buildTerminalTurnNotification(
  event: OrchestrationEvent,
  readModel: OrchestrationReadModel,
): ServerAppNotification | null {
  if (event.type !== "thread.turn-diff-completed" && event.type !== "thread.session-set") {
    return null;
  }

  const context = resolveNotificationContext(event.aggregateId, readModel);
  if (!context) {
    return null;
  }
  const { project, thread } = context;

  if (event.type === "thread.turn-diff-completed") {
    if (event.payload.status === "missing") {
      return null;
    }

    const kind = event.payload.status === "error" ? "turn.error" : "turn.completed";
    const message =
      kind === "turn.error"
        ? truncateNotificationText(
            thread.session?.lastError ?? "Turn failed before the session could recover.",
            PUSHOVER_MESSAGE_MAX_CHARS,
          )
        : "Turn completed";

    return {
      notificationId: `notification:${event.payload.turnId}:${kind}:${event.sequence}`,
      kind,
      projectId: project.id,
      threadId: thread.id,
      turnId: event.payload.turnId,
      title: buildScopedThreadTitle(project.title, thread.title),
      message,
      createdAt: event.occurredAt,
    };
  }

  if (event.payload.session.status !== "error" || event.payload.session.activeTurnId === null) {
    return null;
  }

  return {
    notificationId: `notification:${event.payload.session.activeTurnId}:turn.error:${event.sequence}`,
    kind: "turn.error",
    projectId: project.id,
    threadId: thread.id,
    turnId: event.payload.session.activeTurnId,
    title: buildScopedThreadTitle(project.title, thread.title),
    message: truncateNotificationText(
      event.payload.session.lastError ?? "Provider session error",
      PUSHOVER_MESSAGE_MAX_CHARS,
    ),
    createdAt: event.occurredAt,
  };
}

function buildUserInputRequestedNotification(
  event: OrchestrationEvent,
  readModel: OrchestrationReadModel,
): ServerAppNotification | null {
  if (event.type !== "thread.activity-appended") {
    return null;
  }

  const activity = event.payload.activity;
  if (activity.kind !== "user-input.requested") {
    return null;
  }

  const context = resolveNotificationContext(event.aggregateId, readModel);
  if (!context) {
    return null;
  }
  const { project, thread } = context;

  const requestId = readPayloadString(activity.payload, "requestId") ?? activity.id;
  const turnId =
    activity.turnId ?? thread.latestTurn?.turnId ?? TurnId.makeUnsafe(`user-input:${requestId}`);
  const prompt =
    readFirstUserInputQuestion(activity.payload) ?? "Model is waiting for your response.";

  return {
    notificationId: `notification:${requestId}:user-input.requested:${event.sequence}`,
    kind: "user-input.requested",
    projectId: project.id,
    threadId: thread.id,
    turnId,
    title: buildScopedThreadTitle(project.title, thread.title),
    message: truncateNotificationText(prompt, PUSHOVER_MESSAGE_MAX_CHARS),
    createdAt: activity.createdAt,
  };
}

function buildTestNotification(cwd: string, mode: "auto" | "pushover"): ServerAppNotification {
  const segments = cwd.split(/[/\\]/).filter(Boolean);
  const projectTitle = segments[segments.length - 1] ?? "workspace";
  const title = buildScopedThreadTitle(projectTitle, "Test alert");
  const message =
    mode === "pushover" ? "Pushover test from the server." : "Test alert from the server.";

  return {
    notificationId: `notification:test:${mode}:${crypto.randomUUID()}`,
    kind: "test",
    projectId: ProjectId.makeUnsafe("notification:test:project"),
    threadId: ThreadId.makeUnsafe("notification:test:thread"),
    turnId: TurnId.makeUnsafe(`notification:test:turn:${crypto.randomUUID()}`),
    title,
    message,
    createdAt: new Date().toISOString(),
  };
}

export const createServer = Effect.fn(function* (): Effect.fn.Return<
  http.Server,
  ServerLifecycleError,
  Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
> {
  const serverConfig = yield* ServerConfig;
  const { port, cwd, authToken, host, logWebSocketEvents, autoBootstrapProjectFromCwd } =
    serverConfig;

  const gitManager = yield* GitManager;
  const providerHealth = yield* ProviderHealth;
  const git = yield* GitCore;
  const httpClient = yield* HttpClient.HttpClient;
  const notificationSettings = yield* NotificationSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const clients = yield* Ref.make(new Set<WebSocket>());
  const notifiedTerminalTurns = yield* Ref.make(new Set<string>());
  const pendingNotificationAcks = yield* Ref.make(
    new Map<string, Deferred.Deferred<ServerNotificationDelivery, never>>(),
  );
  const logger = createLogger("ws");
  const readiness = yield* makeServerReadiness;
  function logOutgoingPush(push: WsPushEnvelopeBase, recipients: number) {
    if (!logWebSocketEvents) return;
    logger.event("outgoing push", {
      channel: push.channel,
      sequence: push.sequence,
      recipients,
      payload: push.data,
    });
  }

  const pushBus = yield* makeServerPushBus({ clients, logOutgoingPush });
  yield* readiness.markPushBusReady;

  const clearPendingNotificationAck = (notificationId: string) =>
    Ref.update(pendingNotificationAcks, (current) => {
      const next = new Map(current);
      next.delete(notificationId);
      return next;
    });

  const confirmAppNotificationDelivery = Effect.fnUntraced(function* (
    notificationId: string,
    delivery: ServerNotificationDelivery,
  ) {
    const pending = yield* Ref.get(pendingNotificationAcks).pipe(
      Effect.map((current) => current.get(notificationId) ?? null),
    );
    if (!pending) {
      return;
    }

    yield* Effect.exit(Deferred.succeed(pending, delivery)).pipe(Effect.asVoid);
  });

  const sendPushoverFallback = Effect.fnUntraced(function* (notification: ServerAppNotification) {
    const settings = yield* notificationSettings.getSettings;
    const { appToken, userKey, configured } = settings.pushover;
    if (!configured || appToken === null || userKey === null) {
      return false;
    }

    const body = new URLSearchParams({
      token: appToken,
      user: userKey,
      title: notification.title,
      message: notification.message,
    });

    const request = HttpClientRequest.post(PUSHOVER_MESSAGES_URL).pipe(
      HttpClientRequest.bodyUrlParams(body),
    );
    const response = yield* httpClient.execute(request);
    if (response.status >= 200 && response.status < 300) {
      return true;
    }

    const errorMessage = yield* response.text.pipe(
      Effect.orElseSucceed(() => ""),
      Effect.map((bodyText) => formatPushoverErrorMessage(response.status, bodyText)),
    );
    return yield* new PushoverDeliveryError({
      detail: errorMessage,
      statusCode: response.status,
    });
  });

  const deliverServerNotification = Effect.fnUntraced(function* (
    notification: ServerAppNotification,
  ) {
    const hasOpenClient = yield* Ref.get(clients).pipe(
      Effect.map((current) =>
        Array.from(current).some((client) => client.readyState === client.OPEN),
      ),
    );

    if (hasOpenClient) {
      const deliveryAck = yield* Deferred.make<ServerNotificationDelivery, never>();
      yield* Ref.update(pendingNotificationAcks, (current) => {
        const next = new Map(current);
        next.set(notification.notificationId, deliveryAck);
        return next;
      });

      yield* pushBus.publishAll(WS_CHANNELS.serverNotification, notification);

      const appDelivery = yield* Deferred.await(deliveryAck).pipe(
        Effect.timeoutOption(APP_NOTIFICATION_CONFIRM_TIMEOUT_MS),
        Effect.map((result) => (result._tag === "Some" ? result.value : null)),
        Effect.ensuring(clearPendingNotificationAck(notification.notificationId)),
      );
      if (appDelivery !== null) {
        return appDelivery;
      }
    }

    const pushoverDelivered = yield* sendPushoverFallback(notification);
    return pushoverDelivered ? "pushover" : null;
  });

  const deliverTerminalTurnNotification = Effect.fnUntraced(function* (
    notification: ServerAppNotification,
  ) {
    const terminalTurnKey = `${notification.turnId}:${notification.kind}`;
    const shouldDeliver = yield* Ref.modify(notifiedTerminalTurns, (current) => {
      if (current.has(terminalTurnKey)) {
        return [false, current] as const;
      }

      const next = new Set(current);
      next.add(terminalTurnKey);
      while (next.size > MAX_TRACKED_TERMINAL_TURN_NOTIFICATIONS) {
        const oldestKey = next.values().next().value;
        if (oldestKey === undefined) {
          break;
        }
        next.delete(oldestKey);
      }
      return [true, next] as const;
    });
    if (!shouldDeliver) {
      return;
    }

    yield* deliverServerNotification(notification).pipe(Effect.asVoid);
  });

  const maybeDeliverServerNotification = Effect.fnUntraced(function* (event: OrchestrationEvent) {
    const settings = yield* notificationSettings.getSettings;
    if (!settings.enabled) {
      return;
    }

    const readModel = yield* orchestrationEngine.getReadModel();
    const notification =
      buildTerminalTurnNotification(event, readModel) ??
      buildUserInputRequestedNotification(event, readModel);
    if (!notification) {
      return;
    }

    const deliveryEffect =
      notification.kind === "turn.completed" || notification.kind === "turn.error"
        ? deliverTerminalTurnNotification(notification)
        : deliverServerNotification(notification).pipe(Effect.asVoid);

    yield* deliveryEffect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("failed to deliver server notification", {
          notificationId: notification.notificationId,
          turnId: notification.turnId,
          kind: notification.kind,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const normalizeDispatchCommand = Effect.fnUntraced(function* (input: {
    readonly command: ClientOrchestrationCommand;
  }) {
    const normalizeProjectWorkspaceRoot = Effect.fnUntraced(function* (workspaceRoot: string) {
      const normalizedWorkspaceRoot = path.resolve(yield* expandHomePath(workspaceRoot.trim()));
      const workspaceStat = yield* fileSystem
        .stat(normalizedWorkspaceRoot)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!workspaceStat) {
        return yield* new RouteRequestError({
          message: `Project directory does not exist: ${normalizedWorkspaceRoot}`,
        });
      }
      if (workspaceStat.type !== "Directory") {
        return yield* new RouteRequestError({
          message: `Project path is not a directory: ${normalizedWorkspaceRoot}`,
        });
      }
      return normalizedWorkspaceRoot;
    });

    if (input.command.type === "project.create") {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(input.command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type === "project.meta.update" && input.command.workspaceRoot !== undefined) {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(input.command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type !== "thread.turn.start") {
      return input.command as OrchestrationCommand;
    }

    const threadId = input.command.threadId;
    const normalizedAttachments = yield* Effect.forEach(
      input.command.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed || !parsed.mimeType.startsWith("image/")) {
            return yield* new RouteRequestError({
              message: `Invalid image attachment payload for '${attachment.name}'.`,
            });
          }
          const bytes = Buffer.from(parsed.base64, "base64");
          if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
            return yield* new RouteRequestError({
              message: `Image attachment '${attachment.name}' is empty or too large.`,
            });
          }
          const attachmentId = createAttachmentId(threadId);
          if (!attachmentId) {
            return yield* new RouteRequestError({
              message: "Failed to create a safe attachment id.",
            });
          }
          const persistedAttachment = {
            type: "image" as const,
            id: attachmentId,
            name: attachment.name,
            mimeType: parsed.mimeType.toLowerCase(),
            sizeBytes: bytes.byteLength,
          };
          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new RouteRequestError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }
          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );
          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...input.command,
      message: {
        ...input.command.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });

  const httpServer = http.createServer((req, res) => {
    const respond = (
      statusCode: number,
      headers: Record<string, string>,
      body?: string | Uint8Array,
    ) => {
      res.writeHead(statusCode, headers);
      res.end(body);
    };

    void Effect.runPromise(
      Effect.gen(function* () {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        if (url.pathname === "/health") {
          respond(200, { "Content-Type": "application/json" }, JSON.stringify({ ok: true }));
          return;
        }

        if (url.pathname.startsWith(ATTACHMENTS_ROUTE_PREFIX)) {
          const rawRelativePath = url.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
          const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
          if (!normalizedRelativePath) {
            respond(400, { "Content-Type": "text/plain" }, "Invalid attachment path");
            return;
          }
          const isIdLookup =
            !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
          const filePath = isIdLookup
            ? resolveAttachmentPathById({
                attachmentsDir: serverConfig.attachmentsDir,
                attachmentId: normalizedRelativePath,
              })
            : resolveAttachmentRelativePath({
                attachmentsDir: serverConfig.attachmentsDir,
                relativePath: normalizedRelativePath,
              });
          if (!filePath) {
            respond(
              isIdLookup ? 404 : 400,
              { "Content-Type": "text/plain" },
              isIdLookup ? "Not Found" : "Invalid attachment path",
            );
            return;
          }
          const fileInfo = yield* fileSystem
            .stat(filePath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!fileInfo || fileInfo.type !== "File") {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }
          const data = yield* fileSystem
            .readFile(filePath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!data) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }
          respond(200, { "Content-Type": "application/octet-stream" }, data);
          return;
        }

        respond(
          200,
          { "Content-Type": "application/json" },
          JSON.stringify({
            name: "t3code-backend",
            message: "Backend is running for the React Native mobile client.",
          }),
        );
      }),
    ).catch(() => {
      if (!res.headersSent) {
        respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
      }
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  const closeWebSocketServer = Effect.callback<void, ServerLifecycleError>((resume) => {
    wss.close((error) => {
      if (error && !isServerNotRunningError(error)) {
        resume(
          Effect.fail(
            new ServerLifecycleError({ operation: "closeWebSocketServer", cause: error }),
          ),
        );
      } else {
        resume(Effect.void);
      }
    });
  });

  const closeAllClients = Ref.get(clients).pipe(
    Effect.flatMap(Effect.forEach((client) => Effect.sync(() => client.close()))),
    Effect.flatMap(() => Ref.set(clients, new Set())),
  );

  const listenOptions = host ? { host, port } : { port };
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
  const checkpointDiffQuery = yield* CheckpointDiffQuery;
  const orchestrationReactor = yield* OrchestrationReactor;

  const subscriptionsScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(subscriptionsScope, Exit.void));

  yield* Scope.provide(
    Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
      pushBus
        .publishAll(ORCHESTRATION_WS_CHANNELS.domainEvent, event)
        .pipe(
          Effect.tap(() =>
            Scope.provide(
              maybeDeliverServerNotification(event).pipe(Effect.forkScoped, Effect.asVoid),
              subscriptionsScope,
            ),
          ),
        ),
    ).pipe(Effect.forkScoped),
    subscriptionsScope,
  );

  yield* Scope.provide(orchestrationReactor.start, subscriptionsScope);
  yield* readiness.markOrchestrationSubscriptionsReady;

  let welcomeBootstrapProjectId: ProjectId | undefined;
  let welcomeBootstrapThreadId: ThreadId | undefined;

  if (autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const snapshot = yield* projectionReadModelQuery.getSnapshot();
      const existingProject = snapshot.projects.find(
        (project) => project.workspaceRoot === cwd && project.deletedAt === null,
      );
      let bootstrapProjectId: ProjectId;
      let bootstrapProjectDefaultModel: string;

      if (!existingProject) {
        const createdAt = new Date().toISOString();
        bootstrapProjectId = ProjectId.makeUnsafe(crypto.randomUUID());
        const bootstrapProjectTitle = path.basename(cwd) || "project";
        bootstrapProjectDefaultModel = "gpt-5-codex";
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          projectId: bootstrapProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: cwd,
          defaultModel: bootstrapProjectDefaultModel,
          createdAt,
        });
      } else {
        bootstrapProjectId = existingProject.id;
        bootstrapProjectDefaultModel = existingProject.defaultModel ?? "gpt-5-codex";
      }

      const existingThread = snapshot.threads.find(
        (thread) => thread.projectId === bootstrapProjectId && thread.deletedAt === null,
      );
      if (!existingThread) {
        const createdAt = new Date().toISOString();
        const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId,
          projectId: bootstrapProjectId,
          title: "New thread",
          model: bootstrapProjectDefaultModel,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = threadId;
      } else {
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = existingThread.id;
      }
    }).pipe(
      Effect.mapError(
        (cause) => new ServerLifecycleError({ operation: "autoBootstrapProject", cause }),
      ),
    );
  }

  const runtimeServices = yield* Effect.services<
    ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >();
  const runPromise = Effect.runPromiseWith(runtimeServices);

  yield* NodeHttpServer.make(() => httpServer, listenOptions).pipe(
    Effect.mapError((cause) => new ServerLifecycleError({ operation: "httpServerListen", cause })),
  );
  yield* readiness.markHttpListening;

  yield* Effect.addFinalizer(() =>
    Effect.all([closeAllClients, closeWebSocketServer.pipe(Effect.ignoreCause({ log: true }))]),
  );

  const routeRequest = Effect.fnUntraced(function* (_ws: WebSocket, request: WebSocketRequest) {
    switch (request.body._tag) {
      case ORCHESTRATION_WS_METHODS.getSnapshot:
        return yield* projectionReadModelQuery.getSnapshot();
      case ORCHESTRATION_WS_METHODS.dispatchCommand: {
        const normalizedCommand = yield* normalizeDispatchCommand({
          command: request.body.command,
        });
        return yield* orchestrationEngine.dispatch(normalizedCommand);
      }
      case ORCHESTRATION_WS_METHODS.getTurnDiff:
        return yield* checkpointDiffQuery.getTurnDiff(stripRequestTag(request.body));
      case ORCHESTRATION_WS_METHODS.getFullThreadDiff:
        return yield* checkpointDiffQuery.getFullThreadDiff(stripRequestTag(request.body));
      case ORCHESTRATION_WS_METHODS.replayEvents:
        return yield* Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(request.body.fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(Effect.map((events) => Array.from(events)));
      case WS_METHODS.projectsSearchEntries: {
        const body = request.body;
        return yield* Effect.tryPromise({
          try: () =>
            searchWorkspaceEntries({
              cwd: body.cwd,
              query: body.query,
              limit: body.limit,
            }),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to search workspace entries: ${String(cause)}`,
            }),
        });
      }
      case WS_METHODS.projectsListDirectory: {
        const body = request.body;
        return yield* Effect.tryPromise({
          try: () =>
            listWorkspaceDirectories({
              cwd: body.cwd,
            }),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to list workspace directories: ${String(cause)}`,
            }),
        });
      }
      case WS_METHODS.projectsWriteFile: {
        const body = stripRequestTag(request.body);
        const target = yield* resolveWorkspaceWritePath({
          workspaceRoot: body.cwd,
          relativePath: body.relativePath,
          path,
        });
        yield* fileSystem
          .makeDirectory(path.dirname(target.absolutePath), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RouteRequestError({
                  message: `Failed to prepare workspace path: ${String(cause)}`,
                }),
            ),
          );
        yield* fileSystem.writeFileString(target.absolutePath, body.contents).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to write workspace file: ${String(cause)}`,
              }),
          ),
        );
        return { relativePath: target.relativePath };
      }
      case WS_METHODS.projectsCreateDirectory: {
        const body = stripRequestTag(request.body);
        const target = yield* resolveWorkspaceWritePath({
          workspaceRoot: body.cwd,
          relativePath: body.relativePath,
          path,
        });
        yield* fileSystem.makeDirectory(target.absolutePath, { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to create directory: ${String(cause)}`,
              }),
          ),
        );
        return { relativePath: target.relativePath };
      }
      case WS_METHODS.gitStatus:
        return yield* gitManager.status(stripRequestTag(request.body));
      case WS_METHODS.gitPull:
        return yield* git.pullCurrentBranch(stripRequestTag(request.body).cwd);
      case WS_METHODS.gitRunStackedAction:
        return yield* gitManager.runStackedAction(stripRequestTag(request.body));
      case WS_METHODS.gitResolvePullRequest:
        return yield* gitManager.resolvePullRequest(stripRequestTag(request.body));
      case WS_METHODS.gitPreparePullRequestThread:
        return yield* gitManager.preparePullRequestThread(stripRequestTag(request.body));
      case WS_METHODS.gitListBranches:
        return yield* git.listBranches(stripRequestTag(request.body));
      case WS_METHODS.gitCreateWorktree:
        return yield* git.createWorktree(stripRequestTag(request.body));
      case WS_METHODS.gitRemoveWorktree:
        return yield* git.removeWorktree(stripRequestTag(request.body));
      case WS_METHODS.gitCreateBranch:
        return yield* git.createBranch(stripRequestTag(request.body));
      case WS_METHODS.gitDeleteBranch:
        return yield* git.deleteBranch(stripRequestTag(request.body));
      case WS_METHODS.gitCheckout:
        return yield* Effect.scoped(git.checkoutBranch(stripRequestTag(request.body)));
      case WS_METHODS.gitPrepareMainlineMerge:
        return yield* Effect.scoped(git.prepareMainlineMerge(stripRequestTag(request.body)));
      case WS_METHODS.gitInit:
        return yield* git.initRepo(stripRequestTag(request.body));
      case WS_METHODS.serverGetConfig:
        return {
          cwd,
          providers: yield* providerHealth.getStatuses,
          notifications: yield* notificationSettings.getSettings,
        };
      case WS_METHODS.serverGetConversationCapabilities: {
        const body = stripRequestTag(request.body);
        const snapshot = yield* projectionReadModelQuery.getSnapshot();
        const thread = snapshot.threads.find(
          (entry) => entry.id === body.threadId && entry.deletedAt === null,
        );
        if (!thread) {
          return yield* new RouteRequestError({
            message: `Thread '${body.threadId}' was not found.`,
          });
        }

        return buildServerConversationCapabilities({
          thread,
          providerStatuses: yield* providerHealth.getStatuses,
        });
      }
      case WS_METHODS.serverSetNotificationSettings: {
        const settings = yield* notificationSettings.setSettings(stripRequestTag(request.body));
        yield* pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
          providers: yield* providerHealth.getStatuses,
          notifications: {
            enabled: settings.enabled,
            pushoverConfigured: settings.pushover.configured,
          },
        });
        return settings;
      }
      case WS_METHODS.serverConfirmNotificationDelivery: {
        const body = stripRequestTag(request.body);
        yield* confirmAppNotificationDelivery(body.notificationId, body.delivery);
        return {};
      }
      case WS_METHODS.serverSendTestNotification: {
        const body = stripRequestTag(request.body);
        const notification = buildTestNotification(cwd, body.mode);

        if (body.mode === "pushover") {
          const pushoverDelivered = yield* sendPushoverFallback(notification).pipe(
            Effect.catchTag("PushoverDeliveryError", (error) =>
              Effect.fail(
                new RouteRequestError({
                  message: error.message,
                }),
              ),
            ),
          );
          if (!pushoverDelivered) {
            return yield* new RouteRequestError({
              message: "Pushover is not configured on the server.",
            });
          }

          return {
            notificationId: notification.notificationId,
            delivery: "pushover",
          };
        }

        const delivery = yield* deliverServerNotification(notification).pipe(
          Effect.catchTag("PushoverDeliveryError", (error) =>
            Effect.fail(
              new RouteRequestError({
                message: error.message,
              }),
            ),
          ),
        );
        if (delivery === null) {
          return yield* new RouteRequestError({
            message:
              "The test alert could not be delivered to the app, and Pushover is not configured.",
          });
        }

        return {
          notificationId: notification.notificationId,
          delivery,
        };
      }
      default: {
        const _exhaustiveCheck: never = request.body;
        return yield* new RouteRequestError({
          message: `Unknown method: ${String(_exhaustiveCheck)}`,
        });
      }
    }
  });

  const handleMessage = Effect.fnUntraced(function* (ws: WebSocket, raw: unknown) {
    const sendWsResponse = (response: WsResponseMessage) =>
      encodeWsResponse(response).pipe(
        Effect.tap((encodedResponse) => Effect.sync(() => ws.send(encodedResponse))),
        Effect.asVoid,
      );

    const messageText = websocketRawToString(raw);
    if (messageText === null) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: "Invalid request format: Failed to read message" },
      });
    }

    const request = decodeWebSocketRequest(messageText);
    if (Result.isFailure(request)) {
      return yield* sendWsResponse({
        id: extractRequestIdForDecodeFailure(messageText),
        error: { message: `Invalid request format: ${formatSchemaError(request.failure)}` },
      });
    }

    const result = yield* Effect.exit(routeRequest(ws, request.success));
    if (Exit.isFailure(result)) {
      return yield* sendWsResponse({
        id: request.success.id,
        error: { message: formatRequestFailure(result.cause) },
      });
    }

    return yield* sendWsResponse({ id: request.success.id, result: result.value });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {});
    if (authToken) {
      let providedToken: string | null = null;
      try {
        const url = new URL(request.url ?? "/", `http://localhost:${port}`);
        providedToken = url.searchParams.get("token");
      } catch {
        rejectUpgrade(socket, 400, "Invalid WebSocket URL");
        return;
      }
      if (providedToken !== authToken) {
        rejectUpgrade(socket, 401, "Unauthorized WebSocket connection");
        return;
      }
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    const segments = cwd.split(/[/\\]/).filter(Boolean);
    const projectName = segments[segments.length - 1] ?? "project";
    const welcomeData = {
      cwd,
      projectName,
      ...(welcomeBootstrapProjectId ? { bootstrapProjectId: welcomeBootstrapProjectId } : {}),
      ...(welcomeBootstrapThreadId ? { bootstrapThreadId: welcomeBootstrapThreadId } : {}),
    };

    void runPromise(
      readiness.awaitServerReady.pipe(
        Effect.flatMap(() => pushBus.publishClient(ws, WS_CHANNELS.serverWelcome, welcomeData)),
        Effect.flatMap((delivered) =>
          delivered ? Ref.update(clients, (clients) => clients.add(ws)) : Effect.void,
        ),
      ),
    );

    ws.on("message", (raw) => {
      void runPromise(handleMessage(ws, raw).pipe(Effect.ignoreCause({ log: true })));
    });
    ws.on("close", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });
    ws.on("error", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });
  });

  return httpServer;
});

export const ServerLive = Layer.succeed(Server, {
  start: createServer(),
  stopSignal: Effect.never,
} satisfies ServerShape);
