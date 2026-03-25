import { Feather } from "@expo/vector-icons";
import { type ReactNode, useCallback, useRef } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { useAppThemeContext } from "../appThemeContext";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

export function SwipeDismissRow({
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
  const translateX = useSharedValue(0);
  const dismissTranslateX = -Math.max(width + 48, 220);
  const actionInFlightRef = useRef(false);

  const animateBack = useCallback(() => {
    translateX.value = withSpring(0, {
      damping: 18,
      stiffness: 180,
      mass: 0.9,
    });
  }, [translateX]);

  const handleActionFailure = useCallback(() => {
    actionInFlightRef.current = false;
    animateBack();
  }, [animateBack]);

  const handleActionComplete = useCallback(() => {
    try {
      actionInFlightRef.current = true;
      void Promise.resolve(onAction()).catch(handleActionFailure);
    } catch {
      handleActionFailure();
    }
  }, [handleActionFailure, onAction]);

  const triggerAction = useCallback(() => {
    if (actionInFlightRef.current) {
      return;
    }
    if (actionDisabled) {
      animateBack();
      return;
    }

    translateX.value = withTiming(
      dismissTranslateX,
      {
        duration: 140,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished) {
          runOnJS(handleActionComplete)();
        }
      },
    );
  }, [actionDisabled, animateBack, dismissTranslateX, handleActionComplete, translateX]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .onUpdate((event) => {
      translateX.value = Math.min(0, Math.max(event.translationX, dismissTranslateX));
    })
    .onEnd((event) => {
      if (event.translationX <= -72) {
        runOnJS(triggerAction)();
        return;
      }
      runOnJS(animateBack)();
    })
    .onFinalize(() => {
      if (!actionInFlightRef.current) {
        runOnJS(animateBack)();
      }
    });

  const actionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [dismissTranslateX, -52, -14, 0], [1, 1, 0.7, 0], {
      extrapolateLeft: Extrapolation.CLAMP,
      extrapolateRight: Extrapolation.CLAMP,
    }),
  }));
  const actionIconStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(translateX.value, [dismissTranslateX, -52, -14, 0], [1, 1, 0.95, 0.88], {
          extrapolateLeft: Extrapolation.CLAMP,
          extrapolateRight: Extrapolation.CLAMP,
        }),
      },
    ],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={styles.swipeRowShell}>
      <Animated.View style={[styles.swipeRowAction, actionStyle]}>
        <Pressable
          disabled={actionDisabled}
          onPress={triggerAction}
          style={[styles.swipeRowActionButton, actionDisabled && styles.buttonDisabled]}
        >
          <Animated.View style={[styles.swipeRowActionIconWrap, actionIconStyle]}>
            <Feather color={theme.danger} name={actionIcon} size={16} />
          </Animated.View>
        </Pressable>
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.swipeRowContent, contentStyle]}>
          <Pressable onPress={onPress}>{children}</Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
