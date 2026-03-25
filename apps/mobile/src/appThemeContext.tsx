import { createContext, type ReactNode, useContext } from "react";

import type { AppTheme } from "./theme";

type AppThemeContextValue = {
  readonly styles: any;
  readonly theme: AppTheme;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: AppThemeContextValue;
}) {
  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppThemeContext() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error("App theme context is unavailable.");
  }

  return context;
}
