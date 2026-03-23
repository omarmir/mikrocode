import { Schema } from "effect";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString, TurnId } from "./baseSchemas";
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

export const ServerNotificationDelivery = Schema.Literals(["toast", "device"]);
export type ServerNotificationDelivery = typeof ServerNotificationDelivery.Type;

export const ServerAppNotificationKind = Schema.Literals(["turn.completed", "turn.error", "test"]);
export type ServerAppNotificationKind = typeof ServerAppNotificationKind.Type;

export const ServerAppNotification = Schema.Struct({
  notificationId: TrimmedNonEmptyString,
  kind: ServerAppNotificationKind,
  projectId: ProjectId,
  threadId: ThreadId,
  turnId: TurnId,
  title: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type ServerAppNotification = typeof ServerAppNotification.Type;

export const ServerConfirmNotificationDeliveryInput = Schema.Struct({
  notificationId: TrimmedNonEmptyString,
  delivery: ServerNotificationDelivery,
});
export type ServerConfirmNotificationDeliveryInput =
  typeof ServerConfirmNotificationDeliveryInput.Type;

export const ServerTestNotificationMode = Schema.Literals(["auto", "pushover"]);
export type ServerTestNotificationMode = typeof ServerTestNotificationMode.Type;

export const ServerTestNotificationDelivery = Schema.Literals(["toast", "device", "pushover"]);
export type ServerTestNotificationDelivery = typeof ServerTestNotificationDelivery.Type;

export const ServerSendTestNotificationInput = Schema.Struct({
  mode: ServerTestNotificationMode,
});
export type ServerSendTestNotificationInput = typeof ServerSendTestNotificationInput.Type;

export const ServerSendTestNotificationResult = Schema.Struct({
  notificationId: TrimmedNonEmptyString,
  delivery: ServerTestNotificationDelivery,
});
export type ServerSendTestNotificationResult = typeof ServerSendTestNotificationResult.Type;

const PushoverCredential = TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Za-z0-9]{30}$/));
export type PushoverCredential = typeof PushoverCredential.Type;

export const ServerPushoverNotificationSettings = Schema.Struct({
  appToken: Schema.NullOr(PushoverCredential),
  userKey: Schema.NullOr(PushoverCredential),
  configured: Schema.Boolean,
});
export type ServerPushoverNotificationSettings = typeof ServerPushoverNotificationSettings.Type;

export const ServerNotificationSettings = Schema.Struct({
  pushover: ServerPushoverNotificationSettings,
});
export type ServerNotificationSettings = typeof ServerNotificationSettings.Type;

export const ServerNotificationSettingsSummary = Schema.Struct({
  pushoverConfigured: Schema.Boolean,
});
export type ServerNotificationSettingsSummary = typeof ServerNotificationSettingsSummary.Type;

export const ServerSetNotificationSettingsInput = Schema.Struct({
  pushover: Schema.Struct({
    appToken: Schema.NullOr(PushoverCredential),
    userKey: Schema.NullOr(PushoverCredential),
  }),
});
export type ServerSetNotificationSettingsInput = typeof ServerSetNotificationSettingsInput.Type;

export const ServerConfig = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  providers: ServerProviderStatuses,
  notifications: ServerNotificationSettings,
});
export type ServerConfig = typeof ServerConfig.Type;

export const ServerConfigUpdatedPayload = Schema.Struct({
  providers: ServerProviderStatuses,
  notifications: Schema.optional(ServerNotificationSettingsSummary),
});
export type ServerConfigUpdatedPayload = typeof ServerConfigUpdatedPayload.Type;
