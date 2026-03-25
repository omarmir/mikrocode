import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { memo, type RefObject, useCallback, useMemo } from "react";
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
  EmptyConversationRow,
  ProposedPlanRow,
  ThreadDiffRow,
  TimelineActivityGroupRow,
  WaitingIndicatorRow,
} from "./conversationRows";
import type { HydratedTurnDiffState } from "./renderUtils";
import { useAppThemeContext } from "../appThemeContext";

const FLASH_LIST_DRAW_DISTANCE = 600;

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
  const renderItems = useMemo(
    () =>
      buildConversationRenderItems({
        previousItems: undefined,
        timelineEntries,
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
      revealedMessageId,
      selectedThreadConversationId,
      showWaitingIndicator,
      timelineEntries,
    ],
  );
  const renderConversationItem = useCallback(
    ({ item }: { readonly item: ConversationRenderItem }) => {
      switch (item.kind) {
        case "empty":
          return <EmptyConversationRow />;
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
          return <ProposedPlanRow item={item} />;
        case "message":
          return (
            <ConversationMessageRow
              item={item}
              messageMetaOpacity={messageMetaOpacity}
              onLongPress={requestHandleMessageLongPress}
              onRevealMeta={requestRevealMessageMeta}
              onToggleExpanded={requestToggleAssistantMessageExpanded}
              resolveAttachmentImageUrl={resolveAttachmentImageUrl}
            />
          );
      }
    },
    [
      messageMetaOpacity,
      requestExpandDiffFile,
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
      ref={scrollRef}
      contentContainerStyle={styles.messagesScrollContent}
      data={renderItems}
      drawDistance={FLASH_LIST_DRAW_DISTANCE}
      getItemType={getConversationRenderItemType}
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.id}
      onContentSizeChange={handleConversationContentSizeChange}
      onLayout={handleConversationLayout}
      onScroll={handleConversationScroll}
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
