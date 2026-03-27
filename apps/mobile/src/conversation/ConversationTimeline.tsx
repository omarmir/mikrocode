import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
  type RenderTarget,
} from "@shopify/flash-list";
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  RefreshControl,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import type { ChatAttachment, OrchestrationMessage } from "@t3tools/contracts";

import type { ThreadDiffEntry, ThreadTimelineEntry } from "../threadDiffs";
import {
  buildConversationRenderItems,
  getConversationRenderItemType,
  type ConversationRenderItem,
  type PinnedConversationMessage,
} from "./conversationRenderItems";
import {
  ConversationMessageRow,
  ConversationQueuedRow,
  type ConversationRowRenderMode,
  EmptyConversationRow,
  ProposedPlanRow,
  ShowMoreHistoryRow,
  ThreadDiffRow,
  TimelineActivityGroupRow,
  WaitingIndicatorRow,
} from "./conversationRows";
import type { HydratedTurnDiffState } from "./renderUtils";
import { useAppThemeContext } from "../appThemeContext";
import { buildConversationTimelineWindow } from "./timelineWindow";

const FLASH_LIST_DRAW_DISTANCE = 420;
const FLASH_LIST_MAX_ITEMS_IN_RECYCLE_POOL = 24;
const INITIAL_VISIBLE_CONVERSATION_TURN_COUNT = 10;
const CONVERSATION_TURN_REVEAL_BATCH_SIZE = 10;
const CONVERSATION_TIMELINE_LIST_KEY_FALLBACK = "empty-thread";
const CONVERSATION_TIMELINE_MAINTAIN_VISIBLE_POSITION = {
  startRenderingFromBottom: true,
} as const;

function resolveConversationRowRenderMode(target: RenderTarget): ConversationRowRenderMode {
  return target === "Measurement" ? "measurement" : "visible";
}

const ConversationTimelineImpl = memo(function ConversationTimeline({
  expandedActivityGroupIds,
  expandedAssistantMessageIds,
  expandedDiffFileIds,
  expandedDiffIds,
  handleConversationContentSizeChange,
  handleConversationLayout,
  handleConversationScroll,
  handlePullToRefresh,
  highlightedAssistantMessageId,
  hydratedTurnDiffs,
  isPullRefreshing,
  messageMetaOpacity,
  pinnedQueuedMessages,
  requestExpandDiffFile,
  requestHandleMessageLongPress,
  requestHandlePinnedQueuedMessageLongPress,
  requestRevealMessageMeta,
  requestToggleActivityGroup,
  requestToggleAssistantMessageExpanded,
  requestToggleDiffEntry,
  resolveAttachmentImageUrl,
  revealedMessageId,
  scrollRef,
  selectedThreadConversationId,
  showWaitingIndicator,
  timelineEntries,
  waitingIndicatorLabel,
  waitingIndicatorMotion,
}: {
  readonly expandedActivityGroupIds: Readonly<Record<string, true>>;
  readonly expandedAssistantMessageIds: Readonly<Record<string, true>>;
  readonly expandedDiffFileIds: Readonly<Record<string, Readonly<Record<string, true>>>>;
  readonly expandedDiffIds: Readonly<Record<string, true>>;
  readonly handleConversationContentSizeChange: (width: number, height: number) => void;
  readonly handleConversationLayout: (event: LayoutChangeEvent) => void;
  readonly handleConversationScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  readonly handlePullToRefresh: () => void;
  readonly highlightedAssistantMessageId: string | null;
  readonly hydratedTurnDiffs: Readonly<Record<string, HydratedTurnDiffState>>;
  readonly isPullRefreshing: boolean;
  readonly messageMetaOpacity: Animated.Value;
  readonly pinnedQueuedMessages: ReadonlyArray<PinnedConversationMessage>;
  readonly requestExpandDiffFile: (entryId: string, fileId: string) => void;
  readonly requestHandleMessageLongPress: (message: OrchestrationMessage) => void;
  readonly requestHandlePinnedQueuedMessageLongPress: (messageId: string) => void;
  readonly requestRevealMessageMeta: (messageId: string) => void;
  readonly requestToggleActivityGroup: (groupId: string) => void;
  readonly requestToggleAssistantMessageExpanded: (messageId: string) => void;
  readonly requestToggleDiffEntry: (entry: ThreadDiffEntry) => void;
  readonly resolveAttachmentImageUrl: (attachment: ChatAttachment) => string | null;
  readonly revealedMessageId: string | null;
  readonly scrollRef: RefObject<FlashListRef<ConversationRenderItem> | null>;
  readonly selectedThreadConversationId: string | null;
  readonly showWaitingIndicator: boolean;
  readonly timelineEntries: ReadonlyArray<ThreadTimelineEntry>;
  readonly waitingIndicatorLabel: string;
  readonly waitingIndicatorMotion: Animated.Value;
}) {
  const { styles, theme } = useAppThemeContext();
  const [visibleTurnCount, setVisibleTurnCount] = useState(INITIAL_VISIBLE_CONVERSATION_TURN_COUNT);
  const previousRenderItemsRef = useRef<ReadonlyArray<ConversationRenderItem>>([]);
  const previousThreadConversationIdRef = useRef<string | null>(null);
  const effectiveVisibleTurnCount =
    previousThreadConversationIdRef.current === selectedThreadConversationId
      ? visibleTurnCount
      : INITIAL_VISIBLE_CONVERSATION_TURN_COUNT;
  const timelineWindow = useMemo(
    () =>
      buildConversationTimelineWindow({
        timelineEntries,
        visibleTurnCount: effectiveVisibleTurnCount,
      }),
    [effectiveVisibleTurnCount, timelineEntries],
  );
  const previousRenderItems =
    previousThreadConversationIdRef.current === selectedThreadConversationId
      ? previousRenderItemsRef.current
      : undefined;
  const renderItems = useMemo(
    () =>
      buildConversationRenderItems({
        previousItems: previousRenderItems,
        timelineEntries: timelineWindow.visibleTimelineEntries,
        hiddenHistorySummary:
          timelineWindow.hiddenTurnCount > 0
            ? {
                hiddenEntryCount: timelineWindow.hiddenEntryCount,
                hiddenTurnCount: timelineWindow.hiddenTurnCount,
                revealTurnCount: Math.min(
                  CONVERSATION_TURN_REVEAL_BATCH_SIZE,
                  timelineWindow.hiddenTurnCount,
                ),
              }
            : null,
        pinnedQueuedMessages,
        showWaitingIndicator,
        highlightedAssistantMessageId,
        expandedAssistantMessageIds,
        expandedActivityGroupIds,
        expandedDiffIds,
        expandedDiffFileIds,
        hydratedTurnDiffs,
        revealedMessageId,
        selectedThreadConversationId,
      }),
    [
      expandedActivityGroupIds,
      expandedAssistantMessageIds,
      expandedDiffFileIds,
      expandedDiffIds,
      highlightedAssistantMessageId,
      hydratedTurnDiffs,
      pinnedQueuedMessages,
      previousRenderItems,
      revealedMessageId,
      selectedThreadConversationId,
      showWaitingIndicator,
      timelineWindow.hiddenEntryCount,
      timelineWindow.hiddenTurnCount,
      timelineWindow.visibleTimelineEntries,
    ],
  );
  useEffect(() => {
    previousRenderItemsRef.current = renderItems;
    previousThreadConversationIdRef.current = selectedThreadConversationId;
  }, [renderItems, selectedThreadConversationId]);
  useEffect(() => {
    setVisibleTurnCount(INITIAL_VISIBLE_CONVERSATION_TURN_COUNT);
  }, [selectedThreadConversationId]);
  const handleRevealOlderTurns = useCallback(() => {
    setVisibleTurnCount((current) => current + CONVERSATION_TURN_REVEAL_BATCH_SIZE);
  }, []);
  const renderConversationItem = useCallback(
    ({ item, target }: ListRenderItemInfo<ConversationRenderItem>) => {
      const renderMode = resolveConversationRowRenderMode(target);
      switch (item.kind) {
        case "empty":
          return <EmptyConversationRow />;
        case "show-more-history":
          return <ShowMoreHistoryRow item={item} onPress={handleRevealOlderTurns} />;
        case "waiting":
          return (
            <WaitingIndicatorRow label={waitingIndicatorLabel} motion={waitingIndicatorMotion} />
          );
        case "queued":
          return (
            <ConversationQueuedRow
              item={item}
              messageMetaOpacity={messageMetaOpacity}
              onLongPress={requestHandlePinnedQueuedMessageLongPress}
              onRevealMeta={requestRevealMessageMeta}
              onToggleExpanded={requestToggleAssistantMessageExpanded}
              renderMode={renderMode}
              resolveAttachmentImageUrl={resolveAttachmentImageUrl}
            />
          );
        case "activity-group":
          return <TimelineActivityGroupRow item={item} onToggle={requestToggleActivityGroup} />;
        case "diff":
          return (
            <ThreadDiffRow
              item={item}
              onExpandFile={requestExpandDiffFile}
              onToggle={requestToggleDiffEntry}
              threadId={selectedThreadConversationId}
            />
          );
        case "plan":
          return <ProposedPlanRow item={item} renderMode={renderMode} />;
        case "message":
          return (
            <ConversationMessageRow
              item={item}
              messageMetaOpacity={messageMetaOpacity}
              onLongPress={requestHandleMessageLongPress}
              onRevealMeta={requestRevealMessageMeta}
              onToggleExpanded={requestToggleAssistantMessageExpanded}
              renderMode={renderMode}
              resolveAttachmentImageUrl={resolveAttachmentImageUrl}
            />
          );
      }
    },
    [
      messageMetaOpacity,
      requestExpandDiffFile,
      handleRevealOlderTurns,
      requestHandleMessageLongPress,
      requestHandlePinnedQueuedMessageLongPress,
      requestRevealMessageMeta,
      requestToggleActivityGroup,
      requestToggleAssistantMessageExpanded,
      requestToggleDiffEntry,
      resolveAttachmentImageUrl,
      selectedThreadConversationId,
      waitingIndicatorLabel,
      waitingIndicatorMotion,
    ],
  );

  return (
    <FlashList
      key={selectedThreadConversationId ?? CONVERSATION_TIMELINE_LIST_KEY_FALLBACK}
      ref={scrollRef}
      contentContainerStyle={styles.messagesScrollContent}
      data={renderItems}
      drawDistance={FLASH_LIST_DRAW_DISTANCE}
      getItemType={getConversationRenderItemType}
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.id}
      maxItemsInRecyclePool={FLASH_LIST_MAX_ITEMS_IN_RECYCLE_POOL}
      maintainVisibleContentPosition={CONVERSATION_TIMELINE_MAINTAIN_VISIBLE_POSITION}
      onContentSizeChange={handleConversationContentSizeChange}
      onLayout={handleConversationLayout}
      onScroll={handleConversationScroll}
      removeClippedSubviews={Platform.OS === "android"}
      refreshControl={
        <RefreshControl
          onRefresh={handlePullToRefresh}
          refreshing={isPullRefreshing}
          tintColor={theme.accent}
        />
      }
      renderItem={renderConversationItem}
      scrollEventThrottle={16}
      style={styles.messagesScroll}
    />
  );
});

export const ConversationTimeline = ConversationTimelineImpl;
