import type {
  OrchestrationReadModel,
  ProjectEntry,
  ProviderInteractionMode,
  RuntimeMode,
  ServerConfig,
  WsWelcomePayload,
} from "@t3tools/contracts";

export const MOBILE_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getSnapshot: "orchestration.getSnapshot",
  projectsCreateDirectory: "projects.createDirectory",
  projectsSearchEntries: "projects.searchEntries",
  serverGetConfig: "server.getConfig",
} as const;

export const MOBILE_WS_CHANNELS = {
  domainEvent: "orchestration.domainEvent",
  serverConfigUpdated: "server.configUpdated",
  serverWelcome: "server.welcome",
} as const;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface RpcResponse<TResult = unknown> {
  readonly id: string;
  readonly result?: TResult;
  readonly error?: {
    readonly message: string;
  };
}

export interface PushMessage<TChannel extends string = string, TData = unknown> {
  readonly type: "push";
  readonly sequence: number;
  readonly channel: TChannel;
  readonly data: TData;
}

export interface CreateThreadInput {
  readonly projectId: string;
  readonly title: string;
  readonly model: string;
}

export interface CreateProjectInput {
  readonly title: string;
  readonly workspaceRoot: string;
  readonly defaultModel?: string;
}

export interface SendTurnInput {
  readonly threadId: string;
  readonly text: string;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly model: string;
}

export interface InterruptTurnInput {
  readonly threadId: string;
  readonly turnId?: string;
}

export interface StopSessionInput {
  readonly threadId: string;
}

export interface SearchDirectoryInput {
  readonly cwd: string;
}

export interface CreateDirectoryInput {
  readonly cwd: string;
  readonly relativePath: string;
}

export interface MobileBackendState {
  readonly snapshot: OrchestrationReadModel | null;
  readonly serverConfig: ServerConfig | null;
  readonly welcome: WsWelcomePayload | null;
}

export interface DirectoryListing {
  readonly cwd: string;
  readonly entries: ProjectEntry[];
  readonly truncated: boolean;
}

export function createClientId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeServerUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Enter the backend URL first.");
  }

  const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (parsed.protocol === "http:") {
    parsed.protocol = "ws:";
  } else if (parsed.protocol === "https:") {
    parsed.protocol = "wss:";
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Use a ws://, wss://, http://, or https:// backend URL.");
  }

  return parsed;
}

export function buildWebSocketUrl(serverUrl: string, authToken: string) {
  const parsed = normalizeServerUrl(serverUrl);
  if (authToken.trim()) {
    parsed.searchParams.set("token", authToken.trim());
  } else {
    parsed.searchParams.delete("token");
  }
  return parsed.toString();
}

export function buildDisplayWebSocketUrl(serverUrl: string, authToken: string) {
  const parsed = normalizeServerUrl(serverUrl);
  if (authToken.trim()) {
    parsed.searchParams.set("token", "***");
  } else {
    parsed.searchParams.delete("token");
  }
  return parsed.toString();
}
