import { Schema } from "effect";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind, RuntimeMode } from "./orchestration";

export const ServerProviderStatusState = Schema.Literals(["ready", "warning", "error"]);
export type ServerProviderStatusState = typeof ServerProviderStatusState.Type;

export const ServerProviderAuthStatus = Schema.Literals([
  "authenticated",
  "unauthenticated",
  "unknown",
]);
export type ServerProviderAuthStatus = typeof ServerProviderAuthStatus.Type;

export const ServerProviderStatus = Schema.Struct({
  provider: ProviderKind,
  status: ServerProviderStatusState,
  available: Schema.Boolean,
  authStatus: ServerProviderAuthStatus,
  checkedAt: IsoDateTime,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderStatus = typeof ServerProviderStatus.Type;

export const ServerProviderStatuses = Schema.Array(ServerProviderStatus);
export type ServerProviderStatuses = typeof ServerProviderStatuses.Type;

export const ServerConversationModelSwitchMode = Schema.Literals([
  "in-session",
  "restart-session",
  "unsupported",
]);
export type ServerConversationModelSwitchMode = typeof ServerConversationModelSwitchMode.Type;

export const ServerConversationModelOption = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  available: Schema.Boolean,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type ServerConversationModelOption = typeof ServerConversationModelOption.Type;

export const ServerConversationRuntimeModeOption = Schema.Struct({
  mode: RuntimeMode,
  granted: Schema.Boolean,
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type ServerConversationRuntimeModeOption = typeof ServerConversationRuntimeModeOption.Type;

export const ServerConversationCapabilitiesInput = Schema.Struct({
  threadId: ThreadId,
});
export type ServerConversationCapabilitiesInput = typeof ServerConversationCapabilitiesInput.Type;

export const ServerConversationCapabilities = Schema.Struct({
  threadId: ThreadId,
  provider: ProviderKind,
  modelSwitch: ServerConversationModelSwitchMode,
  models: Schema.Array(ServerConversationModelOption),
  runtimeModes: Schema.Array(ServerConversationRuntimeModeOption),
});
export type ServerConversationCapabilities = typeof ServerConversationCapabilities.Type;

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  providers: ServerProviderStatuses,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  providers: ServerProviderStatuses,
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;
