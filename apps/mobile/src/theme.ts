export const FLEXOKI_DARK_NEUTRAL_SCALE = {
  black: "#100F0F",
  "950": "#1C1B1A",
  "900": "#282726",
  "850": "#343331",
  "800": "#403E3C",
  "700": "#575653",
  "600": "#6F6E69",
  "500": "#878580",
  "300": "#B7B5AC",
  "200": "#CECDC3",
  "150": "#DAD8CE",
  "100": "#E6E4D9",
  "50": "#F2F0E5",
  paper: "#FFFCF0",
} as const;

export const FLEXOKI_DARK_ACCENTS = {
  red: "#AF3029",
  orange: "#BC5215",
  yellow: "#AD8301",
  green: "#66800B",
  cyan: "#24837B",
  blue: "#205EA6",
  purple: "#5E409D",
  magenta: "#A02F6F",
} as const;

export type AppThemeNeutral = "black" | "950" | "900" | "850";
export type AppThemeAccent = keyof typeof FLEXOKI_DARK_ACCENTS;

export interface AppThemeSettings {
  readonly neutralBase: AppThemeNeutral;
  readonly accent: AppThemeAccent;
}

export interface AppThemeOption<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly value: string;
}

export interface AppTheme {
  readonly key: string;
  readonly background: string;
  readonly panel: string;
  readonly panelAlt: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly accentSoftStrong: string;
  readonly warning: string;
  readonly warningSoft: string;
  readonly danger: string;
  readonly dangerSoft: string;
  readonly overlay: string;
  readonly modalOverlay: string;
  readonly userMessageBackground: string;
  readonly userMessageBorder: string;
  readonly assistantMessageBackground: string;
  readonly assistantMessageBorder: string;
}

const FLEXOKI_DARK_NEUTRAL_ORDER: ReadonlyArray<keyof typeof FLEXOKI_DARK_NEUTRAL_SCALE> = [
  "black",
  "950",
  "900",
  "850",
  "800",
  "700",
  "600",
  "500",
  "300",
  "200",
  "150",
  "100",
  "50",
  "paper",
];

export const FLEXOKI_DARK_NEUTRAL_OPTIONS: ReadonlyArray<AppThemeOption<AppThemeNeutral>> = [
  { id: "black", label: "Black", value: FLEXOKI_DARK_NEUTRAL_SCALE.black },
  { id: "950", label: "Ink", value: FLEXOKI_DARK_NEUTRAL_SCALE["950"] },
  { id: "900", label: "Char", value: FLEXOKI_DARK_NEUTRAL_SCALE["900"] },
  { id: "850", label: "Stone", value: FLEXOKI_DARK_NEUTRAL_SCALE["850"] },
];

export const FLEXOKI_DARK_ACCENT_OPTIONS: ReadonlyArray<AppThemeOption<AppThemeAccent>> = [
  { id: "red", label: "Red", value: FLEXOKI_DARK_ACCENTS.red },
  { id: "orange", label: "Orange", value: FLEXOKI_DARK_ACCENTS.orange },
  { id: "yellow", label: "Yellow", value: FLEXOKI_DARK_ACCENTS.yellow },
  { id: "green", label: "Green", value: FLEXOKI_DARK_ACCENTS.green },
  { id: "cyan", label: "Cyan", value: FLEXOKI_DARK_ACCENTS.cyan },
  { id: "blue", label: "Blue", value: FLEXOKI_DARK_ACCENTS.blue },
  { id: "purple", label: "Purple", value: FLEXOKI_DARK_ACCENTS.purple },
  { id: "magenta", label: "Magenta", value: FLEXOKI_DARK_ACCENTS.magenta },
];

export const DEFAULT_APP_THEME_SETTINGS: AppThemeSettings = {
  neutralBase: "black",
  accent: "green",
};

function channelPair(hex: string, start: number) {
  return Number.parseInt(hex.slice(start, start + 2), 16);
}

function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const red = channelPair(normalized, 0);
  const green = channelPair(normalized, 2);
  const blue = channelPair(normalized, 4);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function neutralAt(base: AppThemeNeutral, offset: number) {
  const startIndex = FLEXOKI_DARK_NEUTRAL_ORDER.indexOf(base);
  const targetIndex = Math.min(
    FLEXOKI_DARK_NEUTRAL_ORDER.length - 1,
    Math.max(0, startIndex + offset),
  );
  return FLEXOKI_DARK_NEUTRAL_SCALE[FLEXOKI_DARK_NEUTRAL_ORDER[targetIndex]];
}

export function isAppThemeNeutral(value: unknown): value is AppThemeNeutral {
  return FLEXOKI_DARK_NEUTRAL_OPTIONS.some((option) => option.id === value);
}

export function isAppThemeAccent(value: unknown): value is AppThemeAccent {
  return FLEXOKI_DARK_ACCENT_OPTIONS.some((option) => option.id === value);
}

export function resolveAppTheme(settings: AppThemeSettings): AppTheme {
  const accent = FLEXOKI_DARK_ACCENTS[settings.accent];
  return {
    key: `${settings.neutralBase}:${settings.accent}`,
    background: neutralAt(settings.neutralBase, 0),
    panel: neutralAt(settings.neutralBase, 1),
    panelAlt: neutralAt(settings.neutralBase, 2),
    border: neutralAt(settings.neutralBase, 4),
    borderStrong: neutralAt(settings.neutralBase, 5),
    muted: neutralAt(settings.neutralBase, 6),
    text: neutralAt(settings.neutralBase, 10),
    accent,
    accentSoft: withAlpha(accent, 0.18),
    accentSoftStrong: withAlpha(accent, 0.3),
    warning: FLEXOKI_DARK_ACCENTS.yellow,
    warningSoft: withAlpha(FLEXOKI_DARK_ACCENTS.yellow, 0.18),
    danger: FLEXOKI_DARK_ACCENTS.red,
    dangerSoft: withAlpha(FLEXOKI_DARK_ACCENTS.red, 0.18),
    overlay: withAlpha(FLEXOKI_DARK_NEUTRAL_SCALE.black, 0.74),
    modalOverlay: withAlpha(FLEXOKI_DARK_NEUTRAL_SCALE.black, 0.82),
    userMessageBackground: withAlpha(accent, 0.16),
    userMessageBorder: accent,
    assistantMessageBackground: neutralAt(settings.neutralBase, 1),
    assistantMessageBorder: neutralAt(settings.neutralBase, 4),
  };
}
