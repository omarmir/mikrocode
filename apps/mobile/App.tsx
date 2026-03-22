import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import type {
  OrchestrationMessage,
  OrchestrationProject,
  OrchestrationThread,
  OrchestrationThreadActivity,
} from "@t3tools/contracts";

import { type ConnectionSettings } from "./src/storage";
import { useBackendConnection } from "./src/useBackendConnection";

const FALLBACK_MODEL = "gpt-5-codex";

function formatProviderLabel(provider: "codex" | "claudeAgent") {
  return provider === "codex" ? "Codex" : "Claude Agent";
}

function formatRelativeTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sortProjects(projects: ReadonlyArray<OrchestrationProject>) {
  return [...projects]
    .filter((project) => project.deletedAt === null)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortThreads(threads: ReadonlyArray<OrchestrationThread>, projectId: string | null) {
  return [...threads]
    .filter((thread) => thread.deletedAt === null && thread.projectId === projectId)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortMessages(messages: ReadonlyArray<OrchestrationMessage>) {
  return [...messages].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function sortActivities(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  return [...activities].toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function createThreadTitle(input: string) {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    return "New thread";
  }
  return trimmed.slice(0, 64);
}

function AppShell() {
  const {
    connectionSettings,
    setConnectionSettings,
    settingsReady,
    status,
    resolvedWebSocketUrl,
    errorMessage,
    clearError,
    snapshot,
    serverConfig,
    welcome,
    lastPushSequence,
    isRefreshingSnapshot,
    busyAction,
    connect,
    disconnect,
    refreshSnapshot,
    createProjectFromWelcome,
    createThread,
    sendTurn,
    interruptTurn,
    stopSession,
  } = useBackendConnection();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [projectDraft, setProjectDraft] = useState("");

  const projects = sortProjects(snapshot?.projects ?? []);
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const threads = sortThreads(snapshot?.threads ?? [], selectedProject?.id ?? null);
  const selectedThread =
    threads.find((thread) => thread.id === selectedThreadId) ?? threads[0] ?? null;
  const messages = sortMessages(selectedThread?.messages ?? []);
  const activities = sortActivities(selectedThread?.activities ?? []).slice(0, 8);
  const draft = selectedThread ? (threadDrafts[selectedThread.id] ?? "") : projectDraft;
  const isConnected = status === "connected";
  const hasProjects = projects.length > 0;

  useEffect(() => {
    if (!settingsReady) {
      return;
    }

    if (selectedProject && selectedProject.id !== selectedProjectId) {
      setSelectedProjectId(selectedProject.id);
      return;
    }

    if (selectedProjectId) {
      return;
    }

    const bootstrapProject = projects.find((project) => project.id === welcome?.bootstrapProjectId);
    if (bootstrapProject) {
      setSelectedProjectId(bootstrapProject.id);
      return;
    }

    if (projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProject, selectedProjectId, settingsReady, welcome?.bootstrapProjectId]);

  useEffect(() => {
    if (selectedThread && selectedThread.id !== selectedThreadId) {
      setSelectedThreadId(selectedThread.id);
      return;
    }

    if (selectedThreadId) {
      return;
    }

    const bootstrapThread = threads.find((thread) => thread.id === welcome?.bootstrapThreadId);
    if (bootstrapThread) {
      setSelectedThreadId(bootstrapThread.id);
      return;
    }

    if (threads[0]) {
      setSelectedThreadId(threads[0].id);
    }
  }, [selectedThread, selectedThreadId, threads, welcome?.bootstrapThreadId]);

  const updateConnectionSettings = (patch: Partial<ConnectionSettings>) => {
    clearError();
    setConnectionSettings((current) => ({ ...current, ...patch }));
  };

  const updateDraft = (value: string) => {
    clearError();
    if (selectedThread) {
      setThreadDrafts((current) => ({ ...current, [selectedThread.id]: value }));
      return;
    }

    setProjectDraft(value);
  };

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !selectedProject) {
      return;
    }

    let thread: OrchestrationThread | null = selectedThread;
    let activeThreadId: string | null = thread?.id ?? null;
    if (!thread) {
      const newThreadId = await createThread({
        projectId: selectedProject.id,
        title: createThreadTitle(trimmed),
        model: selectedProject.defaultModel ?? FALLBACK_MODEL,
      });
      setSelectedThreadId(newThreadId);
      activeThreadId = newThreadId;
      thread =
        sortThreads(snapshot?.threads ?? [], selectedProject.id).find(
          (candidate) => candidate.id === newThreadId,
        ) ?? null;
    }

    if (!activeThreadId) {
      return;
    }

    await sendTurn({
      threadId: activeThreadId,
      text: trimmed,
      runtimeMode: thread?.runtimeMode ?? "full-access",
      interactionMode: thread?.interactionMode ?? "default",
      model: thread?.model ?? selectedProject.defaultModel ?? FALLBACK_MODEL,
    });

    if (selectedThread) {
      setThreadDrafts((current) => ({ ...current, [selectedThread.id]: "" }));
    } else {
      setProjectDraft("");
    }
  };

  const handleCreateThread = async () => {
    if (!selectedProject) {
      return;
    }

    const newThreadId = await createThread({
      projectId: selectedProject.id,
      title: "New thread",
      model: selectedProject.defaultModel ?? FALLBACK_MODEL,
    });
    setSelectedThreadId(newThreadId);
  };

  const sessionStatus = selectedThread?.session?.status ?? "idle";
  const canInterrupt =
    isConnected &&
    selectedThread &&
    (selectedThread.latestTurn?.state === "running" || sessionStatus === "running");
  const canStopSession =
    isConnected &&
    selectedThread &&
    selectedThread.session &&
    selectedThread.session.status !== "stopped";

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardAvoider}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshingSnapshot}
                onRefresh={refreshSnapshot}
                tintColor="#f8fafc"
              />
            }
          >
            <LinearGradient
              colors={["#123b7a", "#07111f", "#030712"]}
              locations={[0, 0.45, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <Text style={styles.eyebrow}>T3 Code Mobile</Text>
              <Text style={styles.title}>
                Phone-first control surface for the existing Codex backend
              </Text>
              <Text style={styles.subtitle}>
                Connect directly to the running server, browse threads, follow live activity, and
                send turns from your phone.
              </Text>

              <View style={styles.heroRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>{status}</Text>
                </View>
                {snapshot ? (
                  <View style={styles.badgeMuted}>
                    <Text style={styles.badgeMutedLabel}>
                      seq {snapshot.snapshotSequence}
                      {lastPushSequence !== null ? ` / push ${lastPushSequence}` : ""}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.heroMeta}>
                {resolvedWebSocketUrl ??
                  "Enter a WebSocket URL to reach the backend from this device."}
              </Text>
            </LinearGradient>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Connection</Text>
                <Switch
                  onValueChange={(value) => updateConnectionSettings({ autoConnect: value })}
                  thumbColor={connectionSettings.autoConnect ? "#f8fafc" : "#cbd5e1"}
                  trackColor={{ false: "#334155", true: "#1d4ed8" }}
                  value={connectionSettings.autoConnect}
                />
              </View>
              <Text style={styles.helperText}>
                Auto-connect remembers your last backend target and reconnects after brief mobile
                drops.
              </Text>

              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => updateConnectionSettings({ serverUrl: value })}
                placeholder="ws://192.168.1.42:3773"
                placeholderTextColor="#64748b"
                style={styles.input}
                value={connectionSettings.serverUrl}
              />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => updateConnectionSettings({ authToken: value })}
                placeholder="Optional auth token"
                placeholderTextColor="#64748b"
                secureTextEntry
                style={styles.input}
                value={connectionSettings.authToken}
              />

              <View style={styles.buttonRow}>
                <Pressable
                  disabled={!settingsReady || status === "connecting" || status === "reconnecting"}
                  onPress={connect}
                  style={[
                    styles.primaryButton,
                    (!settingsReady || status === "connecting" || status === "reconnecting") &&
                      styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {status === "connecting" || status === "reconnecting"
                      ? "Connecting"
                      : "Connect"}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={!isConnected}
                  onPress={disconnect}
                  style={[styles.secondaryButton, !isConnected && styles.buttonDisabled]}
                >
                  <Text style={styles.secondaryButtonText}>Disconnect</Text>
                </Pressable>
              </View>
            </View>

            {errorMessage ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>Connection issue</Text>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Server</Text>
              <Text style={styles.metaLine}>
                Workspace: {welcome?.cwd ?? serverConfig?.cwd ?? "Waiting for server welcome"}
              </Text>
              <Text style={styles.metaLine}>
                Bootstrap project: {welcome?.projectName ?? "Not announced yet"}
              </Text>
              {serverConfig?.providers.length ? (
                <View style={styles.providerList}>
                  {serverConfig.providers.map((provider) => (
                    <View key={provider.provider} style={styles.providerRow}>
                      <View style={styles.providerCopy}>
                        <Text style={styles.providerName}>
                          {formatProviderLabel(provider.provider)}
                        </Text>
                        <Text style={styles.providerMeta}>
                          {provider.message ??
                            `${provider.authStatus} / ${provider.available ? "available" : "unavailable"}`}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.statusPill,
                          provider.status === "ready"
                            ? styles.statusReady
                            : provider.status === "warning"
                              ? styles.statusWarning
                              : styles.statusError,
                        ]}
                      >
                        <Text style={styles.statusLabel}>{provider.status}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.helperText}>
                  Provider status arrives after the first successful config fetch.
                </Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Projects</Text>
                {!hasProjects && welcome ? (
                  <Pressable
                    disabled={!isConnected || busyAction !== null}
                    onPress={() => createProjectFromWelcome()}
                    style={[
                      styles.secondaryButtonCompact,
                      (!isConnected || busyAction !== null) && styles.buttonDisabled,
                    ]}
                  >
                    <Text style={styles.secondaryButtonText}>Create from server cwd</Text>
                  </Pressable>
                ) : null}
              </View>
              {hasProjects ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRail}>
                    {projects.map((project) => (
                      <Pressable
                        key={project.id}
                        onPress={() => {
                          setSelectedProjectId(project.id);
                          setSelectedThreadId(null);
                        }}
                        style={[
                          styles.projectChip,
                          selectedProject?.id === project.id && styles.projectChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.projectChipTitle,
                            selectedProject?.id === project.id && styles.projectChipTitleActive,
                          ]}
                        >
                          {project.title}
                        </Text>
                        <Text style={styles.projectChipMeta}>{project.workspaceRoot}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              ) : (
                <Text style={styles.emptyText}>
                  No projects exist yet. If the backend is running with auto-bootstrap, create the
                  workspace project from the server card above.
                </Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Threads</Text>
                <Pressable
                  disabled={!selectedProject || !isConnected || busyAction !== null}
                  onPress={handleCreateThread}
                  style={[
                    styles.secondaryButtonCompact,
                    (!selectedProject || !isConnected || busyAction !== null) &&
                      styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>New thread</Text>
                </Pressable>
              </View>

              {threads.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.threadRail}>
                    {threads.map((thread) => {
                      const lastMessage = [...thread.messages].toSorted((left, right) =>
                        right.createdAt.localeCompare(left.createdAt),
                      )[0];
                      const preview =
                        lastMessage?.text.trim().replace(/\s+/g, " ").slice(0, 72) ??
                        "No messages yet";

                      return (
                        <Pressable
                          key={thread.id}
                          onPress={() => setSelectedThreadId(thread.id)}
                          style={[
                            styles.threadCard,
                            selectedThread?.id === thread.id && styles.threadCardActive,
                          ]}
                        >
                          <Text style={styles.threadTitle}>{thread.title}</Text>
                          <Text style={styles.threadPreview}>{preview}</Text>
                          <View style={styles.threadMetaRow}>
                            <Text style={styles.threadMetaLabel}>{thread.model}</Text>
                            <Text style={styles.threadMetaLabel}>{thread.runtimeMode}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              ) : (
                <Text style={styles.emptyText}>
                  No threads in this project yet. Create one or send a message and the app will open
                  a new thread automatically.
                </Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>{selectedThread?.title ?? "Composer"}</Text>
                  <Text style={styles.metaLine}>
                    {selectedThread
                      ? `${selectedThread.model} / ${selectedThread.runtimeMode} / ${selectedThread.interactionMode}`
                      : "Select a project to create or continue a thread"}
                  </Text>
                </View>
                {busyAction ? (
                  <View style={styles.busyRow}>
                    <ActivityIndicator color="#dbeafe" size="small" />
                    <Text style={styles.busyText}>{busyAction}</Text>
                  </View>
                ) : null}
              </View>

              {selectedThread ? (
                <View style={styles.sessionCard}>
                  <Text style={styles.sessionLabel}>Session</Text>
                  <Text style={styles.sessionValue}>{sessionStatus}</Text>
                  <Text style={styles.sessionMeta}>
                    Updated {formatRelativeTime(selectedThread.updatedAt)}
                  </Text>
                  {selectedThread.branch ? (
                    <Text style={styles.sessionMeta}>Branch {selectedThread.branch}</Text>
                  ) : null}
                </View>
              ) : null}

              {messages.length ? (
                <View style={styles.messageList}>
                  {messages.map((message) => {
                    const isUser = message.role === "user";
                    const isAssistant = message.role === "assistant";

                    return (
                      <View
                        key={message.id}
                        style={[
                          styles.messageBubble,
                          isUser
                            ? styles.messageUser
                            : isAssistant
                              ? styles.messageAssistant
                              : styles.messageSystem,
                        ]}
                      >
                        <Text style={styles.messageRole}>{message.role}</Text>
                        <Text style={styles.messageText}>{message.text || "Streaming..."}</Text>
                        <Text style={styles.messageMeta}>
                          {formatRelativeTime(message.updatedAt)}
                          {message.streaming ? " / streaming" : ""}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.emptyText}>
                  This thread does not have any messages yet. Start with a short prompt from the
                  composer below.
                </Text>
              )}

              <TextInput
                multiline
                onChangeText={updateDraft}
                placeholder="Ask Codex to inspect, edit, or explain something..."
                placeholderTextColor="#64748b"
                style={styles.composer}
                textAlignVertical="top"
                value={draft}
              />

              <View style={styles.buttonRow}>
                <Pressable
                  disabled={
                    !isConnected || !selectedProject || !draft.trim() || busyAction !== null
                  }
                  onPress={() => {
                    void handleSend();
                  }}
                  style={[
                    styles.primaryButton,
                    (!isConnected || !selectedProject || !draft.trim() || busyAction !== null) &&
                      styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Send turn</Text>
                </Pressable>
                <Pressable
                  disabled={!canInterrupt || busyAction !== null}
                  onPress={() => {
                    if (!selectedThread) {
                      return;
                    }
                    void interruptTurn({
                      threadId: selectedThread.id,
                      turnId: selectedThread.latestTurn?.turnId ?? undefined,
                    });
                  }}
                  style={[
                    styles.secondaryButton,
                    (!canInterrupt || busyAction !== null) && styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Interrupt</Text>
                </Pressable>
              </View>

              <Pressable
                disabled={!canStopSession || busyAction !== null}
                onPress={() => {
                  if (!selectedThread) {
                    return;
                  }
                  void stopSession({ threadId: selectedThread.id });
                }}
                style={[
                  styles.ghostButton,
                  (!canStopSession || busyAction !== null) && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.ghostButtonText}>Stop provider session</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Latest activity</Text>
              {activities.length ? (
                <View style={styles.activityList}>
                  {activities.map((activity) => (
                    <View key={activity.id} style={styles.activityRow}>
                      <View
                        style={[
                          styles.activityDot,
                          activity.tone === "error"
                            ? styles.activityDotError
                            : activity.tone === "approval"
                              ? styles.activityDotApproval
                              : activity.tone === "tool"
                                ? styles.activityDotTool
                                : styles.activityDotInfo,
                        ]}
                      />
                      <View style={styles.activityCopy}>
                        <Text style={styles.activityTitle}>{activity.summary}</Text>
                        <Text style={styles.activityMeta}>
                          {activity.kind} / {formatRelativeTime(activity.createdAt)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>
                  Thread activity will appear here as provider work, approvals, and tool events
                  stream in from the backend.
                </Text>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

export default function App() {
  return <AppShell />;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#020617",
  },
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    gap: 16,
    padding: 18,
    paddingBottom: 28,
  },
  hero: {
    borderColor: "rgba(148, 163, 184, 0.18)",
    borderRadius: 28,
    borderWidth: 1,
    gap: 12,
    overflow: "hidden",
    padding: 20,
  },
  eyebrow: {
    color: "#7dd3fc",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
  },
  subtitle: {
    color: "#cbd5e1",
    fontSize: 15,
    lineHeight: 22,
  },
  heroRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  badge: {
    backgroundColor: "rgba(30, 64, 175, 0.7)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  badgeLabel: {
    color: "#eff6ff",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  badgeMuted: {
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  badgeMutedLabel: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "600",
  },
  heroMeta: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    backgroundColor: "#0b1220",
    borderColor: "#162033",
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#f8fafc",
    fontSize: 19,
    fontWeight: "700",
  },
  helperText: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    backgroundColor: "#020817",
    borderColor: "#1e293b",
    borderRadius: 16,
    borderWidth: 1,
    color: "#f8fafc",
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 16,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#eff6ff",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#132033",
    borderColor: "#24415f",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  secondaryButtonCompact: {
    alignItems: "center",
    backgroundColor: "#132033",
    borderColor: "#24415f",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: "#dbeafe",
    fontSize: 14,
    fontWeight: "700",
  },
  ghostButton: {
    alignItems: "center",
    backgroundColor: "#291315",
    borderColor: "#5f2328",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  ghostButtonText: {
    color: "#fecaca",
    fontSize: 14,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  errorCard: {
    backgroundColor: "#321219",
    borderColor: "#7f1d1d",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  errorTitle: {
    color: "#fee2e2",
    fontSize: 16,
    fontWeight: "700",
  },
  errorText: {
    color: "#fecaca",
    fontSize: 14,
    lineHeight: 20,
  },
  metaLine: {
    color: "#cbd5e1",
    fontSize: 14,
    lineHeight: 19,
  },
  providerList: {
    gap: 12,
  },
  providerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  providerCopy: {
    flex: 1,
    gap: 4,
  },
  providerName: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "700",
  },
  providerMeta: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusReady: {
    backgroundColor: "#14532d",
  },
  statusWarning: {
    backgroundColor: "#713f12",
  },
  statusError: {
    backgroundColor: "#7f1d1d",
  },
  statusLabel: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  chipRail: {
    flexDirection: "row",
    gap: 12,
  },
  projectChip: {
    backgroundColor: "#081120",
    borderColor: "#172554",
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    minWidth: 210,
    padding: 16,
  },
  projectChipActive: {
    backgroundColor: "#122040",
    borderColor: "#3b82f6",
  },
  projectChipTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  projectChipTitleActive: {
    color: "#dbeafe",
  },
  projectChipMeta: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 18,
  },
  threadRail: {
    flexDirection: "row",
    gap: 12,
  },
  threadCard: {
    backgroundColor: "#081120",
    borderColor: "#162033",
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    minHeight: 152,
    padding: 16,
    width: 240,
  },
  threadCardActive: {
    backgroundColor: "#111c31",
    borderColor: "#38bdf8",
  },
  threadTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  threadPreview: {
    color: "#cbd5e1",
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  threadMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  threadMetaLabel: {
    backgroundColor: "#0f172a",
    borderRadius: 999,
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sessionCard: {
    backgroundColor: "#081120",
    borderColor: "#162033",
    borderRadius: 18,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  sessionLabel: {
    color: "#7dd3fc",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  sessionValue: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
  },
  sessionMeta: {
    color: "#94a3b8",
    fontSize: 13,
  },
  busyRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  busyText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "600",
  },
  messageList: {
    gap: 12,
  },
  messageBubble: {
    borderRadius: 20,
    gap: 8,
    maxWidth: "92%",
    padding: 14,
  },
  messageUser: {
    alignSelf: "flex-end",
    backgroundColor: "#1d4ed8",
  },
  messageAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#101b2f",
    borderColor: "#22324d",
    borderWidth: 1,
  },
  messageSystem: {
    alignSelf: "center",
    backgroundColor: "#1f2937",
  },
  messageRole: {
    color: "#bfdbfe",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  messageText: {
    color: "#f8fafc",
    fontSize: 15,
    lineHeight: 22,
  },
  messageMeta: {
    color: "#cbd5e1",
    fontSize: 12,
  },
  composer: {
    backgroundColor: "#020817",
    borderColor: "#1e293b",
    borderRadius: 18,
    borderWidth: 1,
    color: "#f8fafc",
    fontSize: 15,
    minHeight: 132,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 21,
  },
  activityList: {
    gap: 12,
  },
  activityRow: {
    flexDirection: "row",
    gap: 12,
  },
  activityDot: {
    borderRadius: 999,
    height: 12,
    marginTop: 5,
    width: 12,
  },
  activityDotInfo: {
    backgroundColor: "#38bdf8",
  },
  activityDotTool: {
    backgroundColor: "#22c55e",
  },
  activityDotApproval: {
    backgroundColor: "#f59e0b",
  },
  activityDotError: {
    backgroundColor: "#ef4444",
  },
  activityCopy: {
    flex: 1,
    gap: 4,
  },
  activityTitle: {
    color: "#e2e8f0",
    fontSize: 14,
    lineHeight: 20,
  },
  activityMeta: {
    color: "#94a3b8",
    fontSize: 12,
  },
});
