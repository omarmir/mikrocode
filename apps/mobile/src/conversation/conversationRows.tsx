import { Feather } from "@expo/vector-icons";
import { memo, useMemo } from "react";
import { Animated, Image, Pressable, ScrollView, Text, View } from "react-native";

import type { ChatAttachment, OrchestrationMessage } from "@t3tools/contracts";

import { useAppThemeContext } from "../appThemeContext";
import { getCachedParsedDiff, getParsedDiffCacheKey } from "./diffParseCache";
import { CachedMarkdownMessage, getMessageMarkdownCacheKey } from "./markdownRenderer";
import type {
  ConversationActivityGroupRowItem,
  ConversationDiffRowItem,
  ConversationMessageRowItem,
  ConversationPlanRowItem,
  ConversationQueuedRowItem,
} from "./conversationRenderItems";
import {
  DIFF_FILE_LINE_LIMIT,
  activityBody,
  activityEyebrow,
  activityGroupPreview,
  activityGroupTitle,
  activityIcon,
  buildAssistantMessagePreview,
  formatProposedPlanStatus,
  formatThreadDiffStateLabel,
  formatThreadDiffStats,
  formatTimestamp,
  summarizeThreadDiffPreview,
} from "./renderUtils";

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

export const EmptyConversationRow = memo(function EmptyConversationRow() {
  const { styles } = useAppThemeContext();
  return (
    <View style={styles.emptyConversation}>
      <Text style={styles.sectionTitle}>No output yet</Text>
      <Text style={styles.helperText}>Send the first instruction to open the stream.</Text>
    </View>
  );
});

export const WaitingIndicatorRow = memo(function WaitingIndicatorRow({
  label,
  motion,
}: {
  readonly label: string;
  readonly motion: Animated.Value;
}) {
  const { styles } = useAppThemeContext();
  return (
    <Animated.View
      style={[
        styles.waitingIndicator,
        {
          opacity: motion.interpolate({
            inputRange: [0, 1],
            outputRange: [0.55, 1],
          }),
          transform: [
            {
              translateY: motion.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -4],
              }),
            },
          ],
        },
      ]}
    >
      <Text style={styles.waitingIndicatorText}>{label}</Text>
    </Animated.View>
  );
});

export const ProposedPlanRow = memo(
  function ProposedPlanRow({ item }: { readonly item: ConversationPlanRowItem }) {
    const { styles, theme } = useAppThemeContext();
    const cacheKey = getMessageMarkdownCacheKey({
      themeKey: theme.key,
      messageId: item.proposedPlan.id,
      updatedAt: item.proposedPlan.updatedAt,
    });

    return (
      <View style={styles.proposedPlanCard}>
        <View style={styles.proposedPlanHeader}>
          <View style={styles.proposedPlanHeaderCopy}>
            <Text style={styles.proposedPlanEyebrow}>Proposed plan</Text>
            <Text style={styles.proposedPlanStatus}>
              {formatProposedPlanStatus(item.proposedPlan)}
            </Text>
          </View>
          <Feather color={theme.accent} name="file-text" size={15} />
        </View>
        <CachedMarkdownMessage cacheKey={cacheKey} value={item.proposedPlan.planMarkdown} />
      </View>
    );
  },
  (previousProps, nextProps) => previousProps.item.proposedPlan === nextProps.item.proposedPlan,
);

function buildMessageAttachmentPreviews(
  attachments: ReadonlyArray<ChatAttachment> | undefined,
  resolveAttachmentImageUrl: (attachment: ChatAttachment) => string | null,
) {
  return (attachments ?? [])
    .filter((attachment) => attachment.type === "image")
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      uri: resolveAttachmentImageUrl(attachment),
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
}

type BaseMessageRowProps = {
  readonly messageMetaOpacity: Animated.Value;
  readonly onRevealMeta: (messageId: string) => void;
  readonly onToggleExpanded: (messageId: string) => void;
  readonly resolveAttachmentImageUrl: (attachment: ChatAttachment) => string | null;
};

export const ConversationMessageRow = memo(
  function ConversationMessageRow({
    item,
    messageMetaOpacity,
    onLongPress,
    onRevealMeta,
    onToggleExpanded,
    resolveAttachmentImageUrl,
  }: BaseMessageRowProps & {
    readonly item: ConversationMessageRowItem;
    readonly onLongPress: (message: OrchestrationMessage) => void;
  }) {
    const { styles, theme } = useAppThemeContext();
    const hasMessageText = item.message.text.length > 0;
    const assistantPreviewText = useMemo(
      () =>
        item.expandable && !item.expanded
          ? buildAssistantMessagePreview(item.message.text)
          : item.message.text,
      [item.expandable, item.expanded, item.message.text],
    );
    const messageAttachmentPreviews = useMemo(
      () => buildMessageAttachmentPreviews(item.message.attachments, resolveAttachmentImageUrl),
      [item.message.attachments, resolveAttachmentImageUrl],
    );
    const markdownCacheKey =
      item.message.role === "assistant" && !item.message.streaming
        ? getMessageMarkdownCacheKey({
            themeKey: theme.key,
            messageId: item.message.id,
            updatedAt: item.message.updatedAt,
          })
        : null;

    return (
      <Pressable
        delayLongPress={180}
        onLongPress={() => {
          onLongPress(item.message);
        }}
        onPress={() => {
          onRevealMeta(item.message.id);
        }}
        style={[
          styles.messageWrap,
          item.message.role === "user" ? styles.messageWrapUser : styles.messageWrapAssistant,
        ]}
      >
        <View
          style={[
            styles.messageRow,
            item.message.role === "user" ? styles.messageRowUser : styles.messageRowAssistant,
            item.highlighted && styles.messageRowAssistantLatest,
          ]}
        >
          <View style={styles.messageBody}>
            {item.badgeLabel ? (
              <View style={styles.messageQueuedBadge}>
                <Text style={styles.messageQueuedBadgeText}>{item.badgeLabel}</Text>
              </View>
            ) : null}
            {hasMessageText || item.message.streaming ? (
              hasMessageText ? (
                item.message.role === "assistant" ? (
                  item.message.streaming ? (
                    <Text selectable style={[styles.messageText, styles.messageTextAssistant]}>
                      {item.message.text || "Streaming..."}
                    </Text>
                  ) : item.expandable && !item.expanded ? (
                    <>
                      <Text style={[styles.messageText, styles.messageTextAssistant]}>
                        {assistantPreviewText}
                      </Text>
                      <Pressable
                        onPress={() => {
                          onToggleExpanded(item.message.id);
                        }}
                        style={styles.messageExpandButton}
                      >
                        <Text style={styles.messageExpandButtonLabel}>Expand</Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <CachedMarkdownMessage
                        cacheKey={markdownCacheKey}
                        value={item.message.text}
                      />
                      {item.expandable ? (
                        <Pressable
                          onPress={() => {
                            onToggleExpanded(item.message.id);
                          }}
                          style={styles.messageExpandButton}
                        >
                          <Text style={styles.messageExpandButtonLabel}>Collapse</Text>
                        </Pressable>
                      ) : null}
                    </>
                  )
                ) : (
                  <Text
                    selectable
                    style={[
                      styles.messageText,
                      item.message.role === "user"
                        ? styles.messageTextUser
                        : styles.messageTextAssistant,
                    ]}
                  >
                    {item.message.text}
                  </Text>
                )
              ) : (
                <Text style={[styles.messageText, styles.messageTextAssistant]}>Streaming...</Text>
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
        {item.isMetaRevealed ? (
          <Animated.View
            style={[
              styles.messageMetaReveal,
              { opacity: messageMetaOpacity },
              item.message.role === "user"
                ? styles.messageMetaRevealUser
                : styles.messageMetaRevealAssistant,
            ]}
          >
            <Text style={styles.messageMetaRevealText}>
              {formatTimestamp(item.message.updatedAt)}
              {item.message.streaming ? " / streaming" : ""}
            </Text>
          </Animated.View>
        ) : null}
      </Pressable>
    );
  },
  (previousProps, nextProps) =>
    previousProps.item.message === nextProps.item.message &&
    previousProps.item.badgeLabel === nextProps.item.badgeLabel &&
    previousProps.item.highlighted === nextProps.item.highlighted &&
    previousProps.item.expandable === nextProps.item.expandable &&
    previousProps.item.expanded === nextProps.item.expanded &&
    previousProps.item.isMetaRevealed === nextProps.item.isMetaRevealed &&
    previousProps.resolveAttachmentImageUrl === nextProps.resolveAttachmentImageUrl &&
    previousProps.messageMetaOpacity === nextProps.messageMetaOpacity,
);

export const ConversationQueuedRow = memo(
  function ConversationQueuedRow({
    item,
    messageMetaOpacity,
    onLongPress,
    onRevealMeta,
    onToggleExpanded,
    resolveAttachmentImageUrl,
  }: BaseMessageRowProps & {
    readonly item: ConversationQueuedRowItem;
    readonly onLongPress: (messageId: string) => void;
  }) {
    return (
      <ConversationMessageRow
        item={{
          kind: "message",
          id: item.id,
          message: item.message,
          badgeLabel: item.badgeLabel,
          highlighted: false,
          expandable: false,
          expanded: true,
          isMetaRevealed: item.isMetaRevealed,
        }}
        messageMetaOpacity={messageMetaOpacity}
        onLongPress={(message) => {
          onLongPress(message.id);
        }}
        onRevealMeta={onRevealMeta}
        onToggleExpanded={onToggleExpanded}
        resolveAttachmentImageUrl={resolveAttachmentImageUrl}
      />
    );
  },
  (previousProps, nextProps) =>
    previousProps.item.message === nextProps.item.message &&
    previousProps.item.badgeLabel === nextProps.item.badgeLabel &&
    previousProps.item.isMetaRevealed === nextProps.item.isMetaRevealed &&
    previousProps.resolveAttachmentImageUrl === nextProps.resolveAttachmentImageUrl &&
    previousProps.messageMetaOpacity === nextProps.messageMetaOpacity,
);

export const TimelineActivityGroupRow = memo(
  function TimelineActivityGroupRow({
    item,
    onToggle,
  }: {
    readonly item: ConversationActivityGroupRowItem;
    readonly onToggle: (groupId: string) => void;
  }) {
    const { styles, theme } = useAppThemeContext();
    const latestActivity = item.entry.activities[item.entry.activities.length - 1];
    if (!latestActivity) {
      return null;
    }

    const preview = activityGroupPreview(item.entry.activities);
    return (
      <View style={styles.timelineActivityWrap}>
        <Pressable
          onPress={() => {
            onToggle(item.entry.id);
          }}
          style={styles.timelineActivitySummaryRow}
        >
          <View style={styles.timelineActivitySummaryHeader}>
            <Feather
              color={theme.muted}
              name={item.expanded ? "chevron-down" : "chevron-right"}
              size={14}
            />
            <Feather color={theme.accent} name={activityIcon(latestActivity)} size={14} />
            <Text style={styles.timelineActivitySummaryTitle}>
              {activityGroupTitle(item.entry.activities)}
            </Text>
          </View>
          <Text style={styles.timelineActivitySummaryMeta}>
            {formatTimestamp(latestActivity.createdAt)}
          </Text>
        </Pressable>
        {preview ? <Text style={styles.timelineActivitySummaryPreview}>{preview}</Text> : null}
        {item.expanded ? (
          <View style={styles.timelineActivityExpandedList}>
            {item.entry.activities.map((activity) => {
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
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  },
  (previousProps, nextProps) =>
    previousProps.item.entry === nextProps.item.entry &&
    previousProps.item.expanded === nextProps.item.expanded,
);

export const ThreadDiffRow = memo(
  function ThreadDiffRow({
    item,
    onExpandFile,
    onToggle,
    threadId,
  }: {
    readonly item: ConversationDiffRowItem;
    readonly onExpandFile: (entryId: string, fileId: string) => void;
    readonly onToggle: (entry: ConversationDiffRowItem["entry"]) => void;
    readonly threadId: string | null;
  }) {
    const { styles, theme } = useAppThemeContext();
    const unifiedDiff = item.hydratedDiff?.result?.diff ?? item.entry.previewUnifiedDiff ?? "";
    const parsedFiles = useMemo(
      () =>
        item.expanded
          ? getCachedParsedDiff({
              cacheKey: getParsedDiffCacheKey({
                threadId: threadId ?? "detached-thread",
                turnId: item.entry.turnId,
                updatedAt: item.entry.updatedAt,
              }),
              diff: unifiedDiff,
            })
          : [],
      [item.entry.turnId, item.entry.updatedAt, item.expanded, threadId, unifiedDiff],
    );
    const summaryFiles = useMemo(
      () =>
        item.entry.files.length > 0
          ? item.entry.files
          : item.expanded
            ? parsedFiles.map((file) => ({
                path: file.path,
                kind: "modified",
                additions: file.additions,
                deletions: file.deletions,
              }))
            : [],
      [item.entry.files, item.expanded, parsedFiles],
    );
    const preview = summarizeThreadDiffPreview(item.entry);

    return (
      <View style={styles.diffCard}>
        <Pressable
          onPress={() => {
            onToggle(item.entry);
          }}
          style={styles.diffCardSummaryRow}
        >
          <View style={styles.diffCardSummaryHeader}>
            <Feather
              color={theme.muted}
              name={item.expanded ? "chevron-down" : "chevron-right"}
              size={14}
            />
            <Feather color={theme.accent} name="edit-3" size={14} />
            <Text style={styles.diffCardSummaryTitle}>
              {summaryFiles.length > 0 ? formatThreadDiffStats(summaryFiles) : "Changes"}
            </Text>
          </View>
          <Text style={styles.diffCardSummaryMeta}>{formatTimestamp(item.entry.updatedAt)}</Text>
        </Pressable>
        <View style={styles.diffCardStatusRow}>
          <Text
            style={[
              styles.diffCardStatus,
              item.entry.state === "streaming" && styles.diffCardStatusStreaming,
              item.entry.state === "ready" && styles.diffCardStatusReady,
              item.entry.state === "error" && styles.diffCardStatusError,
              item.entry.state === "missing" && styles.diffCardStatusMissing,
            ]}
          >
            {formatThreadDiffStateLabel(item.entry)}
          </Text>
          {item.entry.checkpointTurnCount !== null ? (
            <Text
              style={styles.diffCardStatusMeta}
            >{`Turn ${item.entry.checkpointTurnCount}`}</Text>
          ) : null}
        </View>
        {preview ? <Text style={styles.diffCardPreview}>{preview}</Text> : null}
        {item.expanded ? (
          <View style={styles.diffCardExpanded}>
            {item.hydratedDiff?.status === "loading" ? (
              <Text style={styles.diffCardHint}>Loading canonical diff...</Text>
            ) : null}
            {item.hydratedDiff?.status === "error" ? (
              <Text style={styles.diffCardErrorText}>{item.hydratedDiff.errorMessage}</Text>
            ) : null}
            {item.entry.previewTruncated ? (
              <Text style={styles.diffCardHint}>
                Streaming preview was truncated. Expand after completion for the full patch.
              </Text>
            ) : null}
            {parsedFiles.length > 0 ? (
              parsedFiles.map((file) => {
                const isExpanded = item.expandedFileIds[file.id] === true;
                const visibleLines = isExpanded
                  ? file.lines
                  : file.lines.slice(0, DIFF_FILE_LINE_LIMIT);
                return (
                  <View key={file.id} style={styles.diffFileBlock}>
                    <View style={styles.diffFileHeader}>
                      <Text numberOfLines={1} style={styles.diffFilePath}>
                        {file.path}
                      </Text>
                      <Text
                        style={styles.diffFileStats}
                      >{`+${file.additions} -${file.deletions}`}</Text>
                    </View>
                    <ScrollView
                      horizontal
                      style={styles.diffFileScroll}
                      contentContainerStyle={styles.diffFileScrollContent}
                    >
                      <View style={styles.diffFileLines}>
                        {visibleLines.map((line) => (
                          <View
                            key={line.id}
                            style={[
                              styles.diffLineRow,
                              line.kind === "hunk" && styles.diffLineRowHunk,
                              line.kind === "addition" && styles.diffLineRowAddition,
                              line.kind === "deletion" && styles.diffLineRowDeletion,
                            ]}
                          >
                            <Text
                              selectable
                              style={[
                                styles.diffLineText,
                                line.kind === "hunk" && styles.diffLineTextHunk,
                                line.kind === "addition" && styles.diffLineTextAddition,
                                line.kind === "deletion" && styles.diffLineTextDeletion,
                                line.kind === "meta" && styles.diffLineTextMeta,
                              ]}
                            >
                              {line.text || " "}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                    {file.lines.length > visibleLines.length ? (
                      <Pressable
                        onPress={() => {
                          onExpandFile(item.entry.id, file.id);
                        }}
                        style={styles.diffFileMoreButton}
                      >
                        <Text style={styles.diffFileMoreButtonLabel}>
                          {`Show ${file.lines.length - visibleLines.length} more lines`}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })
            ) : unifiedDiff.trim().length > 0 ? (
              <TimelineCodeBlock language="diff" value={unifiedDiff} />
            ) : (
              <Text style={styles.diffCardHint}>
                {item.entry.state === "missing"
                  ? "No checkpoint-backed diff is available for this turn."
                  : "Waiting for file changes..."}
              </Text>
            )}
          </View>
        ) : null}
      </View>
    );
  },
  (previousProps, nextProps) =>
    previousProps.item.entry === nextProps.item.entry &&
    previousProps.item.expanded === nextProps.item.expanded &&
    previousProps.item.expandedFileIds === nextProps.item.expandedFileIds &&
    previousProps.item.hydratedDiff === nextProps.item.hydratedDiff &&
    previousProps.threadId === nextProps.threadId,
);
