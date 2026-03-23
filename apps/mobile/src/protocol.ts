import type {
  AssistantDeliveryMode,
  GitListBranchesResult,
  GitPrepareMainlineMergeResult,
  GitStackedAction,
  GitRunStackedActionResult,
  GitStatusResult,
  OrchestrationReadModel,
  ProjectEntry,
  ProviderModelOptions,
  ProviderReasoningEffort,
  ProviderInteractionMode,
  RuntimeMode,
  ServerConfig,
  ServerConversationCapabilities,
  UploadChatAttachment,
  WsWelcomePayload,
} from "@t3tools/contracts";

export const MOBILE_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getSnapshot: "orchestration.getSnapshot",
  projectsCreateDirectory: "projects.createDirectory",
  projectsSearchEntries: "projects.searchEntries",
  gitCheckout: "git.checkout",
  gitCreateBranch: "git.createBranch",
  gitListBranches: "git.listBranches",
  gitPrepareMainlineMerge: "git.prepareMainlineMerge",
  gitPull: "git.pull",
  gitRunStackedAction: "git.runStackedAction",
  gitStatus: "git.status",
  serverGetConfig: "server.getConfig",
  serverGetConversationCapabilities: "server.getConversationCapabilities",
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
  readonly attachments?: ReadonlyArray<UploadChatAttachment>;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly model: string;
  readonly modelOptions?: ProviderModelOptions;
  readonly reasoningEffort?: ProviderReasoningEffort | null;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
}

export interface InterruptTurnInput {
  readonly threadId: string;
  readonly turnId?: string;
}

export interface StopSessionInput {
  readonly threadId: string;
}

export interface ApprovalResponseInput {
  readonly threadId: string;
  readonly requestId: string;
  readonly decision: "accept" | "acceptForSession" | "decline" | "cancel";
}

export interface DeleteThreadInput {
  readonly threadId: string;
}

export interface SearchDirectoryInput {
  readonly cwd: string;
}

export interface CreateDirectoryInput {
  readonly cwd: string;
  readonly relativePath: string;
}

export interface GitWorkspaceInput {
  readonly cwd: string;
}

export interface GitBranchInput extends GitWorkspaceInput {
  readonly branch: string;
}

export interface GitRunStackedActionInput {
  readonly cwd: string;
  readonly action: GitStackedAction;
  readonly commitMessage?: string;
}

export interface GitPrepareMainlineMergeInput extends GitWorkspaceInput {
  readonly squash?: boolean;
}

export interface GetConversationCapabilitiesInput {
  readonly threadId: string;
}

export interface MobileBackendState {
  readonly snapshot: OrchestrationReadModel | null;
  readonly serverConfig: ServerConfig | null;
  readonly welcome: WsWelcomePayload | null;
}

export type ConversationCapabilities = ServerConversationCapabilities;

export interface DirectoryListing {
  readonly cwd: string;
  readonly entries: ProjectEntry[];
  readonly truncated: boolean;
}

export type MobileGitStatus = GitStatusResult;
export type MobileGitBranches = GitListBranchesResult;
export type MobileGitRunResult = GitRunStackedActionResult;
export type MobileGitPrepareMainlineMergeResult = GitPrepareMainlineMergeResult;

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

export function buildAttachmentUrl(serverUrl: string, authToken: string, attachmentId: string) {
  const parsed = normalizeServerUrl(serverUrl);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  if (authToken.trim()) {
    parsed.searchParams.set("token", authToken.trim());
  } else {
    parsed.searchParams.delete("token");
  }
  parsed.pathname = `/attachments/${encodeURIComponent(attachmentId)}`;
  return parsed.toString();
}
