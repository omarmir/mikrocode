import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ConnectionSettings {
  readonly serverUrl: string;
  readonly authToken: string;
  readonly autoConnect: boolean;
}

const STORAGE_KEY = "@t3tools/mobile/connection-settings";

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  serverUrl: "ws://localhost:3773",
  authToken: "",
  autoConnect: true,
};

export async function loadConnectionSettings(): Promise<ConnectionSettings> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return DEFAULT_CONNECTION_SETTINGS;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<ConnectionSettings>;
    return {
      serverUrl:
        typeof parsed.serverUrl === "string"
          ? parsed.serverUrl
          : DEFAULT_CONNECTION_SETTINGS.serverUrl,
      authToken:
        typeof parsed.authToken === "string"
          ? parsed.authToken
          : DEFAULT_CONNECTION_SETTINGS.authToken,
      autoConnect:
        typeof parsed.autoConnect === "boolean"
          ? parsed.autoConnect
          : DEFAULT_CONNECTION_SETTINGS.autoConnect,
    };
  } catch {
    return DEFAULT_CONNECTION_SETTINGS;
  }
}

export async function saveConnectionSettings(settings: ConnectionSettings) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
