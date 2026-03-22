import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
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
  ProjectEntry,
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
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortThreads(threads: ReadonlyArray<OrchestrationThread>, projectId: string | null) {
  return [...threads]
    .filter((thread) => thread.deletedAt === null && thread.projectId === projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortMessages(messages: ReadonlyArray<OrchestrationMessage>) {
  return [...messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function basenameOf(input: string) {
  const normalized = input.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? input;
}

function parentDirectoryOf(input: string) {
  const normalized = input.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separatorIndex <= 0) {
    return normalized.startsWith("/") ? "/" : normalized;
  }
  return normalized.slice(0, separatorIndex);
}

function joinDirectoryPath(base: string, relativePath: string) {
  const trimmedBase = base.replace(/[\\/]+$/, "");
  const trimmedRelative = relativePath.replace(/^[\\/]+/, "");
  if (!trimmedRelative) {
    return trimmedBase || "/";
  }
  return `${trimmedBase}/${trimmedRelative}`;
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
    isRefreshingSnapshot,
    busyAction,
    connect,
    disconnect,
    refreshSnapshot,
    createProject,
    createThread,
    sendTurn,
    interruptTurn,
    stopSession,
    searchDirectory,
    createDirectory,
  } = useBackendConnection();

  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [newThreadTitleDraft, setNewThreadTitleDraft] = useState("");

  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [directoryPathDraft, setDirectoryPathDraft] = useState("");
  const [directoryCwd, setDirectoryCwd] = useState<string | null>(null);
  const [directoryEntries, setDirectoryEntries] = useState<ProjectEntry[]>([]);
  const [directoryTruncated, setDirectoryTruncated] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const allProjects = sortProjects(snapshot?.projects ?? []);
  const allThreads = snapshot?.threads ?? [];
  const projectsWithThreads = allProjects.filter((project) =>
    allThreads.some((thread) => thread.deletedAt === null && thread.projectId === project.id),
  );

  const selectedProject =
    allProjects.find((project) => project.id === selectedProjectId) ??
    projectsWithThreads[0] ??
    allProjects[0] ??
    null;

  const threads = sortThreads(allThreads, selectedProject?.id ?? null);
  const selectedThread =
    threads.find((thread) => thread.id === selectedThreadId) ?? threads[0] ?? null;
  const messages = sortMessages(selectedThread?.messages ?? []);
  const draft = selectedThread ? (threadDrafts[selectedThread.id] ?? "") : "";
  const isConnected = status === "connected";

  const activeThreads = allThreads.filter(
    (thread) =>
      thread.deletedAt === null &&
      (thread.latestTurn?.state === "running" ||
        thread.session?.status === "starting" ||
        thread.session?.status === "running" ||
        thread.session?.status === "ready"),
  );

  const activeModels = Array.from(new Set(activeThreads.map((thread) => thread.model))).sort();

  const activeHarnesses = (() => {
    const fromSessions = activeThreads
      .map((thread) => thread.session?.providerName)
      .filter((provider): provider is string => Boolean(provider));
    const fromHealth = (serverConfig?.providers ?? [])
      .filter((provider) => provider.available || provider.status === "ready")
      .map((provider) => formatProviderLabel(provider.provider));
    return Array.from(new Set([...fromSessions, ...fromHealth])).sort();
  })();

  const openSettingsPanel = () => {
    const initialPath = selectedProject?.workspaceRoot ?? welcome?.cwd ?? serverConfig?.cwd ?? "";
    if (initialPath) {
      setDirectoryPathDraft((current) => (current.trim().length > 0 ? current : initialPath));
      setDirectoryCwd((current) => current ?? initialPath);
      setProjectTitleDraft((current) =>
        current.trim().length > 0 ? current : basenameOf(initialPath),
      );
    }

    setSettingsOpen(true);
  };

  const updateConnectionSettings = (patch: Partial<ConnectionSettings>) => {
    clearError();
    setConnectionSettings((current) => ({ ...current, ...patch }));
  };

  const updateDraft = (value: string) => {
    clearError();
    if (!selectedThread) {
      return;
    }

    setThreadDrafts((current) => ({ ...current, [selectedThread.id]: value }));
  };

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !selectedProject || !selectedThread) {
      return;
    }

    await sendTurn({
      threadId: selectedThread.id,
      text: trimmed,
      runtimeMode: selectedThread.runtimeMode,
      interactionMode: selectedThread.interactionMode,
      model: selectedThread.model,
    });

    setThreadDrafts((current) => ({ ...current, [selectedThread.id]: "" }));
  };

  const loadDirectory = async (cwd: string) => {
    const listing = await searchDirectory({ cwd });
    setDirectoryCwd(listing.cwd);
    setDirectoryPathDraft(listing.cwd);
    setDirectoryEntries(listing.entries.filter((entry) => entry.kind === "directory"));
    setDirectoryTruncated(listing.truncated);
    setProjectTitleDraft((current) => (current.trim().length > 0 ? current : basenameOf(cwd)));
  };

  const handleOpenDirectory = async () => {
    const trimmed = directoryPathDraft.trim();
    if (!trimmed) {
      return;
    }

    await loadDirectory(trimmed);
  };

  const handleOpenParentDirectory = async () => {
    const source = (directoryCwd ?? directoryPathDraft).trim();
    if (!source) {
      return;
    }

    await loadDirectory(parentDirectoryOf(source));
  };

  const handleCreateFolder = async () => {
    if (!directoryCwd || !newFolderName.trim()) {
      return;
    }

    await createDirectory({
      cwd: directoryCwd,
      relativePath: newFolderName.trim(),
    });
    setNewFolderName("");
    await loadDirectory(directoryCwd);
  };

  const handleCreateProject = async () => {
    const workspaceRoot = (directoryCwd ?? directoryPathDraft).trim();
    if (!workspaceRoot) {
      return;
    }

    const projectId = await createProject({
      title: projectTitleDraft.trim() || basenameOf(workspaceRoot),
      workspaceRoot,
      defaultModel: FALLBACK_MODEL,
    });

    setSelectedProjectId(projectId);
    setSelectedThreadId(null);
    setNewThreadTitleDraft("");
  };

  const handleCreateConversation = async () => {
    if (!selectedProject) {
      return;
    }

    const threadId = await createThread({
      projectId: selectedProject.id,
      title:
        newThreadTitleDraft.trim() ||
        createThreadTitle(`${selectedProject.title} ${new Date().toLocaleString()}`),
      model: selectedProject.defaultModel ?? FALLBACK_MODEL,
    });

    setSelectedThreadId(threadId);
    setNewThreadTitleDraft("");
    setSettingsOpen(false);
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
          <View style={styles.topBar}>
            <Pressable onPress={() => setNavMenuOpen(true)} style={styles.topBarButton}>
              <Text style={styles.topBarButtonText}>Projects</Text>
            </Pressable>
            <View style={styles.topBarCenter}>
              <Text style={styles.topBarTitle}>{selectedThread?.title ?? "Mobile Harness"}</Text>
              <Text style={styles.topBarSubtitle}>
                {selectedProject?.title ?? "No project selected"}
              </Text>
            </View>
            <Pressable onPress={openSettingsPanel} style={styles.topBarButton}>
              <Text style={styles.topBarButtonText}>Settings</Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshingSnapshot}
                onRefresh={refreshSnapshot}
                tintColor="#ffffff"
              />
            }
          >
            <View style={styles.block}>
              <Text style={styles.label}>Connection</Text>
              <Text style={styles.value}>{isConnected ? "Connected" : status}</Text>
              <Text style={styles.mutedText}>
                {resolvedWebSocketUrl ?? connectionSettings.serverUrl}
              </Text>
            </View>

            <View style={styles.row}>
              <View style={styles.blockHalf}>
                <Text style={styles.label}>Active models</Text>
                {activeModels.length > 0 ? (
                  activeModels.map((model) => (
                    <Text key={model} style={styles.valueSmall}>
                      {model}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.mutedText}>No active models</Text>
                )}
              </View>
              <View style={styles.blockHalf}>
                <Text style={styles.label}>Active harnesses</Text>
                {activeHarnesses.length > 0 ? (
                  activeHarnesses.map((harness) => (
                    <Text key={harness} style={styles.valueSmall}>
                      {harness}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.mutedText}>No active harnesses</Text>
                )}
              </View>
            </View>

            <View style={styles.block}>
              <Text style={styles.label}>Harness health</Text>
              {(serverConfig?.providers ?? []).length > 0 ? (
                (serverConfig?.providers ?? []).map((provider) => (
                  <View key={provider.provider} style={styles.listRow}>
                    <View style={styles.listRowCopy}>
                      <Text style={styles.valueSmall}>
                        {formatProviderLabel(provider.provider)}
                      </Text>
                      <Text style={styles.mutedText}>
                        {provider.message ??
                          `${provider.authStatus} / ${provider.available ? "available" : "unavailable"}`}
                      </Text>
                    </View>
                    <Text style={styles.valueTiny}>{provider.status}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.mutedText}>Waiting for provider status</Text>
              )}
            </View>

            {errorMessage ? (
              <View style={styles.errorBlock}>
                <Text style={styles.errorTitle}>Backend issue</Text>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <View style={styles.block}>
              <Text style={styles.sectionTitle}>{selectedThread?.title ?? "Conversation"}</Text>
              <Text style={styles.mutedText}>
                {selectedThread
                  ? `${selectedThread.model} / ${selectedThread.runtimeMode} / ${selectedThread.interactionMode}`
                  : "Select a conversation from Projects or create one in Settings"}
              </Text>

              {messages.length > 0 ? (
                <View style={styles.messageList}>
                  {messages.map((message) => (
                    <View
                      key={message.id}
                      style={[
                        styles.message,
                        message.role === "user" ? styles.messageUser : styles.messageAssistant,
                      ]}
                    >
                      <Text style={styles.messageRole}>{message.role}</Text>
                      <Text style={styles.messageText}>{message.text || "Streaming..."}</Text>
                      <Text style={styles.messageMeta}>
                        {formatRelativeTime(message.updatedAt)}
                        {message.streaming ? " / streaming" : ""}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.mutedText}>
                  {selectedThread
                    ? "No messages yet. Send the first instruction below."
                    : "No conversation selected."}
                </Text>
              )}

              {selectedThread ? (
                <TextInput
                  multiline
                  onChangeText={updateDraft}
                  placeholder="Send the next instruction..."
                  placeholderTextColor="#64748b"
                  style={styles.composer}
                  textAlignVertical="top"
                  value={draft}
                />
              ) : null}

              <View style={styles.buttonRow}>
                <Pressable
                  disabled={
                    !isConnected ||
                    !selectedProject ||
                    !selectedThread ||
                    !draft.trim() ||
                    busyAction !== null
                  }
                  onPress={() => {
                    void handleSend();
                  }}
                  style={[
                    styles.primaryButton,
                    (!isConnected ||
                      !selectedProject ||
                      !selectedThread ||
                      !draft.trim() ||
                      busyAction !== null) &&
                      styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Send</Text>
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
                <Pressable
                  disabled={!canStopSession || busyAction !== null}
                  onPress={() => {
                    if (!selectedThread) {
                      return;
                    }
                    void stopSession({ threadId: selectedThread.id });
                  }}
                  style={[
                    styles.secondaryButton,
                    (!canStopSession || busyAction !== null) && styles.buttonDisabled,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Stop</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>

          <Modal
            animationType="slide"
            onRequestClose={() => setNavMenuOpen(false)}
            transparent
            visible={navMenuOpen}
          >
            <View style={styles.overlay}>
              <Pressable style={styles.backdrop} onPress={() => setNavMenuOpen(false)} />
              <SafeAreaView style={styles.sidePanelLeft} edges={["top", "bottom"]}>
                <ScrollView contentContainerStyle={styles.sidePanelContent}>
                  <Text style={styles.panelTitle}>Projects</Text>
                  {projectsWithThreads.length > 0 ? (
                    projectsWithThreads.map((project) => {
                      const projectThreads = sortThreads(allThreads, project.id);
                      return (
                        <View key={project.id} style={styles.menuGroup}>
                          <Pressable
                            onPress={() => {
                              setSelectedProjectId(project.id);
                              setSelectedThreadId(null);
                            }}
                            style={[
                              styles.menuItem,
                              selectedProject?.id === project.id && styles.menuItemActive,
                            ]}
                          >
                            <Text style={styles.menuTitle}>{project.title}</Text>
                            <Text style={styles.menuMeta}>{project.workspaceRoot}</Text>
                          </Pressable>
                          {selectedProject?.id === project.id
                            ? projectThreads.map((thread) => (
                                <Pressable
                                  key={thread.id}
                                  onPress={() => {
                                    setSelectedThreadId(thread.id);
                                    setNavMenuOpen(false);
                                  }}
                                  style={[
                                    styles.threadMenuItem,
                                    selectedThread?.id === thread.id && styles.menuItemActive,
                                  ]}
                                >
                                  <Text style={styles.menuTitle}>{thread.title}</Text>
                                  <Text style={styles.menuMeta}>
                                    {thread.model} / {thread.session?.status ?? "idle"}
                                  </Text>
                                </Pressable>
                              ))
                            : null}
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.mutedText}>
                      Projects only appear here after they have at least one conversation thread.
                    </Text>
                  )}
                </ScrollView>
              </SafeAreaView>
            </View>
          </Modal>

          <Modal
            animationType="slide"
            onRequestClose={() => setSettingsOpen(false)}
            transparent
            visible={settingsOpen}
          >
            <View style={styles.overlay}>
              <SafeAreaView style={styles.sidePanelRight} edges={["top", "bottom"]}>
                <ScrollView contentContainerStyle={styles.sidePanelContent}>
                  <Text style={styles.panelTitle}>Settings</Text>

                  <View style={styles.settingsSection}>
                    <Text style={styles.label}>Connection</Text>
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={(value) => updateConnectionSettings({ serverUrl: value })}
                      placeholder="ws://192.168.2.124:3773"
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
                    <View style={styles.switchRow}>
                      <Text style={styles.valueSmall}>Auto connect</Text>
                      <Switch
                        onValueChange={(value) => updateConnectionSettings({ autoConnect: value })}
                        trackColor={{ false: "#334155", true: "#2563eb" }}
                        value={connectionSettings.autoConnect}
                      />
                    </View>
                    <View style={styles.buttonRow}>
                      <Pressable
                        disabled={!settingsReady || busyAction !== null}
                        onPress={() => {
                          void connect();
                        }}
                        style={[
                          styles.primaryButton,
                          (!settingsReady || busyAction !== null) && styles.buttonDisabled,
                        ]}
                      >
                        <Text style={styles.primaryButtonText}>Connect</Text>
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

                  <View style={styles.settingsSection}>
                    <Text style={styles.label}>Current project</Text>
                    <Text style={styles.valueSmall}>
                      {selectedProject?.title ?? "No project selected"}
                    </Text>
                    <Text style={styles.mutedText}>
                      {selectedProject?.workspaceRoot ??
                        "Create or select a project before starting a conversation."}
                    </Text>
                    <TextInput
                      onChangeText={setNewThreadTitleDraft}
                      placeholder="Conversation title"
                      placeholderTextColor="#64748b"
                      style={styles.input}
                      value={newThreadTitleDraft}
                    />
                    <Pressable
                      disabled={!selectedProject || busyAction !== null}
                      onPress={() => {
                        void handleCreateConversation();
                      }}
                      style={[
                        styles.primaryButton,
                        (!selectedProject || busyAction !== null) && styles.buttonDisabled,
                      ]}
                    >
                      <Text style={styles.primaryButtonText}>New conversation</Text>
                    </Pressable>
                  </View>

                  <View style={styles.settingsSection}>
                    <Text style={styles.label}>Add project</Text>
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={setDirectoryPathDraft}
                      placeholder="/home/omar/Code/mikrocode"
                      placeholderTextColor="#64748b"
                      style={styles.input}
                      value={directoryPathDraft}
                    />
                    <View style={styles.buttonRow}>
                      <Pressable
                        onPress={() => void handleOpenDirectory()}
                        style={styles.secondaryButton}
                      >
                        <Text style={styles.secondaryButtonText}>Open path</Text>
                      </Pressable>
                      <Pressable
                        disabled={!directoryCwd || busyAction !== null}
                        onPress={() => void handleOpenParentDirectory()}
                        style={[
                          styles.secondaryButton,
                          (!directoryCwd || busyAction !== null) && styles.buttonDisabled,
                        ]}
                      >
                        <Text style={styles.secondaryButtonText}>Up</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.mutedText}>
                      {directoryCwd ?? "Open a backend path to browse directories"}
                    </Text>

                    {directoryEntries.length > 0 ? (
                      <View style={styles.directoryList}>
                        {directoryEntries.map((entry) => {
                          const nextPath = directoryCwd
                            ? joinDirectoryPath(directoryCwd, entry.path)
                            : entry.path;
                          return (
                            <Pressable
                              key={nextPath}
                              onPress={() => void loadDirectory(nextPath)}
                              style={styles.directoryRow}
                            >
                              <Text style={styles.menuTitle}>{entry.path}</Text>
                              <Text style={styles.menuMeta}>directory</Text>
                            </Pressable>
                          );
                        })}
                        {directoryTruncated ? (
                          <Text style={styles.mutedText}>Directory list truncated.</Text>
                        ) : null}
                      </View>
                    ) : null}

                    <TextInput
                      onChangeText={setNewFolderName}
                      placeholder="New folder name"
                      placeholderTextColor="#64748b"
                      style={styles.input}
                      value={newFolderName}
                    />
                    <Pressable
                      disabled={!directoryCwd || !newFolderName.trim() || busyAction !== null}
                      onPress={() => {
                        void handleCreateFolder();
                      }}
                      style={[
                        styles.secondaryButton,
                        (!directoryCwd || !newFolderName.trim() || busyAction !== null) &&
                          styles.buttonDisabled,
                      ]}
                    >
                      <Text style={styles.secondaryButtonText}>Create folder</Text>
                    </Pressable>

                    <TextInput
                      onChangeText={setProjectTitleDraft}
                      placeholder="Project title"
                      placeholderTextColor="#64748b"
                      style={styles.input}
                      value={projectTitleDraft}
                    />
                    <Pressable
                      disabled={!(directoryCwd ?? directoryPathDraft).trim() || busyAction !== null}
                      onPress={() => {
                        void handleCreateProject();
                      }}
                      style={[
                        styles.primaryButton,
                        (!(directoryCwd ?? directoryPathDraft).trim() || busyAction !== null) &&
                          styles.buttonDisabled,
                      ]}
                    >
                      <Text style={styles.primaryButtonText}>Create project</Text>
                    </Pressable>
                  </View>

                  <Pressable onPress={() => setSettingsOpen(false)} style={styles.closePanelButton}>
                    <Text style={styles.secondaryButtonText}>Close settings</Text>
                  </Pressable>
                </ScrollView>
              </SafeAreaView>
            </View>
          </Modal>
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
    backgroundColor: "#f3f4f6",
  },
  keyboardAvoider: {
    flex: 1,
  },
  topBar: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderBottomColor: "#d1d5db",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 12,
  },
  topBarButton: {
    borderColor: "#d1d5db",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  topBarButtonText: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "700",
  },
  topBarCenter: {
    flex: 1,
    paddingHorizontal: 12,
  },
  topBarTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "700",
  },
  topBarSubtitle: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    gap: 12,
    padding: 12,
    paddingBottom: 24,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  block: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  blockHalf: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderWidth: 1,
    flex: 1,
    gap: 8,
    padding: 14,
  },
  label: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  value: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "800",
  },
  valueSmall: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "700",
  },
  valueTiny: {
    color: "#374151",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  mutedText: {
    color: "#6b7280",
    fontSize: 13,
    lineHeight: 18,
  },
  listRow: {
    alignItems: "center",
    borderTopColor: "#e5e7eb",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
  },
  listRowCopy: {
    flex: 1,
    gap: 2,
    paddingRight: 8,
  },
  errorBlock: {
    backgroundColor: "#fff1f2",
    borderColor: "#fda4af",
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  errorTitle: {
    color: "#9f1239",
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: "#be123c",
    fontSize: 13,
    lineHeight: 18,
  },
  sectionTitle: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "700",
  },
  messageList: {
    gap: 10,
  },
  message: {
    borderWidth: 1,
    gap: 6,
    maxWidth: "94%",
    padding: 12,
  },
  messageUser: {
    alignSelf: "flex-end",
    backgroundColor: "#dbeafe",
    borderColor: "#93c5fd",
  },
  messageAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#f9fafb",
    borderColor: "#d1d5db",
  },
  messageRole: {
    color: "#374151",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  messageText: {
    color: "#111827",
    fontSize: 15,
    lineHeight: 21,
  },
  messageMeta: {
    color: "#6b7280",
    fontSize: 11,
  },
  composer: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderWidth: 1,
    color: "#111827",
    fontSize: 15,
    minHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#111827",
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  secondaryButtonText: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    backgroundColor: "rgba(17, 24, 39, 0.35)",
    flex: 1,
  },
  sidePanelLeft: {
    backgroundColor: "#ffffff",
    borderRightColor: "#d1d5db",
    borderRightWidth: 1,
    width: "80%",
  },
  sidePanelRight: {
    backgroundColor: "#ffffff",
    borderLeftColor: "#d1d5db",
    borderLeftWidth: 1,
    marginLeft: "auto",
    width: "86%",
  },
  sidePanelContent: {
    gap: 14,
    padding: 14,
  },
  panelTitle: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "800",
  },
  menuGroup: {
    gap: 6,
  },
  menuItem: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  threadMenuItem: {
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
    borderWidth: 1,
    gap: 4,
    marginLeft: 14,
    padding: 12,
  },
  menuItemActive: {
    borderColor: "#111827",
  },
  menuTitle: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "700",
  },
  menuMeta: {
    color: "#6b7280",
    fontSize: 12,
    lineHeight: 17,
  },
  settingsSection: {
    borderColor: "#d1d5db",
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderWidth: 1,
    color: "#111827",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  directoryList: {
    gap: 6,
  },
  directoryRow: {
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
    borderWidth: 1,
    gap: 2,
    padding: 10,
  },
  closePanelButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
});
