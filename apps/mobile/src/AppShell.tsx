import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import {
  type ComponentProps,
  cloneElement,
  createContext,
  isValidElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Animated,
  Easing,
  Image,
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
  type TextStyle,
  View,
  type ViewStyle,
  useWindowDimensions,
} from "react-native";
import { Renderer, type MarkedStyles, useMarkdown } from "react-native-marked";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  CLAUDE_CODE_EFFORT_OPTIONS,
  CODEX_REASONING_EFFORT_OPTIONS,
  DEFAULT_REASONING_EFFORT_BY_PROVIDER,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import type {
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
  ProviderInteractionMode,
  ProviderUserInputAnswers,
  ProjectEntry,
  ProviderReasoningEffort,
  RuntimeMode,
  ServerConversationCapabilities,
  UserInputQuestion,
  UploadChatAttachment,
} from "@t3tools/contracts";

import { MOBILE_DEFAULT_MODEL } from "./defaults";
import { buildAttachmentUrl, createClientId } from "./protocol";
import {
  loadThreadTurnPreferences,
  saveThreadTurnPreferences,
  type ConnectionSettings,
  type StoredThreadTurnPreference,
  type TurnDispatchMode,
} from "./storage";
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
const DEVICE_NOTIFICATION_CHANNEL_ID = "turn-updates";
const ANDROID_EXPO_GO_APP_OWNERSHIP = "expo";
const TERMINAL_FONT_FAMILY = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});
type ComposerPanelMode = "model" | "reasoning" | "git";
type ThreadTurnPreference = StoredThreadTurnPreference;
type DraftImageAttachment = UploadChatAttachment & {
  readonly id: string;
  readonly previewUri: string;
};
type FeatherIconName = ComponentProps<typeof Feather>["name"];

type MessageMarkdownStyles = {
  readonly root: ViewStyle;
  readonly text: TextStyle;
  readonly paragraph: ViewStyle;
  readonly link: TextStyle;
  readonly blockquote: ViewStyle;
  readonly heading: TextStyle;
  readonly codespan: TextStyle;
  readonly codeBlock: ViewStyle;
  readonly codeHeader: ViewStyle;
  readonly codeHeaderLabel: TextStyle;
  readonly codeScroll: ViewStyle;
  readonly codeScrollContent: ViewStyle;
  readonly codeContent: ViewStyle;
  readonly codeText: TextStyle;
  readonly codeComment: TextStyle;
  readonly codeKeyword: TextStyle;
  readonly codeString: TextStyle;
  readonly codeNumber: TextStyle;
  readonly codeFunction: TextStyle;
  readonly codeOperator: TextStyle;
  readonly codePunctuation: TextStyle;
  readonly codeType: TextStyle;
  readonly codeProperty: TextStyle;
  readonly codeTag: TextStyle;
  readonly codeAttrName: TextStyle;
  readonly codeAttrValue: TextStyle;
  readonly codeImportant: TextStyle;
  readonly rule: ViewStyle;
  readonly list: ViewStyle;
  readonly listItem: TextStyle;
  readonly table: ViewStyle;
  readonly tableRow: ViewStyle;
  readonly tableCell: ViewStyle;
  readonly strong: TextStyle;
  readonly emphasis: TextStyle;
  readonly strikethrough: TextStyle;
};

type MarkdownRenderElementProps = {
  readonly children?: ReactNode;
  readonly style?: unknown;
};

const PRISM_LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  console: "bash",
  cts: "typescript",
  diff: "diff",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  mts: "typescript",
  patch: "diff",
  sh: "bash",
  shell: "bash",
  text: "plain",
  plaintext: "plain",
  ts: "typescript",
  tsx: "tsx",
  txt: "plain",
  typescript: "typescript",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

function normalizeCodeLanguage(language?: string) {
  const normalizedLanguage = language?.trim().toLowerCase() ?? "";
  if (normalizedLanguage.length === 0) {
    return null;
  }
  return PRISM_LANGUAGE_ALIASES[normalizedLanguage] ?? normalizedLanguage;
}

function getPrismGrammar(language?: string) {
  const normalizedLanguage = normalizeCodeLanguage(language);
  if (!normalizedLanguage || normalizedLanguage === "plain") {
    return null;
  }
  const grammar = Prism.languages[normalizedLanguage];
  return grammar ? { grammar, language: normalizedLanguage } : null;
}

function formatServerNotificationToast(notification: {
  readonly title: string;
  readonly message: string;
}) {
  return `${notification.title}: ${notification.message}`;
}

type NotificationsModule = typeof import("expo-notifications");

let notificationsModulePromise: Promise<NotificationsModule> | null = null;

function loadNotificationsModule() {
  notificationsModulePromise ??= import("expo-notifications");
  return notificationsModulePromise;
}

function getCodeTokenStyles(
  token: Prism.Token,
  markdownStyles: MessageMarkdownStyles,
): TextStyle[] | undefined {
  const tokenNames = [
    token.type,
    ...(Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : []),
  ];
  const resolvedStyles = tokenNames.flatMap((tokenName) => {
    switch (tokenName) {
      case "comment":
      case "prolog":
      case "doctype":
      case "cdata":
        return [markdownStyles.codeComment];
      case "keyword":
      case "atrule":
      case "selector":
      case "important":
        return [markdownStyles.codeKeyword];
      case "string":
      case "char":
      case "regex":
        return [markdownStyles.codeString];
      case "number":
      case "boolean":
      case "constant":
        return [markdownStyles.codeNumber];
      case "function":
      case "function-variable":
        return [markdownStyles.codeFunction];
      case "operator":
        return [markdownStyles.codeOperator];
      case "punctuation":
        return [markdownStyles.codePunctuation];
      case "class-name":
      case "builtin":
      case "type":
      case "namespace":
        return [markdownStyles.codeType];
      case "property":
      case "parameter":
        return [markdownStyles.codeProperty];
      case "tag":
        return [markdownStyles.codeTag];
      case "attr-name":
        return [markdownStyles.codeAttrName];
      case "attr-value":
        return [markdownStyles.codeAttrValue];
      case "bold":
        return [markdownStyles.codeImportant];
      default:
        return [];
    }
  });

  return resolvedStyles.length > 0 ? resolvedStyles : undefined;
}

function renderHighlightedCodeTokens(
  tokenStream: Prism.TokenStream,
  markdownStyles: MessageMarkdownStyles,
  keyPrefix: string,
): ReactNode[] {
  if (typeof tokenStream === "string") {
    return [tokenStream];
  }

  if (Array.isArray(tokenStream)) {
    return tokenStream.flatMap((token, index) =>
      renderHighlightedCodeTokens(token, markdownStyles, `${keyPrefix}-${index}`),
    );
  }

  return [
    <Text key={keyPrefix} style={getCodeTokenStyles(tokenStream, markdownStyles)}>
      {renderHighlightedCodeTokens(tokenStream.content, markdownStyles, `${keyPrefix}-content`)}
    </Text>,
  ];
}

function flattenReactNodes(children: ReactNode): ReactNode[] {
  if (Array.isArray(children)) {
    return children.flatMap((child) => flattenReactNodes(child));
  }
  if (children === null || children === undefined || typeof children === "boolean") {
    return [];
  }
  return [children];
}

function getTextLeafValue(node: ReactNode): string | null {
  if (typeof node === "string") {
    return node;
  }
  if (!isValidElement<MarkdownRenderElementProps>(node) || node.type !== Text) {
    return null;
  }
  const children = node.props.children;
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === "string") {
    return children[0];
  }
  return null;
}

function getUnderlineMarker(node: ReactNode): "open" | "close" | null {
  const value = getTextLeafValue(node);
  if (value === "<u>") {
    return "open";
  }
  if (value === "</u>") {
    return "close";
  }
  return null;
}

function normalizeUnderlineNodes(
  children: ReactNode,
  underlineStyle: TextStyle,
  keyPrefix: string,
): ReactNode[] {
  const flattenedChildren = flattenReactNodes(children);
  const normalizedChildren: ReactNode[] = [];
  let underlineBuffer: ReactNode[] | null = null;
  let openMarkerNode: ReactNode | null = null;

  flattenedChildren.forEach((child, index) => {
    const underlineMarker = getUnderlineMarker(child);
    const childKeyPrefix = `${keyPrefix}-${index}`;

    if (underlineMarker === "open" && underlineBuffer === null) {
      underlineBuffer = [];
      openMarkerNode = child;
      return;
    }

    if (underlineMarker === "close" && underlineBuffer !== null) {
      normalizedChildren.push(
        ...underlineBuffer.map((bufferedChild, bufferIndex) =>
          applyUnderlineToNode(
            bufferedChild,
            underlineStyle,
            `${childKeyPrefix}-underline-${bufferIndex}`,
          ),
        ),
      );
      underlineBuffer = null;
      openMarkerNode = null;
      return;
    }

    if (underlineBuffer !== null) {
      underlineBuffer.push(child);
      return;
    }

    normalizedChildren.push(normalizeMarkdownNode(child, underlineStyle, childKeyPrefix));
  });

  if (underlineBuffer !== null) {
    const trailingUnderlineBuffer = underlineBuffer as ReactNode[];
    if (openMarkerNode !== null) {
      normalizedChildren.push(
        normalizeMarkdownNode(openMarkerNode, underlineStyle, `${keyPrefix}-open`),
      );
    }
    normalizedChildren.push(
      ...trailingUnderlineBuffer.map((bufferedChild, bufferIndex) =>
        normalizeMarkdownNode(
          bufferedChild,
          underlineStyle,
          `${keyPrefix}-trailing-${bufferIndex}`,
        ),
      ),
    );
  }

  return normalizedChildren;
}

function normalizeMarkdownNode(
  node: ReactNode,
  underlineStyle: TextStyle,
  keyPrefix: string,
): ReactNode {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }
  if (Array.isArray(node)) {
    return normalizeUnderlineNodes(node, underlineStyle, keyPrefix);
  }
  if (!isValidElement<MarkdownRenderElementProps>(node)) {
    return node;
  }

  return cloneElement(
    node,
    {
      key: node.key ?? keyPrefix,
    },
    normalizeUnderlineNodes(node.props.children, underlineStyle, `${keyPrefix}-children`),
  );
}

function applyUnderlineToNode(
  node: ReactNode,
  underlineStyle: TextStyle,
  keyPrefix: string,
): ReactNode {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }
  if (Array.isArray(node)) {
    return normalizeUnderlineNodes(node, underlineStyle, keyPrefix).map((child, index) =>
      applyUnderlineToNode(child, underlineStyle, `${keyPrefix}-${index}`),
    );
  }
  if (typeof node === "string" || typeof node === "number") {
    return (
      <Text key={keyPrefix} selectable style={underlineStyle}>
        {node}
      </Text>
    );
  }
  if (!isValidElement<MarkdownRenderElementProps>(node)) {
    return node;
  }

  const children = normalizeUnderlineNodes(
    node.props.children,
    underlineStyle,
    `${keyPrefix}-children`,
  );
  if (node.type === Text) {
    return cloneElement(
      node,
      {
        key: node.key ?? keyPrefix,
        style: node.props.style ? [node.props.style, underlineStyle] : underlineStyle,
      },
      children,
    );
  }

  return cloneElement(
    node,
    {
      key: node.key ?? keyPrefix,
    },
    children.map((child, index) =>
      applyUnderlineToNode(child, underlineStyle, `${keyPrefix}-${index}`),
    ),
  );
}

class ChatMarkdownRenderer extends Renderer {
  constructor(private readonly markdownStyles: MessageMarkdownStyles) {
    super();
  }

  override code(
    text: string,
    language?: string,
    _containerStyle?: ViewStyle,
    _textStyle?: TextStyle,
  ): ReactNode {
    const normalizedLanguage = language?.trim();
    const trimmedText = text.replace(/[\r\n]+$/u, "");
    const prismGrammar = getPrismGrammar(normalizedLanguage);
    const highlightedContent = prismGrammar
      ? renderHighlightedCodeTokens(
          Prism.tokenize(trimmedText, prismGrammar.grammar),
          this.markdownStyles,
          `${this.getKey()}-code`,
        )
      : trimmedText;

    return (
      <View key={this.getKey()} style={this.markdownStyles.codeBlock}>
        {normalizedLanguage ? (
          <View style={this.markdownStyles.codeHeader}>
            <Text style={this.markdownStyles.codeHeaderLabel}>{normalizedLanguage}</Text>
          </View>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={this.markdownStyles.codeScroll}
          contentContainerStyle={this.markdownStyles.codeScrollContent}
        >
          <View style={this.markdownStyles.codeContent}>
            <Text selectable style={this.markdownStyles.codeText}>
              {highlightedContent}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  override codespan(text: string, styles?: TextStyle): ReactNode {
    return (
      <Text key={this.getKey()} selectable style={[styles, this.markdownStyles.codespan]}>
        {text}
      </Text>
    );
  }
}

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

function formatInteractionModeIcon(mode: ProviderInteractionMode): FeatherIconName {
  return mode === "plan" ? "file-text" : "message-square";
}

function formatTurnDispatchModeIcon(mode: TurnDispatchMode): FeatherIconName {
  return mode === "live" ? "chevrons-right" : "clock";
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

function base64ByteLength(input: string) {
  const paddingChars = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
  return Math.floor((input.length * 3) / 4) - paddingChars;
}

function formatByteSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function normalizeImageAttachmentName(fileName: string | null | undefined) {
  const baseName = fileName ? basenameOf(fileName) : "image";
  const withoutExtension = baseName.replace(/\.[^.]+$/, "").trim() || "image";
  return `${withoutExtension}.jpg`;
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

function readPayloadNumber(payload: unknown, key: string) {
  const record = asRecord(payload);
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

type PendingUserInputRequest = {
  readonly requestId: string;
  readonly questions: ReadonlyArray<UserInputQuestion>;
};

type PendingUserInputSelectionState = Record<string, Record<string, string | string[]>>;
type PendingUserInputOtherState = Record<string, Record<string, string>>;
type ThreadTimelineMessageEntry = {
  readonly kind: "message";
  readonly id: string;
  readonly createdAt: string;
  readonly message: OrchestrationMessage;
};
type ThreadTimelineActivityGroupEntry = {
  readonly kind: "activityGroup";
  readonly id: string;
  readonly createdAt: string;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
};
type ThreadTimelineEntry = ThreadTimelineMessageEntry | ThreadTimelineActivityGroupEntry;

const INLINE_ACTIVITY_KINDS = new Set([
  "content.delta",
  "runtime.warning",
  "runtime.error",
  "turn.plan.updated",
  "task.started",
  "task.progress",
  "task.completed",
  "tool.started",
  "tool.updated",
  "tool.completed",
]);

function readPayloadBoolean(payload: unknown, key: string) {
  const record = asRecord(payload);
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function readPayloadQuestions(payload: unknown): ReadonlyArray<UserInputQuestion> {
  const record = asRecord(payload);
  const rawQuestions = Array.isArray(record?.questions) ? record.questions : [];

  return rawQuestions.flatMap((entry) => {
    const question = asRecord(entry);
    if (!question) {
      return [];
    }

    const id = typeof question.id === "string" && question.id.trim() ? question.id.trim() : null;
    const header =
      typeof question.header === "string" && question.header.trim() ? question.header.trim() : null;
    const prompt =
      typeof question.question === "string" && question.question.trim()
        ? question.question.trim()
        : null;
    const options = (Array.isArray(question.options) ? question.options : []).flatMap((option) => {
      const optionRecord = asRecord(option);
      if (!optionRecord) {
        return [];
      }

      const label =
        typeof optionRecord.label === "string" && optionRecord.label.trim()
          ? optionRecord.label.trim()
          : null;
      const description =
        typeof optionRecord.description === "string" && optionRecord.description.trim()
          ? optionRecord.description.trim()
          : null;
      return label && description ? [{ label, description }] : [];
    });

    if (!id || !header || !prompt || options.length === 0) {
      return [];
    }

    return [
      {
        id,
        header,
        question: prompt,
        options,
        ...(readPayloadBoolean(question, "multiSelect") ? { multiSelect: true } : {}),
      } satisfies UserInputQuestion,
    ];
  });
}

function shouldRenderInlineActivity(activity: OrchestrationThreadActivity) {
  return INLINE_ACTIVITY_KINDS.has(activity.kind);
}

function timelineMessagePriority(message: OrchestrationMessage) {
  switch (message.role) {
    case "user":
      return 0;
    case "assistant":
      return 2;
    default:
      return 3;
  }
}

function compareInlineActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
) {
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
}

function buildThreadTimelineEntries(
  messages: ReadonlyArray<OrchestrationMessage>,
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<ThreadTimelineEntry> {
  const merged = sortReadonlyArray(
    [
      ...messages.map((message) => ({ kind: "message" as const, message })),
      ...activities
        .filter((activity) => shouldRenderInlineActivity(activity))
        .map((activity) => ({ kind: "activity" as const, activity })),
    ],
    (left, right) => {
      if (left.kind === "activity" && right.kind === "activity") {
        return compareInlineActivities(left.activity, right.activity);
      }

      const leftCreatedAt =
        left.kind === "message" ? left.message.createdAt : left.activity.createdAt;
      const rightCreatedAt =
        right.kind === "message" ? right.message.createdAt : right.activity.createdAt;
      if (leftCreatedAt !== rightCreatedAt) {
        return leftCreatedAt.localeCompare(rightCreatedAt);
      }

      const leftPriority = left.kind === "message" ? timelineMessagePriority(left.message) : 1;
      const rightPriority = right.kind === "message" ? timelineMessagePriority(right.message) : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      const leftId = left.kind === "message" ? left.message.id : left.activity.id;
      const rightId = right.kind === "message" ? right.message.id : right.activity.id;
      return leftId.localeCompare(rightId);
    },
  );

  const timeline: ThreadTimelineEntry[] = [];
  let bufferedActivities: OrchestrationThreadActivity[] = [];

  const flushBufferedActivities = () => {
    const firstActivity = bufferedActivities[0];
    const lastActivity = bufferedActivities[bufferedActivities.length - 1];
    if (!firstActivity || !lastActivity) {
      bufferedActivities = [];
      return;
    }

    timeline.push({
      kind: "activityGroup",
      id: `activity-group:${firstActivity.id}:${lastActivity.id}`,
      createdAt: firstActivity.createdAt,
      activities: bufferedActivities,
    });
    bufferedActivities = [];
  };

  for (const entry of merged) {
    if (entry.kind === "activity") {
      bufferedActivities = [...bufferedActivities, entry.activity];
      continue;
    }

    flushBufferedActivities();
    timeline.push({
      kind: "message",
      id: entry.message.id,
      createdAt: entry.message.createdAt,
      message: entry.message,
    });
  }

  flushBufferedActivities();
  return timeline;
}

function summarizePreviewText(value: string, limit = 140) {
  const firstNonEmptyLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstNonEmptyLine) {
    return null;
  }
  const compact = firstNonEmptyLine.replace(/\s+/g, " ");
  return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

function readPlanStepLines(payload: unknown) {
  const payloadRecord = asRecord(payload);
  const plan = Array.isArray(payloadRecord?.plan) ? payloadRecord.plan : [];
  return plan.flatMap((entry) => {
    const stepRecord = asRecord(entry);
    const step =
      typeof stepRecord?.step === "string" && stepRecord.step.trim()
        ? stepRecord.step.trim()
        : null;
    if (!step) {
      return [];
    }

    const status =
      typeof stepRecord?.status === "string" && stepRecord.status.trim()
        ? stepRecord.status.trim()
        : "pending";
    const statusLabel =
      status === "inProgress" || status === "in_progress"
        ? "in progress"
        : status === "completed"
          ? "completed"
          : "pending";
    return [`[${statusLabel}] ${step}`];
  });
}

function activityPreviewText(activity: OrchestrationThreadActivity) {
  const delta = readPayloadString(activity.payload, "delta");
  if (delta) {
    return summarizePreviewText(delta);
  }

  const detail =
    readPayloadString(activity.payload, "detail") ??
    readPayloadString(activity.payload, "message") ??
    readPayloadString(activity.payload, "explanation");
  if (detail) {
    return summarizePreviewText(detail);
  }

  if (activity.kind === "turn.plan.updated") {
    return summarizePreviewText(readPlanStepLines(activity.payload).join(" / "));
  }

  return null;
}

function activityGroupTitle(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  const lastActivity = activities[activities.length - 1];
  if (!lastActivity) {
    return "Runtime updates";
  }
  return activities.length === 1 ? lastActivity.summary : `${activities.length} runtime updates`;
}

function activityGroupPreview(activities: ReadonlyArray<OrchestrationThreadActivity>) {
  for (const activity of activities.toReversed()) {
    const preview = activityPreviewText(activity);
    if (preview) {
      return preview;
    }
  }

  const summaries = Array.from(new Set(activities.map((activity) => activity.summary)));
  if (summaries.length === 0) {
    return null;
  }

  return summaries.slice(Math.max(0, summaries.length - 3)).join(" / ");
}

function activityIcon(activity: OrchestrationThreadActivity): FeatherIconName {
  const streamKind = readPayloadString(activity.payload, "streamKind");
  if (streamKind === "file_change_output") {
    return "edit-3";
  }
  if (streamKind === "command_output") {
    return "terminal";
  }
  if (streamKind === "reasoning_text" || streamKind === "reasoning_summary_text") {
    return "cpu";
  }
  if (streamKind === "plan_text" || activity.kind === "turn.plan.updated") {
    return "list";
  }
  if (activity.kind === "runtime.warning" || activity.kind === "runtime.error") {
    return "alert-triangle";
  }
  if (activity.kind.startsWith("tool.")) {
    return "tool";
  }
  if (activity.kind.startsWith("task.")) {
    return "activity";
  }
  return "activity";
}

function activityEyebrow(activity: OrchestrationThreadActivity) {
  const streamKind = readPayloadString(activity.payload, "streamKind");
  switch (streamKind) {
    case "file_change_output":
      return "Edit";
    case "command_output":
      return "Command";
    case "reasoning_text":
      return "Reasoning";
    case "reasoning_summary_text":
      return "Summary";
    case "plan_text":
      return "Plan";
    default:
      break;
  }

  if (activity.kind.startsWith("tool.")) {
    return "Tool";
  }
  if (activity.kind.startsWith("task.")) {
    return "Task";
  }
  if (activity.kind === "runtime.warning") {
    return "Warning";
  }
  if (activity.kind === "runtime.error") {
    return "Error";
  }
  if (activity.kind === "turn.plan.updated") {
    return "Plan";
  }
  return "Activity";
}

function activityBody(activity: OrchestrationThreadActivity): {
  readonly kind: "code" | "text";
  readonly language: string | null;
  readonly value: string;
} | null {
  const streamKind = readPayloadString(activity.payload, "streamKind");
  const delta = readPayloadString(activity.payload, "delta");
  if (delta) {
    return {
      kind:
        streamKind === "file_change_output" || streamKind === "command_output" ? "code" : "text",
      language:
        streamKind === "file_change_output"
          ? "diff"
          : streamKind === "command_output"
            ? "bash"
            : null,
      value: delta,
    };
  }

  if (activity.kind === "turn.plan.updated") {
    const lines: string[] = [];
    const explanation = readPayloadString(activity.payload, "explanation");
    if (explanation) {
      lines.push(explanation);
    }

    const planLines = readPlanStepLines(activity.payload);
    if (planLines.length > 0) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(...planLines);
    }

    if (lines.length > 0) {
      return {
        kind: "text",
        language: null,
        value: lines.join("\n"),
      };
    }
  }

  const detail =
    readPayloadString(activity.payload, "detail") ?? readPayloadString(activity.payload, "message");
  if (!detail) {
    return null;
  }

  return {
    kind: "text",
    language: null,
    value: detail,
  };
}

function TimelineCodeBlock({
  language,
  value,
}: {
  readonly language: string | null;
  readonly value: string;
}) {
  const { styles } = useAppThemeContext();
  return (
    <View style={styles.timelineActivityCodeBlock}>
      <View style={styles.timelineActivityCodeHeader}>
        <Text style={styles.timelineActivityCodeHeaderLabel}>{language ?? "text"}</Text>
      </View>
      <ScrollView
        horizontal
        style={styles.timelineActivityCodeScroll}
        contentContainerStyle={styles.timelineActivityCodeScrollContent}
      >
        <Text selectable style={styles.timelineActivityCodeText}>
          {value}
        </Text>
      </ScrollView>
    </View>
  );
}

function TimelineActivityGroup({
  activities,
  expanded,
  onToggle,
}: {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const { styles, theme } = useAppThemeContext();
  const latestActivity = activities[activities.length - 1];
  if (!latestActivity) {
    return null;
  }

  const preview = activityGroupPreview(activities);
  return (
    <View style={styles.timelineActivityWrap}>
      <Pressable onPress={onToggle} style={styles.timelineActivitySummaryRow}>
        <View style={styles.timelineActivitySummaryHeader}>
          <Feather
            color={theme.muted}
            name={expanded ? "chevron-down" : "chevron-right"}
            size={14}
          />
          <Feather color={theme.accent} name={activityIcon(latestActivity)} size={14} />
          <Text style={styles.timelineActivitySummaryTitle}>{activityGroupTitle(activities)}</Text>
        </View>
        <Text style={styles.timelineActivitySummaryMeta}>
          {formatTimestamp(latestActivity.createdAt)}
        </Text>
      </Pressable>
      {preview ? <Text style={styles.timelineActivitySummaryPreview}>{preview}</Text> : null}
      {expanded ? (
        <View style={styles.timelineActivityExpandedList}>
          {activities.map((activity) => {
            const body = activityBody(activity);
            return (
              <View key={activity.id} style={styles.timelineActivityExpandedItem}>
                <View style={styles.timelineActivityExpandedHeader}>
                  <Text style={styles.timelineActivityExpandedEyebrow}>
                    {activityEyebrow(activity)}
                  </Text>
                  <Text style={styles.timelineActivityExpandedTimestamp}>
                    {formatTimestamp(activity.createdAt)}
                  </Text>
                </View>
                <Text style={styles.timelineActivityExpandedTitle}>{activity.summary}</Text>
                {body ? (
                  body.kind === "code" ? (
                    <TimelineCodeBlock language={body.language} value={body.value} />
                  ) : (
                    <Text selectable style={styles.timelineActivityExpandedText}>
                      {body.value}
                    </Text>
                  )
                ) : null}
                {readPayloadBoolean(activity.payload, "truncated") ? (
                  <Text style={styles.timelineActivityExpandedHint}>Stored chunk truncated.</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

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

function findPendingUserInputRequest(
  thread: OrchestrationThread | null,
): PendingUserInputRequest | null {
  if (!thread) {
    return null;
  }

  const resolvedRequestIds = new Set<string>();

  for (const activity of sortActivities(thread.activities).toReversed()) {
    const requestId = readPayloadString(activity.payload, "requestId");
    if (!requestId) {
      continue;
    }

    if (activity.kind === "user-input.resolved") {
      resolvedRequestIds.add(requestId);
      continue;
    }

    if (activity.kind !== "user-input.requested" || resolvedRequestIds.has(requestId)) {
      continue;
    }

    const questions = readPayloadQuestions(activity.payload);
    if (questions.length === 0) {
      continue;
    }

    return {
      requestId,
      questions,
    };
  }

  return null;
}

function findLatestActiveTaskType(thread: OrchestrationThread | null): string | null {
  const activeTurnId = thread?.latestTurn?.turnId ?? null;
  if (!thread || !activeTurnId) {
    return null;
  }

  for (const activity of sortActivities(thread.activities).toReversed()) {
    if (activity.turnId !== activeTurnId || activity.kind !== "task.started") {
      continue;
    }

    return readPayloadString(activity.payload, "taskType");
  }

  return null;
}

function readRemainingContextPercent(usage: unknown): number | null {
  const usageRecord = asRecord(usage);
  const normalizedUsage = asRecord(usageRecord?.tokenUsage) ?? usageRecord;
  if (!normalizedUsage) {
    return null;
  }

  const totalTokens =
    readPayloadNumber(normalizedUsage.total, "totalTokens") ??
    readPayloadNumber(normalizedUsage.total, "total_tokens") ??
    readPayloadNumber(normalizedUsage, "totalTokens") ??
    readPayloadNumber(normalizedUsage, "total_tokens");
  const modelContextWindow =
    readPayloadNumber(normalizedUsage, "modelContextWindow") ??
    readPayloadNumber(normalizedUsage, "model_context_window");
  if (totalTokens === null || modelContextWindow === null || modelContextWindow <= 0) {
    return null;
  }

  const remainingPercent = ((modelContextWindow - totalTokens) / modelContextWindow) * 100;
  return Math.max(0, Math.min(100, Math.round(remainingPercent)));
}

function findThreadRemainingContextPercent(thread: OrchestrationThread | null): number | null {
  if (!thread) {
    return null;
  }

  for (const activity of sortActivities(thread.activities).toReversed()) {
    if (activity.kind !== "thread.token-usage.updated") {
      continue;
    }

    const remainingPercent = readRemainingContextPercent(asRecord(activity.payload)?.usage);
    if (remainingPercent !== null) {
      return remainingPercent;
    }
  }

  return null;
}

function formatThreadModelLabel(thread: OrchestrationThread | null) {
  const model = thread?.model ?? FALLBACK_MODEL;
  const remainingContextPercent = findThreadRemainingContextPercent(thread);
  if (remainingContextPercent === null) {
    return model;
  }
  return `${model} (${remainingContextPercent}%)`;
}

function getUserInputAnswerKey(
  provider: "codex" | "claudeAgent" | null,
  question: UserInputQuestion,
) {
  return provider === "claudeAgent" ? question.question : question.id;
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

function MarkdownMessage({ value }: { readonly value: string }) {
  const { styles, theme } = useAppThemeContext();
  const markdownStyles = useMemo<MarkedStyles>(
    () => ({
      text: styles.messageMarkdownText,
      paragraph: styles.messageMarkdownParagraph,
      link: styles.messageMarkdownLink,
      blockquote: styles.messageMarkdownBlockquote,
      h1: styles.messageMarkdownHeading1,
      h2: styles.messageMarkdownHeading2,
      h3: styles.messageMarkdownHeading3,
      h4: styles.messageMarkdownHeading4,
      h5: styles.messageMarkdownHeading5,
      h6: styles.messageMarkdownHeading6,
      codespan: styles.messageMarkdownCodespan,
      code: styles.messageMarkdownCode,
      hr: styles.messageMarkdownRule,
      list: styles.messageMarkdownList,
      li: styles.messageMarkdownListItem,
      table: styles.messageMarkdownTable,
      tableRow: styles.messageMarkdownTableRow,
      tableCell: styles.messageMarkdownTableCell,
      strong: styles.messageMarkdownStrong,
      em: styles.messageMarkdownEmphasis,
      strikethrough: styles.messageMarkdownStrikethrough,
    }),
    [styles],
  );
  const renderer = useMemo(
    () =>
      new ChatMarkdownRenderer({
        root: styles.messageMarkdownRoot,
        text: styles.messageMarkdownText,
        paragraph: styles.messageMarkdownParagraph,
        link: styles.messageMarkdownLink,
        blockquote: styles.messageMarkdownBlockquote,
        heading: styles.messageMarkdownHeading3,
        codespan: styles.messageMarkdownCodespan,
        codeBlock: styles.messageMarkdownCode,
        codeHeader: styles.messageMarkdownCodeHeader,
        codeHeaderLabel: styles.messageMarkdownCodeHeaderLabel,
        codeScroll: styles.messageMarkdownCodeScroll,
        codeScrollContent: styles.messageMarkdownCodeScrollContent,
        codeContent: styles.messageMarkdownCodeContent,
        codeText: styles.messageMarkdownCodeText,
        codeComment: styles.messageMarkdownCodeComment,
        codeKeyword: styles.messageMarkdownCodeKeyword,
        codeString: styles.messageMarkdownCodeString,
        codeNumber: styles.messageMarkdownCodeNumber,
        codeFunction: styles.messageMarkdownCodeFunction,
        codeOperator: styles.messageMarkdownCodeOperator,
        codePunctuation: styles.messageMarkdownCodePunctuation,
        codeType: styles.messageMarkdownCodeType,
        codeProperty: styles.messageMarkdownCodeProperty,
        codeTag: styles.messageMarkdownCodeTag,
        codeAttrName: styles.messageMarkdownCodeAttrName,
        codeAttrValue: styles.messageMarkdownCodeAttrValue,
        codeImportant: styles.messageMarkdownCodeImportant,
        rule: styles.messageMarkdownRule,
        list: styles.messageMarkdownList,
        listItem: styles.messageMarkdownListItem,
        table: styles.messageMarkdownTable,
        tableRow: styles.messageMarkdownTableRow,
        tableCell: styles.messageMarkdownTableCell,
        strong: styles.messageMarkdownStrong,
        emphasis: styles.messageMarkdownEmphasis,
        strikethrough: styles.messageMarkdownStrikethrough,
      }),
    [styles],
  );
  const elements = useMarkdown(value, {
    colorScheme: "dark",
    renderer,
    styles: markdownStyles,
    theme: {
      colors: {
        background: theme.background,
        border: theme.border,
        code: theme.panelAlt,
        link: theme.accent,
        text: theme.text,
      },
    },
  });
  const normalizedElements = useMemo(
    () => normalizeUnderlineNodes(elements, styles.messageMarkdownUnderline, "markdown"),
    [elements, styles.messageMarkdownUnderline],
  );

  return <View style={styles.messageMarkdownRoot}>{normalizedElements}</View>;
}

function isThreadWaitingForResponse(
  thread: OrchestrationThread | null,
  hasPendingServerResponse: boolean,
) {
  const sessionStatus = thread?.session?.status ?? "idle";
  return (
    hasPendingServerResponse ||
    thread?.latestTurn?.state === "running" ||
    sessionStatus === "starting" ||
    sessionStatus === "running"
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
    dismissServerNotification,
    errorMessage,
    confirmNotificationDelivery,
    gitCheckout,
    gitCreateBranch,
    gitDeleteBranch,
    gitListBranches,
    gitPrepareMainlineMerge,
    gitPull,
    gitRunStackedAction,
    gitStatus,
    getConversationCapabilities,
    interruptTurn,
    lastPushSequence,
    listDirectory,
    pendingServerResponseThreadIds,
    refreshSnapshot,
    respondToApproval,
    respondToUserInput,
    resolvedWebSocketUrl,
    sendTurn,
    sendTestNotification,
    serverConfig,
    serverNotifications,
    setNotificationSettings,
    setConnectionSettings,
    settingsReady,
    snapshot,
    status,
    stopSession,
    updateThreadBranch,
    updateThreadInteractionMode,
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
  const [pushoverAppTokenDraft, setPushoverAppTokenDraft] = useState("");
  const [pushoverUserKeyDraft, setPushoverUserKeyDraft] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [hiddenRecentThreadIds, setHiddenRecentThreadIds] = useState<string[]>([]);
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [threadDraftAttachments, setThreadDraftAttachments] = useState<
    Record<string, DraftImageAttachment[]>
  >({});
  const [threadTurnPreferences, setThreadTurnPreferences] = useState<
    Record<string, ThreadTurnPreference>
  >({});
  const [threadTurnPreferencesReady, setThreadTurnPreferencesReady] = useState(false);
  const [pendingUserInputSelections, setPendingUserInputSelections] =
    useState<PendingUserInputSelectionState>({});
  const [pendingUserInputOtherDrafts, setPendingUserInputOtherDrafts] =
    useState<PendingUserInputOtherState>({});
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [expandedActivityGroupIds, setExpandedActivityGroupIds] = useState<Record<string, true>>(
    {},
  );
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
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false);
  const [isProjectBuilderMutating, setIsProjectBuilderMutating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [gitRepoStatus, setGitRepoStatus] = useState<GitStatusResult | null>(null);
  const [gitBranches, setGitBranches] = useState<GitListBranchesResult | null>(null);
  const [isLoadingGitState, setIsLoadingGitState] = useState(false);
  const [gitCommitMessageDraft, setGitCommitMessageDraft] = useState("");
  const [gitBranchNameDraft, setGitBranchNameDraft] = useState("");
  const [gitMergeUseSquash, setGitMergeUseSquash] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const navTranslateX = useRef(new Animated.Value(-sidebarWidth)).current;
  const settingsTranslateX = useRef(new Animated.Value(floatingPanelWidth)).current;
  const workspaceOpacity = useRef(new Animated.Value(1)).current;
  const workspaceTranslateY = useRef(new Animated.Value(0)).current;
  const messageMetaOpacity = useRef(new Animated.Value(0)).current;
  const messageMetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceNotificationChannelReadyRef = useRef(false);
  const messagesScrollRef = useRef<ScrollView | null>(null);
  const processingServerNotificationRef = useRef(false);
  const directoryLoadSequenceRef = useRef(0);
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
  const timelineEntries = useMemo(
    () => buildThreadTimelineEntries(messages, selectedThread?.activities ?? []),
    [messages, selectedThread?.activities],
  );
  const queuedPositionByMessageId = useMemo(() => {
    const positions = new Map<string, number>();
    for (const [index, queuedTurn] of (selectedThread?.queuedTurns ?? []).entries()) {
      positions.set(queuedTurn.messageId, index + 1);
    }
    return positions;
  }, [selectedThread?.queuedTurns]);
  const highlightedAssistantMessageId =
    messages[messages.length - 1]?.role === "assistant" ? messages[messages.length - 1]?.id : null;
  const pendingApprovalRequest = findPendingApprovalRequest(selectedThread);
  const selectedThreadDisplayTitle = getThreadDisplayTitle(selectedThread);
  const draft = selectedThread ? (threadDrafts[selectedThread.id] ?? "") : "";
  const draftAttachments = selectedThread ? (threadDraftAttachments[selectedThread.id] ?? []) : [];
  const isConnected = status === "connected";
  const providers = serverConfig?.providers ?? [];
  const notificationsEnabled = serverConfig?.notifications.enabled ?? true;
  const notificationsConfigured = serverConfig?.notifications.pushover.configured ?? false;
  const supportsDeviceNotifications = !(
    Platform.OS === "android" && Constants.appOwnership === ANDROID_EXPO_GO_APP_OWNERSHIP
  );
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
          turnDispatchMode: stored?.turnDispatchMode ?? "live",
          runtimeMode: stored?.runtimeMode ?? selectedThread.runtimeMode ?? "full-access",
          interactionMode: stored?.interactionMode ?? selectedThread.interactionMode ?? "default",
        } satisfies ThreadTurnPreference;
      })()
    : null;
  const selectedRuntimeMode =
    selectedThreadTurnPreference?.runtimeMode ?? selectedThread?.runtimeMode ?? "full-access";
  const selectedInteractionMode =
    selectedThreadTurnPreference?.interactionMode ?? selectedThread?.interactionMode ?? "default";
  const selectedTurnDispatchMode = selectedThreadTurnPreference?.turnDispatchMode ?? "live";
  const selectedThreadHasPendingServerResponse =
    selectedThread !== null && pendingServerResponseThreadIds.includes(selectedThread.id);
  const pendingUserInputRequest = findPendingUserInputRequest(selectedThread);
  const activeTaskType = findLatestActiveTaskType(selectedThread);
  const sessionStatus = selectedThread?.session?.status ?? "idle";
  const sessionBusy = isThreadWaitingForResponse(
    selectedThread,
    selectedThreadHasPendingServerResponse,
  );
  const showWaitingIndicator = selectedThread !== null && sessionBusy;
  const waitingIndicatorLabel =
    pendingUserInputRequest !== null
      ? "awaiting input"
      : activeTaskType === "plan"
        ? "planning"
        : activeTaskType === "default"
          ? "executing"
          : selectedInteractionMode === "plan"
            ? "planning"
            : "executing";

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
  const canSend =
    selectedThread !== null &&
    isConnected &&
    busyAction === null &&
    pendingApprovalRequest === null &&
    pendingUserInputRequest === null &&
    (draft.trim().length > 0 || draftAttachments.length > 0);
  const projectBuilderNavigationDisabled = isProjectBuilderMutating || busyAction !== null;
  const projectBuilderSubmitDisabled =
    isProjectBuilderMutating || isLoadingDirectory || busyAction !== null;

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
    setPushoverAppTokenDraft(serverConfig?.notifications.pushover.appToken ?? "");
    setPushoverUserKeyDraft(serverConfig?.notifications.pushover.userKey ?? "");
  }, [serverConfig?.notifications.pushover.appToken, serverConfig?.notifications.pushover.userKey]);

  const ensureDeviceNotificationsReady = useCallback(
    async (promptForPermission: boolean) => {
      if (!supportsDeviceNotifications) {
        return false;
      }

      const notificationsModule = await loadNotificationsModule();
      if (Platform.OS === "android" && !deviceNotificationChannelReadyRef.current) {
        await notificationsModule.setNotificationChannelAsync(DEVICE_NOTIFICATION_CHANNEL_ID, {
          name: "Turn updates",
          importance: notificationsModule.AndroidImportance.DEFAULT,
        });
        deviceNotificationChannelReadyRef.current = true;
      }

      let permissions = await notificationsModule.getPermissionsAsync();
      if (!permissions.granted && promptForPermission) {
        permissions = await notificationsModule.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: false,
            allowSound: false,
          },
        });
      }

      return permissions.granted;
    },
    [supportsDeviceNotifications],
  );

  useEffect(() => {
    if (processingServerNotificationRef.current || serverNotifications.length === 0) {
      return;
    }

    processingServerNotificationRef.current = true;
    const nextNotification = serverNotifications[0];
    if (!nextNotification) {
      processingServerNotificationRef.current = false;
      return;
    }

    void (async () => {
      try {
        if (AppState.currentState === "active") {
          showToast(formatServerNotificationToast(nextNotification));
          await confirmNotificationDelivery({
            notificationId: nextNotification.notificationId,
            delivery: "toast",
          });
          return;
        }

        const deviceNotificationsReady = await ensureDeviceNotificationsReady(false).catch(
          () => false,
        );
        if (!deviceNotificationsReady) {
          return;
        }

        const notificationsModule = await loadNotificationsModule();
        await notificationsModule.scheduleNotificationAsync({
          content: {
            title: nextNotification.title,
            body: nextNotification.message,
            data: {
              threadId: nextNotification.threadId,
              turnId: nextNotification.turnId,
              kind: nextNotification.kind,
            },
          },
          trigger: null,
        });

        await confirmNotificationDelivery({
          notificationId: nextNotification.notificationId,
          delivery: "device",
        });
      } finally {
        dismissServerNotification(nextNotification.notificationId);
        processingServerNotificationRef.current = false;
      }
    })();
  }, [
    confirmNotificationDelivery,
    dismissServerNotification,
    ensureDeviceNotificationsReady,
    serverNotifications,
  ]);

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
    setExpandedActivityGroupIds({});
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
  }, [selectedThreadConversationId, timelineEntries.length]);

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
    if (!showWaitingIndicator) {
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
  }, [showWaitingIndicator, waitingIndicatorMotion]);

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
    directoryLoadSequenceRef.current += 1;
    clearError();
    setProjectBuilderRoot(serverDirectoryHint.trim() || null);
    setNewFolderName("");
    setProjectTitleDraft("");
    setDirectoryCwd(null);
    setDirectoryEntries([]);
    setDirectoryTruncated(false);
    setIsLoadingDirectory(false);
    setIsProjectBuilderMutating(false);
    setProjectBuilderOpen(true);
  };

  const closeProjectBuilder = () => {
    directoryLoadSequenceRef.current += 1;
    setProjectBuilderOpen(false);
    setProjectBuilderRoot(null);
    setNewFolderName("");
    setIsLoadingDirectory(false);
    setIsProjectBuilderMutating(false);
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

  const updateDraftAttachments = (
    updater: (currentAttachments: DraftImageAttachment[]) => DraftImageAttachment[],
  ) => {
    clearError();
    if (!selectedThread) {
      return;
    }

    setThreadDraftAttachments((current) => ({
      ...current,
      [selectedThread.id]: updater(current[selectedThread.id] ?? []),
    }));
  };

  const buildDraftImageAttachment = (asset: ImagePicker.ImagePickerAsset) => {
    if (!asset.base64) {
      return null;
    }

    const sizeBytes = base64ByteLength(asset.base64);
    if (sizeBytes <= 0 || sizeBytes > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      return null;
    }

    return {
      id: createClientId("attachment"),
      type: "image" as const,
      name: normalizeImageAttachmentName(asset.fileName),
      mimeType: "image/jpeg",
      sizeBytes,
      dataUrl: `data:image/jpeg;base64,${asset.base64}`,
      previewUri: asset.uri,
    } satisfies DraftImageAttachment;
  };

  const handlePickImageAttachment = async () => {
    if (!selectedThread || busyAction !== null) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast("Photos access is required");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: false,
      base64: true,
      mediaTypes: ["images"],
      quality: 1,
    });
    if (result.canceled) {
      return;
    }

    const nextAttachments = result.assets
      .map((asset) => buildDraftImageAttachment(asset))
      .filter((asset): asset is DraftImageAttachment => asset !== null);

    if (nextAttachments.length === 0) {
      showToast(`Image must be under ${formatByteSize(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)}`);
      return;
    }

    updateDraftAttachments((current) => [...current, ...nextAttachments]);
    showToast(
      nextAttachments.length === 1 ? "Image attached" : `${nextAttachments.length} images attached`,
    );
  };

  const handleRemoveDraftAttachment = (attachmentId: string) => {
    updateDraftAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
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
        turnDispatchMode:
          patch.turnDispatchMode ?? current[selectedThread.id]?.turnDispatchMode ?? "live",
        runtimeMode:
          patch.runtimeMode ??
          current[selectedThread.id]?.runtimeMode ??
          selectedThread.runtimeMode ??
          "full-access",
        interactionMode:
          patch.interactionMode ??
          current[selectedThread.id]?.interactionMode ??
          selectedThread.interactionMode ??
          "default",
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

  const loadDirectory = useCallback(
    async (cwd: string) => {
      const nextSequence = directoryLoadSequenceRef.current + 1;
      directoryLoadSequenceRef.current = nextSequence;
      setIsLoadingDirectory(true);
      try {
        const listing = await listDirectory({ cwd });
        if (directoryLoadSequenceRef.current !== nextSequence) {
          return;
        }
        setDirectoryCwd(listing.cwd);
        setDirectoryEntries(listing.entries.filter((entry) => entry.kind === "directory"));
        setDirectoryTruncated(listing.truncated);
        setProjectTitleDraft(basenameOf(listing.cwd));
      } finally {
        if (directoryLoadSequenceRef.current === nextSequence) {
          setIsLoadingDirectory(false);
        }
      }
    },
    [listDirectory],
  );

  useEffect(() => {
    let cancelled = false;

    void loadThreadTurnPreferences().then((loaded) => {
      if (cancelled) {
        return;
      }

      setThreadTurnPreferences((current) => ({
        ...loaded,
        ...current,
      }));
      setThreadTurnPreferencesReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!threadTurnPreferencesReady) {
      return;
    }

    void saveThreadTurnPreferences(threadTurnPreferences);
  }, [threadTurnPreferences, threadTurnPreferencesReady]);

  useEffect(() => {
    if (!projectBuilderOpen || directoryCwd !== null) {
      return;
    }

    const nextRoot = projectBuilderRoot?.trim() ?? "";
    if (!nextRoot) {
      return;
    }

    void loadDirectory(nextRoot);
  }, [directoryCwd, loadDirectory, projectBuilderOpen, projectBuilderRoot]);

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
    if (!nextRoot || projectBuilderNavigationDisabled) {
      return;
    }
    await loadDirectory(nextRoot);
  };

  const handleOpenParentDirectory = async () => {
    const source = directoryCwd?.trim();
    if (!source || projectBuilderNavigationDisabled) {
      return;
    }

    await loadDirectory(parentDirectoryOf(source));
  };

  const handleCreateFolder = async () => {
    if (!directoryCwd || !newFolderName.trim() || projectBuilderSubmitDisabled) {
      return;
    }

    setIsProjectBuilderMutating(true);
    try {
      await createDirectory({
        cwd: directoryCwd,
        relativePath: newFolderName.trim(),
      });
      setNewFolderName("");
      await loadDirectory(directoryCwd);
    } finally {
      setIsProjectBuilderMutating(false);
    }
  };

  const handleCreateProject = async () => {
    const workspaceRoot = directoryCwd?.trim() ?? "";
    if (!workspaceRoot || projectBuilderSubmitDisabled) {
      return;
    }

    setIsProjectBuilderMutating(true);
    try {
      const projectId = await createProject({
        title: projectTitleDraft.trim() || basenameOf(workspaceRoot),
        workspaceRoot,
        defaultModel: FALLBACK_MODEL,
      });

      setSelectedProjectId(projectId);
      setSelectedThreadId(null);
      closeProjectBuilder();
    } finally {
      setIsProjectBuilderMutating(false);
    }
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

  const handlePullToRefresh = async () => {
    if (isPullRefreshing) {
      return;
    }

    setIsPullRefreshing(true);
    try {
      await refreshSnapshot();
    } finally {
      setIsPullRefreshing(false);
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

  const toggleActivityGroup = (groupId: string) => {
    setExpandedActivityGroupIds((current) => {
      if (groupId in current) {
        const next = { ...current };
        delete next[groupId];
        return next;
      }

      return {
        ...current,
        [groupId]: true,
      };
    });
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

  const resolveNotificationSettingsInput = (input?: {
    readonly enabled?: boolean;
    readonly appToken: string | null;
    readonly userKey: string | null;
  }) => ({
    enabled: input?.enabled ?? serverConfig?.notifications.enabled ?? true,
    appToken:
      input?.appToken ??
      (pushoverAppTokenDraft.trim().length > 0 ? pushoverAppTokenDraft.trim() : null),
    userKey:
      input?.userKey ??
      (pushoverUserKeyDraft.trim().length > 0 ? pushoverUserKeyDraft.trim() : null),
  });

  const saveNotificationSettings = async (input?: {
    readonly enabled?: boolean;
    readonly appToken: string | null;
    readonly userKey: string | null;
  }) => {
    if (!serverConfig) {
      throw new Error("Wait for the server configuration before updating notifications.");
    }

    const nextSettings = resolveNotificationSettingsInput(input);

    return setNotificationSettings({
      enabled: nextSettings.enabled,
      pushover: {
        appToken: nextSettings.appToken,
        userKey: nextSettings.userKey,
      },
    });
  };

  const handleSaveNotificationSettings = async (input?: {
    readonly enabled?: boolean;
    readonly appToken: string | null;
    readonly userKey: string | null;
  }) => {
    const nextSettings = resolveNotificationSettingsInput(input);
    const notifications = await saveNotificationSettings(input);

    const deviceNotificationsEnabled = await ensureDeviceNotificationsReady(true).catch(
      () => false,
    );
    if (nextSettings.appToken === null) {
      setPushoverAppTokenDraft("");
    }
    if (nextSettings.userKey === null) {
      setPushoverUserKeyDraft("");
    }

    showToast(
      !notifications.enabled
        ? "Notifications muted"
        : notifications.pushover.configured
          ? deviceNotificationsEnabled
            ? "Notification delivery updated"
            : supportsDeviceNotifications
              ? "Saved. Device alerts are disabled, so missed app delivery falls back to Pushover."
              : "Saved. Android Expo Go cannot test device alerts, so missed app delivery falls back to Pushover."
          : "Notification settings cleared",
    );
  };

  const handleSetNotificationsEnabled = async (enabled: boolean) => {
    const notifications = await saveNotificationSettings({
      enabled,
      appToken: serverConfig?.notifications.pushover.appToken ?? null,
      userKey: serverConfig?.notifications.pushover.userKey ?? null,
    });
    showToast(notifications.enabled ? "Notifications enabled" : "Notifications muted");
  };

  const handleSendTestNotification = async (mode: "auto" | "pushover") => {
    const result = await sendTestNotification({ mode });
    if (mode === "pushover") {
      showToast("Pushover test sent");
      return;
    }

    if (result.delivery === "pushover") {
      showToast("Test alert fell back to Pushover");
    }
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

  const handleSelectTurnDispatchMode = (mode: TurnDispatchMode) => {
    updateThreadTurnPreference({ turnDispatchMode: mode });
    showToast(mode === "live" ? "Delivery: Live" : "Delivery: Queue");
    closeConversationPicker();
  };

  const handleToggleTurnDispatchMode = () => {
    handleSelectTurnDispatchMode(selectedTurnDispatchMode === "live" ? "queue" : "live");
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
    if (selectedRuntimeMode === runtimeMode) {
      closeConversationPicker();
      return;
    }

    await updateThreadRuntimeMode({
      threadId: selectedThread.id,
      runtimeMode,
    });
    updateThreadTurnPreference({ runtimeMode });
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
      selectedRuntimeMode === "approval-required" ? "full-access" : "approval-required",
    );
  };

  const handleSelectConversationInteractionMode = async (
    interactionMode: ProviderInteractionMode,
  ) => {
    if (!selectedThread) {
      return;
    }
    if (selectedInteractionMode === interactionMode) {
      return;
    }

    await updateThreadInteractionMode({
      threadId: selectedThread.id,
      interactionMode,
    });
    updateThreadTurnPreference({ interactionMode });
    showToast(interactionMode === "plan" ? "Mode: Plan" : "Mode: Default");
  };

  const handleToggleConversationInteractionMode = async () => {
    await handleSelectConversationInteractionMode(
      selectedInteractionMode === "plan" ? "default" : "plan",
    );
  };

  const updatePendingUserInputSelection = (
    requestId: string,
    answerKey: string,
    value: string | string[],
  ) => {
    setPendingUserInputSelections((current) => ({
      ...current,
      [requestId]: {
        ...current[requestId],
        [answerKey]: value,
      },
    }));
  };

  const updatePendingUserInputOtherDraft = (
    requestId: string,
    answerKey: string,
    value: string,
  ) => {
    setPendingUserInputOtherDrafts((current) => ({
      ...current,
      [requestId]: {
        ...current[requestId],
        [answerKey]: value,
      },
    }));
  };

  const handleTogglePendingUserInputOption = (question: UserInputQuestion, optionLabel: string) => {
    if (!pendingUserInputRequest) {
      return;
    }

    const answerKey = getUserInputAnswerKey(selectedConversationProvider, question);
    const currentValue = pendingUserInputSelections[pendingUserInputRequest.requestId]?.[answerKey];

    if (question.multiSelect) {
      const currentAnswers = Array.isArray(currentValue)
        ? currentValue
        : typeof currentValue === "string" && currentValue.trim()
          ? [currentValue]
          : [];
      const nextAnswers = currentAnswers.includes(optionLabel)
        ? currentAnswers.filter((value) => value !== optionLabel)
        : [...currentAnswers, optionLabel];
      updatePendingUserInputSelection(pendingUserInputRequest.requestId, answerKey, nextAnswers);
      return;
    }

    updatePendingUserInputSelection(pendingUserInputRequest.requestId, answerKey, optionLabel);
  };

  const handleChangePendingUserInputOtherDraft = (question: UserInputQuestion, value: string) => {
    if (!pendingUserInputRequest) {
      return;
    }

    const answerKey = getUserInputAnswerKey(selectedConversationProvider, question);
    updatePendingUserInputOtherDraft(pendingUserInputRequest.requestId, answerKey, value);
  };

  const handleRespondToPendingUserInput = async () => {
    if (!selectedThread || !pendingUserInputRequest) {
      return;
    }

    const selectionDrafts = pendingUserInputSelections[pendingUserInputRequest.requestId] ?? {};
    const otherDrafts = pendingUserInputOtherDrafts[pendingUserInputRequest.requestId] ?? {};
    const answers: Record<string, string | string[]> = {};

    for (const question of pendingUserInputRequest.questions) {
      const answerKey = getUserInputAnswerKey(selectedConversationProvider, question);
      const selectedValue = selectionDrafts[answerKey];
      const otherValue = otherDrafts[answerKey]?.trim() ?? "";

      if (question.multiSelect) {
        const selections = Array.isArray(selectedValue)
          ? selectedValue.filter((value) => value.trim().length > 0)
          : typeof selectedValue === "string" && selectedValue.trim()
            ? [selectedValue.trim()]
            : [];
        const combinedAnswers = otherValue ? [...selections, otherValue] : selections;
        if (combinedAnswers.length === 0) {
          showToast("Answer every question before submitting");
          return;
        }
        answers[answerKey] = combinedAnswers;
        continue;
      }

      const singleAnswer =
        typeof selectedValue === "string" && selectedValue.trim().length > 0
          ? selectedValue.trim()
          : otherValue;
      if (!singleAnswer) {
        showToast("Answer every question before submitting");
        return;
      }
      answers[answerKey] = singleAnswer;
    }

    await respondToUserInput({
      threadId: selectedThread.id,
      requestId: pendingUserInputRequest.requestId,
      answers: answers as ProviderUserInputAnswers,
    });

    setPendingUserInputSelections((current) => {
      if (!(pendingUserInputRequest.requestId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[pendingUserInputRequest.requestId];
      return next;
    });
    setPendingUserInputOtherDrafts((current) => {
      if (!(pendingUserInputRequest.requestId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[pendingUserInputRequest.requestId];
      return next;
    });
    showToast("Answer sent");
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
    showToast(`Checked out ${branch}`);
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
    showToast(`Checked out ${branch}`);
  };

  const handleDeleteBranch = async (branch: string) => {
    if (!selectedWorkspaceRoot) {
      return;
    }

    await gitDeleteBranch({ cwd: selectedWorkspaceRoot, branch });
    if (gitBranchNameDraft.trim() === branch) {
      setGitBranchNameDraft("");
    }
    await loadGitState(selectedWorkspaceRoot);
    showToast(`Deleted ${branch}`);
  };

  const handlePrepareMainlineMerge = async () => {
    if (!selectedWorkspaceRoot || !selectedThread) {
      return;
    }

    const result = await gitPrepareMainlineMerge({
      cwd: selectedWorkspaceRoot,
      ...(gitMergeUseSquash ? { squash: true } : {}),
    });
    await updateThreadBranch({ threadId: selectedThread.id, branch: result.targetBranch });
    setGitBranchNameDraft(result.targetBranch);
    await loadGitState(selectedWorkspaceRoot);
    showToast(
      result.conflictsResolvedWithIncoming
        ? `${result.squash ? "Squash" : "Merge"} ready on ${result.targetBranch}; incoming changes kept`
        : `${result.squash ? "Squash" : "Merge"} ready on ${result.targetBranch}`,
    );
  };

  const runGitAction = async (action: "commit" | "commit_push", commitMessage?: string) => {
    if (!selectedWorkspaceRoot) {
      return null;
    }

    const result = await gitRunStackedAction({
      cwd: selectedWorkspaceRoot,
      action,
      ...(commitMessage ? { commitMessage } : {}),
    });
    await loadGitState(selectedWorkspaceRoot);
    return result;
  };

  const showGitActionToast = (
    action: "commit" | "commit_push",
    result: NonNullable<Awaited<ReturnType<typeof runGitAction>>>,
  ) => {
    if (result.push.status === "pushed") {
      showToast(
        result.commit.status === "created" ? "Committed and pushed" : "Pushed current branch",
      );
      return;
    }

    if (result.commit.status === "created") {
      showToast(action === "commit" ? "Commit created" : "Committed on current branch");
      return;
    }

    showToast("No changes to commit");
  };

  const handleGitAutoCommitAndPush = async () => {
    const result = await runGitAction("commit_push");
    if (!result) {
      return;
    }
    showGitActionToast("commit_push", result);
  };

  const handleGitManualCommit = async () => {
    const commitMessage = gitCommitMessageDraft.trim();
    if (!commitMessage) {
      return;
    }

    const result = await runGitAction("commit", commitMessage);
    if (!result) {
      return;
    }
    showGitActionToast("commit", result);
  };

  const handleGitManualCommitAndPush = async () => {
    const commitMessage = gitCommitMessageDraft.trim();
    if (!commitMessage) {
      return;
    }

    const result = await runGitAction("commit_push", commitMessage);
    if (!result) {
      return;
    }
    showGitActionToast("commit_push", result);
  };

  const handleSend = async () => {
    const trimmed = draft.trim();
    if ((!trimmed && draftAttachments.length === 0) || !selectedThread) {
      return;
    }

    const willQueueTurn = selectedTurnDispatchMode === "queue" && sessionBusy;
    const willInterruptTurn = selectedTurnDispatchMode === "live" && sessionBusy;

    await sendTurn({
      threadId: selectedThread.id,
      text: trimmed,
      attachments: draftAttachments.map((attachment) => ({
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        dataUrl: attachment.dataUrl,
      })),
      runtimeMode: selectedRuntimeMode,
      interactionMode: selectedInteractionMode,
      model: selectedThread.model,
      turnDispatchMode: selectedTurnDispatchMode,
      assistantDeliveryMode: "streaming",
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
    setThreadDraftAttachments((current) => ({ ...current, [selectedThread.id]: [] }));
    if (willQueueTurn) {
      showToast("Queued for next turn");
    } else if (willInterruptTurn) {
      showToast("Interrupting current turn");
    }
  };

  const resolveAttachmentImageUrl = (attachmentId: string) => {
    try {
      return buildAttachmentUrl(
        connectionSettings.serverUrl,
        connectionSettings.authToken,
        attachmentId,
      );
    } catch {
      return null;
    }
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

  const canRespondToPendingApproval =
    isConnected &&
    selectedThread !== null &&
    pendingApprovalRequest !== null &&
    selectedThread.session !== null &&
    selectedThread.session.status !== "stopped" &&
    busyAction === null;
  const canRespondToPendingUserInput =
    isConnected &&
    selectedThread !== null &&
    pendingUserInputRequest !== null &&
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
  const gitCurrentBranch = gitRepoStatus?.branch ?? selectedThread?.branch ?? null;
  const gitWorkingTreeDirty = gitRepoStatus?.hasWorkingTreeChanges ?? false;
  const canPrepareGitMainlineMerge =
    canRunGitOperations && gitCurrentBranch !== null && !gitWorkingTreeDirty;
  const gitManualCommitMessage = gitCommitMessageDraft.trim();

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
                        <Text
                          style={[styles.projectCount, projectActive && styles.projectCountActive]}
                        >
                          {projectThreads.length}
                        </Text>
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
                        <Pressable
                          disabled={busyAction !== null}
                          onPress={() => {
                            void handleCreateConversation(project);
                          }}
                          style={[
                            styles.projectInlineActionButton,
                            busyAction !== null && styles.buttonDisabled,
                          ]}
                        >
                          <Feather color={theme.accent} name="plus" size={13} />
                          <Text style={styles.projectInlineActionLabel}>New session</Text>
                        </Pressable>
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
          onRefresh={() => {
            void handlePullToRefresh();
          }}
          refreshing={isPullRefreshing}
          tintColor={theme.accent}
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

        <View style={styles.flatSection}>
          <Text style={styles.sectionEyebrow}>Alerts</Text>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.switchRow}>
            <Text style={styles.metaValue}>Automatic alerts</Text>
            <Switch
              disabled={!isConnected || busyAction !== null || !serverConfig}
              onValueChange={(value) => {
                void handleSetNotificationsEnabled(value);
              }}
              trackColor={{ false: TERMINAL_BORDER, true: TERMINAL_ACCENT_SOFT }}
              value={notificationsEnabled}
            />
          </View>
          <View style={styles.compactList}>
            <MetaRow accent label="Status" value={notificationsEnabled ? "Enabled" : "Muted"} />
            <MetaRow
              label="Fallback"
              value={notificationsConfigured ? "Pushover configured" : "App delivery only"}
            />
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
              {formatThreadModelLabel(selectedThread)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={
              selectedRuntimeMode === "approval-required"
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
              selectedRuntimeMode === "full-access" && styles.composerControlButtonSelected,
              (!selectedThread || !isConnected || busyAction !== null) && styles.buttonDisabled,
            ]}
          >
            <Feather
              accessibilityElementsHidden
              color={selectedRuntimeMode === "full-access" ? theme.accent : theme.text}
              importantForAccessibility="no-hide-descendants"
              name={formatRuntimeModeIcon(selectedRuntimeMode)}
              size={14}
            />
          </Pressable>
          <Pressable
            accessibilityLabel={
              selectedInteractionMode === "plan" ? "Disable plan mode" : "Enable plan mode"
            }
            disabled={!selectedThread || !isConnected || busyAction !== null}
            onPress={() => {
              void handleToggleConversationInteractionMode();
            }}
            style={[
              styles.composerControlButton,
              styles.composerControlButtonIcon,
              selectedInteractionMode === "plan" && styles.composerControlButtonSelected,
              (!selectedThread || !isConnected || busyAction !== null) && styles.buttonDisabled,
            ]}
          >
            <Feather
              accessibilityElementsHidden
              color={selectedInteractionMode === "plan" ? theme.accent : theme.text}
              importantForAccessibility="no-hide-descendants"
              name={formatInteractionModeIcon(selectedInteractionMode)}
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
              selectedTurnDispatchMode === "live"
                ? "Switch message delivery to queue"
                : "Switch message delivery to live"
            }
            disabled={!selectedThread || busyAction !== null}
            onPress={() => {
              handleToggleTurnDispatchMode();
            }}
            style={[
              styles.composerControlButton,
              styles.composerControlButtonIcon,
              selectedTurnDispatchMode === "queue" && styles.composerControlButtonSelected,
              (!selectedThread || busyAction !== null) && styles.buttonDisabled,
            ]}
          >
            <Feather
              accessibilityElementsHidden
              color={selectedTurnDispatchMode === "queue" ? theme.accent : theme.text}
              importantForAccessibility="no-hide-descendants"
              name={formatTurnDispatchModeIcon(selectedTurnDispatchMode)}
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
            onRefresh={() => {
              void handlePullToRefresh();
            }}
            refreshing={isPullRefreshing}
            tintColor={theme.accent}
          />
        }
        style={styles.messagesScroll}
      >
        {timelineEntries.length > 0 ? (
          timelineEntries.map((entry) => {
            if (entry.kind === "activityGroup") {
              return (
                <TimelineActivityGroup
                  key={entry.id}
                  activities={entry.activities}
                  expanded={entry.id in expandedActivityGroupIds}
                  onToggle={() => {
                    toggleActivityGroup(entry.id);
                  }}
                />
              );
            }

            const { message } = entry;
            const queuedPosition =
              message.role === "user" ? (queuedPositionByMessageId.get(message.id) ?? null) : null;
            const hasMessageText = message.text.length > 0;
            const messageAttachmentPreviews = (message.attachments ?? [])
              .filter((attachment) => attachment.type === "image")
              .map((attachment) => ({
                id: attachment.id,
                name: attachment.name,
                uri: resolveAttachmentImageUrl(attachment.id),
              }))
              .filter(
                (
                  attachment,
                ): attachment is {
                  readonly id: string;
                  readonly name: string;
                  readonly uri: string;
                } => attachment.uri !== null,
              );

            return (
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
                  <View style={styles.messageBody}>
                    {queuedPosition !== null ? (
                      <View style={styles.messageQueuedBadge}>
                        <Text style={styles.messageQueuedBadgeText}>
                          {queuedPosition === 1 ? "Queued next" : `Queued ${queuedPosition}`}
                        </Text>
                      </View>
                    ) : null}
                    {hasMessageText || message.streaming ? (
                      hasMessageText ? (
                        message.role === "assistant" ? (
                          <MarkdownMessage value={message.text} />
                        ) : (
                          <Text
                            style={[
                              styles.messageText,
                              message.role === "user"
                                ? styles.messageTextUser
                                : styles.messageTextAssistant,
                            ]}
                          >
                            {message.text}
                          </Text>
                        )
                      ) : (
                        <Text style={[styles.messageText, styles.messageTextAssistant]}>
                          Streaming...
                        </Text>
                      )
                    ) : null}

                    {messageAttachmentPreviews.length > 0 ? (
                      <View style={styles.messageAttachmentRow}>
                        {messageAttachmentPreviews.map((attachment) => (
                          <View key={attachment.id} style={styles.messageAttachmentTile}>
                            <Image
                              resizeMode="cover"
                              source={{ uri: attachment.uri }}
                              style={styles.messageAttachmentImage}
                            />
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
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
            );
          })
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
            <Text style={styles.waitingIndicatorText}>{waitingIndicatorLabel}</Text>
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

        {pendingUserInputRequest ? (
          <View style={styles.pendingUserInputPanel}>
            <Text style={styles.pendingUserInputEyebrow}>Model Question</Text>
            {pendingUserInputRequest.questions.map((question) => {
              const answerKey = getUserInputAnswerKey(selectedConversationProvider, question);
              const selectedValue =
                pendingUserInputSelections[pendingUserInputRequest.requestId]?.[answerKey];
              const otherDraft =
                pendingUserInputOtherDrafts[pendingUserInputRequest.requestId]?.[answerKey] ?? "";
              const selectedValues = Array.isArray(selectedValue)
                ? selectedValue
                : typeof selectedValue === "string" && selectedValue.trim().length > 0
                  ? [selectedValue]
                  : [];

              return (
                <View key={question.id} style={styles.pendingUserInputQuestionCard}>
                  <Text style={styles.pendingUserInputQuestionHeader}>{question.header}</Text>
                  <Text style={styles.pendingUserInputQuestionText}>{question.question}</Text>
                  <Text style={styles.pendingUserInputQuestionHint}>
                    {question.multiSelect ? "Select one or more answers." : "Select one answer."}
                  </Text>
                  <View style={styles.pendingUserInputOptionList}>
                    {question.options.map((option) => {
                      const selected = selectedValues.includes(option.label);
                      return (
                        <Pressable
                          key={`${question.id}:${option.label}`}
                          disabled={!canRespondToPendingUserInput}
                          onPress={() => {
                            handleTogglePendingUserInputOption(question, option.label);
                          }}
                          style={[
                            styles.pendingUserInputOptionButton,
                            selected && styles.pendingUserInputOptionButtonSelected,
                            !canRespondToPendingUserInput && styles.buttonDisabled,
                          ]}
                        >
                          <Text
                            style={[
                              styles.pendingUserInputOptionLabel,
                              selected && styles.pendingUserInputOptionLabelSelected,
                            ]}
                          >
                            {option.label}
                          </Text>
                          <Text style={styles.pendingUserInputOptionDescription}>
                            {option.description}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <TextInput
                    editable={canRespondToPendingUserInput}
                    onChangeText={(value) => {
                      handleChangePendingUserInputOtherDraft(question, value);
                    }}
                    placeholder="Other"
                    placeholderTextColor={theme.muted}
                    style={[
                      styles.pendingUserInputOtherInput,
                      !canRespondToPendingUserInput && styles.buttonDisabled,
                    ]}
                    value={otherDraft}
                  />
                </View>
              );
            })}
            <View style={styles.inlineButtonRow}>
              <ActionButton
                compact
                disabled={!canRespondToPendingUserInput}
                label="Submit"
                onPress={() => {
                  void handleRespondToPendingUserInput();
                }}
              />
            </View>
          </View>
        ) : null}

        {draftAttachments.length > 0 ? (
          <ScrollView
            horizontal
            contentContainerStyle={styles.composerAttachmentStripContent}
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            style={styles.composerAttachmentStrip}
          >
            {draftAttachments.map((attachment) => (
              <View key={attachment.id} style={styles.composerAttachmentCard}>
                <Image
                  resizeMode="cover"
                  source={{ uri: attachment.previewUri }}
                  style={styles.composerAttachmentImage}
                />
                <Pressable
                  accessibilityLabel={`Remove ${attachment.name}`}
                  onPress={() => {
                    handleRemoveDraftAttachment(attachment.id);
                  }}
                  style={styles.composerAttachmentRemove}
                >
                  <Feather
                    accessibilityElementsHidden
                    color={theme.text}
                    importantForAccessibility="no-hide-descendants"
                    name="x"
                    size={12}
                  />
                </Pressable>
                <View style={styles.composerAttachmentMeta}>
                  <Text numberOfLines={1} style={styles.composerAttachmentName}>
                    {attachment.name}
                  </Text>
                  <Text style={styles.composerAttachmentSize}>
                    {formatByteSize(attachment.sizeBytes)}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
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
            <Pressable
              disabled={!selectedThread || busyAction !== null}
              onPress={() => {
                void handlePickImageAttachment();
              }}
              style={[
                styles.composerUtilityButton,
                draftAttachments.length > 0 && styles.composerUtilityButtonSelected,
                (!selectedThread || busyAction !== null) && styles.buttonDisabled,
              ]}
            >
              <Feather
                accessibilityElementsHidden
                color={draftAttachments.length > 0 ? theme.accent : theme.text}
                importantForAccessibility="no-hide-descendants"
                name="image"
                size={13}
              />
              <Text
                style={[
                  styles.composerUtilityLabel,
                  draftAttachments.length > 0 && styles.composerUtilityLabelSelected,
                ]}
              >
                {draftAttachments.length > 0
                  ? `${draftAttachments.length} image${draftAttachments.length === 1 ? "" : "s"}`
                  : "Image"}
              </Text>
            </Pressable>
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
              disabled={!canSend}
              label={
                selectedTurnDispatchMode === "queue" && sessionBusy
                  ? "Queue"
                  : selectedTurnDispatchMode === "live" && sessionBusy
                    ? "Send now"
                    : "Send"
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
              Two flows: auto commit and push on the current branch, or create a branch and then
              choose auto or manual commit actions.
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
              <MetaRow accent label="Branch" value={formatGitBranchLabel(gitCurrentBranch)} />
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

            <View style={[styles.gitFlowSection, styles.gitFlowSectionFirst]}>
              <Text style={styles.navSectionLabel}>Flow 1</Text>
              <Text style={styles.gitFlowHeading}>Current branch</Text>
              <Text style={styles.gitFlowDescription}>
                Stage all changes, let the model write the commit message, then commit and push the
                checked-out branch.
              </Text>
              <Text style={styles.gitFlowStatus}>
                Running on {formatGitBranchLabel(gitCurrentBranch)}
              </Text>
              <ActionButton
                disabled={!canRunGitOperations}
                label="Stage + Auto Commit + Push"
                onPress={() => {
                  void handleGitAutoCommitAndPush();
                }}
              />
            </View>

            <View style={styles.gitFlowSection}>
              <Text style={styles.navSectionLabel}>Existing branches</Text>
              <View style={styles.selectionList}>
                {localBranches.length > 0 ? (
                  localBranches.map((branch: GitBranch) => (
                    <SwipeDismissRow
                      actionDisabled={!canRunGitOperations || branch.current}
                      key={branch.name}
                      onAction={() => {
                        return handleDeleteBranch(branch.name);
                      }}
                      onPress={() => {
                        void handleCheckoutBranch(branch.name);
                      }}
                    >
                      <View
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
                            {branch.current
                              ? "Current branch"
                              : branch.isDefault
                                ? "Default branch"
                                : "Tap to check out or swipe to delete"}
                          </Text>
                        </View>
                      </View>
                    </SwipeDismissRow>
                  ))
                ) : (
                  <Text style={styles.helperText}>
                    {isLoadingGitState ? "Loading branches..." : "No local branches found."}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.gitFlowSection}>
              <Text style={styles.navSectionLabel}>Flow 2</Text>
              <Text style={styles.gitFlowHeading}>Create a branch</Text>
              <Text style={styles.gitFlowDescription}>
                Start from the current branch and worktree with `checkout -b`, then either let the
                model generate the commit message or enter one manually. Commit actions stage all
                changes first.
              </Text>
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
              <Text style={styles.gitFlowStatus}>
                Checked-out branch: {formatGitBranchLabel(gitCurrentBranch)}
              </Text>
              <ActionButton
                disabled={!canRunGitOperations}
                emphasis="surface"
                label="Stage + Auto Commit + Push"
                onPress={() => {
                  void handleGitAutoCommitAndPush();
                }}
              />
              <View style={styles.projectPickerFieldGroup}>
                <Text style={styles.navSectionLabel}>Manual commit message</Text>
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
                  disabled={!canRunGitOperations || !gitManualCommitMessage}
                  emphasis="surface"
                  label="Stage + Manual Commit"
                  onPress={() => {
                    void handleGitManualCommit();
                  }}
                />
                <ActionButton
                  disabled={!canRunGitOperations || !gitManualCommitMessage}
                  emphasis="surface"
                  label="Stage + Manual Commit + Push"
                  onPress={() => {
                    void handleGitManualCommitAndPush();
                  }}
                />
              </View>
            </View>

            <View style={styles.gitFlowSection}>
              <Text style={styles.navSectionLabel}>Flow 3</Text>
              <Text style={styles.gitFlowHeading}>Merge into default branch</Text>
              <Text style={styles.gitFlowDescription}>
                Switch to the repo default branch, fetch and pull it to make sure it is current,
                then prepare a merge from the current branch without committing. Use Flow 1 or Flow
                2 afterward to commit and push from that default branch.
              </Text>
              <Text style={styles.selectionRowReason}>
                This changes the checked-out branch and, if conflicts happen, accepts the incoming
                changes from {formatGitBranchLabel(gitCurrentBranch)}.
              </Text>
              <View style={styles.switchRow}>
                <Text style={styles.metaValue}>Squash merge</Text>
                <Switch
                  disabled={!canRunGitOperations}
                  onValueChange={setGitMergeUseSquash}
                  trackColor={{ false: TERMINAL_BORDER, true: TERMINAL_ACCENT_SOFT }}
                  value={gitMergeUseSquash}
                />
              </View>
              <Text style={styles.gitFlowStatus}>
                Source: {formatGitBranchLabel(gitCurrentBranch)} / Target: repo default branch
              </Text>
              {gitWorkingTreeDirty ? (
                <Text style={styles.helperText}>
                  Commit or stash the current working tree changes before starting the merge.
                </Text>
              ) : null}
              <ActionButton
                disabled={!canPrepareGitMainlineMerge}
                emphasis="surface"
                label={
                  gitMergeUseSquash
                    ? "switch default + pull + squash merge"
                    : "switch default + pull + merge"
                }
                onPress={() => {
                  void handlePrepareMainlineMerge();
                }}
              />
            </View>
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
          <Text style={styles.sectionEyebrow}>Notifications</Text>
          <Text style={styles.helperText}>
            The server tries app delivery first. Foreground sessions show a toast, background
            sessions schedule a device notification, and Pushover is used only when the app does not
            confirm delivery in time.
          </Text>
          <View style={styles.switchRow}>
            <Text style={styles.metaValue}>Automatic alerts</Text>
            <Switch
              disabled={!isConnected || busyAction !== null || !serverConfig}
              onValueChange={(value) => {
                void handleSetNotificationsEnabled(value);
              }}
              trackColor={{ false: TERMINAL_BORDER, true: TERMINAL_ACCENT_SOFT }}
              value={notificationsEnabled}
            />
          </View>
          <Text style={styles.helperText}>
            Test alert follows the normal app-first flow. Test Pushover bypasses app delivery and
            sends the server fallback directly.
          </Text>
          {!supportsDeviceNotifications ? (
            <Text style={styles.helperText}>
              Android Expo Go cannot test device notifications with `expo-notifications`. Use a
              development build for that path.
            </Text>
          ) : null}
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPushoverAppTokenDraft}
            placeholder="Pushover app token"
            placeholderTextColor={TERMINAL_MUTED}
            secureTextEntry
            style={styles.input}
            value={pushoverAppTokenDraft}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPushoverUserKeyDraft}
            placeholder="Pushover user key"
            placeholderTextColor={TERMINAL_MUTED}
            secureTextEntry
            style={styles.input}
            value={pushoverUserKeyDraft}
          />
          <MetaRow accent label="Status" value={notificationsEnabled ? "Enabled" : "Muted"} />
          <MetaRow
            accent
            label="Fallback"
            value={notificationsConfigured ? "Pushover configured" : "App delivery only"}
          />
          <View style={styles.inlineButtonRow}>
            <ActionButton
              disabled={!isConnected || busyAction !== null}
              label="Save alerts"
              onPress={() => {
                void handleSaveNotificationSettings();
              }}
            />
            <ActionButton
              disabled={!isConnected || busyAction !== null}
              emphasis="secondary"
              label="Clear"
              onPress={() => {
                setPushoverAppTokenDraft("");
                setPushoverUserKeyDraft("");
                void handleSaveNotificationSettings({
                  appToken: null,
                  userKey: null,
                });
              }}
            />
          </View>
          <View style={styles.inlineButtonRow}>
            <ActionButton
              disabled={!isConnected || busyAction !== null}
              emphasis="secondary"
              label="Test alert"
              onPress={() => {
                void handleSendTestNotification("auto");
              }}
            />
            <ActionButton
              disabled={!isConnected || busyAction !== null || !notificationsConfigured}
              emphasis="secondary"
              label="Test Pushover"
              onPress={() => {
                void handleSendTestNotification("pushover");
              }}
            />
          </View>
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
            disabled={!projectBuilderRoot?.trim() || projectBuilderNavigationDisabled}
            emphasis="secondary"
            label="Server cwd"
            onPress={() => {
              void handleResetProjectDirectory();
            }}
          />
          <ActionButton
            compact
            disabled={!directoryCwd?.trim() || projectBuilderNavigationDisabled}
            emphasis="ghost"
            label="Parent"
            onPress={() => {
              void handleOpenParentDirectory();
            }}
          />
        </View>

        <ScrollView
          key={directoryCwd ?? projectBuilderRoot ?? "directory-browser"}
          contentContainerStyle={styles.directoryBrowserContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={[styles.directoryBrowser, styles.projectPickerBrowser]}
        >
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
        </ScrollView>

        {directoryTruncated ? (
          <Text style={styles.helperText}>
            Directory listing truncated. Keep drilling down to narrow the folder set.
          </Text>
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
                disabled={!directoryCwd || !newFolderName.trim() || projectBuilderSubmitDisabled}
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
          disabled={!directoryCwd?.trim() || projectBuilderSubmitDisabled}
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
      paddingTop: 0,
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
      borderBottomColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
      gap: 0,
      paddingBottom: 6,
      paddingTop: 4,
    },
    projectRow: {
      alignItems: "center",
      backgroundColor: "transparent",
      borderLeftColor: "transparent",
      borderLeftWidth: 2,
      flexDirection: "row",
      gap: 8,
      minHeight: 34,
      paddingLeft: 8,
      paddingRight: 2,
      paddingVertical: 5,
    },
    projectRowActive: {
      backgroundColor: TERMINAL_PANEL_ALT,
      borderLeftColor: TERMINAL_ACCENT,
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
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
      minWidth: 18,
      textAlign: "right",
    },
    projectCountActive: {
      color: TERMINAL_ACCENT,
    },
    projectInlineActions: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      paddingLeft: 12,
      paddingTop: 2,
    },
    projectHeaderDestructiveAction: {
      marginLeft: 4,
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    projectInlineActionButton: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
      minHeight: 24,
      paddingHorizontal: 1,
      paddingVertical: 2,
    },
    projectInlineActionLabel: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
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
      gap: 0,
      paddingLeft: 12,
      paddingTop: 2,
    },
    threadRow: {
      alignItems: "center",
      borderLeftColor: "transparent",
      borderLeftWidth: 2,
      flexDirection: "row",
      gap: 8,
      minHeight: 30,
      paddingHorizontal: 8,
      paddingVertical: 5,
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
      paddingHorizontal: 10,
      paddingVertical: 5,
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
      overflow: "hidden",
      padding: 0,
    },
    directoryBrowserContent: {
      flexGrow: 1,
    },
    directoryRow: {
      backgroundColor: "transparent",
      borderBottomColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
      gap: 2,
      minWidth: 0,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    directoryTitle: {
      color: TERMINAL_TEXT,
      flexShrink: 1,
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
      alignSelf: "stretch",
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
      alignSelf: "stretch",
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
    messageBody: {
      gap: 6,
      width: "100%",
    },
    messageQueuedBadge: {
      alignSelf: "flex-start",
      backgroundColor: TERMINAL_ACCENT_SOFT,
      borderColor: TERMINAL_ACCENT,
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    messageQueuedBadgeText: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
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
    messageMarkdownRoot: {
      gap: 6,
      width: "100%",
    },
    messageMarkdownText: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 17,
    },
    messageMarkdownParagraph: {
      paddingVertical: 0,
    },
    messageMarkdownLink: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 17,
      textDecorationLine: "underline",
    },
    messageMarkdownBlockquote: {
      backgroundColor: TERMINAL_PANEL,
      borderLeftColor: TERMINAL_BORDER_STRONG,
      borderLeftWidth: 2,
      paddingLeft: 10,
      paddingVertical: 4,
    },
    messageMarkdownHeading1: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 18,
      fontWeight: "700",
      lineHeight: 22,
    },
    messageMarkdownHeading2: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 16,
      fontWeight: "700",
      lineHeight: 21,
    },
    messageMarkdownHeading3: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 14,
      fontWeight: "700",
      lineHeight: 19,
    },
    messageMarkdownHeading4: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      fontWeight: "700",
      lineHeight: 18,
    },
    messageMarkdownHeading5: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      fontWeight: "700",
      lineHeight: 17,
    },
    messageMarkdownHeading6: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
      lineHeight: 16,
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    messageMarkdownCodespan: {
      backgroundColor: TERMINAL_PANEL_ALT,
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 17,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    messageMarkdownCode: {
      width: "100%",
      backgroundColor: TERMINAL_PANEL_ALT,
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      overflow: "hidden",
    },
    messageMarkdownCodeHeader: {
      borderBottomColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 5,
    },
    messageMarkdownCodeHeaderLabel: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.9,
      textTransform: "uppercase",
    },
    messageMarkdownCodeScroll: {
      maxWidth: "100%",
    },
    messageMarkdownCodeScrollContent: {
      minWidth: "100%",
    },
    messageMarkdownCodeContent: {
      minWidth: "100%",
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    messageMarkdownCodeText: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 17,
    },
    messageMarkdownCodeComment: {
      color: TERMINAL_MUTED,
    },
    messageMarkdownCodeKeyword: {
      color: TERMINAL_ACCENT,
      fontWeight: "700",
    },
    messageMarkdownCodeString: {
      color: TERMINAL_WARNING,
    },
    messageMarkdownCodeNumber: {
      color: TERMINAL_WARNING,
    },
    messageMarkdownCodeFunction: {
      color: TERMINAL_TEXT,
      fontWeight: "700",
    },
    messageMarkdownCodeOperator: {
      color: TERMINAL_TEXT,
    },
    messageMarkdownCodePunctuation: {
      color: TERMINAL_MUTED,
    },
    messageMarkdownCodeType: {
      color: TERMINAL_ACCENT,
    },
    messageMarkdownCodeProperty: {
      color: TERMINAL_TEXT,
    },
    messageMarkdownCodeTag: {
      color: TERMINAL_ACCENT,
    },
    messageMarkdownCodeAttrName: {
      color: TERMINAL_ACCENT,
    },
    messageMarkdownCodeAttrValue: {
      color: TERMINAL_WARNING,
    },
    messageMarkdownCodeImportant: {
      color: TERMINAL_DANGER,
      fontWeight: "700",
    },
    messageMarkdownRule: {
      backgroundColor: TERMINAL_BORDER,
      height: 1,
      marginVertical: 4,
    },
    messageMarkdownList: {
      paddingVertical: 0,
    },
    messageMarkdownListItem: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 17,
    },
    messageMarkdownTable: {
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
    },
    messageMarkdownTableRow: {
      borderBottomColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
    },
    messageMarkdownTableCell: {
      borderRightColor: TERMINAL_BORDER,
      borderRightWidth: 1,
      padding: 6,
    },
    messageMarkdownStrong: {
      fontWeight: "700",
    },
    messageMarkdownEmphasis: {
      fontStyle: "italic",
    },
    messageMarkdownStrikethrough: {
      textDecorationLine: "line-through",
      textDecorationStyle: "solid",
    },
    messageMarkdownUnderline: {
      textDecorationLine: "underline",
      textDecorationStyle: "solid",
    },
    messageAttachmentRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    messageAttachmentTile: {
      backgroundColor: TERMINAL_PANEL_ALT,
      overflow: "hidden",
    },
    messageAttachmentImage: {
      height: 112,
      width: 112,
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
    timelineActivityWrap: {
      alignSelf: "stretch",
      backgroundColor: TERMINAL_PANEL_ALT,
      borderLeftColor: TERMINAL_BORDER_STRONG,
      borderLeftWidth: 2,
      gap: 6,
      marginVertical: 2,
      paddingHorizontal: 8,
      paddingVertical: 7,
    },
    timelineActivitySummaryRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      justifyContent: "space-between",
    },
    timelineActivitySummaryHeader: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 8,
    },
    timelineActivitySummaryTitle: {
      color: TERMINAL_TEXT,
      flex: 1,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
      lineHeight: 16,
    },
    timelineActivitySummaryMeta: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      paddingLeft: 8,
    },
    timelineActivitySummaryPreview: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      lineHeight: 15,
      paddingLeft: 22,
    },
    timelineActivityExpandedList: {
      borderTopColor: TERMINAL_BORDER,
      borderTopWidth: 1,
      gap: 8,
      paddingTop: 8,
    },
    timelineActivityExpandedItem: {
      gap: 5,
    },
    timelineActivityExpandedHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    timelineActivityExpandedEyebrow: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    timelineActivityExpandedTimestamp: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
    },
    timelineActivityExpandedTitle: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
      lineHeight: 16,
    },
    timelineActivityExpandedText: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      lineHeight: 16,
    },
    timelineActivityExpandedHint: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
    },
    timelineActivityCodeBlock: {
      backgroundColor: TERMINAL_BG,
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      width: "100%",
    },
    timelineActivityCodeHeader: {
      borderBottomColor: TERMINAL_BORDER,
      borderBottomWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    timelineActivityCodeHeaderLabel: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.8,
      textTransform: "uppercase",
    },
    timelineActivityCodeScroll: {
      maxWidth: "100%",
    },
    timelineActivityCodeScrollContent: {
      minWidth: "100%",
    },
    timelineActivityCodeText: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      lineHeight: 16,
      minWidth: "100%",
      paddingHorizontal: 8,
      paddingVertical: 8,
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
    pendingUserInputPanel: {
      backgroundColor: TERMINAL_PANEL_ALT,
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      gap: 8,
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    pendingUserInputEyebrow: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1,
      textTransform: "uppercase",
    },
    pendingUserInputQuestionCard: {
      gap: 5,
    },
    pendingUserInputQuestionHeader: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      fontWeight: "700",
    },
    pendingUserInputQuestionText: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      lineHeight: 16,
    },
    pendingUserInputQuestionHint: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
    },
    pendingUserInputOptionList: {
      gap: 5,
    },
    pendingUserInputOptionButton: {
      backgroundColor: TERMINAL_PANEL,
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    pendingUserInputOptionButtonSelected: {
      borderColor: TERMINAL_ACCENT,
      backgroundColor: TERMINAL_ACCENT_SOFT,
    },
    pendingUserInputOptionLabel: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
    },
    pendingUserInputOptionLabelSelected: {
      color: TERMINAL_ACCENT,
    },
    pendingUserInputOptionDescription: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      lineHeight: 14,
    },
    pendingUserInputOtherInput: {
      backgroundColor: TERMINAL_BG,
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      minHeight: 34,
      paddingHorizontal: 8,
      paddingVertical: 6,
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
    composerAttachmentStrip: {
      maxHeight: 102,
    },
    composerAttachmentStripContent: {
      gap: 8,
      paddingBottom: 2,
    },
    composerAttachmentCard: {
      backgroundColor: TERMINAL_PANEL_ALT,
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      gap: 4,
      padding: 4,
      width: 96,
    },
    composerAttachmentImage: {
      backgroundColor: TERMINAL_BG,
      height: 60,
      width: "100%",
    },
    composerAttachmentRemove: {
      alignItems: "center",
      backgroundColor: TERMINAL_PANEL,
      height: 18,
      justifyContent: "center",
      position: "absolute",
      right: 6,
      top: 6,
      width: 18,
    },
    composerAttachmentMeta: {
      gap: 1,
    },
    composerAttachmentName: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 10,
      fontWeight: "700",
    },
    composerAttachmentSize: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 9,
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
      paddingTop: 4,
      paddingBottom: 6,
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
    composerUtilityButton: {
      alignItems: "center",
      backgroundColor: TERMINAL_BG,
      borderColor: TERMINAL_BORDER,
      borderWidth: 1,
      flexDirection: "row",
      gap: 6,
      minHeight: 28,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    composerUtilityButtonSelected: {
      backgroundColor: TERMINAL_ACCENT_SOFT,
      borderColor: TERMINAL_ACCENT,
    },
    composerUtilityLabel: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
    },
    composerUtilityLabelSelected: {
      color: TERMINAL_ACCENT,
    },
    composerRunAction: {
      minWidth: 102,
    },
    gitCommitInput: {
      minHeight: 90,
    },
    gitFlowSection: {
      borderTopColor: TERMINAL_BORDER,
      borderTopWidth: 1,
      gap: 8,
      paddingTop: 10,
    },
    gitFlowSectionFirst: {
      borderTopWidth: 0,
      paddingTop: 0,
    },
    gitFlowHeading: {
      color: TERMINAL_TEXT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      fontWeight: "700",
    },
    gitFlowDescription: {
      color: TERMINAL_MUTED,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      lineHeight: 15,
    },
    gitFlowStatus: {
      color: TERMINAL_ACCENT,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 11,
      fontWeight: "700",
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
