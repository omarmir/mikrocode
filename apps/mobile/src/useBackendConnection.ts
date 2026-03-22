import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import type {
  OrchestrationReadModel,
  ProjectEntry,
  ProviderInteractionMode,
  RuntimeMode,
  ServerConfig,
  ServerConversationCapabilities,
  WsWelcomePayload,
} from "@t3tools/contracts";

import {
  buildDisplayWebSocketUrl,
  buildWebSocketUrl,
  createClientId,
  MOBILE_WS_CHANNELS,
  MOBILE_WS_METHODS,
  type ConnectionStatus,
  type CreateDirectoryInput,
  type CreateProjectInput,
  type CreateThreadInput,
  type GetConversationCapabilitiesInput,
  type DirectoryListing,
  type InterruptTurnInput,
  type PushMessage,
  type RpcResponse,
  type SearchDirectoryInput,
  type SendTurnInput,
  type StopSessionInput,
} from "./protocol";
import { MOBILE_DEFAULT_MODEL } from "./defaults";
import {
  getDefaultConnectionSettings,
  loadConnectionSettings,
  saveConnectionSettings,
  type ConnectionSettings,
} from "./storage";

const REQUEST_TIMEOUT_MS = 15_000;
const SNAPSHOT_REFRESH_DEBOUNCE_MS = 250;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeoutHandle: ReturnType<typeof setTimeout>;
}

function isSocketOpen(socket: WebSocket | null) {
  return socket?.readyState === WebSocket.OPEN;
}

function useStableEvent<TArgs extends unknown[], TResult>(handler: (...args: TArgs) => TResult) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  return useCallback((...args: TArgs) => handlerRef.current(...args), []);
}

function withCommandMeta<TCommand extends Record<string, unknown>>(command: TCommand) {
  return {
    ...command,
    commandId: createClientId("cmd"),
    createdAt: new Date().toISOString(),
  };
}

export function useBackendConnection() {
  const [connectionSettings, setConnectionSettings] = useState<ConnectionSettings>(
    getDefaultConnectionSettings(),
  );
  const [settingsReady, setSettingsReady] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [resolvedWebSocketUrl, setResolvedWebSocketUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OrchestrationReadModel | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [welcome, setWelcome] = useState<WsWelcomePayload | null>(null);
  const [lastPushSequence, setLastPushSequence] = useState<number | null>(null);
  const [isRefreshingSnapshot, setIsRefreshingSnapshot] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketListenerCleanupRef = useRef<(() => void) | null>(null);
  const reconnectAttemptRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const shouldStayConnectedRef = useRef(false);
  const autoConnectBootstrappedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void loadConnectionSettings().then((loaded) => {
      if (cancelled) {
        return;
      }

      setConnectionSettings(loaded);
      setSettingsReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) {
      return;
    }

    void saveConnectionSettings(connectionSettings);
  }, [connectionSettings, settingsReady]);

  const clearReconnectTimer = useStableEvent(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  });

  const clearRefreshTimer = useStableEvent(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  });

  const rejectPendingRequests = useStableEvent((message: string) => {
    for (const [requestId, pending] of pendingRequestsRef.current) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error(message));
      pendingRequestsRef.current.delete(requestId);
    }
  });

  const disconnectSocket = useStableEvent(() => {
    clearReconnectTimer();
    clearRefreshTimer();
    rejectPendingRequests("The socket disconnected.");

    const currentSocket = socketRef.current;
    socketRef.current = null;
    socketListenerCleanupRef.current?.();
    socketListenerCleanupRef.current = null;
    currentSocket?.close();
  });

  const request = useStableEvent(
    <TResult>(tag: string, payload: Record<string, unknown>): Promise<TResult> => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("Connect to the backend before sending requests."));
      }

      return new Promise<TResult>((resolve, reject) => {
        const requestId = createClientId("req");
        const timeoutHandle = setTimeout(() => {
          pendingRequestsRef.current.delete(requestId);
          reject(new Error(`The backend did not respond to ${tag} in time.`));
        }, REQUEST_TIMEOUT_MS);

        pendingRequestsRef.current.set(requestId, {
          resolve: (value) => resolve(value as TResult),
          reject,
          timeoutHandle,
        });

        socket.send(
          JSON.stringify({
            id: requestId,
            body: {
              _tag: tag,
              ...payload,
            },
          }),
        );
      });
    },
  );

  const refreshSnapshot = useStableEvent(async () => {
    if (!isSocketOpen(socketRef.current)) {
      return;
    }

    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    setIsRefreshingSnapshot(true);

    try {
      do {
        refreshQueuedRef.current = false;
        const nextSnapshot = await request<OrchestrationReadModel>(
          MOBILE_WS_METHODS.getSnapshot,
          {},
        );
        startTransition(() => {
          setSnapshot(nextSnapshot);
        });
      } while (refreshQueuedRef.current);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to refresh the snapshot.");
    } finally {
      refreshInFlightRef.current = false;
      setIsRefreshingSnapshot(false);
    }
  });

  const fetchBootstrapState = useStableEvent(async () => {
    const [nextConfig, nextSnapshot] = await Promise.all([
      request<ServerConfig>(MOBILE_WS_METHODS.serverGetConfig, {}),
      request<OrchestrationReadModel>(MOBILE_WS_METHODS.getSnapshot, {}),
    ]);

    startTransition(() => {
      setServerConfig(nextConfig);
      setSnapshot(nextSnapshot);
    });
  });

  const scheduleReconnect = useStableEvent(() => {
    if (!shouldStayConnectedRef.current) {
      return;
    }

    clearReconnectTimer();
    const delay =
      RECONNECT_DELAYS_MS[Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS_MS.length - 1)];

    setStatus("reconnecting");
    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptRef.current += 1;
      void connect();
    }, delay);
  });

  const scheduleSnapshotRefresh = useStableEvent(() => {
    clearRefreshTimer();
    refreshTimerRef.current = setTimeout(() => {
      void refreshSnapshot();
    }, SNAPSHOT_REFRESH_DEBOUNCE_MS);
  });

  const handleIncomingPush = useStableEvent((message: PushMessage) => {
    setLastPushSequence(message.sequence);

    if (message.channel === MOBILE_WS_CHANNELS.serverWelcome) {
      setWelcome(message.data as WsWelcomePayload);
      setErrorMessage(null);
      void fetchBootstrapState();
      return;
    }

    if (message.channel === MOBILE_WS_CHANNELS.serverConfigUpdated) {
      startTransition(() => {
        setServerConfig((current) =>
          current
            ? {
                ...current,
                providers: (message.data as ServerConfig["providers"]) ?? current.providers,
              }
            : current,
        );
      });
      return;
    }

    if (message.channel === MOBILE_WS_CHANNELS.domainEvent) {
      scheduleSnapshotRefresh();
    }
  });

  const handleSocketMessage = useStableEvent((event: WebSocketMessageEvent) => {
    try {
      const parsed = JSON.parse(String(event.data)) as RpcResponse | PushMessage;

      if ("type" in parsed && parsed.type === "push") {
        handleIncomingPush(parsed);
        return;
      }

      const response = parsed as RpcResponse;
      const pending = pendingRequestsRef.current.get(response.id);
      if (!pending) {
        return;
      }

      pendingRequestsRef.current.delete(response.id);
      clearTimeout(pending.timeoutHandle);

      if (response.error?.message) {
        pending.reject(new Error(response.error.message));
        return;
      }

      pending.resolve(response.result);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Received an invalid server response.",
      );
    }
  });

  const connect = useStableEvent(async () => {
    clearReconnectTimer();
    clearRefreshTimer();
    rejectPendingRequests("Connection restarted.");
    shouldStayConnectedRef.current = true;

    try {
      const nextUrl = buildWebSocketUrl(connectionSettings.serverUrl, connectionSettings.authToken);
      setResolvedWebSocketUrl(
        buildDisplayWebSocketUrl(connectionSettings.serverUrl, connectionSettings.authToken),
      );
      setErrorMessage(null);
      setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

      const previousSocket = socketRef.current;
      socketRef.current = null;
      socketListenerCleanupRef.current?.();
      socketListenerCleanupRef.current = null;
      previousSocket?.close();

      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(nextUrl);
        socketRef.current = socket;
        let opened = false;

        const handleOpen = () => {
          opened = true;
          reconnectAttemptRef.current = 0;
          setStatus("connected");
          resolve();
        };

        const handleMessage = (event: WebSocketMessageEvent) => {
          handleSocketMessage(event);
        };

        const handleError = () => {
          if (!opened) {
            setErrorMessage("The backend WebSocket failed before it could connect.");
          }
        };

        const handleClose = () => {
          rejectPendingRequests("The backend connection closed.");
          if (socketRef.current === socket) {
            socketRef.current = null;
          }
          if (socketListenerCleanupRef.current) {
            socketListenerCleanupRef.current();
            socketListenerCleanupRef.current = null;
          }
          if (!opened) {
            reject(new Error("The backend closed the connection before it became ready."));
            return;
          }
          if (shouldStayConnectedRef.current) {
            scheduleReconnect();
          } else {
            setStatus("disconnected");
          }
        };

        socket.addEventListener("open", handleOpen);
        socket.addEventListener("message", handleMessage);
        socket.addEventListener("error", handleError);
        socket.addEventListener("close", handleClose);

        socketListenerCleanupRef.current = () => {
          socket.removeEventListener("open", handleOpen);
          socket.removeEventListener("message", handleMessage);
          socket.removeEventListener("error", handleError);
          socket.removeEventListener("close", handleClose);
        };
      });

      await fetchBootstrapState();
    } catch (error) {
      setStatus("disconnected");
      setErrorMessage(error instanceof Error ? error.message : "Failed to connect to the backend.");
      scheduleReconnect();
    }
  });

  const disconnect = useStableEvent(() => {
    shouldStayConnectedRef.current = false;
    reconnectAttemptRef.current = 0;
    setStatus("disconnected");
    disconnectSocket();
  });

  useEffect(() => {
    if (!settingsReady || !connectionSettings.autoConnect || autoConnectBootstrappedRef.current) {
      return;
    }

    autoConnectBootstrappedRef.current = true;
    void connect();
  }, [connect, connectionSettings.autoConnect, settingsReady]);

  useEffect(() => {
    return () => {
      shouldStayConnectedRef.current = false;
      disconnectSocket();
    };
  }, [disconnectSocket]);

  const runBusyCommand = useStableEvent(
    async <TResult>(label: string, work: () => Promise<TResult>) => {
      try {
        setBusyAction(label);
        setErrorMessage(null);
        const result = await work();
        return result;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : `${label} failed.`);
        throw error;
      } finally {
        setBusyAction(null);
      }
    },
  );

  const dispatchCommand = useStableEvent(async (command: Record<string, unknown>) => {
    await request<{ sequence: number }>(MOBILE_WS_METHODS.dispatchCommand, {
      command,
    });
    await refreshSnapshot();
  });

  const createProjectFromWelcome = useStableEvent(async () => {
    if (!welcome) {
      throw new Error("Wait for the server welcome payload before creating the bootstrap project.");
    }

    await runBusyCommand("Creating project", () =>
      dispatchCommand(
        withCommandMeta({
          type: "project.create",
          projectId: createClientId("project"),
          title: welcome.projectName,
          workspaceRoot: welcome.cwd,
          defaultModel: MOBILE_DEFAULT_MODEL,
        }),
      ),
    );
  });

  const createProject = useStableEvent(async (input: CreateProjectInput) => {
    const projectId = createClientId("project");

    await runBusyCommand("Creating project", () =>
      dispatchCommand(
        withCommandMeta({
          type: "project.create",
          projectId,
          title: input.title.trim() || input.workspaceRoot.trim(),
          workspaceRoot: input.workspaceRoot.trim(),
          ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
        }),
      ),
    );

    return projectId;
  });

  const deleteProject = useStableEvent(async (projectId: string) => {
    await runBusyCommand("Removing project", () =>
      dispatchCommand(
        withCommandMeta({
          type: "project.delete",
          projectId,
        }),
      ),
    );
  });

  const createThread = useStableEvent(async (input: CreateThreadInput) => {
    const threadId = createClientId("thread");

    await runBusyCommand("Creating thread", () =>
      dispatchCommand(
        withCommandMeta({
          type: "thread.create",
          threadId,
          projectId: input.projectId,
          title: input.title.trim() || "Conversation",
          model: input.model,
          runtimeMode: "full-access" satisfies RuntimeMode,
          interactionMode: "default" satisfies ProviderInteractionMode,
          branch: null,
          worktreePath: null,
        }),
      ),
    );

    return threadId;
  });

  const sendTurn = useStableEvent(async (input: SendTurnInput) => {
    await runBusyCommand("Sending turn", () =>
      dispatchCommand(
        withCommandMeta({
          type: "thread.turn.start",
          threadId: input.threadId,
          message: {
            messageId: createClientId("message"),
            role: "user" as const,
            text: input.text,
            attachments: [],
          },
          model: input.model,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
        }),
      ),
    );
  });

  const updateThreadModel = useStableEvent(async (input: { threadId: string; model: string }) => {
    await runBusyCommand("Switching model", () =>
      dispatchCommand(
        withCommandMeta({
          type: "thread.meta.update",
          threadId: input.threadId,
          model: input.model.trim(),
        }),
      ),
    );
  });

  const updateThreadRuntimeMode = useStableEvent(
    async (input: { threadId: string; runtimeMode: RuntimeMode }) => {
      await runBusyCommand("Updating access", () =>
        dispatchCommand(
          withCommandMeta({
            type: "thread.runtime-mode.set",
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
          }),
        ),
      );
    },
  );

  const getConversationCapabilities = useStableEvent(
    async (input: GetConversationCapabilitiesInput): Promise<ServerConversationCapabilities> => {
      try {
        return await request<ServerConversationCapabilities>(
          MOBILE_WS_METHODS.serverGetConversationCapabilities,
          {
            threadId: input.threadId,
          },
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load conversation capabilities from the backend.",
        );
        throw error;
      }
    },
  );

  const interruptTurn = useStableEvent(async (input: InterruptTurnInput) => {
    await runBusyCommand("Interrupting turn", () =>
      dispatchCommand(
        withCommandMeta({
          type: "thread.turn.interrupt",
          threadId: input.threadId,
          ...(input.turnId ? { turnId: input.turnId } : {}),
        }),
      ),
    );
  });

  const stopSession = useStableEvent(async (input: StopSessionInput) => {
    await runBusyCommand("Stopping session", () =>
      dispatchCommand(
        withCommandMeta({
          type: "thread.session.stop",
          threadId: input.threadId,
        }),
      ),
    );
  });

  const searchDirectory = useStableEvent(
    async (input: SearchDirectoryInput): Promise<DirectoryListing> => {
      const result = await runBusyCommand("Loading directories", () =>
        request<{ entries: ProjectEntry[]; truncated: boolean }>(
          MOBILE_WS_METHODS.projectsSearchEntries,
          {
            cwd: input.cwd,
            query: ".",
            limit: 200,
          },
        ),
      );

      return {
        cwd: input.cwd,
        entries: result.entries.filter((entry) => entry.parentPath === undefined),
        truncated: result.truncated,
      };
    },
  );

  const createDirectory = useStableEvent(async (input: CreateDirectoryInput) => {
    await runBusyCommand("Creating folder", () =>
      request<{ relativePath: string }>(MOBILE_WS_METHODS.projectsCreateDirectory, {
        cwd: input.cwd,
        relativePath: input.relativePath,
      }),
    );
  });

  return {
    connectionSettings,
    setConnectionSettings,
    settingsReady,
    status,
    resolvedWebSocketUrl,
    errorMessage,
    clearError: () => setErrorMessage(null),
    snapshot,
    serverConfig,
    welcome,
    lastPushSequence,
    isRefreshingSnapshot,
    busyAction,
    connect: () => connect(),
    disconnect: () => disconnect(),
    refreshSnapshot: () => refreshSnapshot(),
    createProjectFromWelcome: () => createProjectFromWelcome(),
    createProject: (input: CreateProjectInput) => createProject(input),
    deleteProject: (projectId: string) => deleteProject(projectId),
    createThread: (input: CreateThreadInput) => createThread(input),
    sendTurn: (input: SendTurnInput) => sendTurn(input),
    updateThreadModel: (input: { threadId: string; model: string }) => updateThreadModel(input),
    updateThreadRuntimeMode: (input: { threadId: string; runtimeMode: RuntimeMode }) =>
      updateThreadRuntimeMode(input),
    getConversationCapabilities: (input: GetConversationCapabilitiesInput) =>
      getConversationCapabilities(input),
    interruptTurn: (input: InterruptTurnInput) => interruptTurn(input),
    stopSession: (input: StopSessionInput) => stopSession(input),
    searchDirectory: (input: SearchDirectoryInput) => searchDirectory(input),
    createDirectory: (input: CreateDirectoryInput) => createDirectory(input),
  };
}
