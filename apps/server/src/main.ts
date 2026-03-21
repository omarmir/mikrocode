/**
 * CliConfig - CLI/runtime bootstrap service definitions.
 *
 * Defines startup-only service contracts used while resolving process config
 * and constructing server runtime layers.
 *
 * @module CliConfig
 */
import { Config, Data, Effect, Layer, Option, Schema, ServiceMap } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { NetService } from "@t3tools/shared/Net";
import { DEFAULT_PORT, deriveServerPaths, ServerConfig, type ServerConfigShape } from "./config";
import { fixPath, resolveBaseDir } from "./os-jank";
import * as SqlitePersistence from "./persistence/Layers/Sqlite";
import { makeServerProviderLayer, makeServerRuntimeServicesLayer } from "./serverLayers";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { ProviderHealthLive } from "./provider/Layers/ProviderHealth";
import { Server } from "./wsServer";
import { ServerLoggerLive } from "./serverLogger";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService";

export class StartupError extends Data.TaggedError("StartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface CliInput {
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly t3Home: Option.Option<string>;
  readonly authToken: Option.Option<string>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

export interface CliConfigShape {
  readonly cwd: string;
  readonly fixPath: Effect.Effect<void>;
}

export class CliConfig extends ServiceMap.Service<CliConfig, CliConfigShape>()(
  "t3/main/CliConfig",
) {
  static readonly layer = Layer.succeed(CliConfig, {
    cwd: process.cwd(),
    fixPath: Effect.sync(fixPath),
  } satisfies CliConfigShape);
}

const CliEnvConfig = Config.all({
  port: Config.port("T3CODE_PORT").pipe(Config.option, Config.map(Option.getOrUndefined)),
  host: Config.string("T3CODE_HOST").pipe(Config.option, Config.map(Option.getOrUndefined)),
  t3Home: Config.string("T3CODE_HOME").pipe(Config.option, Config.map(Option.getOrUndefined)),
  authToken: Config.string("T3CODE_AUTH_TOKEN").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  autoBootstrapProjectFromCwd: Config.boolean("T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  logWebSocketEvents: Config.boolean("T3CODE_LOG_WS_EVENTS").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);

const ServerConfigLive = (input: CliInput) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const cliConfig = yield* CliConfig;
      const { findAvailablePort } = yield* NetService;
      const env = yield* CliEnvConfig.asEffect().pipe(
        Effect.mapError(
          (cause) =>
            new StartupError({ message: "Failed to read environment configuration", cause }),
        ),
      );

      const port = yield* Option.match(input.port, {
        onSome: Effect.succeed,
        onNone: () => (env.port ? Effect.succeed(env.port) : findAvailablePort(DEFAULT_PORT)),
      });

      const baseDir = yield* resolveBaseDir(Option.getOrUndefined(input.t3Home) ?? env.t3Home);
      const derivedPaths = yield* deriveServerPaths(baseDir);
      const config: ServerConfigShape = {
        mode: "server",
        port,
        cwd: cliConfig.cwd,
        host: Option.getOrUndefined(input.host) ?? env.host,
        baseDir,
        ...derivedPaths,
        authToken: Option.getOrUndefined(input.authToken) ?? env.authToken,
        autoBootstrapProjectFromCwd: resolveBooleanFlag(
          input.autoBootstrapProjectFromCwd,
          env.autoBootstrapProjectFromCwd ?? true,
        ),
        logWebSocketEvents: resolveBooleanFlag(
          input.logWebSocketEvents,
          env.logWebSocketEvents ?? false,
        ),
      } satisfies ServerConfigShape;

      return config;
    }),
  );

const LayerLive = (input: CliInput) =>
  Layer.empty.pipe(
    Layer.provideMerge(makeServerRuntimeServicesLayer()),
    Layer.provideMerge(makeServerProviderLayer()),
    Layer.provideMerge(ProviderHealthLive),
    Layer.provideMerge(SqlitePersistence.layerConfig),
    Layer.provideMerge(ServerLoggerLive),
    Layer.provideMerge(AnalyticsServiceLayerLive),
    Layer.provideMerge(ServerConfigLive(input)),
  );

export const recordStartupHeartbeat = Effect.gen(function* () {
  const analytics = yield* AnalyticsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const { threadCount, projectCount } = yield* projectionSnapshotQuery.getSnapshot().pipe(
    Effect.map((snapshot) => ({
      threadCount: snapshot.threads.length,
      projectCount: snapshot.projects.length,
    })),
    Effect.catch((cause) =>
      Effect.logWarning("failed to gather startup snapshot for telemetry", { cause }).pipe(
        Effect.as({
          threadCount: 0,
          projectCount: 0,
        }),
      ),
    ),
  );

  yield* analytics.record("server.boot.heartbeat", {
    threadCount,
    projectCount,
  });
});

const makeServerProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const cliConfig = yield* CliConfig;
    const { start, stopSignal } = yield* Server;
    yield* cliConfig.fixPath;

    const config = yield* ServerConfig;
    yield* start;
    yield* Effect.forkChild(recordStartupHeartbeat);

    const bindHost = config.host ?? "localhost";
    const bindUrl = `http://${bindHost.includes(":") ? `[${bindHost}]` : bindHost}:${config.port}`;
    const { authToken, ...safeConfig } = config;
    yield* Effect.logInfo("T3 Code backend running", {
      ...safeConfig,
      bindUrl,
      authEnabled: Boolean(authToken),
    });

    return yield* stopSignal;
  }).pipe(Effect.provide(LayerLive(input)));

const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1 or 0.0.0.0)."),
  Flag.optional,
);
const t3HomeFlag = Flag.string("home-dir").pipe(
  Flag.withDescription("Base directory for all T3 Code data (equivalent to T3CODE_HOME)."),
  Flag.optional,
);
const authTokenFlag = Flag.string("auth-token").pipe(
  Flag.withDescription("Auth token required for WebSocket connections."),
  Flag.withAlias("token"),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to T3CODE_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);

export const t3Cli = Command.make("t3", {
  port: portFlag,
  host: hostFlag,
  t3Home: t3HomeFlag,
  authToken: authTokenFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
}).pipe(
  Command.withDescription("Run the T3 Code backend for the mobile client."),
  Command.withHandler(makeServerProgram),
);
