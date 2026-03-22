import {
  MODEL_OPTIONS_BY_PROVIDER,
  type OrchestrationThread,
  type ProviderKind,
  type RuntimeMode,
  type ServerConversationCapabilities,
  type ServerConversationModelOption,
  type ServerConversationRuntimeModeOption,
  type ServerProviderStatus,
} from "@t3tools/contracts";
import { inferProviderForModel } from "@t3tools/shared/model";

const RUNTIME_MODES_BY_PROVIDER: Record<ProviderKind, readonly RuntimeMode[]> = {
  codex: ["approval-required", "full-access"],
  claudeAgent: ["approval-required", "full-access"],
};
const MODEL_SWITCH_BY_PROVIDER: Record<
  ProviderKind,
  ServerConversationCapabilities["modelSwitch"]
> = {
  codex: "in-session",
  claudeAgent: "in-session",
};

function isKnownProvider(value: string | null | undefined): value is ProviderKind {
  return value === "codex" || value === "claudeAgent";
}

export function resolveConversationProvider(thread: OrchestrationThread): ProviderKind {
  return isKnownProvider(thread.session?.providerName)
    ? thread.session.providerName
    : inferProviderForModel(thread.model);
}

function resolveProviderBlockedReason(status: ServerProviderStatus | undefined) {
  if (!status) {
    return "Provider status is unavailable.";
  }
  if (status.authStatus === "unauthenticated") {
    return status.message ?? "Provider authentication is required.";
  }
  if (!status.available) {
    return status.message ?? "Provider is unavailable.";
  }
  return undefined;
}

function hasActiveSession(thread: OrchestrationThread) {
  return thread.session !== null && thread.session.status !== "stopped";
}

function buildModelOptions(input: {
  readonly thread: OrchestrationThread;
  readonly provider: ProviderKind;
  readonly providerBlockedReason: string | undefined;
  readonly modelSwitch: ServerConversationCapabilities["modelSwitch"];
}): ReadonlyArray<ServerConversationModelOption> {
  const { modelSwitch, provider, providerBlockedReason, thread } = input;
  const currentModel = thread.model.trim();
  const shouldLockModelSwitch = modelSwitch === "unsupported" && hasActiveSession(thread);
  const modelSwitchBlockedReason = shouldLockModelSwitch
    ? "Stop the active session before changing models."
    : undefined;
  const options: Array<{ slug: string; name: string }> = [...MODEL_OPTIONS_BY_PROVIDER[provider]];
  if (currentModel && !options.some((option) => option.slug === currentModel)) {
    options.unshift({
      slug: currentModel,
      name: currentModel,
    });
  }

  return options.map((option) => {
    const isCurrent = option.slug === currentModel;
    const blockedReason =
      providerBlockedReason ?? (!isCurrent ? modelSwitchBlockedReason : undefined);
    if (blockedReason) {
      return {
        slug: option.slug,
        name: option.name,
        available: false,
        reason: blockedReason,
      };
    }
    return {
      slug: option.slug,
      name: option.name,
      available: true,
    };
  });
}

function buildRuntimeModeOptions(input: {
  readonly provider: ProviderKind;
  readonly providerBlockedReason: string | undefined;
}): ReadonlyArray<ServerConversationRuntimeModeOption> {
  const { provider, providerBlockedReason } = input;
  return RUNTIME_MODES_BY_PROVIDER[provider].map((mode) =>
    providerBlockedReason
      ? {
          mode,
          granted: false,
          reason: providerBlockedReason,
        }
      : {
          mode,
          granted: true,
        },
  );
}

export function buildServerConversationCapabilities(input: {
  readonly thread: OrchestrationThread;
  readonly providerStatuses: ReadonlyArray<ServerProviderStatus>;
}): ServerConversationCapabilities {
  const provider = resolveConversationProvider(input.thread);
  const modelSwitch = MODEL_SWITCH_BY_PROVIDER[provider];
  const providerStatus = input.providerStatuses.find((status) => status.provider === provider);
  const providerBlockedReason = resolveProviderBlockedReason(providerStatus);

  return {
    threadId: input.thread.id,
    provider,
    modelSwitch,
    models: buildModelOptions({
      thread: input.thread,
      provider,
      providerBlockedReason,
      modelSwitch,
    }),
    runtimeModes: buildRuntimeModeOptions({
      provider,
      providerBlockedReason,
    }),
  };
}
