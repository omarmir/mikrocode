// @ts-nocheck
/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import { Context, Effect, FileSystem, Layer, Path } from "effect";

export const DEFAULT_PORT = 3773;

export type RuntimeMode = "server";
export type StartupPresentation = "browser" | "headless";

export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly dbPath: string;
  readonly worktreesDir: string;
  readonly attachmentsDir: string;
  readonly logsDir: string;
  readonly terminalLogsDir: string;
  readonly serverLogPath: string;
  readonly serverTracePath: string;
  readonly providerLogsDir: string;
  readonly providerEventLogPath: string;
  readonly anonymousIdPath: string;
  readonly environmentIdPath: string;
  readonly settingsPath: string;
  readonly secretsDir: string;
}

export interface ServerConfigShape extends ServerDerivedPaths {
  readonly logLevel?: unknown;
  readonly traceMinLevel?: unknown;
  readonly traceTimingEnabled?: boolean;
  readonly traceBatchWindowMs?: number;
  readonly traceMaxBytes?: number;
  readonly traceMaxFiles?: number;
  readonly otlpTracesUrl?: string | undefined;
  readonly otlpMetricsUrl?: string | undefined;
  readonly otlpExportIntervalMs?: number;
  readonly otlpServiceName?: string;
  readonly mode: RuntimeMode;
  readonly port: number;
  readonly host: string | undefined;
  readonly cwd: string;
  readonly baseDir: string;
  readonly authToken: string | undefined;
  readonly staticDir?: string | undefined;
  readonly devUrl?: URL | undefined;
  readonly noBrowser?: boolean;
  readonly startupPresentation?: "browser" | "headless";
  readonly autoBootstrapProjectFromCwd: boolean;
  readonly logWebSocketEvents: boolean;
  readonly tailscaleServeEnabled?: boolean;
  readonly tailscaleServePort?: number;
}

export const deriveServerPaths = Effect.fn(function* (
  baseDir: ServerConfigShape["baseDir"],
  _unused?: unknown,
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  const stateDir = join(baseDir, "userdata");
  const dbPath = join(stateDir, "state.sqlite");
  const attachmentsDir = join(stateDir, "attachments");
  const logsDir = join(stateDir, "logs");
  const terminalLogsDir = join(logsDir, "terminal");
  const providerLogsDir = join(logsDir, "provider");
  return {
    stateDir,
    dbPath,
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir,
    logsDir,
    terminalLogsDir,
    serverLogPath: join(logsDir, "server.log"),
    serverTracePath: join(logsDir, "server-trace.ndjson"),
    providerLogsDir,
    providerEventLogPath: join(providerLogsDir, "events.log"),
    anonymousIdPath: join(stateDir, "anonymous-id"),
    environmentIdPath: join(stateDir, "environment-id"),
    settingsPath: join(stateDir, "settings.json"),
    secretsDir: join(stateDir, "secrets"),
  };
});

export const ensureServerDirectories = Effect.fn(function* (
  paths: ServerDerivedPaths,
): Effect.fn.Return<void, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(paths.stateDir, { recursive: true });
  yield* fs.makeDirectory(paths.logsDir, { recursive: true });
  yield* fs.makeDirectory(paths.providerLogsDir, { recursive: true });
  yield* fs.makeDirectory(paths.terminalLogsDir, { recursive: true });
  yield* fs.makeDirectory(paths.attachmentsDir, { recursive: true });
  yield* fs.makeDirectory(paths.worktreesDir, { recursive: true });
  yield* fs.makeDirectory(paths.secretsDir, { recursive: true });
});

export const resolveStaticDir = Effect.fn(function* (): Effect.fn.Return<
  string | undefined,
  never,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const candidates = [path.resolve("apps/web/dist"), path.resolve("dist")];

  for (const candidate of candidates) {
    const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      return candidate;
    }
  }

  return undefined;
});

export class ServerConfig extends Context.Service<ServerConfig, ServerConfigShape>()(
  "t3/config/ServerConfig",
) {
  static readonly layerTest = (cwd: string, baseDirOrPrefix: string | { prefix: string }) =>
    Layer.effect(
      ServerConfig,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const baseDir =
          typeof baseDirOrPrefix === "string"
            ? baseDirOrPrefix
            : yield* fs.makeTempDirectoryScoped({ prefix: baseDirOrPrefix.prefix });
        const derivedPaths = yield* deriveServerPaths(baseDir);

        yield* fs.makeDirectory(derivedPaths.stateDir, { recursive: true });
        yield* fs.makeDirectory(derivedPaths.logsDir, { recursive: true });
        yield* fs.makeDirectory(derivedPaths.attachmentsDir, { recursive: true });
        yield* fs.makeDirectory(derivedPaths.providerLogsDir, { recursive: true });
        yield* fs.makeDirectory(derivedPaths.terminalLogsDir, { recursive: true });
        yield* fs.makeDirectory(derivedPaths.worktreesDir, { recursive: true });

        return {
          cwd,
          baseDir,
          ...derivedPaths,
          logLevel: "Info",
          traceMinLevel: "Info",
          traceTimingEnabled: true,
          traceBatchWindowMs: 200,
          traceMaxBytes: 10 * 1024 * 1024,
          traceMaxFiles: 10,
          otlpTracesUrl: undefined,
          otlpMetricsUrl: undefined,
          otlpExportIntervalMs: 10_000,
          otlpServiceName: "t3-server",
          mode: "server",
          autoBootstrapProjectFromCwd: false,
          logWebSocketEvents: false,
          port: 0,
          host: undefined,
          authToken: undefined,
          staticDir: undefined,
          devUrl: undefined,
          noBrowser: false,
          startupPresentation: "browser",
          tailscaleServeEnabled: false,
          tailscaleServePort: 443,
        } satisfies ServerConfigShape;
      }),
    );
}
