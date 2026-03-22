import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Keyboard,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CLAUDE_CODE_EFFORT_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
  DEFAULT_REASONING_EFFORT_BY_PROVIDER,
} from "@t3tools/contracts";
import type {
  AssistantDeliveryMode,
  ClaudeCodeEffort,
  CodexReasoningEffort,
  GitBranch,
  GitListBranchesResult,
  GitStatusResult,
  OrchestrationMessage,
  OrchestrationProject,
  OrchestrationThread,
  OrchestrationThreadActivity,
  ProviderApprovalDecision,
  ProjectEntry,
  ProviderReasoningEffort,
  RuntimeMode,
  ServerConversationCapabilities,
} from "@t3tools/contracts";

import { MOBILE_DEFAULT_MODEL } from "./defaults";
import { type ConnectionSettings } from "./storage";
import {
  FLEXOKI_DARK_ACCENT_OPTIONS,
  FLEXOKI_DARK_NEUTRAL_OPTIONS,
  resolveAppTheme,
  type AppTheme,
  type AppThemeAccent,
  type AppThemeNeutral,
} from "./theme";
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
type ComposerPanelMode = "model" | "reasoning" | "git";
type ThreadTurnPreference = {
  readonly reasoningEffort: ProviderReasoningEffort | null;
  readonly assistantDeliveryMode: AssistantDeliveryMode;
};
type FeatherIconName = ComponentProps<typeof Feather>["name"];

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

function formatReasoningEffortLabel(effort: ProviderReasoningEffort | null) {
  return effort ? effort.toUpperCase() : "AUTO";
}

function formatRuntimeModeIcon(mode: RuntimeMode): FeatherIconName {
  return mode === "full-access" ? "unlock" : "lock";
}

function formatAssistantDeliveryModeIcon(mode: AssistantDeliveryMode): FeatherIconName {
  return mode === "streaming" ? "chevrons-right" : "clock";
}

function getThemeNeutralLabel(base: AppThemeNeutral) {
  return (
    FLEXOKI_DARK_NEUTRAL_OPTIONS.find((option) => option.id === base)?.label ??
    FLEXOKI_DARK_NEUTRAL_OPTIONS[0].label
  );
}

function getThemeAccentLabel(accent: AppThemeAccent) {
  return (
    FLEXOKI_DARK_ACCENT_OPTIONS.find((option) => option.id === accent)?.label ??
    FLEXOKI_DARK_ACCENT_OPTIONS[0].label
  );
}

function formatGitBranchLabel(branch: string | null | undefined) {
  const trimmed = branch?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Detached HEAD";
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

const GENERATED_THREAD_STAMP_PATTERN =
  /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{1,2}:\d{2}(?:\s?(?:AM|PM|A\.M\.|P\.M\.|a\.m\.|p\.m\.))?$/;

function getThreadDisplayTitle(thread: OrchestrationThread | null) {
  const title = thread?.title.trim();
  if (!title || title.toLowerCase() === "new thread") {
    return "Conversation";
  }
  return title;
}

function getRecentThreadDisplayTitle(thread: OrchestrationThread, projectTitle: string) {
  const displayTitle = getThreadDisplayTitle(thread);
  const normalizedProjectTitle = projectTitle.trim();
  if (!normalizedProjectTitle) {
    return displayTitle;
  }

  const trailingSegment = displayTitle.slice(normalizedProjectTitle.length).trimStart();
  if (
    displayTitle.toLowerCase().startsWith(normalizedProjectTitle.toLowerCase()) &&
    GENERATED_THREAD_STAMP_PATTERN.test(trailingSegment)
  ) {
    return normalizedProjectTitle;
  }

  return displayTitle;
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

function sortActivities(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  return sortReadonlyArray(activities, (left, right) => {
    if (
      left.sequence !== undefined &&
      right.sequence !== undefined &&
      left.sequence !== right.sequence
    ) {
      return left.sequence - right.sequence;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    return left.id.localeCompare(right.id);
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readPayloadString(payload: unknown, key: string) {
  const record = asRecord(payload);
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function formatApprovalRequestKindLabel(kind: string | null) {
  if (kind === "command") {
    return "Command";
  }
  if (kind === "file-read") {
    return "File read";
  }
  if (kind === "file-change") {
    return "File change";
  }
  return "Approval";
}

type PendingApprovalRequest = {
  readonly requestId: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly requestKind: string | null;
};

function findPendingApprovalRequest(
  thread: OrchestrationThread | null,
): PendingApprovalRequest | null {
  if (!thread) {
    return null;
  }

  const resolvedRequestIds = new Set<string>();

  for (const activity of sortActivities(thread.activities).toReversed()) {
    const requestId = readPayloadString(activity.payload, "requestId");
    if (!requestId) {
      continue;
    }

    if (activity.kind === "approval.resolved") {
      resolvedRequestIds.add(requestId);
      continue;
    }

    if (activity.kind !== "approval.requested" || resolvedRequestIds.has(requestId)) {
      continue;
    }

    return {
      requestId,
      summary: activity.summary,
      detail: readPayloadString(activity.payload, "detail"),
      requestKind: readPayloadString(activity.payload, "requestKind"),
    };
  }

  return null;
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
  const { styles } = useAppThemeContext();
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

function IconButton({
  accessibilityLabel,
  disabled = false,
  icon,
  onPress,
}: {
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly icon: FeatherIconName;
  readonly onPress: () => void;
}) {
  const { styles, theme } = useAppThemeContext();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconButton, disabled && styles.buttonDisabled]}
    >
      <Feather
        accessibilityElementsHidden
        color={theme.text}
        importantForAccessibility="no-hide-descendants"
        name={icon}
        size={16}
      />
    </Pressable>
  );
}

function SidebarNavButton({
  icon,
  label,
  onPress,
}: {
  readonly icon: FeatherIconName;
  readonly label: string;
  readonly onPress: () => void;
}) {
  const { styles, theme } = useAppThemeContext();
  return (
    <Pressable onPress={onPress} style={styles.sidebarNavButton}>
      <Feather color={theme.text} name={icon} size={16} />
      <Text style={styles.sidebarNavButtonLabel}>{label}</Text>
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
  const { styles } = useAppThemeContext();
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
  actionDisabled = false,
  actionIcon = "trash-2",
  children,
  onAction,
  onPress,
}: {
  readonly actionDisabled?: boolean;
  readonly actionIcon?: FeatherIconName;
  readonly children: ReactNode;
  readonly onAction: () => void | Promise<void>;
  readonly onPress: () => void;
}) {
  const { styles, theme } = useAppThemeContext();
  const { width } = useWindowDimensions();
  const translateX = useRef(new Animated.Value(0)).current;
  const dismissTranslateX = -Math.max(width + 48, 220);
  const actionOpacity = translateX.interpolate({
    inputRange: [dismissTranslateX, -52, -14, 0],
    outputRange: [1, 1, 0.7, 0],
    extrapolate: "clamp",
  });
  const actionScale = translateX.interpolate({
    inputRange: [dismissTranslateX, -52, -14, 0],
    outputRange: [1, 1, 0.95, 0.88],
    extrapolate: "clamp",
  });

  const animateBack = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
      mass: 0.9,
    }).start();
  };

  const triggerAction = () => {
    if (actionDisabled) {
      animateBack();
      return;
    }
    Animated.timing(translateX, {
      toValue: dismissTranslateX,
      duration: 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        try {
          void Promise.resolve(onAction()).catch(() => {
            animateBack();
          });
        } catch {
          animateBack();
        }
      }
    });
  };

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) =>
      Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderMove: (_, gestureState) => {
      translateX.setValue(Math.min(0, Math.max(gestureState.dx, dismissTranslateX)));
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx <= -72) {
        triggerAction();
        return;
      }
      animateBack();
    },
    onPanResponderTerminate: animateBack,
  });

  return (
    <View style={styles.swipeRowShell}>
      <Animated.View
        style={[
          styles.swipeRowAction,
          {
            opacity: actionOpacity,
          },
        ]}
      >
        <Pressable
          disabled={actionDisabled}
          onPress={triggerAction}
          style={[styles.swipeRowActionButton, actionDisabled && styles.buttonDisabled]}
        >
          <Animated.View
            style={[
              styles.swipeRowActionIconWrap,
              {
                transform: [{ scale: actionScale }],
              },
            ]}
          >
            <Feather color={theme.danger} name={actionIcon} size={16} />
          </Animated.View>
        </Pressable>
      </Animated.View>
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

function AppShellContent() {
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
    deleteThread,
    errorMessage,
    gitCheckout,
    gitCreateBranch,
    gitListBranches,
    gitPull,
    gitRunStackedAction,
    gitStatus,
    getConversationCapabilities,
    interruptTurn,
    isRefreshingSnapshot,
    lastPushSequence,
    refreshSnapshot,
    respondToApproval,
    resolvedWebSocketUrl,
    searchDirectory,
    sendTurn,
    serverConfig,
    setConnectionSettings,
    settingsReady,
    snapshot,
    status,
    stopSession,
    updateThreadBranch,
    updateThreadModel,
    updateThreadRuntimeMode,
    welcome,
  } = useBackendConnection();
  const theme = resolveAppTheme({
    neutralBase: connectionSettings.themeBase,
    accent: connectionSettings.themeAccent,
  });
  const styles = getStyles(theme);
  const themeContextValue = useMemo(() => ({ styles, theme }), [styles, theme]);
  const TERMINAL_BORDER = theme.border;
  const TERMINAL_MUTED = theme.muted;
  const TERMINAL_ACCENT = theme.accent;
  const TERMINAL_ACCENT_SOFT = theme.accentSoft;
  const insets = useSafeAreaInsets();

  const { height, width } = useWindowDimensions();
  const sidebarPersistent = width >= PERSISTENT_SIDEBAR_BREAKPOINT;
  const wideLayout = width >= WIDE_LAYOUT_BREAKPOINT;
  const sidebarWidth = sidebarPersistent ? Math.min(360, Math.max(286, width * 0.28)) : 340;
  const floatingPanelWidth = Math.min(380, Math.max(300, width - 26));
  const conversationPickerWidth = Math.min(560, Math.max(320, width - 24));
  const conversationPickerHeight = Math.min(540, Math.max(320, height - 40));
  const projectPickerWidth = Math.min(720, Math.max(320, width - 24));
  const projectPickerHeight = Math.min(640, Math.max(420, height - 24));
  const [androidKeyboardInset, setAndroidKeyboardInset] = useState(0);

  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [hiddenRecentThreadIds, setHiddenRecentThreadIds] = useState<string[]>([]);
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [threadTurnPreferences, setThreadTurnPreferences] = useState<
    Record<string, ThreadTurnPreference>
  >({});
  const [revealedMessageId, setRevealedMessageId] = useState<string | null>(null);
  const [projectBuilderOpen, setProjectBuilderOpen] = useState(false);
  const [projectBuilderRoot, setProjectBuilderRoot] = useState<string | null>(null);
  const [conversationPickerMode, setConversationPickerMode] = useState<ComposerPanelMode | null>(
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
  const [gitRepoStatus, setGitRepoStatus] = useState<GitStatusResult | null>(null);
  const [gitBranches, setGitBranches] = useState<GitListBranchesResult | null>(null);
  const [isLoadingGitState, setIsLoadingGitState] = useState(false);
  const [gitCommitMessageDraft, setGitCommitMessageDraft] = useState("");
  const [gitBranchNameDraft, setGitBranchNameDraft] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const navTranslateX = useRef(new Animated.Value(-sidebarWidth)).current;
  const settingsTranslateX = useRef(new Animated.Value(floatingPanelWidth)).current;
  const workspaceOpacity = useRef(new Animated.Value(1)).current;
  const workspaceTranslateY = useRef(new Animated.Value(0)).current;
  const messageMetaOpacity = useRef(new Animated.Value(0)).current;
  const messageMetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesScrollRef = useRef<ScrollView | null>(null);
  const waitingIndicatorMotion = useRef(new Animated.Value(0)).current;

  const allProjects = sortProjects(snapshot?.projects ?? []);
  const visibleProjectIds = new Set(allProjects.map((project) => project.id));
  const allThreads = sortThreads(snapshot?.threads ?? []).filter((thread) =>
    visibleProjectIds.has(thread.projectId),
  );
  const recentThreads = allThreads
    .filter((thread) => !hiddenRecentThreadIds.includes(thread.id))
    .slice(0, 8);
  const selectedThread = allThreads.find((thread) => thread.id === selectedThreadId) ?? null;
  const effectiveProjectId =
    selectedThread?.projectId ?? selectedProjectId ?? allProjects[0]?.id ?? null;
  const selectedProject = allProjects.find((project) => project.id === effectiveProjectId) ?? null;
  const selectedProjectThreads = selectedProject ? sortThreads(allThreads, selectedProject.id) : [];
  const messages = sortMessages(selectedThread?.messages ?? []);
  const highlightedAssistantMessageId =
    messages[messages.length - 1]?.role === "assistant" ? messages[messages.length - 1]?.id : null;
  const pendingApprovalRequest = findPendingApprovalRequest(selectedThread);
  const selectedThreadDisplayTitle = getThreadDisplayTitle(selectedThread);
  const draft = selectedThread ? (threadDrafts[selectedThread.id] ?? "") : "";
  const isConnected = status === "connected";
  const providers = serverConfig?.providers ?? [];
  const serverDirectoryHint =
    serverConfig?.cwd ?? welcome?.cwd ?? selectedProject?.workspaceRoot ?? "";
  const selectedThreadConversationId = selectedThread?.id ?? null;
  const selectedConversationProvider = resolveProviderForThread(selectedThread);
  const currentModelOptions =
    selectedThread && conversationCapabilities?.threadId === selectedThread.id
      ? conversationCapabilities.models
      : [];
  const selectedWorkspaceRoot =
    selectedThread?.worktreePath ?? selectedProject?.workspaceRoot ?? null;
  const selectedReasoningOptions: ReadonlyArray<ProviderReasoningEffort> =
    selectedConversationProvider === "codex"
      ? CODEX_REASONING_EFFORT_OPTIONS
      : selectedConversationProvider === "claudeAgent"
        ? CLAUDE_CODE_EFFORT_OPTIONS
        : [];
  const selectedThreadTurnPreference = selectedThread
    ? (() => {
        const stored = threadTurnPreferences[selectedThread.id];
        const defaultReasoning =
          selectedConversationProvider && selectedReasoningOptions.length > 0
            ? DEFAULT_REASONING_EFFORT_BY_PROVIDER[selectedConversationProvider]
            : null;
        const resolvedReasoning =
          stored?.reasoningEffort && selectedReasoningOptions.includes(stored.reasoningEffort)
            ? stored.reasoningEffort
            : defaultReasoning;
        return {
          reasoningEffort: resolvedReasoning,
          assistantDeliveryMode: stored?.assistantDeliveryMode ?? "buffered",
        } satisfies ThreadTurnPreference;
      })()
    : null;

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
  const conversationPickerTitle = conversationPickerMode === "model" ? "Switch model" : "";
  const conversationPickerSubtitle =
    conversationPickerMode === "model"
      ? formatModelSwitchBehavior(conversationCapabilities?.modelSwitch ?? null)
      : "";

  useEffect(() => {
    if (sidebarPersistent) {
      setNavMenuOpen(false);
      navTranslateX.setValue(-sidebarWidth);
    }
  }, [navTranslateX, sidebarPersistent, sidebarWidth]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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

  const scrollConversationToEnd = () => {
    messagesScrollRef.current?.scrollToEnd({ animated: true });
  };

  useEffect(() => {
    if (!selectedThreadConversationId) {
      return;
    }

    const keyboardShowEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const subscription = Keyboard.addListener(keyboardShowEvent, () => {
      requestAnimationFrame(scrollConversationToEnd);
    });

    return () => {
      subscription.remove();
    };
  }, [selectedThreadConversationId]);

  useEffect(() => {
    if (!selectedThreadConversationId) {
      return;
    }

    requestAnimationFrame(scrollConversationToEnd);
  }, [messages.length, selectedThreadConversationId]);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    const showSubscription = Keyboard.addListener("keyboardDidShow", (event) => {
      setAndroidKeyboardInset(Math.max(0, event.endCoordinates.height - insets.bottom));
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setAndroidKeyboardInset(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [insets.bottom]);

  useEffect(() => {
    const waitingActive =
      selectedThread !== null &&
      (selectedThread.latestTurn?.state === "running" ||
        selectedThread.session?.status === "running");

    if (!waitingActive) {
      waitingIndicatorMotion.stopAnimation();
      waitingIndicatorMotion.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(waitingIndicatorMotion, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(waitingIndicatorMotion, {
          toValue: 0,
          duration: 360,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
      waitingIndicatorMotion.stopAnimation();
      waitingIndicatorMotion.setValue(0);
    };
  }, [selectedThread, waitingIndicatorMotion]);

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
    setProjectBuilderRoot(serverDirectoryHint.trim() || null);
    setNewFolderName("");
    setProjectTitleDraft("");
    setDirectoryCwd(null);
    setDirectoryEntries([]);
    setDirectoryTruncated(false);
    setProjectBuilderOpen(true);
  };

  const closeProjectBuilder = () => {
    setProjectBuilderOpen(false);
    setProjectBuilderRoot(null);
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

  const handleSelectThemeBase = (themeBase: AppThemeNeutral) => {
    if (connectionSettings.themeBase === themeBase) {
      return;
    }
    updateConnectionSettings({ themeBase });
    showToast(`Base: ${getThemeNeutralLabel(themeBase)}`);
  };

  const handleSelectThemeAccent = (themeAccent: AppThemeAccent) => {
    if (connectionSettings.themeAccent === themeAccent) {
      return;
    }
    updateConnectionSettings({ themeAccent });
    showToast(`Accent: ${getThemeAccentLabel(themeAccent)}`);
  };

  const updateDraft = (value: string) => {
    clearError();
    if (!selectedThread) {
      return;
    }

    setThreadDrafts((current) => ({ ...current, [selectedThread.id]: value }));
  };

  const updateThreadTurnPreference = (patch: Partial<ThreadTurnPreference>) => {
    if (!selectedThread) {
      return;
    }

    setThreadTurnPreferences((current) => ({
      ...current,
      [selectedThread.id]: {
        reasoningEffort:
          patch.reasoningEffort ?? current[selectedThread.id]?.reasoningEffort ?? null,
        assistantDeliveryMode:
          patch.assistantDeliveryMode ??
          current[selectedThread.id]?.assistantDeliveryMode ??
          "buffered",
      },
    }));
  };

  const loadGitState = async (cwd: string) => {
    setIsLoadingGitState(true);
    try {
      const [nextStatus, nextBranches] = await Promise.all([
        gitStatus({ cwd }),
        gitListBranches({ cwd }),
      ]);
      setGitRepoStatus(nextStatus);
      setGitBranches(nextBranches);
    } finally {
      setIsLoadingGitState(false);
    }
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

    const nextRoot = projectBuilderRoot?.trim() ?? "";
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
  }, [directoryCwd, projectBuilderOpen, projectBuilderRoot, searchDirectory]);

  useEffect(() => {
    setConversationCapabilities((current) =>
      current?.threadId === selectedThreadConversationId ? current : null,
    );
    setConversationPickerMode(null);
    setIsLoadingConversationCapabilities(false);
    setGitRepoStatus(null);
    setGitBranches(null);
    setIsLoadingGitState(false);
    setGitCommitMessageDraft("");
    setGitBranchNameDraft("");
  }, [selectedThreadConversationId]);

  const handleResetProjectDirectory = async () => {
    const nextRoot = projectBuilderRoot?.trim() ?? "";
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

  const handleKillRecentThread = async (threadId: string, isStopped: boolean) => {
    if (!isStopped) {
      await stopSession({ threadId });
    }

    await deleteThread({ threadId });

    setHiddenRecentThreadIds((current) =>
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

  const showToast = (message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1800);
  };

  const closeConversationPicker = () => {
    setConversationPickerMode(null);
  };

  const openConversationPicker = async (mode: ComposerPanelMode) => {
    clearError();
    if (!selectedThread) {
      return;
    }
    setConversationPickerMode(mode);

    if (mode === "git") {
      if (selectedWorkspaceRoot) {
        await loadGitState(selectedWorkspaceRoot);
      }
      return;
    }

    if (mode === "reasoning") {
      return;
    }

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

  const handleSelectReasoningEffort = (effort: ProviderReasoningEffort | null) => {
    updateThreadTurnPreference({ reasoningEffort: effort });
    showToast(`Effort: ${formatReasoningEffortLabel(effort)}`);
    closeConversationPicker();
  };

  const handleSelectAssistantDeliveryMode = (mode: AssistantDeliveryMode) => {
    updateThreadTurnPreference({ assistantDeliveryMode: mode });
    showToast(mode === "streaming" ? "Delivery: Live" : "Delivery: Queue");
    closeConversationPicker();
  };

  const handleToggleAssistantDeliveryMode = () => {
    handleSelectAssistantDeliveryMode(
      (selectedThreadTurnPreference?.assistantDeliveryMode ?? "buffered") === "streaming"
        ? "buffered"
        : "streaming",
    );
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
    showToast(`Model: ${model}`);
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
    showToast(
      runtimeMode === "approval-required" ? "Permissions: Ask first" : "Permissions: Full access",
    );
    closeConversationPicker();
  };

  const handleToggleConversationRuntimeMode = async () => {
    if (!selectedThread) {
      return;
    }
    await handleSelectConversationRuntimeMode(
      selectedThread.runtimeMode === "approval-required" ? "full-access" : "approval-required",
    );
  };

  const handleRefreshGitState = async () => {
    if (!selectedWorkspaceRoot) {
      return;
    }
    await loadGitState(selectedWorkspaceRoot);
  };

  const handlePullBranch = async () => {
    if (!selectedWorkspaceRoot) {
      return;
    }
    await gitPull({ cwd: selectedWorkspaceRoot });
    await loadGitState(selectedWorkspaceRoot);
  };

  const handleCheckoutBranch = async (branch: string) => {
    if (!selectedWorkspaceRoot || !selectedThread) {
      return;
    }

    await gitCheckout({ cwd: selectedWorkspaceRoot, branch });
    await updateThreadBranch({ threadId: selectedThread.id, branch });
    setGitBranchNameDraft(branch);
    await loadGitState(selectedWorkspaceRoot);
  };

  const handleCreateBranchAndCheckout = async () => {
    const branch = gitBranchNameDraft.trim();
    if (!selectedWorkspaceRoot || !selectedThread || !branch) {
      return;
    }

    await gitCreateBranch({ cwd: selectedWorkspaceRoot, branch });
    await gitCheckout({ cwd: selectedWorkspaceRoot, branch });
    await updateThreadBranch({ threadId: selectedThread.id, branch });
    await loadGitState(selectedWorkspaceRoot);
  };

  const handleGitCommit = async () => {
    if (!selectedWorkspaceRoot) {
      return;
    }

    await gitRunStackedAction({
      cwd: selectedWorkspaceRoot,
      action: "commit",
      commitMessage: gitCommitMessageDraft,
    });
    await loadGitState(selectedWorkspaceRoot);
  };

  const handleGitPush = async () => {
    if (!selectedWorkspaceRoot) {
      return;
    }

    await gitRunStackedAction({
      cwd: selectedWorkspaceRoot,
      action: "commit_push",
      commitMessage: gitCommitMessageDraft,
    });
    await loadGitState(selectedWorkspaceRoot);
  };

  const handleBranchCommitAndPush = async () => {
    const branch = gitBranchNameDraft.trim();
    if (!selectedWorkspaceRoot || !selectedThread || !branch) {
      return;
    }

    await gitCreateBranch({ cwd: selectedWorkspaceRoot, branch });
    await gitCheckout({ cwd: selectedWorkspaceRoot, branch });
    await updateThreadBranch({ threadId: selectedThread.id, branch });
    await gitRunStackedAction({
      cwd: selectedWorkspaceRoot,
      action: "commit_push",
      commitMessage: gitCommitMessageDraft,
    });
    await loadGitState(selectedWorkspaceRoot);
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
      assistantDeliveryMode: selectedThreadTurnPreference?.assistantDeliveryMode ?? "buffered",
      modelOptions:
        selectedConversationProvider === "codex" && selectedThreadTurnPreference?.reasoningEffort
          ? {
              codex: {
                reasoningEffort:
                  selectedThreadTurnPreference.reasoningEffort as CodexReasoningEffort,
              },
            }
          : selectedConversationProvider === "claudeAgent" &&
              selectedThreadTurnPreference?.reasoningEffort
            ? {
                claudeAgent: {
                  effort: selectedThreadTurnPreference.reasoningEffort as ClaudeCodeEffort,
                },
              }
            : undefined,
    });

    setThreadDrafts((current) => ({ ...current, [selectedThread.id]: "" }));
  };

  const handleRespondToPendingApproval = async (decision: ProviderApprovalDecision) => {
    if (!selectedThread || !pendingApprovalRequest) {
      return;
    }

    await respondToApproval({
      threadId: selectedThread.id,
      requestId: pendingApprovalRequest.requestId,
      decision,
    });
  };

  const sessionStatus = selectedThread?.session?.status ?? "idle";
  const sessionBusy =
    selectedThread?.latestTurn?.state === "running" || sessionStatus === "running";
  const showWaitingIndicator = selectedThread !== null && sessionBusy;
  const canRespondToPendingApproval =
    isConnected &&
    selectedThread !== null &&
    pendingApprovalRequest !== null &&
    selectedThread.session !== null &&
    selectedThread.session.status !== "stopped" &&
    busyAction === null;
  const canInterrupt =
    isConnected &&
    selectedThread !== null &&
    (selectedThread.latestTurn?.state === "running" || sessionStatus === "running");
  const canStopSession =
    isConnected &&
    selectedThread !== null &&
    selectedThread.session !== null &&
    selectedThread.session.status !== "stopped";
  const canRunGitOperations =
    isConnected &&
    selectedThread !== null &&
    selectedWorkspaceRoot !== null &&
    busyAction === null &&
    !sessionBusy;

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
          <SidebarNavButton icon="home" label="Home" onPress={handleSelectHome} />
        </View>

        <ScrollView
          contentContainerStyle={styles.sidebarScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.navSection}>
            <View style={styles.navSectionHeader}>
              <Text style={styles.navSectionLabel}>Project Tree</Text>
              <IconButton
                accessibilityLabel={projectBuilderOpen ? "Close root picker" : "Add root"}
                disabled={busyAction !== null}
                icon={projectBuilderOpen ? "x" : "plus"}
                onPress={() => {
                  if (projectBuilderOpen) {
                    closeProjectBuilder();
                    return;
                  }
                  openProjectBuilder();
                }}
              />
            </View>
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
            recentThreads.map((thread) => {
              const projectTitle =
                allProjects.find((project) => project.id === thread.projectId)?.title ??
                "Conversation";

              return (
                <SwipeDismissRow
                  actionDisabled={busyAction !== null}
                  key={thread.id}
                  onAction={() => {
                    return handleKillRecentThread(thread.id, thread.session?.status === "stopped");
                  }}
                  onPress={() => {
                    handleSelectThread(thread.projectId, thread.id);
                  }}
                >
                  <View
                    style={[
                      styles.recentRow,
                      recentThreads[recentThreads.length - 1]?.id === thread.id &&
                        styles.recentRowLast,
                    ]}
                  >
                    <View style={styles.recentRowAccent} />
                    <View style={styles.recentRowCopy}>
                      <Text numberOfLines={1} style={styles.recentRowTitle}>
                        {getRecentThreadDisplayTitle(thread, projectTitle)}
                      </Text>
                      <Text numberOfLines={1} style={styles.recentRowMeta}>
                        {formatTimestamp(thread.updatedAt)} / {thread.session?.status ?? "idle"}
                      </Text>
                    </View>
                  </View>
                </SwipeDismissRow>
              );
            })
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

      <View style={styles.threadHeader}>
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
              styles.composerControlButtonModel,
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
            accessibilityLabel={
              selectedThread?.runtimeMode === "approval-required"
                ? "Enable full access permissions"
                : "Require approval for permissions"
            }
            disabled={!selectedThread || !isConnected || busyAction !== null}
            onPress={() => {
              void handleToggleConversationRuntimeMode();
            }}
            style={[
              styles.composerControlButton,
              styles.composerControlButtonIcon,
              selectedThread?.runtimeMode === "full-access" && styles.composerControlButtonSelected,
              (!selectedThread || !isConnected || busyAction !== null) && styles.buttonDisabled,
            ]}
          >
            <Feather
              accessibilityElementsHidden
              color={selectedThread?.runtimeMode === "full-access" ? theme.accent : theme.text}
              importantForAccessibility="no-hide-descendants"
              name={formatRuntimeModeIcon(selectedThread?.runtimeMode ?? "approval-required")}
              size={14}
            />
          </Pressable>
          <Pressable
            disabled={
              !selectedThread || busyAction !== null || selectedReasoningOptions.length === 0
            }
            onPress={() => {
              void openConversationPicker("reasoning");
            }}
            style={[
              styles.composerControlButton,
              styles.composerControlButtonEffort,
              (!selectedThread || busyAction !== null || selectedReasoningOptions.length === 0) &&
                styles.buttonDisabled,
            ]}
          >
            <Text numberOfLines={1} style={styles.composerControlValue}>
              {formatReasoningEffortLabel(selectedThreadTurnPreference?.reasoningEffort ?? null)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={
              (selectedThreadTurnPreference?.assistantDeliveryMode ?? "buffered") === "streaming"
                ? "Switch reply delivery to queue"
                : "Switch reply delivery to live"
            }
            disabled={!selectedThread || busyAction !== null}
            onPress={() => {
              handleToggleAssistantDeliveryMode();
            }}
            style={[
              styles.composerControlButton,
              styles.composerControlButtonIcon,
              (selectedThreadTurnPreference?.assistantDeliveryMode ?? "buffered") === "streaming" &&
                styles.composerControlButtonSelected,
              (!selectedThread || busyAction !== null) && styles.buttonDisabled,
            ]}
          >
            <Feather
              accessibilityElementsHidden
              color={
                (selectedThreadTurnPreference?.assistantDeliveryMode ?? "buffered") === "streaming"
                  ? theme.accent
                  : theme.text
              }
              importantForAccessibility="no-hide-descendants"
              name={formatAssistantDeliveryModeIcon(
                selectedThreadTurnPreference?.assistantDeliveryMode ?? "buffered",
              )}
              size={14}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="Open git controls"
            disabled={!selectedThread || !selectedWorkspaceRoot || busyAction !== null}
            onPress={() => {
              void openConversationPicker("git");
            }}
            style={[
              styles.composerControlButton,
              styles.composerControlButtonIcon,
              (!selectedThread || !selectedWorkspaceRoot || busyAction !== null) &&
                styles.buttonDisabled,
            ]}
          >
            <Feather
              accessibilityElementsHidden
              color={theme.text}
              importantForAccessibility="no-hide-descendants"
              name="git-branch"
              size={14}
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={messagesScrollRef}
        contentContainerStyle={styles.messagesScrollContent}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          requestAnimationFrame(scrollConversationToEnd);
        }}
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
                  message.role === "assistant" &&
                    message.id === highlightedAssistantMessageId &&
                    styles.messageRowAssistantLatest,
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

        {showWaitingIndicator ? (
          <Animated.View
            style={[
              styles.waitingIndicator,
              {
                opacity: waitingIndicatorMotion.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.55, 1],
                }),
                transform: [
                  {
                    translateY: waitingIndicatorMotion.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -4],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.waitingIndicatorText}>waiting</Text>
          </Animated.View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.composerShell,
          Platform.OS === "android" && androidKeyboardInset > 0
            ? { marginBottom: androidKeyboardInset }
            : null,
        ]}
      >
        {pendingApprovalRequest ? (
          <View style={styles.pendingApprovalPanel}>
            <Text style={styles.pendingApprovalEyebrow}>Permission Requested</Text>
            <Text style={styles.pendingApprovalTitle}>
              {formatApprovalRequestKindLabel(pendingApprovalRequest.requestKind)}
            </Text>
            <Text style={styles.pendingApprovalSummary}>{pendingApprovalRequest.summary}</Text>
            {pendingApprovalRequest.detail ? (
              <Text style={styles.pendingApprovalDetail}>{pendingApprovalRequest.detail}</Text>
            ) : null}
            <View style={styles.inlineButtonRow}>
              <ActionButton
                compact
                disabled={!canRespondToPendingApproval}
                label="Allow"
                onPress={() => {
                  void handleRespondToPendingApproval("accept");
                }}
              />
              <ActionButton
                compact
                disabled={!canRespondToPendingApproval}
                emphasis="secondary"
                label="Session"
                onPress={() => {
                  void handleRespondToPendingApproval("acceptForSession");
                }}
              />
              <ActionButton
                compact
                disabled={!canRespondToPendingApproval}
                emphasis="ghost"
                label="Deny"
                onPress={() => {
                  void handleRespondToPendingApproval("decline");
                }}
              />
            </View>
          </View>
        ) : null}

        <TextInput
          multiline
          onChangeText={updateDraft}
          onFocus={() => {
            requestAnimationFrame(scrollConversationToEnd);
          }}
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
              label={
                (selectedThreadTurnPreference?.assistantDeliveryMode ?? "buffered") === "streaming"
                  ? "Send"
                  : "Queue"
              }
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

    type PickerRow = {
      readonly key: string;
      readonly title: string;
      readonly meta: string | null;
      readonly current: boolean;
      readonly available: boolean;
      readonly reason: string | null;
      readonly onPress: () => void;
    };

    const rows: ReadonlyArray<PickerRow> =
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
        : conversationPickerMode === "reasoning"
          ? selectedReasoningOptions.map((effort: ProviderReasoningEffort) => ({
              key: effort,
              title: formatReasoningEffortLabel(effort),
              meta: null,
              current: effort === selectedThreadTurnPreference?.reasoningEffort,
              available: true,
              reason: null,
              onPress: () => {
                handleSelectReasoningEffort(effort);
              },
            }))
          : [];

    if (conversationPickerMode === "git") {
      const localBranches = (gitBranches?.branches ?? []).filter((branch) => !branch.isRemote);

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
            <Text style={styles.panelEyebrow}>Git</Text>
            <Text style={styles.panelTitle}>Workspace controls</Text>
            <Text style={styles.panelSubtitle}>
              Commit, push, or create and check out a branch before committing and pushing.
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.projectPickerScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.projectPickerPathPanel}>
              <Text style={styles.projectPickerPathLabel}>Workspace</Text>
              <Text style={styles.projectPickerPathValue}>
                {selectedWorkspaceRoot ?? "No workspace attached to this conversation."}
              </Text>
            </View>

            <View style={styles.compactList}>
              <MetaRow
                accent
                label="Branch"
                value={formatGitBranchLabel(gitRepoStatus?.branch ?? selectedThread.branch)}
              />
              <MetaRow
                label="Working tree"
                value={
                  gitRepoStatus
                    ? gitRepoStatus.hasWorkingTreeChanges
                      ? `${gitRepoStatus.workingTree.files.length} files / +${gitRepoStatus.workingTree.insertions} -${gitRepoStatus.workingTree.deletions}`
                      : "Clean"
                    : isLoadingGitState
                      ? "Loading..."
                      : "Unavailable"
                }
              />
              <MetaRow
                label="Upstream"
                value={
                  gitRepoStatus
                    ? gitRepoStatus.hasUpstream
                      ? `ahead ${gitRepoStatus.aheadCount} / behind ${gitRepoStatus.behindCount}`
                      : "No upstream configured"
                    : "Unavailable"
                }
              />
            </View>

            {sessionBusy ? (
              <Text style={styles.selectionRowReason}>
                Stop the active turn before running branch-changing Git actions.
              </Text>
            ) : null}

            <View style={styles.inlineButtonRow}>
              <ActionButton
                compact
                disabled={!selectedWorkspaceRoot || busyAction !== null}
                emphasis="secondary"
                label="Refresh"
                onPress={() => {
                  void handleRefreshGitState();
                }}
              />
              <ActionButton
                compact
                disabled={!canRunGitOperations}
                emphasis="ghost"
                label="Pull"
                onPress={() => {
                  void handlePullBranch();
                }}
              />
            </View>

            <View style={styles.projectPickerFieldGroup}>
              <Text style={styles.navSectionLabel}>Branches</Text>
              <View style={styles.selectionList}>
                {localBranches.length > 0 ? (
                  localBranches.map((branch: GitBranch) => (
                    <Pressable
                      key={branch.name}
                      disabled={!canRunGitOperations || branch.current}
                      onPress={() => {
                        void handleCheckoutBranch(branch.name);
                      }}
                      style={[
                        styles.selectionRow,
                        branch.current && styles.selectionRowCurrent,
                        (!canRunGitOperations || branch.current) && styles.buttonDisabled,
                      ]}
                    >
                      <View style={styles.selectionRowCopy}>
                        <View style={styles.selectionRowHeading}>
                          <Text style={styles.selectionRowTitle}>{branch.name}</Text>
                          {branch.current ? (
                            <Text style={styles.selectionRowCurrentTag}>Current</Text>
                          ) : null}
                        </View>
                        <Text style={styles.selectionRowMeta}>
                          {branch.isDefault ? "Default branch" : "Tap to check out"}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles.helperText}>
                    {isLoadingGitState ? "Loading branches..." : "No local branches found."}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.projectPickerFieldGroup}>
              <Text style={styles.navSectionLabel}>New branch</Text>
              <View style={styles.projectPickerInputRow}>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setGitBranchNameDraft}
                  placeholder="feature/mobile-controls"
                  placeholderTextColor={TERMINAL_MUTED}
                  style={[styles.input, styles.projectPickerInput]}
                  value={gitBranchNameDraft}
                />
                <View style={styles.projectPickerActionCell}>
                  <ActionButton
                    disabled={!canRunGitOperations || !gitBranchNameDraft.trim()}
                    emphasis="ghost"
                    label="checkout -b"
                    onPress={() => {
                      void handleCreateBranchAndCheckout();
                    }}
                  />
                </View>
              </View>
            </View>

            <View style={styles.projectPickerFieldGroup}>
              <Text style={styles.navSectionLabel}>Commit message</Text>
              <TextInput
                multiline
                onChangeText={setGitCommitMessageDraft}
                placeholder="feat: expose reasoning, delivery, and git controls"
                placeholderTextColor={TERMINAL_MUTED}
                style={[styles.input, styles.gitCommitInput]}
                textAlignVertical="top"
                value={gitCommitMessageDraft}
              />
            </View>

            <View style={styles.inlineButtonRow}>
              <ActionButton
                disabled={!canRunGitOperations}
                emphasis="surface"
                label="Commit"
                onPress={() => {
                  void handleGitCommit();
                }}
              />
              <ActionButton
                disabled={!canRunGitOperations}
                emphasis="surface"
                label="Push"
                onPress={() => {
                  void handleGitPush();
                }}
              />
            </View>

            <ActionButton
              disabled={!canRunGitOperations || !gitBranchNameDraft.trim()}
              label="Branch + Commit + Push"
              onPress={() => {
                void handleBranchCommitAndPush();
              }}
            />
          </ScrollView>

          <View style={styles.projectPickerFooter}>
            <ActionButton emphasis="secondary" label="Close" onPress={closeConversationPicker} />
          </View>
        </View>
      );
    }

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
          <Text style={styles.panelTitle}>
            {conversationPickerMode === "reasoning" ? "Reasoning effort" : conversationPickerTitle}
          </Text>
          <Text style={styles.panelSubtitle}>
            {conversationPickerMode === "reasoning"
              ? "Pick how much reasoning effort the next turn should use."
              : conversationPickerSubtitle}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.projectPickerScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.projectPickerPathPanel}>
            <Text style={styles.projectPickerPathLabel}>
              {conversationPickerMode === "model" && isLoadingConversationCapabilities
                ? "Loading"
                : "Selected session"}
            </Text>
            <Text style={styles.projectPickerPathValue}>
              {conversationPickerMode !== "reasoning" && isLoadingConversationCapabilities
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
          <Text style={styles.panelTitle}>Server + appearance</Text>
          <Text style={styles.panelSubtitle}>
            Connection, theme, and provider controls live here so the left rail stays focused on
            roots and sessions.
          </Text>
        </View>

        <View style={[styles.settingsSection, styles.settingsSectionFirst]}>
          <Text style={styles.sectionEyebrow}>Appearance</Text>
          <View style={styles.themeFieldGroup}>
            <View style={styles.themeField}>
              <View style={styles.themeFieldHeader}>
                <Text style={styles.themeFieldLabel}>Base neutral</Text>
                <Text style={styles.themeFieldValue}>
                  {getThemeNeutralLabel(connectionSettings.themeBase)}
                </Text>
              </View>
              <View style={styles.themeOptionGrid}>
                {FLEXOKI_DARK_NEUTRAL_OPTIONS.map((option) => (
                  <Pressable
                    key={option.id}
                    onPress={() => {
                      handleSelectThemeBase(option.id);
                    }}
                    style={[
                      styles.themeOptionButton,
                      connectionSettings.themeBase === option.id &&
                        styles.themeOptionButtonSelected,
                    ]}
                  >
                    <View
                      style={[
                        styles.themeOptionSwatch,
                        { backgroundColor: option.value },
                        connectionSettings.themeBase === option.id &&
                          styles.themeOptionSwatchSelected,
                      ]}
                    />
                    <Text style={styles.themeOptionLabel}>{option.label}</Text>
                    <Text style={styles.themeOptionMeta}>{option.value}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.themeField}>
              <View style={styles.themeFieldHeader}>
                <Text style={styles.themeFieldLabel}>Accent</Text>
                <Text style={styles.themeFieldValue}>
                  {getThemeAccentLabel(connectionSettings.themeAccent)}
                </Text>
              </View>
              <View style={styles.themeOptionGrid}>
                {FLEXOKI_DARK_ACCENT_OPTIONS.map((option) => (
                  <Pressable
                    key={option.id}
                    onPress={() => {
                      handleSelectThemeAccent(option.id);
                    }}
                    style={[
                      styles.themeOptionButton,
                      connectionSettings.themeAccent === option.id &&
                        styles.themeOptionButtonSelected,
                    ]}
                  >
                    <View style={[styles.themeOptionSwatch, { backgroundColor: option.value }]} />
                    <Text style={styles.themeOptionLabel}>{option.label}</Text>
                    <Text style={styles.themeOptionMeta}>{option.value}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
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
            {(directoryCwd ?? projectBuilderRoot) || "Loading server folders..."}
          </Text>
        </View>

        <View style={styles.inlineButtonRow}>
          <ActionButton
            compact
            disabled={!projectBuilderRoot?.trim() || busyAction !== null}
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
    <AppThemeContext.Provider value={themeContextValue}>
      <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
        {/* oxlint-disable-next-line react/style-prop-object */}
        <StatusBar style="light" />
        <View style={styles.shellBackground}>
          <KeyboardAvoidingView
            behavior="padding"
            enabled={Platform.OS === "ios"}
            keyboardVerticalOffset={insets.top}
            style={styles.keyboardAvoider}
          >
            <View style={styles.shellLayout}>
              <View style={[styles.topBar, selectedThread ? styles.topBarConversation : null]}>
                {!sidebarPersistent ? (
                  <IconButton accessibilityLabel="Open tree" icon="menu" onPress={openNavMenu} />
                ) : (
                  <View style={styles.topBarSpacer} />
                )}

                <View style={styles.topBarCopy}>
                  <Text numberOfLines={1} style={styles.topBarTitle}>
                    {`MIKROCODE / ${topBarPrimary}`}
                  </Text>
                  <Text numberOfLines={1} style={styles.topBarSubtitle}>
                    {topBarSecondary}
                  </Text>
                </View>

                <IconButton
                  accessibilityLabel="Open config"
                  icon="settings"
                  onPress={openSettingsPanel}
                />
              </View>

              {toastMessage ? (
                <View pointerEvents="none" style={styles.toastOverlay}>
                  <View style={styles.toastBubble}>
                    <Text numberOfLines={1} style={styles.toastText}>
                      {toastMessage}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View
                style={[
                  styles.appFrame,
                  selectedThread && !sidebarPersistent ? styles.appFrameConversation : null,
                ]}
              >
                {sidebarPersistent ? (
                  <View style={[styles.sidebarFrame, { width: sidebarWidth }]}>
                    {renderSidebar()}
                  </View>
                ) : null}

                <View
                  style={[
                    styles.workspaceFrame,
                    selectedThread ? styles.workspaceFrameConversation : null,
                  ]}
                >
                  <Animated.View
                    style={[
                      styles.workspaceSurface,
                      !selectedThread ? styles.workspaceSurfaceHome : null,
                      selectedThread ? styles.workspaceSurfaceConversation : null,
                      selectedThread
                        ? {
                            opacity: workspaceOpacity,
                          }
                        : {
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
    </AppThemeContext.Provider>
  );
}

export function AppShell() {
  return <AppShellContent />;
}

function createStyles(theme: AppTheme) {
  const TERMINAL_BG = theme.background;
  const TERMINAL_PANEL = theme.panel;
  const TERMINAL_PANEL_ALT = theme.panelAlt;
  const TERMINAL_BORDER = theme.border;
  const TERMINAL_BORDER_STRONG = theme.borderStrong;
  const TERMINAL_TEXT = theme.text;
  const TERMINAL_MUTED = theme.muted;
  const TERMINAL_ACCENT = theme.accent;
  const TERMINAL_ACCENT_SOFT = theme.accentSoft;
  const TERMINAL_ACCENT_SOFT_STRONG = theme.accentSoftStrong;
  const TERMINAL_WARNING = theme.warning;
  const TERMINAL_DANGER = theme.danger;
  const TERMINAL_DANGER_SOFT = theme.dangerSoft;
  const TERMINAL_OVERLAY = theme.overlay;
  const TERMINAL_MODAL_OVERLAY = theme.modalOverlay;
  const TERMINAL_USER_MESSAGE_BACKGROUND = theme.userMessageBackground;
  const TERMINAL_USER_MESSAGE_BORDER = theme.userMessageBorder;
  const TERMINAL_ASSISTANT_MESSAGE_BACKGROUND = theme.assistantMessageBackground;
  const TERMINAL_ASSISTANT_MESSAGE_BORDER = theme.assistantMessageBorder;

  return StyleSheet.create({
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
      gap: 6,
      padding: 6,
      paddingTop: 4,
    },
    appFrameConversation: {
      padding: 0,
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
      gap: 4,
      paddingHorizontal: 12,
      paddingTop: 8,
    },
    sidebarNavButton: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      minHeight: 28,
    },
    sidebarNavButtonLabel: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      fontWeight: "700",
    },
    sidebarScrollContent: {
      gap: 12,
      padding: 12,
      paddingBottom: 18,
    },
    navSection: {
      gap: 8,
    },
    navSectionHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
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
      color: TERMINAL_DANGER,
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
      backgroundColor: TERMINAL_BORDER_STRONG,
      borderRadius: 999,
      height: 6,
      width: 6,
    },
    statusPulseLive: {
      backgroundColor: TERMINAL_ACCENT,
    },
    statusPulseError: {
      backgroundColor: TERMINAL_DANGER,
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
      gap: 4,
    },
    workspaceFrameConversation: {
      gap: 0,
    },
    topBar: {
      alignItems: "center",
      backgroundColor: TERMINAL_BG,
      borderBottomColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: 6,
      minHeight: 34,
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    topBarConversation: {
      backgroundColor: TERMINAL_PANEL,
      borderBottomWidth: 0,
    },
    topBarSpacer: {
      width: 28,
    },
    topBarCopy: {
      flex: 1,
      gap: 0,
    },
    topBarTitle: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
    },
    topBarSubtitle: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
    },
    iconButton: {
      alignItems: "center",
      justifyContent: "center",
      minHeight: 28,
      minWidth: 28,
    },
    workspaceSurface: {
      backgroundColor: TERMINAL_PANEL_ALT,
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      flex: 1,
      overflow: "hidden",
    },
    workspaceSurfaceHome: {
      backgroundColor: "transparent",
      borderWidth: 0,
    },
    workspaceSurfaceConversation: {
      backgroundColor: "transparent",
      borderWidth: 0,
    },
    toastOverlay: {
      alignItems: "center",
      left: 0,
      paddingHorizontal: 12,
      position: "absolute",
      right: 0,
      top: 46,
      zIndex: 20,
    },
    toastBubble: {
      backgroundColor: TERMINAL_PANEL,
      borderColor: TERMINAL_ACCENT,
      borderWidth: 1,
      maxWidth: "100%",
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    toastText: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
    },
    workspaceScrollContent: {
      gap: 8,
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 10,
    },
    recentSection: {
      gap: 4,
    },
    recentSectionActions: {
      alignItems: "center",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    recentRail: {
      overflow: "hidden",
    },
    swipeRowShell: {
      backgroundColor: "transparent",
      minHeight: 44,
      overflow: "hidden",
    },
    swipeRowAction: {
      alignItems: "flex-end",
      backgroundColor: TERMINAL_DANGER_SOFT,
      bottom: 0,
      justifyContent: "center",
      left: 0,
      paddingHorizontal: 0,
      position: "absolute",
      right: 0,
      top: 0,
    },
    swipeRowActionButton: {
      alignItems: "flex-end",
      alignSelf: "stretch",
      backgroundColor: "transparent",
      flex: 1,
      justifyContent: "center",
      paddingLeft: 12,
      paddingRight: 16,
    },
    swipeRowActionIconWrap: {
      alignItems: "center",
      justifyContent: "center",
    },
    swipeRowContent: {
      backgroundColor: TERMINAL_BG,
    },
    recentRow: {
      alignItems: "center",
      backgroundColor: TERMINAL_BG,
      borderBottomColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 9,
      paddingVertical: 7,
    },
    recentRowLast: {
      borderBottomWidth: 0,
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
    metricLabel: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1.1,
      textTransform: "uppercase",
    },
    errorBanner: {
      backgroundColor: TERMINAL_DANGER_SOFT,
      borderColor: TERMINAL_DANGER,
      borderWidth: 1,
      gap: 6,
      padding: 10,
    },
    errorTitle: {
      color: TERMINAL_DANGER,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 14,
      fontWeight: "700",
    },
    errorText: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      lineHeight: 18,
    },
    homeGrid: {
      gap: 8,
    },
    homeGridWide: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    flatSection: {
      borderTopColor: TERMINAL_BORDER,
      borderTopWidth: 1,
      flex: 1,
      gap: 6,
      minWidth: 260,
      paddingTop: 8,
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
      color: TERMINAL_WARNING,
    },
    providerStatusError: {
      color: TERMINAL_DANGER,
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
      padding: 0,
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
      color: TERMINAL_WARNING,
    },
    threadControlHintError: {
      color: TERMINAL_DANGER,
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
      gap: 2,
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 6,
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
      paddingVertical: 3,
    },
    messageRowUser: {
      backgroundColor: TERMINAL_USER_MESSAGE_BACKGROUND,
      borderRightColor: TERMINAL_ACCENT,
      borderRightWidth: 2,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    messageRowAssistant: {
      paddingHorizontal: 0,
      paddingVertical: 2,
    },
    messageRowAssistantLatest: {
      backgroundColor: TERMINAL_ASSISTANT_MESSAGE_BACKGROUND,
      borderLeftColor: TERMINAL_ACCENT,
      borderLeftWidth: 2,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    messageText: {
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 17,
    },
    messageTextUser: {
      color: TERMINAL_TEXT,
    },
    messageTextAssistant: {
      color: TERMINAL_TEXT,
    },
    messageMetaReveal: {
      alignSelf: "flex-start",
      backgroundColor: "transparent",
      marginTop: 3,
      paddingHorizontal: 1,
      paddingVertical: 2,
    },
    messageMetaRevealUser: {
      alignSelf: "flex-end",
      borderColor: TERMINAL_USER_MESSAGE_BORDER,
    },
    messageMetaRevealAssistant: {
      alignSelf: "flex-start",
      borderColor: TERMINAL_ASSISTANT_MESSAGE_BORDER,
    },
    messageMetaRevealText: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
    },
    emptyConversation: {
      alignItems: "flex-start",
      gap: 5,
      paddingVertical: 8,
    },
    pendingApprovalPanel: {
      backgroundColor: TERMINAL_ACCENT_SOFT,
      borderColor: TERMINAL_ACCENT,
      borderWidth: 1,
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    pendingApprovalEyebrow: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    pendingApprovalTitle: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      fontWeight: "700",
    },
    pendingApprovalSummary: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      lineHeight: 16,
    },
    pendingApprovalDetail: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      lineHeight: 15,
    },
    waitingIndicator: {
      alignSelf: "flex-start",
      paddingVertical: 6,
    },
    waitingIndicatorText: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.3,
    },
    composerShell: {
      borderTopColor: TERMINAL_BORDER,
      borderTopWidth: 1,
      gap: 3,
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 5,
    },
    composerControlStrip: {
      backgroundColor: TERMINAL_PANEL,
      borderColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: 4,
      paddingHorizontal: 3,
      paddingTop: 1,
      paddingBottom: 3,
    },
    composerControlButton: {
      justifyContent: "center",
      minHeight: 24,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    composerControlButtonModel: {
      flex: 1,
      minWidth: 0,
    },
    composerControlButtonEffort: {
      flexGrow: 0,
      minWidth: 64,
    },
    composerControlButtonIcon: {
      alignItems: "center",
      flex: 0,
      minWidth: 30,
      paddingHorizontal: 0,
    },
    composerControlButtonSelected: {
      backgroundColor: TERMINAL_ACCENT_SOFT,
      borderColor: TERMINAL_ACCENT,
      borderWidth: 1,
    },
    composerControlValue: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    composerInput: {
      backgroundColor: "transparent",
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      minHeight: 48,
      paddingHorizontal: 2,
      paddingVertical: 4,
    },
    composerFooter: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      justifyContent: "space-between",
    },
    composerActionCluster: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
    },
    composerRunAction: {
      minWidth: 102,
    },
    gitCommitInput: {
      minHeight: 90,
    },
    buttonBase: {
      alignItems: "center",
      backgroundColor: "transparent",
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      minHeight: 32,
      justifyContent: "center",
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    buttonCompact: {
      minHeight: 28,
      paddingHorizontal: 8,
      paddingVertical: 4,
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
      backgroundColor: TERMINAL_OVERLAY,
      flex: 1,
    },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: TERMINAL_MODAL_OVERLAY,
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
      gap: 0,
      paddingHorizontal: 10,
      paddingTop: 10,
      paddingBottom: 16,
    },
    floatingPanelHeader: {
      gap: 6,
      paddingBottom: 10,
      borderBottomColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
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
      borderTopColor: TERMINAL_BORDER,
      borderTopWidth: 1,
      gap: 10,
      paddingTop: 10,
      paddingBottom: 10,
    },
    settingsSectionFirst: {
      borderTopWidth: 0,
      paddingTop: 0,
    },
    themeFieldGroup: {
      gap: 10,
    },
    themeField: {
      gap: 8,
    },
    themeFieldHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    themeFieldLabel: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },
    themeFieldValue: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
    },
    themeOptionGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    themeOptionButton: {
      backgroundColor: "transparent",
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      flexBasis: "48%",
      flexGrow: 1,
      gap: 6,
      minWidth: 96,
      padding: 8,
    },
    themeOptionButtonSelected: {
      backgroundColor: TERMINAL_ACCENT_SOFT_STRONG,
      borderColor: TERMINAL_ACCENT,
    },
    themeOptionSwatch: {
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      height: 18,
    },
    themeOptionSwatchSelected: {
      borderColor: TERMINAL_BORDER_STRONG,
    },
    themeOptionLabel: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      fontWeight: "700",
    },
    themeOptionMeta: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
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
      color: TERMINAL_DANGER,
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
      color: TERMINAL_DANGER,
    },
  });
}

const stylesCache = new Map<string, ReturnType<typeof createStyles>>();

function getStyles(theme: AppTheme) {
  const cached = stylesCache.get(theme.key);
  if (cached) {
    return cached;
  }

  const nextStyles = createStyles(theme);
  stylesCache.set(theme.key, nextStyles);
  return nextStyles;
}

type AppThemeContextValue = {
  readonly styles: ReturnType<typeof createStyles>;
  readonly theme: AppTheme;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function useAppThemeContext() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error("App theme context is unavailable.");
  }
  return context;
}
