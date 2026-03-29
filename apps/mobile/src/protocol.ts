import type {
  AssistantDeliveryMode,
  ChatAttachment,
  GitListBranchesResult,
  GitPrepareMainlineMergeResult,
  GitStackedAction,
  GitRunStackedActionResult,
  GitStatusResult,
  OrchestrationReadModel,
  OrchestrationSnapshotInvalidationPayload,
  ProjectCloneGitRepositoryResult,
  ProjectEntry,
  ProviderModelOptions,
  ProviderReasoningEffort,
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  RuntimeMode,
  ServerAppNotification,
  ServerConfig,
  ServerConfirmNotificationDeliveryInput,
  ServerConversationCapabilities,
  ServerSendTestNotificationInput,
  ServerSendTestNotificationResult,
  ServerSetNotificationSettingsInput,
  TurnDispatchMode,
  UploadChatAttachment,
  WsWelcomePayload,
} from "@t3tools/contracts";

export const MOBILE_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getSnapshot: "orchestration.getSnapshot",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  projectsCreateDirectory: "projects.createDirectory",
  projectsCloneGitRepository: "projects.cloneGitRepository",
  projectsListDirectory: "projects.listDirectory",
  projectsSearchEntries: "projects.searchEntries",
  gitCheckout: "git.checkout",
  gitCreateBranch: "git.createBranch",
  gitDeleteBranch: "git.deleteBranch",
  gitListBranches: "git.listBranches",
  gitPrepareMainlineMerge: "git.prepareMainlineMerge",
  gitPull: "git.pull",
  gitRunStackedAction: "git.runStackedAction",
  gitStatus: "git.status",
  serverGetConfig: "server.getConfig",
  serverGetConversationCapabilities: "server.getConversationCapabilities",
  serverSetNotificationSettings: "server.setNotificationSettings",
  serverConfirmNotificationDelivery: "server.confirmNotificationDelivery",
  serverSendTestNotification: "server.sendTestNotification",
} as const;

export const MOBILE_WS_CHANNELS = {
  domainEvent: "orchestration.domainEvent",
  snapshotInvalidated: "orchestration.snapshotInvalidated",
  serverConfigUpdated: "server.configUpdated",
  serverNotification: "server.notification",
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

export type SendTurnAttachment = UploadChatAttachment | ChatAttachment;

export interface SendTurnInput {
  readonly threadId: string;
  readonly messageId?: string;
  readonly text: string;
  readonly attachments?: ReadonlyArray<SendTurnAttachment>;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly model: string;
  readonly modelOptions?: ProviderModelOptions;
  readonly reasoningEffort?: ProviderReasoningEffort | null;
  readonly turnDispatchMode: TurnDispatchMode;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
}

export interface InterruptTurnInput {
  readonly threadId: string;
  readonly turnId?: string;
}

export interface RemoveQueuedTurnInput {
  readonly threadId: string;
  readonly messageId: string;
}

export interface StopSessionInput {
  readonly threadId: string;
}

export interface ApprovalResponseInput {
  readonly threadId: string;
  readonly requestId: string;
  readonly decision: "accept" | "acceptForSession" | "decline" | "cancel";
}

export interface UserInputResponseInput {
  readonly threadId: string;
  readonly requestId: string;
  readonly answers: ProviderUserInputAnswers;
}

export interface DeleteThreadInput {
  readonly threadId: string;
}

export interface ListDirectoryInput {
  readonly cwd: string;
}

export interface CreateDirectoryInput {
  readonly cwd: string;
  readonly relativePath: string;
}

export interface CloneGitRepositoryInput {
  readonly cwd: string;
  readonly repositoryUrl: string;
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

export type SetNotificationSettingsInput = ServerSetNotificationSettingsInput;
export type ConfirmNotificationDeliveryInput = ServerConfirmNotificationDeliveryInput;
export type SendTestNotificationInput = ServerSendTestNotificationInput;
export type SendTestNotificationResult = ServerSendTestNotificationResult;
export type MobileServerNotification = ServerAppNotification;
export type MobileSnapshotInvalidation = OrchestrationSnapshotInvalidationPayload;

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

export type CloneGitRepositoryResult = ProjectCloneGitRepositoryResult;

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

export function buildHealthcheckUrl(serverUrl: string) {
  const parsed = normalizeServerUrl(serverUrl);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.search = "";
  parsed.pathname = "/health";
  return parsed.toString();
}
