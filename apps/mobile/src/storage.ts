import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  AssistantDeliveryMode,
  ProviderReasoningEffort,
  RuntimeMode,
} from "@t3tools/contracts";

import {
  DEFAULT_APP_THEME_SETTINGS,
  isAppThemeAccent,
  isAppThemeNeutral,
  type AppThemeAccent,
  type AppThemeNeutral,
} from "./theme";

export interface ConnectionSettings {
  readonly serverUrl: string;
  readonly authToken: string;
  readonly autoConnect: boolean;
  readonly themeBase: AppThemeNeutral;
  readonly themeAccent: AppThemeAccent;
}

export interface StoredThreadTurnPreference {
  readonly reasoningEffort: ProviderReasoningEffort | null;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
  readonly runtimeMode: RuntimeMode;
}

const STORAGE_KEY = "@t3tools/mobile/connection-settings";
const THREAD_TURN_PREFERENCES_STORAGE_KEY = "@t3tools/mobile/thread-turn-preferences";
const VALID_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultrathink"]);
const VALID_ASSISTANT_DELIVERY_MODES = new Set(["buffered", "streaming"]);
const VALID_RUNTIME_MODES = new Set(["approval-required", "full-access"]);

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  serverUrl: "ws://localhost:3773",
  authToken: "",
  autoConnect: true,
  themeBase: DEFAULT_APP_THEME_SETTINGS.neutralBase,
  themeAccent: DEFAULT_APP_THEME_SETTINGS.accent,
};

function isLoopbackServerUrl(value: string) {
  return /^(ws|http)s?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(value.trim());
}

function getExpoHostUri() {
  return (
    Constants.expoConfig?.hostUri ??
    Constants.platform?.hostUri ??
    Constants.manifest2?.extra?.expoClient?.hostUri ??
    null
  );
}

function deriveServerUrl() {
  const hostUri = getExpoHostUri();
  if (!hostUri) {
    return DEFAULT_CONNECTION_SETTINGS.serverUrl;
  }

  const host = hostUri.split(":")[0]?.trim();
  if (!host) {
    return DEFAULT_CONNECTION_SETTINGS.serverUrl;
  }

  return `ws://${host}:3773`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoredThreadTurnPreference(value: unknown): StoredThreadTurnPreference | null {
  if (!isRecord(value)) {
    return null;
  }

  const reasoningEffort =
    value.reasoningEffort === null
      ? null
      : typeof value.reasoningEffort === "string" &&
          VALID_REASONING_EFFORTS.has(value.reasoningEffort)
        ? (value.reasoningEffort as ProviderReasoningEffort)
        : null;
  const assistantDeliveryMode =
    typeof value.assistantDeliveryMode === "string" &&
    VALID_ASSISTANT_DELIVERY_MODES.has(value.assistantDeliveryMode)
      ? (value.assistantDeliveryMode as AssistantDeliveryMode)
      : null;
  const runtimeMode =
    typeof value.runtimeMode === "string" && VALID_RUNTIME_MODES.has(value.runtimeMode)
      ? (value.runtimeMode as RuntimeMode)
      : null;

  if (!assistantDeliveryMode || !runtimeMode) {
    return null;
  }

  return {
    reasoningEffort,
    assistantDeliveryMode,
    runtimeMode,
  };
}

export function getDefaultConnectionSettings(): ConnectionSettings {
  return {
    ...DEFAULT_CONNECTION_SETTINGS,
    serverUrl: deriveServerUrl(),
  };
}

export async function loadConnectionSettings(
  defaults: ConnectionSettings = getDefaultConnectionSettings(),
): Promise<ConnectionSettings> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ConnectionSettings>;
    const parsedServerUrl =
      typeof parsed.serverUrl === "string" && parsed.serverUrl.trim().length > 0
        ? parsed.serverUrl
        : defaults.serverUrl;

    return {
      serverUrl:
        isLoopbackServerUrl(parsedServerUrl) &&
        defaults.serverUrl !== DEFAULT_CONNECTION_SETTINGS.serverUrl
          ? defaults.serverUrl
          : parsedServerUrl,
      authToken: typeof parsed.authToken === "string" ? parsed.authToken : defaults.authToken,
      autoConnect:
        typeof parsed.autoConnect === "boolean" ? parsed.autoConnect : defaults.autoConnect,
      themeBase: isAppThemeNeutral(parsed.themeBase) ? parsed.themeBase : defaults.themeBase,
      themeAccent: isAppThemeAccent(parsed.themeAccent) ? parsed.themeAccent : defaults.themeAccent,
    };
  } catch {
    return defaults;
  }
}

export async function saveConnectionSettings(settings: ConnectionSettings) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export async function loadThreadTurnPreferences(): Promise<
  Record<string, StoredThreadTurnPreference>
> {
  const stored = await AsyncStorage.getItem(THREAD_TURN_PREFERENCES_STORAGE_KEY);
  if (!stored) {
    return {};
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([threadId, value]) => {
        const preference = parseStoredThreadTurnPreference(value);
        return preference ? [[threadId, preference] as const] : [];
      }),
    );
  } catch {
    return {};
  }
}

export async function saveThreadTurnPreferences(
  preferences: Record<string, StoredThreadTurnPreference>,
) {
  await AsyncStorage.setItem(THREAD_TURN_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}
