// @ts-nocheck
export function createLogger(scope: string) {
  return {
    event(message: string, details?: Record<string, unknown>) {
      if (details && Object.keys(details).length > 0) {
        console.info(`[${scope}] ${message}`, details);
        return;
      }
      console.info(`[${scope}] ${message}`);
    },
  };
}
