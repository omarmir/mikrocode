export type MessageScrollMetrics = {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
};

export type ScrollToBottomRequest = {
  animated: boolean;
  targetOffset: number;
};

function targetOffsetForMetrics(nextMetrics: MessageScrollMetrics) {
  return Math.max(0, nextMetrics.contentHeight - nextMetrics.viewportHeight);
}

type AutoScrollControllerInput = {
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (frameId: number) => void;
  readonly onScrollToBottom: (input: ScrollToBottomRequest) => void;
  readonly stickyThreshold: number;
};

export function createConversationAutoScrollController(input: AutoScrollControllerInput) {
  let pendingFrameId: number | null = null;
  let pendingAnimatedScroll = false;
  let forceScrollToBottom = false;
  let stickToBottom = true;
  let metrics: MessageScrollMetrics = {
    contentHeight: 0,
    viewportHeight: 0,
    offsetY: 0,
  };

  const cancelPendingScroll = () => {
    if (pendingFrameId === null) {
      return;
    }

    input.cancelAnimationFrame(pendingFrameId);
    pendingFrameId = null;
    pendingAnimatedScroll = false;
  };

  const reset = () => {
    cancelPendingScroll();
    forceScrollToBottom = false;
    stickToBottom = true;
    metrics = {
      contentHeight: 0,
      viewportHeight: 0,
      offsetY: 0,
    };
  };

  const isNearBottomForMetrics = (nextMetrics: MessageScrollMetrics) => {
    if (nextMetrics.viewportHeight <= 0) {
      return true;
    }

    const distanceFromBottom =
      nextMetrics.contentHeight - (nextMetrics.offsetY + nextMetrics.viewportHeight);
    return distanceFromBottom <= input.stickyThreshold;
  };

  const scheduleScrollToBottom = (options?: {
    readonly force?: boolean;
    readonly animated?: boolean;
  }) => {
    if (options?.force) {
      forceScrollToBottom = true;
      stickToBottom = true;
    }
    pendingAnimatedScroll = pendingAnimatedScroll || (options?.animated ?? false);

    if (pendingFrameId !== null) {
      return;
    }

    let completedSynchronously = false;
    const frameId = input.requestAnimationFrame(() => {
      completedSynchronously = true;
      pendingFrameId = null;
      input.onScrollToBottom({
        animated: pendingAnimatedScroll,
        targetOffset: targetOffsetForMetrics(metrics),
      });
      pendingAnimatedScroll = false;
      forceScrollToBottom = false;
      stickToBottom = true;
    });
    pendingFrameId = completedSynchronously ? null : frameId;
  };

  return {
    cancelPendingScroll,
    getMetrics() {
      return metrics;
    },
    handleContentSizeChange(height: number) {
      metrics = {
        ...metrics,
        contentHeight: height,
      };
      if ((forceScrollToBottom || stickToBottom) && metrics.viewportHeight > 0) {
        scheduleScrollToBottom({ animated: false });
      }
    },
    handleLayout(viewportHeight: number) {
      const previousViewportHeight = metrics.viewportHeight;
      metrics = {
        ...metrics,
        viewportHeight,
      };
      if (
        viewportHeight <= 0 ||
        metrics.contentHeight <= 0 ||
        (!forceScrollToBottom && !stickToBottom) ||
        previousViewportHeight === viewportHeight
      ) {
        return;
      }

      scheduleScrollToBottom({ animated: false });
    },
    handleScroll(inputMetrics: {
      readonly contentHeight: number;
      readonly viewportHeight: number;
      readonly offsetY: number;
    }) {
      metrics = {
        contentHeight: inputMetrics.contentHeight,
        viewportHeight: inputMetrics.viewportHeight,
        offsetY: inputMetrics.offsetY,
      };
      if (forceScrollToBottom || pendingFrameId !== null) {
        return;
      }

      stickToBottom = isNearBottomForMetrics(metrics);
    },
    isNearBottom() {
      return forceScrollToBottom || stickToBottom || isNearBottomForMetrics(metrics);
    },
    reset,
    requestScrollToBottom(options?: { readonly force?: boolean }) {
      scheduleScrollToBottom({
        force: options?.force,
        animated: false,
      });
    },
  };
}
