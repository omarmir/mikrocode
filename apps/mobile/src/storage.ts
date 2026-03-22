import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

const STORAGE_KEY = "@t3tools/mobile/connection-settings";

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
