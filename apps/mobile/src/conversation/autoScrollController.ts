export type MessageScrollMetrics = {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
};

type AutoScrollControllerInput = {
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (frameId: number) => void;
  readonly onScrollToBottom: () => void;
  readonly stickyThreshold: number;
};

export function createConversationAutoScrollController(input: AutoScrollControllerInput) {
  let pendingFrameId: number | null = null;
  let forceScrollToBottom = false;
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
  };

  const isNearBottom = () => {
    if (metrics.viewportHeight <= 0) {
      return true;
    }

    const distanceFromBottom = metrics.contentHeight - (metrics.offsetY + metrics.viewportHeight);
    return distanceFromBottom <= input.stickyThreshold;
  };

  const scheduleScrollToBottom = (options?: { readonly force?: boolean }) => {
    if (options?.force) {
      forceScrollToBottom = true;
    }

    if (pendingFrameId !== null) {
      return;
    }

    pendingFrameId = input.requestAnimationFrame(() => {
      pendingFrameId = null;
      input.onScrollToBottom();
      forceScrollToBottom = false;
    });
  };

  return {
    cancelPendingScroll,
    getMetrics() {
      return metrics;
    },
    handleContentSizeChange(height: number) {
      const shouldStickToBottom = forceScrollToBottom || isNearBottom();
      metrics = {
        ...metrics,
        contentHeight: height,
      };
      if (shouldStickToBottom) {
        scheduleScrollToBottom();
      }
    },
    handleLayout(viewportHeight: number) {
      metrics = {
        ...metrics,
        viewportHeight,
      };
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
    },
    isNearBottom,
    requestScrollToBottom(options?: { readonly force?: boolean }) {
      scheduleScrollToBottom(options);
    },
  };
}
