import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import type {
  OrchestrationMessage,
  OrchestrationProject,
  OrchestrationThread,
  ProjectEntry,
  RuntimeMode,
  ServerConversationCapabilities,
} from "@t3tools/contracts";

import { MOBILE_DEFAULT_MODEL } from "./defaults";
import { type ConnectionSettings } from "./storage";
import { useBackendConnection } from "./useBackendConnection";

const FALLBACK_MODEL = MOBILE_DEFAULT_MODEL;
const PERSISTENT_SIDEBAR_BREAKPOINT = 920;
const WIDE_LAYOUT_BREAKPOINT = 1180;
const PANEL_ANIMATION_DURATION_MS = 220;
const TERMINAL_FONT_FAMILY = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});
const TERMINAL_BG = "#050816";
const TERMINAL_PANEL = "#0a1020";
const TERMINAL_PANEL_ALT = "#0d1528";
const TERMINAL_BORDER = "#18243c";
const TERMINAL_TEXT = "#d8e6ff";
const TERMINAL_MUTED = "#7f8ca8";
const TERMINAL_ACCENT = "#7ef5b8";
const TERMINAL_ACCENT_SOFT = "#133126";

function formatProviderLabel(provider: "codex" | "claudeAgent") {
  return provider === "codex" ? "Codex" : "Claude Agent";
}

function resolveProviderForThread(
  thread: OrchestrationThread | null,
): "codex" | "claudeAgent" | null {
  if (!thread) {
    return null;
  }
  if (thread.session?.providerName === "codex" || thread.session?.providerName === "claudeAgent") {
    return thread.session.providerName;
  }
  return thread.model.trim().toLowerCase().startsWith("claude") ? "claudeAgent" : "codex";
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatConnectionLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatRuntimeModeLabel(mode: RuntimeMode) {
  return mode === "full-access" ? "Full access" : "Approval required";
}

function formatModelSwitchBehavior(
  modelSwitch: ServerConversationCapabilities["modelSwitch"] | null,
) {
  if (modelSwitch === "restart-session") {
    return "Model changes restart the provider session on the next turn.";
  }
  if (modelSwitch === "unsupported") {
    return "Stop the active session before switching models.";
  }
  return "Model changes apply on the next turn without restarting the session.";
}

function sortReadonlyArray<T>(items: ReadonlyArray<T>, compare: (left: T, right: T) => number) {
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...items].sort(compare);
}

function sortProjects(projects: ReadonlyArray<OrchestrationProject>) {
  return sortReadonlyArray(
    projects.filter((project) => project.deletedAt === null),
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

function sortThreads(threads: ReadonlyArray<OrchestrationThread>, projectId: string | null = null) {
  return sortReadonlyArray(
    threads.filter(
      (thread) =>
        thread.deletedAt === null && (projectId === null || thread.projectId === projectId),
    ),
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

function sortMessages(messages: ReadonlyArray<OrchestrationMessage>) {
  return sortReadonlyArray(messages, (left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
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

function createThreadTitle(projectTitle: string) {
  const stamp = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  return `${projectTitle.trim() || "Conversation"} ${stamp}`.slice(0, 64);
}

function getThreadDisplayTitle(thread: OrchestrationThread | null) {
  const title = thread?.title.trim();
  if (!title || title.toLowerCase() === "new thread") {
    return "Conversation";
  }
  return title;
}

function getSessionTone(thread: OrchestrationThread | null) {
  const status = thread?.session?.status ?? "idle";
  if (status === "running" || status === "ready") {
    return "live";
  }
  if (status === "error") {
    return "error";
  }
  return "muted";
}

function ActionButton({
  compact = false,
  disabled = false,
  emphasis = "primary",
  label,
  onPress,
}: {
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly emphasis?: "primary" | "secondary" | "ghost" | "surface";
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.buttonBase,
        compact && styles.buttonCompact,
        emphasis === "primary" && styles.buttonPrimary,
        emphasis === "secondary" && styles.buttonSecondary,
        emphasis === "ghost" && styles.buttonGhost,
        emphasis === "surface" && styles.buttonSurface,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          emphasis === "primary" && styles.buttonLabelPrimary,
          emphasis === "surface" && styles.buttonLabelSurface,
          (emphasis === "secondary" || emphasis === "ghost") && styles.buttonLabelSecondary,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function MetaRow({
  accent = false,
  label,
  value,
}: {
  readonly accent?: boolean;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text numberOfLines={2} style={[styles.metaValue, accent && styles.metaValueAccent]}>
        {value}
      </Text>
    </View>
  );
}

function SwipeDismissRow({
  children,
  onDismiss,
  onPress,
}: {
  readonly children: ReactNode;
  readonly onDismiss: () => void;
  readonly onPress: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;

  const animateBack = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
      mass: 0.9,
    }).start();
  };

  const dismiss = () => {
    Animated.timing(translateX, {
      toValue: -132,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onDismiss();
      }
    });
  };

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) =>
      Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderMove: (_, gestureState) => {
      translateX.setValue(Math.min(0, Math.max(gestureState.dx, -132)));
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx <= -72) {
        dismiss();
        return;
      }
      animateBack();
    },
    onPanResponderTerminate: animateBack,
  });

  return (
    <View style={styles.swipeRowShell}>
      <View style={styles.swipeRowAction}>
        <Pressable onPress={dismiss} style={styles.swipeRowActionButton}>
          <Text style={styles.swipeRowActionLabel}>Hide</Text>
        </Pressable>
      </View>
      <Animated.View
        style={[
          styles.swipeRowContent,
          {
            transform: [{ translateX }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <Pressable onPress={onPress}>{children}</Pressable>
      </Animated.View>
    </View>
  );
}

export function AppShell() {
  const {
    busyAction,
    clearError,
    connect,
    connectionSettings,
    createDirectory,
    createProject,
    createThread,
    deleteProject,
    disconnect,
    errorMessage,
    getConversationCapabilities,
    interruptTurn,
    isRefreshingSnapshot,
    lastPushSequence,
    refreshSnapshot,
    resolvedWebSocketUrl,
    searchDirectory,
    sendTurn,
    serverConfig,
    setConnectionSettings,
    settingsReady,
    snapshot,
    status,
    stopSession,
    updateThreadModel,
    updateThreadRuntimeMode,
    welcome,
  } = useBackendConnection();

  const { height, width } = useWindowDimensions();
  const sidebarPersistent = width >= PERSISTENT_SIDEBAR_BREAKPOINT;
  const wideLayout = width >= WIDE_LAYOUT_BREAKPOINT;
  const sidebarWidth = sidebarPersistent ? Math.min(360, Math.max(286, width * 0.28)) : 340;
  const floatingPanelWidth = Math.min(380, Math.max(300, width - 26));
  const conversationPickerWidth = Math.min(560, Math.max(320, width - 24));
  const conversationPickerHeight = Math.min(540, Math.max(320, height - 40));
  const projectPickerWidth = Math.min(720, Math.max(320, width - 24));
  const projectPickerHeight = Math.min(640, Math.max(420, height - 24));

  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [dismissedRecentThreadIds, setDismissedRecentThreadIds] = useState<string[]>([]);
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [revealedMessageId, setRevealedMessageId] = useState<string | null>(null);
  const [projectBuilderOpen, setProjectBuilderOpen] = useState(false);
  const [conversationPickerMode, setConversationPickerMode] = useState<"model" | "access" | null>(
    null,
  );
  const [conversationCapabilities, setConversationCapabilities] =
    useState<ServerConversationCapabilities | null>(null);
  const [isLoadingConversationCapabilities, setIsLoadingConversationCapabilities] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [directoryCwd, setDirectoryCwd] = useState<string | null>(null);
  const [directoryEntries, setDirectoryEntries] = useState<ProjectEntry[]>([]);
  const [directoryTruncated, setDirectoryTruncated] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const navTranslateX = useRef(new Animated.Value(-sidebarWidth)).current;
  const settingsTranslateX = useRef(new Animated.Value(floatingPanelWidth)).current;
  const workspaceOpacity = useRef(new Animated.Value(1)).current;
  const workspaceTranslateY = useRef(new Animated.Value(0)).current;
  const messageMetaOpacity = useRef(new Animated.Value(0)).current;
  const messageMetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allProjects = sortProjects(snapshot?.projects ?? []);
  const visibleProjectIds = new Set(allProjects.map((project) => project.id));
  const allThreads = sortThreads(snapshot?.threads ?? []).filter((thread) =>
    visibleProjectIds.has(thread.projectId),
  );
  const recentThreads = allThreads
    .filter((thread) => !dismissedRecentThreadIds.includes(thread.id))
    .slice(0, 8);
  const selectedThread = allThreads.find((thread) => thread.id === selectedThreadId) ?? null;
  const effectiveProjectId =
    selectedThread?.projectId ?? selectedProjectId ?? allProjects[0]?.id ?? null;
  const selectedProject = allProjects.find((project) => project.id === effectiveProjectId) ?? null;
  const selectedProjectThreads = selectedProject ? sortThreads(allThreads, selectedProject.id) : [];
  const messages = sortMessages(selectedThread?.messages ?? []);
  const selectedThreadDisplayTitle = getThreadDisplayTitle(selectedThread);
  const draft = selectedThread ? (threadDrafts[selectedThread.id] ?? "") : "";
  const isConnected = status === "connected";
  const providers = serverConfig?.providers ?? [];
  const serverDirectoryHint =
    serverConfig?.cwd ?? welcome?.cwd ?? selectedProject?.workspaceRoot ?? "";
  const selectedThreadConversationId = selectedThread?.id ?? null;
  const selectedConversationProvider = resolveProviderForThread(selectedThread);
  const selectedConversationProviderStatus =
    selectedConversationProvider === null
      ? null
      : (providers.find((provider) => provider.provider === selectedConversationProvider) ?? null);
  const currentModelOptions =
    selectedThread && conversationCapabilities?.threadId === selectedThread.id
      ? conversationCapabilities.models
      : [];
  const currentRuntimeModeOptions =
    selectedThread && conversationCapabilities?.threadId === selectedThread.id
      ? conversationCapabilities.runtimeModes
      : [];

  const snapshotSequenceLabel = lastPushSequence === null ? "--" : `${lastPushSequence}`;
  const homeSubtitle = selectedProject
    ? `${selectedProject.title} mounted / ${selectedProjectThreads.length} sessions`
    : "Harness + CLI status";
  const topBarPrimary = selectedThread
    ? `${selectedProject?.title ?? "Root"} / ${selectedThread?.session?.status ?? "idle"}`
    : "Index";
  const topBarSecondary = selectedThread
    ? `${selectedConversationProvider ? formatProviderLabel(selectedConversationProvider) : "Provider"}${selectedThreadDisplayTitle !== "Conversation" ? ` / ${selectedThreadDisplayTitle}` : ""}`
    : homeSubtitle;
  const conversationPickerTitle =
    conversationPickerMode === "model" ? "Switch model" : "Switch permission";
  const conversationPickerSubtitle =
    conversationPickerMode === "model"
      ? formatModelSwitchBehavior(conversationCapabilities?.modelSwitch ?? null)
      : selectedThread?.session && selectedThread.session.status !== "stopped"
        ? "Changing access restarts the active provider session immediately."
        : "Access mode applies to the next session start.";

  useEffect(() => {
    if (sidebarPersistent) {
      setNavMenuOpen(false);
      navTranslateX.setValue(-sidebarWidth);
    }
  }, [navTranslateX, sidebarPersistent, sidebarWidth]);

  useEffect(() => {
    if (!navMenuOpen) {
      navTranslateX.setValue(-sidebarWidth);
    }
  }, [navMenuOpen, navTranslateX, sidebarWidth]);

  useEffect(() => {
    if (!settingsOpen) {
      settingsTranslateX.setValue(floatingPanelWidth);
    }
  }, [floatingPanelWidth, settingsOpen, settingsTranslateX]);

  useEffect(() => {
    workspaceOpacity.setValue(0.55);
    workspaceTranslateY.setValue(18);
    Animated.parallel([
      Animated.timing(workspaceOpacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(workspaceTranslateY, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [selectedProject?.id, selectedThread?.id, workspaceOpacity, workspaceTranslateY]);

  useEffect(() => {
    if (messageMetaTimerRef.current) {
      clearTimeout(messageMetaTimerRef.current);
      messageMetaTimerRef.current = null;
    }
    setRevealedMessageId(null);
    messageMetaOpacity.setValue(0);
  }, [messageMetaOpacity, selectedThreadConversationId]);

  useEffect(() => {
    return () => {
      if (messageMetaTimerRef.current) {
        clearTimeout(messageMetaTimerRef.current);
        messageMetaTimerRef.current = null;
      }
    };
  }, []);

  const animatePanel = (
    animatedValue: Animated.Value,
    toValue: number,
    onComplete?: () => void,
  ) => {
    Animated.timing(animatedValue, {
      toValue,
      duration: PANEL_ANIMATION_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onComplete?.();
      }
    });
  };

  const closeNavMenu = () => {
    animatePanel(navTranslateX, -sidebarWidth, () => {
      setNavMenuOpen(false);
    });
  };

  const closeSettingsPanel = () => {
    animatePanel(settingsTranslateX, floatingPanelWidth, () => {
      setSettingsOpen(false);
    });
  };

  const openNavMenu = () => {
    if (sidebarPersistent) {
      return;
    }
    settingsTranslateX.setValue(floatingPanelWidth);
    setSettingsOpen(false);
    navTranslateX.setValue(-sidebarWidth);
    setNavMenuOpen(true);
    animatePanel(navTranslateX, 0);
  };

  const openSettingsPanel = () => {
    if (!sidebarPersistent) {
      navTranslateX.setValue(-sidebarWidth);
      setNavMenuOpen(false);
    }
    settingsTranslateX.setValue(floatingPanelWidth);
    setSettingsOpen(true);
    animatePanel(settingsTranslateX, 0);
  };

  const openProjectBuilder = () => {
    clearError();
    setNewFolderName("");
    setProjectTitleDraft("");
    setDirectoryCwd(null);
    setDirectoryEntries([]);
    setDirectoryTruncated(false);
    setProjectBuilderOpen(true);
  };

  const closeProjectBuilder = () => {
    setProjectBuilderOpen(false);
    setNewFolderName("");
  };

  const navPanelPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) =>
      navMenuOpen &&
      !sidebarPersistent &&
      gestureState.dx < -10 &&
      Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderMove: (_, gestureState) => {
      navTranslateX.setValue(Math.max(-sidebarWidth, Math.min(0, gestureState.dx)));
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx <= -Math.min(96, sidebarWidth * 0.24)) {
        closeNavMenu();
        return;
      }
      animatePanel(navTranslateX, 0);
    },
    onPanResponderTerminate: () => {
      animatePanel(navTranslateX, 0);
    },
  });

  const settingsPanelPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) =>
      settingsOpen && gestureState.dx > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderMove: (_, gestureState) => {
      settingsTranslateX.setValue(Math.max(0, Math.min(floatingPanelWidth, gestureState.dx)));
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx >= Math.min(96, floatingPanelWidth * 0.24)) {
        closeSettingsPanel();
        return;
      }
      animatePanel(settingsTranslateX, 0);
    },
    onPanResponderTerminate: () => {
      animatePanel(settingsTranslateX, 0);
    },
  });

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

  const loadDirectory = async (cwd: string) => {
    const listing = await searchDirectory({ cwd });
    setDirectoryCwd(listing.cwd);
    setDirectoryEntries(listing.entries.filter((entry) => entry.kind === "directory"));
    setDirectoryTruncated(listing.truncated);
    setProjectTitleDraft(basenameOf(listing.cwd));
  };

  useEffect(() => {
    if (!projectBuilderOpen || directoryCwd !== null) {
      return;
    }

    const nextRoot = serverDirectoryHint.trim();
    if (!nextRoot) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const listing = await searchDirectory({ cwd: nextRoot });
      if (cancelled) {
        return;
      }
      setDirectoryCwd(listing.cwd);
      setDirectoryEntries(listing.entries.filter((entry) => entry.kind === "directory"));
      setDirectoryTruncated(listing.truncated);
      setProjectTitleDraft(basenameOf(listing.cwd));
    })();

    return () => {
      cancelled = true;
    };
  }, [directoryCwd, projectBuilderOpen, searchDirectory, serverDirectoryHint]);

  useEffect(() => {
    setConversationCapabilities((current) =>
      current?.threadId === selectedThreadConversationId ? current : null,
    );
    setConversationPickerMode(null);
    setIsLoadingConversationCapabilities(false);
  }, [selectedThreadConversationId]);

  const handleResetProjectDirectory = async () => {
    const nextRoot = serverDirectoryHint.trim();
    if (!nextRoot) {
      return;
    }
    await loadDirectory(nextRoot);
  };

  const handleOpenParentDirectory = async () => {
    const source = directoryCwd?.trim();
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
    const workspaceRoot = directoryCwd?.trim() ?? "";
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
    closeProjectBuilder();
  };

  const handleCreateConversation = async (projectOverride?: OrchestrationProject | null) => {
    const project = projectOverride ?? selectedProject;
    if (!project) {
      return;
    }

    const threadId = await createThread({
      projectId: project.id,
      title: createThreadTitle(project.title),
      model: project.defaultModel ?? FALLBACK_MODEL,
    });

    setSelectedProjectId(project.id);
    setSelectedThreadId(threadId);
    if (!sidebarPersistent) {
      closeNavMenu();
    }
  };

  const handleSelectHome = () => {
    setSelectedThreadId(null);
    if (!sidebarPersistent) {
      closeNavMenu();
    }
  };

  const handleSelectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    const activeThread = allThreads.find((thread) => thread.id === selectedThreadId) ?? null;
    if (activeThread?.projectId !== projectId) {
      setSelectedThreadId(null);
    }
  };

  const handleSelectThread = (projectId: string, threadId: string) => {
    setSelectedProjectId(projectId);
    setSelectedThreadId(threadId);
    if (!sidebarPersistent) {
      closeNavMenu();
    }
  };

  const handleDismissRecentThread = (threadId: string) => {
    setDismissedRecentThreadIds((current) =>
      current.includes(threadId) ? current : [...current, threadId],
    );
  };

  const handleDeleteProject = async (projectId: string) => {
    const activeThread = allThreads.find((thread) => thread.id === selectedThreadId) ?? null;
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
    }
    if (activeThread?.projectId === projectId) {
      setSelectedThreadId(null);
    }
    await deleteProject(projectId);
  };

  const handleRevealMessageMeta = (messageId: string) => {
    if (messageMetaTimerRef.current) {
      clearTimeout(messageMetaTimerRef.current);
      messageMetaTimerRef.current = null;
    }

    messageMetaOpacity.stopAnimation();
    setRevealedMessageId(messageId);
    messageMetaOpacity.setValue(1);

    messageMetaTimerRef.current = setTimeout(() => {
      Animated.timing(messageMetaOpacity, {
        toValue: 0,
        duration: 1800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) {
          return;
        }
        setRevealedMessageId((current) => (current === messageId ? null : current));
      });
    }, 1200);
  };

  const closeConversationPicker = () => {
    setConversationPickerMode(null);
  };

  const openConversationPicker = async (mode: "model" | "access") => {
    clearError();
    if (!selectedThread) {
      return;
    }
    setConversationPickerMode(mode);

    if (conversationCapabilities?.threadId === selectedThread.id) {
      return;
    }

    setIsLoadingConversationCapabilities(true);
    try {
      const nextCapabilities = await getConversationCapabilities({
        threadId: selectedThread.id,
      });
      setConversationCapabilities(nextCapabilities);
    } finally {
      setIsLoadingConversationCapabilities(false);
    }
  };

  const handleSelectConversationModel = async (model: string) => {
    if (!selectedThread) {
      return;
    }
    if (selectedThread.model === model) {
      closeConversationPicker();
      return;
    }

    await updateThreadModel({
      threadId: selectedThread.id,
      model,
    });
    setConversationCapabilities(null);
    closeConversationPicker();
  };

  const handleSelectConversationRuntimeMode = async (runtimeMode: RuntimeMode) => {
    if (!selectedThread) {
      return;
    }
    if (selectedThread.runtimeMode === runtimeMode) {
      closeConversationPicker();
      return;
    }

    await updateThreadRuntimeMode({
      threadId: selectedThread.id,
      runtimeMode,
    });
    setConversationCapabilities(null);
    closeConversationPicker();
  };

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !selectedThread) {
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

  const sessionStatus = selectedThread?.session?.status ?? "idle";
  const canInterrupt =
    isConnected &&
    selectedThread !== null &&
    (selectedThread.latestTurn?.state === "running" || sessionStatus === "running");
  const canStopSession =
    isConnected &&
    selectedThread !== null &&
    selectedThread.session !== null &&
    selectedThread.session.status !== "stopped";

  const renderSidebar = () => (
    <View style={styles.sidebarRoot}>
      <SafeAreaView style={styles.sidebarSafeArea} edges={["top", "bottom"]}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.brandMark}>MIKROCODE</Text>
          <Text style={styles.sidebarHeaderCopy}>
            {allProjects.length} roots / {allThreads.length} sessions
          </Text>
        </View>

        <View style={styles.sidebarActions}>
          <ActionButton compact label="Index" onPress={handleSelectHome} />
          <ActionButton
            compact
            emphasis="secondary"
            label={projectBuilderOpen ? "Close Picker" : "Mount Root"}
            onPress={() => {
              if (projectBuilderOpen) {
                closeProjectBuilder();
                return;
              }
              openProjectBuilder();
            }}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.sidebarScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.navSection}>
            <Text style={styles.navSectionLabel}>Project Tree</Text>
            {allProjects.length > 0 ? (
              allProjects.map((project) => {
                const projectThreads = sortThreads(allThreads, project.id);
                const projectActive = selectedProject?.id === project.id;
                return (
                  <View key={project.id} style={styles.projectGroup}>
                    <View style={[styles.projectRow, projectActive && styles.projectRowActive]}>
                      <Pressable
                        onPress={() => {
                          handleSelectProject(project.id);
                        }}
                        style={styles.projectSelectButton}
                      >
                        <View style={styles.projectCopy}>
                          <Text style={styles.projectTitle}>{project.title}</Text>
                        </View>
                        <Text style={styles.projectCount}>{projectThreads.length}</Text>
                      </Pressable>

                      {projectActive ? (
                        <Pressable
                          disabled={busyAction !== null}
                          onPress={() => {
                            void handleDeleteProject(project.id);
                          }}
                          style={[
                            styles.projectHeaderDestructiveAction,
                            busyAction !== null && styles.buttonDisabled,
                          ]}
                        >
                          <Text style={styles.inlineDestructiveActionLabel}>Drop</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <View style={styles.threadGroup}>
                      {projectThreads.length > 0 ? (
                        projectThreads.map((thread) => {
                          const threadActive = selectedThread?.id === thread.id;
                          return (
                            <Pressable
                              key={thread.id}
                              onPress={() => {
                                handleSelectThread(project.id, thread.id);
                              }}
                              style={[styles.threadRow, threadActive && styles.threadRowActive]}
                            >
                              <View style={styles.threadRowCopy}>
                                <Text numberOfLines={1} style={styles.threadTitle}>
                                  {getThreadDisplayTitle(thread)}
                                </Text>
                              </View>
                              <View
                                style={[
                                  styles.statusPulse,
                                  getSessionTone(thread) === "live" && styles.statusPulseLive,
                                  getSessionTone(thread) === "error" && styles.statusPulseError,
                                ]}
                              />
                            </Pressable>
                          );
                        })
                      ) : (
                        <Text style={styles.emptyThreadsCopy}>No sessions yet.</Text>
                      )}

                      <View style={styles.projectInlineActions}>
                        <ActionButton
                          compact
                          disabled={busyAction !== null}
                          emphasis="ghost"
                          label="New Session"
                          onPress={() => {
                            void handleCreateConversation(project);
                          }}
                        />
                      </View>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyProjectsCopy}>
                No mounted roots yet. Open the server picker to mount a folder and start tracking
                sessions.
              </Text>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );

  const renderHome = () => (
    <ScrollView
      contentContainerStyle={styles.workspaceScrollContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          onRefresh={refreshSnapshot}
          refreshing={isRefreshingSnapshot}
          tintColor={TERMINAL_ACCENT}
        />
      }
    >
      <View style={styles.recentSection}>
        <View style={styles.sectionHeadingRow}>
          <View>
            <Text style={styles.sectionEyebrow}>Buffer</Text>
            <Text style={styles.sectionTitle}>Recent sessions</Text>
          </View>
          <View style={styles.recentSectionActions}>
            {dismissedRecentThreadIds.length > 0 ? (
              <Pressable
                onPress={() => {
                  setDismissedRecentThreadIds([]);
                }}
                style={styles.inlineSubtleAction}
              >
                <Text style={styles.inlineSubtleActionLabel}>Show hidden</Text>
              </Pressable>
            ) : null}
            {selectedProject ? (
              <ActionButton
                compact
                disabled={busyAction !== null}
                label="New session"
                onPress={() => {
                  void handleCreateConversation(selectedProject);
                }}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.recentRail}>
          {recentThreads.length > 0 ? (
            recentThreads.map((thread) => (
              <SwipeDismissRow
                key={thread.id}
                onDismiss={() => {
                  handleDismissRecentThread(thread.id);
                }}
                onPress={() => {
                  handleSelectThread(thread.projectId, thread.id);
                }}
              >
                <View style={styles.recentRow}>
                  <View style={styles.recentRowAccent} />
                  <View style={styles.recentRowCopy}>
                    <Text numberOfLines={1} style={styles.recentRowTitle}>
                      {getThreadDisplayTitle(thread)}
                    </Text>
                    <Text numberOfLines={1} style={styles.recentRowMeta}>
                      {allProjects.find((project) => project.id === thread.projectId)?.title ??
                        "Project"}{" "}
                      / {thread.session?.status ?? "idle"}
                    </Text>
                  </View>
                  <Text style={styles.recentRowTime}>{formatTimestamp(thread.updatedAt)}</Text>
                </View>
              </SwipeDismissRow>
            ))
          ) : (
            <Text style={styles.helperText}>No recent sessions in buffer.</Text>
          )}
        </View>
      </View>

      {errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>Backend fault</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <View style={[styles.homeGrid, wideLayout && styles.homeGridWide]}>
        <View style={styles.flatSection}>
          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.sectionEyebrow}>Harness</Text>
              <Text style={styles.sectionTitle}>Harness matrix</Text>
            </View>
            <ActionButton compact emphasis="secondary" label="Config" onPress={openSettingsPanel} />
          </View>
          <Text numberOfLines={1} style={styles.sectionSubtleText}>
            {resolvedWebSocketUrl ?? connectionSettings.serverUrl}
          </Text>
          <View style={styles.compactList}>
            {providers.length > 0 ? (
              providers.map((provider) => (
                <View key={provider.provider} style={styles.providerRow}>
                  <View style={styles.providerCopy}>
                    <Text style={styles.providerTitle}>
                      {formatProviderLabel(provider.provider)}
                    </Text>
                    <Text style={styles.providerMeta}>
                      {provider.message ??
                        `${provider.authStatus} / ${provider.available ? "available" : "unavailable"}`}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.providerStatus,
                      provider.status === "warning" && styles.providerStatusWarning,
                      provider.status === "error" && styles.providerStatusError,
                    ]}
                  >
                    {provider.status}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.helperText}>Awaiting provider heartbeat from the server.</Text>
            )}
          </View>
        </View>

        <View style={styles.flatSection}>
          <Text style={styles.sectionEyebrow}>CLI</Text>
          <Text style={styles.sectionTitle}>CLI telemetry</Text>
          <View style={styles.compactList}>
            <MetaRow
              accent
              label="Socket"
              value={resolvedWebSocketUrl ?? connectionSettings.serverUrl}
            />
            <MetaRow
              label="Server cwd"
              value={serverConfig?.cwd ?? welcome?.cwd ?? "Unavailable"}
            />
            <MetaRow label="Bootstrap project" value={welcome?.projectName ?? "Unavailable"} />
            <MetaRow label="Snapshot sequence" value={snapshotSequenceLabel} />
            <MetaRow label="Busy action" value={busyAction ?? "Idle"} />
          </View>
        </View>
      </View>
    </ScrollView>
  );

  const renderConversation = () => (
    <View style={styles.threadShell}>
      {errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorTitle}>Backend fault</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.messagesScrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            onRefresh={refreshSnapshot}
            refreshing={isRefreshingSnapshot}
            tintColor={TERMINAL_ACCENT}
          />
        }
        style={styles.messagesScroll}
      >
        {messages.length > 0 ? (
          messages.map((message) => (
            <Pressable
              key={message.id}
              onPress={() => {
                handleRevealMessageMeta(message.id);
              }}
              style={[
                styles.messageWrap,
                message.role === "user" ? styles.messageWrapUser : styles.messageWrapAssistant,
              ]}
            >
              <View
                style={[
                  styles.messageRow,
                  message.role === "user" ? styles.messageRowUser : styles.messageRowAssistant,
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    message.role === "user" ? styles.messageTextUser : styles.messageTextAssistant,
                  ]}
                >
                  {message.text || "Streaming..."}
                </Text>
              </View>
              {revealedMessageId === message.id ? (
                <Animated.View
                  style={[
                    styles.messageMetaReveal,
                    { opacity: messageMetaOpacity },
                    message.role === "user"
                      ? styles.messageMetaRevealUser
                      : styles.messageMetaRevealAssistant,
                  ]}
                >
                  <Text style={styles.messageMetaRevealText}>
                    {formatTimestamp(message.updatedAt)}
                    {message.streaming ? " / streaming" : ""}
                  </Text>
                </Animated.View>
              ) : null}
            </Pressable>
          ))
        ) : (
          <View style={styles.emptyConversation}>
            <Text style={styles.sectionTitle}>No output yet</Text>
            <Text style={styles.helperText}>Send the first instruction to open the stream.</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.composerShell}>
        <View style={styles.composerControlStrip}>
          <Pressable
            disabled={
              !selectedThread ||
              !isConnected ||
              busyAction !== null ||
              isLoadingConversationCapabilities
            }
            onPress={() => {
              void openConversationPicker("model");
            }}
            style={[
              styles.composerControlButton,
              (!selectedThread ||
                !isConnected ||
                busyAction !== null ||
                isLoadingConversationCapabilities) &&
                styles.buttonDisabled,
            ]}
          >
            <Text numberOfLines={1} style={styles.composerControlValue}>
              {selectedThread?.model ?? FALLBACK_MODEL}
            </Text>
          </Pressable>
          <Pressable
            disabled={
              !selectedThread ||
              !isConnected ||
              busyAction !== null ||
              isLoadingConversationCapabilities
            }
            onPress={() => {
              void openConversationPicker("access");
            }}
            style={[
              styles.composerControlButton,
              styles.composerControlButtonAccess,
              (!selectedThread ||
                !isConnected ||
                busyAction !== null ||
                isLoadingConversationCapabilities) &&
                styles.buttonDisabled,
            ]}
          >
            <Text numberOfLines={1} style={styles.composerControlValue}>
              {selectedThread?.runtimeMode === "approval-required" ? "ASK" : "FULL"}
            </Text>
          </Pressable>
        </View>
        <Text
          style={[
            styles.composerControlHint,
            selectedConversationProviderStatus?.status === "warning" &&
              styles.composerControlHintWarn,
            selectedConversationProviderStatus?.status === "error" &&
              styles.composerControlHintError,
          ]}
        >
          {isLoadingConversationCapabilities
            ? "Loading backend capability map..."
            : `${selectedConversationProvider ? formatProviderLabel(selectedConversationProvider) : "Provider"} / ${selectedThread?.session?.status ?? "idle"}${selectedConversationProviderStatus?.message ? ` / ${selectedConversationProviderStatus.message}` : ` / ${formatModelSwitchBehavior(conversationCapabilities?.modelSwitch ?? null)}`}`}
        </Text>
        <TextInput
          multiline
          onChangeText={updateDraft}
          placeholder="Type the next instruction..."
          placeholderTextColor={TERMINAL_MUTED}
          style={styles.composerInput}
          textAlignVertical="top"
          value={draft}
        />

        <View style={styles.composerFooter}>
          <View style={styles.composerActionCluster}>
            <ActionButton
              compact
              disabled={!canInterrupt || busyAction !== null}
              emphasis="surface"
              label="Ctrl+C"
              onPress={() => {
                if (!selectedThread) {
                  return;
                }
                void interruptTurn({
                  threadId: selectedThread.id,
                  turnId: selectedThread.latestTurn?.turnId ?? undefined,
                });
              }}
            />
            <ActionButton
              compact
              disabled={!canStopSession || busyAction !== null}
              emphasis="surface"
              label="Kill"
              onPress={() => {
                if (!selectedThread) {
                  return;
                }
                void stopSession({ threadId: selectedThread.id });
              }}
            />
          </View>
          <View style={styles.composerRunAction}>
            <ActionButton
              disabled={!selectedThread || !draft.trim() || !isConnected || busyAction !== null}
              label="Run"
              onPress={() => {
                void handleSend();
              }}
            />
          </View>
        </View>
      </View>
    </View>
  );

  const renderConversationPickerModal = () => {
    if (!selectedThread || conversationPickerMode === null) {
      return null;
    }

    const rows =
      conversationPickerMode === "model"
        ? currentModelOptions.map((option) => ({
            key: option.slug,
            title: option.name,
            meta: option.slug === option.name ? null : option.slug,
            current: option.slug === selectedThread.model,
            available: option.available,
            reason: option.reason ?? null,
            onPress: () => {
              void handleSelectConversationModel(option.slug);
            },
          }))
        : currentRuntimeModeOptions.map((option) => ({
            key: option.mode,
            title: formatRuntimeModeLabel(option.mode),
            meta:
              option.mode === "full-access"
                ? "Bypass permission prompts for tools and file changes."
                : "Require approval before tools and file mutations run.",
            current: option.mode === selectedThread.runtimeMode,
            available: option.granted,
            reason: option.reason ?? null,
            onPress: () => {
              void handleSelectConversationRuntimeMode(option.mode);
            },
          }));

    return (
      <View
        style={[
          styles.conversationPickerCard,
          {
            maxHeight: conversationPickerHeight,
            width: conversationPickerWidth,
          },
        ]}
      >
        <View style={styles.projectPickerHeader}>
          <Text style={styles.panelEyebrow}>
            {selectedConversationProvider
              ? formatProviderLabel(selectedConversationProvider)
              : "Conversation"}
          </Text>
          <Text style={styles.panelTitle}>{conversationPickerTitle}</Text>
          <Text style={styles.panelSubtitle}>{conversationPickerSubtitle}</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.projectPickerScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.projectPickerPathPanel}>
            <Text style={styles.projectPickerPathLabel}>
              {isLoadingConversationCapabilities ? "Loading" : "Selected session"}
            </Text>
            <Text style={styles.projectPickerPathValue}>
              {isLoadingConversationCapabilities
                ? "Reading the backend capability map for this conversation."
                : getThreadDisplayTitle(selectedThread)}
            </Text>
          </View>

          <View style={styles.selectionList}>
            {!isLoadingConversationCapabilities && rows.length > 0 ? (
              rows.map((row) => (
                <Pressable
                  key={row.key}
                  disabled={!row.available || busyAction !== null}
                  onPress={row.onPress}
                  style={[
                    styles.selectionRow,
                    row.current && styles.selectionRowCurrent,
                    (!row.available || busyAction !== null) && styles.buttonDisabled,
                  ]}
                >
                  <View style={styles.selectionRowCopy}>
                    <View style={styles.selectionRowHeading}>
                      <Text style={styles.selectionRowTitle}>{row.title}</Text>
                      {row.current ? (
                        <Text style={styles.selectionRowCurrentTag}>Current</Text>
                      ) : null}
                    </View>
                    {row.meta ? <Text style={styles.selectionRowMeta}>{row.meta}</Text> : null}
                    {row.reason ? (
                      <Text style={styles.selectionRowReason}>{row.reason}</Text>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.selectionRowStatus,
                      row.available
                        ? styles.selectionRowStatusReady
                        : styles.selectionRowStatusBlocked,
                    ]}
                  >
                    {row.available ? "Ready" : "Blocked"}
                  </Text>
                </Pressable>
              ))
            ) : (
              <Text style={styles.helperText}>
                {isLoadingConversationCapabilities
                  ? "Loading options..."
                  : "No backend options are available for this session."}
              </Text>
            )}
          </View>
        </ScrollView>

        <View style={styles.projectPickerFooter}>
          <ActionButton emphasis="secondary" label="Close" onPress={closeConversationPicker} />
        </View>
      </View>
    );
  };

  const renderSettingsPanel = () => (
    <SafeAreaView style={styles.floatingPanelSafeArea} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.floatingPanelScrollContent}>
        <View style={styles.floatingPanelHeader}>
          <Text style={styles.panelEyebrow}>Config</Text>
          <Text style={styles.panelTitle}>Server + harness</Text>
          <Text style={styles.panelSubtitle}>
            Connection and provider controls live here so the left rail stays focused on roots and
            sessions.
          </Text>
        </View>

        <View style={styles.settingsSection}>
          <Text style={styles.sectionEyebrow}>Socket</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => updateConnectionSettings({ serverUrl: value })}
            placeholder="ws://192.168.2.124:3773"
            placeholderTextColor={TERMINAL_MUTED}
            style={styles.input}
            value={connectionSettings.serverUrl}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => updateConnectionSettings({ authToken: value })}
            placeholder="Optional auth token"
            placeholderTextColor={TERMINAL_MUTED}
            secureTextEntry
            style={styles.input}
            value={connectionSettings.authToken}
          />
          <View style={styles.switchRow}>
            <Text style={styles.metaValue}>Auto-connect</Text>
            <Switch
              onValueChange={(value) => {
                updateConnectionSettings({ autoConnect: value });
              }}
              trackColor={{ false: TERMINAL_BORDER, true: TERMINAL_ACCENT_SOFT }}
              value={connectionSettings.autoConnect}
            />
          </View>

          <View style={styles.inlineButtonRow}>
            <ActionButton
              disabled={!settingsReady || busyAction !== null}
              label={isConnected ? "Reconnect" : "Connect"}
              onPress={() => {
                void connect();
              }}
            />
            <ActionButton
              disabled={!isConnected}
              emphasis="secondary"
              label="Disconnect"
              onPress={disconnect}
            />
          </View>
        </View>

        <View style={styles.settingsSection}>
          <Text style={styles.sectionEyebrow}>State</Text>
          <MetaRow accent label="Connection" value={formatConnectionLabel(status)} />
          <MetaRow label="Resolved URL" value={resolvedWebSocketUrl ?? "Unavailable"} />
          <MetaRow label="Server cwd" value={serverConfig?.cwd ?? welcome?.cwd ?? "Unavailable"} />
          <MetaRow label="Snapshot sequence" value={snapshotSequenceLabel} />
        </View>

        <View style={styles.settingsSection}>
          <Text style={styles.sectionEyebrow}>Harness</Text>
          {providers.length > 0 ? (
            providers.map((provider) => (
              <View key={provider.provider} style={styles.providerRow}>
                <View style={styles.providerCopy}>
                  <Text style={styles.providerTitle}>{formatProviderLabel(provider.provider)}</Text>
                  <Text style={styles.providerMeta}>
                    {provider.message ??
                      `${provider.authStatus} / ${provider.available ? "available" : "unavailable"}`}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.providerStatus,
                    provider.status === "warning" && styles.providerStatusWarning,
                    provider.status === "error" && styles.providerStatusError,
                  ]}
                >
                  {provider.status}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.helperText}>No provider heartbeat has been reported yet.</Text>
          )}
        </View>

        <ActionButton emphasis="secondary" label="Close config" onPress={closeSettingsPanel} />
      </ScrollView>
    </SafeAreaView>
  );

  const renderProjectBuilderModal = () => (
    <View
      style={[
        styles.projectPickerCard,
        {
          maxHeight: projectPickerHeight,
          width: projectPickerWidth,
        },
      ]}
    >
      <View style={styles.projectPickerHeader}>
        <Text style={styles.panelEyebrow}>Mount</Text>
        <Text style={styles.panelTitle}>Choose a server folder</Text>
        <Text style={styles.panelSubtitle}>
          Browse the backend filesystem and mount the selected folder as a project root.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.projectPickerScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.projectPickerPathPanel}>
          <Text style={styles.projectPickerPathLabel}>Current folder</Text>
          <Text style={styles.projectPickerPathValue}>
            {(directoryCwd ?? serverDirectoryHint) || "Loading server folders..."}
          </Text>
        </View>

        <View style={styles.inlineButtonRow}>
          <ActionButton
            compact
            disabled={!serverDirectoryHint.trim() || busyAction !== null}
            emphasis="secondary"
            label="Server cwd"
            onPress={() => {
              void handleResetProjectDirectory();
            }}
          />
          <ActionButton
            compact
            disabled={!directoryCwd?.trim() || busyAction !== null}
            emphasis="ghost"
            label="Parent"
            onPress={() => {
              void handleOpenParentDirectory();
            }}
          />
        </View>

        <View style={[styles.directoryBrowser, styles.projectPickerBrowser]}>
          {directoryEntries.length > 0 ? (
            directoryEntries.map((entry) => {
              const nextPath = directoryCwd
                ? joinDirectoryPath(directoryCwd, entry.path)
                : entry.path;
              return (
                <Pressable
                  key={nextPath}
                  onPress={() => {
                    void loadDirectory(nextPath);
                  }}
                  style={styles.directoryRow}
                >
                  <Text numberOfLines={1} style={styles.directoryTitle}>
                    {entry.path}
                  </Text>
                  <Text style={styles.directoryMeta}>dir</Text>
                </Pressable>
              );
            })
          ) : (
            <View style={styles.projectPickerEmptyState}>
              <Text style={styles.helperText}>
                {directoryCwd
                  ? "No child folders here. You can mount this folder directly."
                  : "Loading server folders..."}
              </Text>
            </View>
          )}
        </View>

        {directoryTruncated ? (
          <Text style={styles.helperText}>Directory index truncated to 200 entries.</Text>
        ) : null}

        <View style={styles.projectPickerFieldGroup}>
          <Text style={styles.navSectionLabel}>New folder</Text>
          <View style={styles.projectPickerInputRow}>
            <TextInput
              onChangeText={setNewFolderName}
              placeholder="New folder"
              placeholderTextColor={TERMINAL_MUTED}
              style={[styles.input, styles.projectPickerInput]}
              value={newFolderName}
            />
            <View style={styles.projectPickerActionCell}>
              <ActionButton
                disabled={!directoryCwd || !newFolderName.trim() || busyAction !== null}
                emphasis="ghost"
                label="mkdir"
                onPress={() => {
                  void handleCreateFolder();
                }}
              />
            </View>
          </View>
        </View>

        <View style={styles.projectPickerFieldGroup}>
          <Text style={styles.navSectionLabel}>Project alias</Text>
          <TextInput
            onChangeText={setProjectTitleDraft}
            placeholder="Project alias"
            placeholderTextColor={TERMINAL_MUTED}
            style={styles.input}
            value={projectTitleDraft}
          />
        </View>
      </ScrollView>

      <View style={styles.projectPickerFooter}>
        <ActionButton emphasis="secondary" label="Cancel" onPress={closeProjectBuilder} />
        <ActionButton
          disabled={!directoryCwd?.trim() || busyAction !== null}
          label="Mount folder"
          onPress={() => {
            void handleCreateProject();
          }}
        />
      </View>
    </View>
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
        {/* oxlint-disable-next-line react/style-prop-object */}
        <StatusBar style="light" />
        <View style={styles.shellBackground}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.keyboardAvoider}
          >
            <View style={styles.shellLayout}>
              <View style={styles.topBar}>
                {!sidebarPersistent ? (
                  <ActionButton emphasis="secondary" label="Tree" onPress={openNavMenu} />
                ) : (
                  <View style={styles.topBarSpacer} />
                )}

                <View style={styles.topBarCopy}>
                  <Text style={styles.topBarEyebrow}>MIKROCODE</Text>
                  <Text numberOfLines={1} style={styles.topBarTitle}>
                    {topBarPrimary}
                  </Text>
                  <Text numberOfLines={1} style={styles.topBarSubtitle}>
                    {topBarSecondary}
                  </Text>
                </View>

                <ActionButton emphasis="ghost" label="Config" onPress={openSettingsPanel} />
              </View>

              <View style={styles.appFrame}>
                {sidebarPersistent ? (
                  <View style={[styles.sidebarFrame, { width: sidebarWidth }]}>
                    {renderSidebar()}
                  </View>
                ) : null}

                <View style={styles.workspaceFrame}>
                  <Animated.View
                    style={[
                      styles.workspaceSurface,
                      {
                        opacity: workspaceOpacity,
                        transform: [{ translateY: workspaceTranslateY }],
                      },
                    ]}
                  >
                    {selectedThread ? renderConversation() : renderHome()}
                  </Animated.View>
                </View>
              </View>
            </View>

            {!sidebarPersistent && navMenuOpen ? (
              <View pointerEvents="box-none" style={styles.overlayRoot}>
                <View style={styles.overlayRow}>
                  <Animated.View
                    style={[
                      styles.overlayPanelLeft,
                      {
                        width: sidebarWidth,
                        transform: [{ translateX: navTranslateX }],
                      },
                    ]}
                    {...navPanelPanResponder.panHandlers}
                  >
                    {renderSidebar()}
                  </Animated.View>
                  <Pressable onPress={closeNavMenu} style={styles.overlayBackdrop} />
                </View>
              </View>
            ) : null}

            {settingsOpen ? (
              <View pointerEvents="box-none" style={styles.overlayRoot}>
                <View style={styles.overlayRow}>
                  <Pressable onPress={closeSettingsPanel} style={styles.overlayBackdrop} />
                  <Animated.View
                    style={[
                      styles.overlayPanelRight,
                      {
                        width: floatingPanelWidth,
                        transform: [{ translateX: settingsTranslateX }],
                      },
                    ]}
                    {...settingsPanelPanResponder.panHandlers}
                  >
                    {renderSettingsPanel()}
                  </Animated.View>
                </View>
              </View>
            ) : null}

            {conversationPickerMode ? (
              <View pointerEvents="box-none" style={styles.overlayRoot}>
                <Pressable onPress={closeConversationPicker} style={styles.modalBackdrop} />
                <View pointerEvents="box-none" style={styles.modalCenterWrap}>
                  {renderConversationPickerModal()}
                </View>
              </View>
            ) : null}

            {projectBuilderOpen ? (
              <View pointerEvents="box-none" style={styles.overlayRoot}>
                <Pressable onPress={closeProjectBuilder} style={styles.modalBackdrop} />
                <View pointerEvents="box-none" style={styles.modalCenterWrap}>
                  {renderProjectBuilderModal()}
                </View>
              </View>
            ) : null}
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: TERMINAL_BG,
  },
  shellBackground: {
    flex: 1,
    backgroundColor: TERMINAL_BG,
  },
  keyboardAvoider: {
    flex: 1,
  },
  shellLayout: {
    flex: 1,
  },
  appFrame: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    padding: 8,
    paddingTop: 6,
  },
  sidebarFrame: {
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    overflow: "hidden",
  },
  sidebarRoot: {
    backgroundColor: TERMINAL_PANEL,
    flex: 1,
  },
  sidebarSafeArea: {
    flex: 1,
  },
  sidebarHeader: {
    borderBottomColor: TERMINAL_BORDER,
    borderBottomWidth: 1,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  brandMark: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  sidebarHeaderCopy: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 14,
  },
  sidebarActions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  sidebarScrollContent: {
    gap: 12,
    padding: 12,
    paddingBottom: 18,
  },
  navSection: {
    gap: 8,
  },
  navSectionLabel: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  projectGroup: {
    gap: 2,
  },
  projectRow: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  projectRowActive: {
    backgroundColor: TERMINAL_PANEL_ALT,
    borderColor: TERMINAL_ACCENT,
  },
  projectCopy: {
    flex: 1,
  },
  projectSelectButton: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
  },
  projectTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    fontWeight: "700",
  },
  projectCount: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    fontWeight: "700",
  },
  projectInlineActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  projectHeaderDestructiveAction: {
    borderLeftColor: TERMINAL_BORDER,
    borderLeftWidth: 1,
    marginLeft: 2,
    paddingLeft: 8,
    paddingVertical: 4,
  },
  inlineDestructiveActionLabel: {
    color: "#ff8d8d",
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  threadGroup: {
    gap: 1,
    paddingLeft: 12,
  },
  threadRow: {
    alignItems: "center",
    borderLeftColor: TERMINAL_BORDER,
    borderLeftWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  threadRowActive: {
    backgroundColor: TERMINAL_ACCENT_SOFT,
    borderLeftColor: TERMINAL_ACCENT,
  },
  threadRowCopy: { flex: 1 },
  threadTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    fontWeight: "500",
  },
  statusPulse: {
    backgroundColor: "#3a4764",
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  statusPulseLive: {
    backgroundColor: TERMINAL_ACCENT,
  },
  statusPulseError: {
    backgroundColor: "#ff7676",
  },
  emptyThreadsCopy: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 14,
  },
  emptyProjectsCopy: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    lineHeight: 16,
  },
  helperText: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 15,
  },
  input: {
    backgroundColor: TERMINAL_BG,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  inlineButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  directoryBrowser: {
    backgroundColor: TERMINAL_PANEL_ALT,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    gap: 0,
    maxHeight: 220,
    padding: 0,
  },
  directoryRow: {
    backgroundColor: "transparent",
    borderBottomColor: TERMINAL_BORDER,
    borderBottomWidth: 1,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  directoryTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    fontWeight: "600",
  },
  directoryMeta: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    textTransform: "uppercase",
  },
  projectPickerCard: {
    backgroundColor: TERMINAL_PANEL,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    overflow: "hidden",
  },
  conversationPickerCard: {
    backgroundColor: TERMINAL_PANEL,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    overflow: "hidden",
  },
  projectPickerHeader: {
    borderBottomColor: TERMINAL_BORDER,
    borderBottomWidth: 1,
    gap: 6,
    padding: 12,
  },
  projectPickerScrollContent: {
    gap: 10,
    padding: 12,
  },
  projectPickerPathPanel: {
    backgroundColor: TERMINAL_BG,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  projectPickerPathLabel: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  projectPickerPathValue: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    lineHeight: 18,
  },
  projectPickerBrowser: {
    maxHeight: 300,
    minHeight: 240,
  },
  projectPickerEmptyState: {
    justifyContent: "center",
    minHeight: 120,
    padding: 10,
  },
  projectPickerFieldGroup: {
    gap: 8,
  },
  projectPickerInputRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  projectPickerInput: {
    flex: 1,
  },
  projectPickerActionCell: {
    minWidth: 112,
  },
  projectPickerFooter: {
    borderTopColor: TERMINAL_BORDER,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    padding: 12,
  },
  workspaceFrame: {
    flex: 1,
    gap: 6,
  },
  topBar: {
    alignItems: "center",
    backgroundColor: TERMINAL_BG,
    borderBottomColor: TERMINAL_BORDER,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  topBarSpacer: {
    width: 72,
  },
  topBarCopy: {
    flex: 1,
    gap: 1,
  },
  topBarEyebrow: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  topBarTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    fontWeight: "700",
  },
  topBarSubtitle: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
  },
  workspaceSurface: {
    backgroundColor: TERMINAL_PANEL_ALT,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    flex: 1,
    overflow: "hidden",
  },
  workspaceScrollContent: {
    gap: 10,
    padding: 10,
    paddingBottom: 14,
  },
  recentSection: {
    gap: 6,
  },
  recentSectionActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  inlineSubtleAction: {
    paddingVertical: 6,
  },
  inlineSubtleActionLabel: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  recentRail: {
    backgroundColor: TERMINAL_PANEL,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    overflow: "hidden",
  },
  swipeRowShell: {
    backgroundColor: TERMINAL_PANEL,
    minHeight: 44,
    overflow: "hidden",
  },
  swipeRowAction: {
    alignItems: "flex-end",
    backgroundColor: "#101924",
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: 12,
    position: "absolute",
    right: 0,
    top: 0,
    width: 132,
  },
  swipeRowActionButton: {
    alignItems: "center",
    backgroundColor: TERMINAL_ACCENT_SOFT,
    borderColor: TERMINAL_ACCENT,
    borderWidth: 1,
    minWidth: 84,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  swipeRowActionLabel: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  swipeRowContent: {
    backgroundColor: TERMINAL_PANEL,
  },
  recentRow: {
    alignItems: "center",
    borderBottomColor: TERMINAL_BORDER,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  recentRowAccent: {
    alignSelf: "stretch",
    backgroundColor: TERMINAL_ACCENT,
    width: 2,
  },
  recentRowCopy: {
    flex: 1,
    gap: 2,
  },
  recentRowTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    fontWeight: "700",
  },
  recentRowMeta: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
  },
  recentRowTime: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    maxWidth: 92,
    textAlign: "right",
  },
  metricLabel: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  errorBanner: {
    backgroundColor: "#1a0d13",
    borderColor: "#592437",
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  errorTitle: {
    color: "#ff8d8d",
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 14,
    fontWeight: "700",
  },
  errorText: {
    color: "#f2b9c3",
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    lineHeight: 18,
  },
  homeGrid: {
    gap: 10,
  },
  homeGridWide: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  flatSection: {
    backgroundColor: TERMINAL_PANEL,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    minWidth: 260,
    padding: 10,
  },
  sectionHeadingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  sectionSubtleText: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
  },
  sectionEyebrow: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 16,
    fontWeight: "700",
  },
  compactList: {
    gap: 0,
  },
  providerRow: {
    alignItems: "center",
    borderTopColor: TERMINAL_BORDER,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingVertical: 8,
  },
  providerCopy: {
    flex: 1,
    gap: 2,
  },
  providerTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    fontWeight: "700",
  },
  providerMeta: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 15,
  },
  providerStatus: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  providerStatusWarning: {
    color: "#f7c56a",
  },
  providerStatusError: {
    color: "#ff8d8d",
  },
  metaRow: {
    borderTopColor: TERMINAL_BORDER,
    borderTopWidth: 1,
    gap: 3,
    paddingVertical: 7,
  },
  metaLabel: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  metaValue: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    lineHeight: 17,
  },
  metaValueAccent: {
    color: TERMINAL_ACCENT,
    fontWeight: "700",
  },
  compactThreadRow: {
    borderTopColor: TERMINAL_BORDER,
    borderTopWidth: 1,
    gap: 3,
    paddingVertical: 8,
  },
  compactThreadTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    fontWeight: "600",
  },
  compactThreadMeta: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
  },
  compactThreadStatus: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  threadShell: {
    flex: 1,
  },
  threadHeader: {
    backgroundColor: TERMINAL_PANEL,
    borderBottomColor: TERMINAL_BORDER,
    borderBottomWidth: 1,
    gap: 8,
    padding: 10,
  },
  threadHeaderCopy: {
    gap: 4,
  },
  threadHeaderEyebrow: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  threadHeaderTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  },
  threadHeaderMeta: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 16,
  },
  threadControlStrip: {
    flexDirection: "row",
    gap: 8,
  },
  threadControlButton: {
    backgroundColor: TERMINAL_BG,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  threadControlLabel: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  threadControlValue: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    fontWeight: "700",
  },
  threadControlHint: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 15,
  },
  threadControlHintWarn: {
    color: "#f7c56a",
  },
  threadControlHintError: {
    color: "#ff8d8d",
  },
  threadStatRow: {
    backgroundColor: TERMINAL_BG,
    borderTopColor: TERMINAL_BORDER,
    borderTopWidth: 1,
    flexDirection: "row",
    marginTop: 2,
  },
  threadStatItem: {
    borderRightColor: TERMINAL_BORDER,
    borderRightWidth: 1,
    flex: 1,
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  threadStatValue: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    fontWeight: "600",
  },
  threadHeaderActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  messagesScroll: {
    flex: 1,
  },
  messagesScrollContent: {
    gap: 4,
    padding: 8,
    paddingBottom: 12,
  },
  messageWrap: {
    maxWidth: "100%",
  },
  messageWrapUser: {
    alignSelf: "flex-end",
  },
  messageWrapAssistant: {
    alignSelf: "flex-start",
  },
  messageRow: {
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  messageRowUser: {
    backgroundColor: "#0d1e18",
    borderColor: "#1f6048",
  },
  messageRowAssistant: {
    backgroundColor: "#09101f",
    borderColor: "#24324f",
  },
  messageText: {
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    lineHeight: 18,
  },
  messageTextUser: {
    color: "#ddffed",
  },
  messageTextAssistant: {
    color: TERMINAL_TEXT,
  },
  messageMetaReveal: {
    alignSelf: "flex-start",
    backgroundColor: TERMINAL_BG,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    marginTop: 3,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  messageMetaRevealUser: {
    alignSelf: "flex-end",
    borderColor: "#1f6048",
  },
  messageMetaRevealAssistant: {
    alignSelf: "flex-start",
    borderColor: "#24324f",
  },
  messageMetaRevealText: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
  },
  emptyConversation: {
    alignItems: "flex-start",
    gap: 6,
    paddingVertical: 10,
  },
  composerShell: {
    backgroundColor: TERMINAL_PANEL,
    borderTopColor: TERMINAL_BORDER,
    borderTopWidth: 1,
    gap: 5,
    padding: 8,
  },
  composerControlStrip: {
    flexDirection: "row",
    gap: 6,
  },
  composerControlButton: {
    backgroundColor: TERMINAL_BG,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  composerControlButtonAccess: {
    flex: 0,
    minWidth: 68,
  },
  composerControlValue: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  composerControlHint: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    lineHeight: 13,
  },
  composerControlHintWarn: {
    color: "#f7c56a",
  },
  composerControlHintError: {
    color: "#ff8d8d",
  },
  composerInput: {
    backgroundColor: TERMINAL_BG,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    minHeight: 68,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  composerFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  composerActionCluster: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  composerRunAction: {
    minWidth: 112,
  },
  buttonBase: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonCompact: {
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  buttonPrimary: {
    backgroundColor: TERMINAL_ACCENT_SOFT,
    borderColor: TERMINAL_ACCENT,
  },
  buttonSecondary: {
    backgroundColor: TERMINAL_PANEL_ALT,
  },
  buttonGhost: {
    backgroundColor: "transparent",
  },
  buttonSurface: {
    backgroundColor: TERMINAL_BG,
  },
  buttonDisabled: {
    opacity: 0.42,
  },
  buttonLabel: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  buttonLabelPrimary: {
    color: TERMINAL_ACCENT,
  },
  buttonLabelSurface: {
    color: TERMINAL_TEXT,
  },
  buttonLabelSecondary: {
    color: TERMINAL_TEXT,
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
  },
  overlayRow: {
    flex: 1,
    flexDirection: "row",
  },
  overlayBackdrop: {
    backgroundColor: "rgba(5, 8, 22, 0.74)",
    flex: 1,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 8, 22, 0.82)",
  },
  modalCenterWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  overlayPanelLeft: {
    borderRightColor: TERMINAL_BORDER,
    borderRightWidth: 1,
  },
  overlayPanelRight: {
    borderLeftColor: TERMINAL_BORDER,
    borderLeftWidth: 1,
  },
  floatingPanelSafeArea: {
    backgroundColor: TERMINAL_PANEL,
    flex: 1,
  },
  floatingPanelScrollContent: {
    gap: 10,
    padding: 10,
    paddingBottom: 16,
  },
  floatingPanelHeader: {
    gap: 6,
  },
  panelEyebrow: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  panelTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 18,
    fontWeight: "700",
  },
  panelSubtitle: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 16,
  },
  settingsSection: {
    backgroundColor: TERMINAL_PANEL_ALT,
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
    gap: 10,
    padding: 10,
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  selectionList: {
    borderColor: TERMINAL_BORDER,
    borderWidth: 1,
  },
  selectionRow: {
    alignItems: "center",
    backgroundColor: TERMINAL_PANEL_ALT,
    borderBottomColor: TERMINAL_BORDER,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  selectionRowCurrent: {
    backgroundColor: TERMINAL_ACCENT_SOFT,
    borderColor: TERMINAL_ACCENT,
  },
  selectionRowCopy: {
    flex: 1,
    gap: 3,
  },
  selectionRowHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  selectionRowTitle: {
    color: TERMINAL_TEXT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 13,
    fontWeight: "700",
  },
  selectionRowCurrentTag: {
    color: TERMINAL_ACCENT,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  selectionRowMeta: {
    color: TERMINAL_MUTED,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 15,
  },
  selectionRowReason: {
    color: "#f2b9c3",
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 11,
    lineHeight: 15,
  },
  selectionRowStatus: {
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  selectionRowStatusReady: {
    color: TERMINAL_ACCENT,
  },
  selectionRowStatusBlocked: {
    color: "#ff8d8d",
  },
});
