import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { useAppThemeContext } from "../appThemeContext";

const PANEL_ANIMATION_DURATION_MS = 220;

export function SlidingPanel({
  children,
  onClose,
  open,
  side,
  width,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly side: "left" | "right";
  readonly width: number;
}) {
  const { styles } = useAppThemeContext();
  const [visible, setVisible] = useState(open);
  const closedOffset = side === "left" ? -width : width;
  const translateX = useSharedValue(open ? 0 : closedOffset);

  useEffect(() => {
    if (open) {
      setVisible(true);
      translateX.value = withTiming(0, {
        duration: PANEL_ANIMATION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    translateX.value = withTiming(
      closedOffset,
      {
        duration: PANEL_ANIMATION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(setVisible)(false);
        }
      },
    );
  }, [closedOffset, open, translateX]);

  const closeThreshold = Math.min(96, width * 0.24);
  const panelGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(side === "left" ? [-10, 10] : [-10, 10])
        .failOffsetY([-10, 10])
        .onUpdate((event) => {
          if (side === "left") {
            translateX.value = Math.max(closedOffset, Math.min(0, event.translationX));
            return;
          }

          translateX.value = Math.max(0, Math.min(width, event.translationX));
        })
        .onEnd((event) => {
          if (side === "left") {
            if (event.translationX <= -closeThreshold) {
              runOnJS(onClose)();
              return;
            }
            translateX.value = withTiming(0, {
              duration: PANEL_ANIMATION_DURATION_MS,
              easing: Easing.out(Easing.cubic),
            });
            return;
          }

          if (event.translationX >= closeThreshold) {
            runOnJS(onClose)();
            return;
          }
          translateX.value = withTiming(0, {
            duration: PANEL_ANIMATION_DURATION_MS,
            easing: Easing.out(Easing.cubic),
          });
        }),
    [closeThreshold, closedOffset, onClose, side, translateX, width],
  );
  const backdropStyle = useAnimatedStyle(() => ({
    opacity:
      side === "left"
        ? interpolate(translateX.value, [closedOffset, 0], [0, 1], {
            extrapolateLeft: Extrapolation.CLAMP,
            extrapolateRight: Extrapolation.CLAMP,
          })
        : interpolate(translateX.value, [0, closedOffset], [1, 0], {
            extrapolateLeft: Extrapolation.CLAMP,
            extrapolateRight: Extrapolation.CLAMP,
          }),
  }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  if (!visible) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.overlayRoot}>
      <Animated.View style={[styles.overlayBackdrop, backdropStyle]}>
        <Pressable onPress={onClose} style={styles.overlayBackdropPressable} />
      </Animated.View>
      <GestureDetector gesture={panelGesture}>
        <Animated.View
          style={[
            side === "left" ? styles.overlayPanelLeft : styles.overlayPanelRight,
            { width },
            panelStyle,
          ]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
