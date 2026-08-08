/**
 * The launch screen — what replaces the OS splash while the ledger opens.
 *
 * ## Why there are two splashes
 *
 * The native splash is a single static PNG the OS draws before any JavaScript
 * exists. It cannot animate, and it cannot know whether the database opened.
 * This is its continuation: same mark, same place, taking over the moment
 * React can draw, and staying until there is something real to show.
 *
 * ## Why the icon is dead centre
 *
 * The native splash centres its image, so this one must too, or the mark jumps
 * at the handoff. That is why the wordmark is positioned absolutely *below*
 * the centre line rather than being laid out under the icon in a column — a
 * column would push the icon up by half the text block's height and give away
 * the seam. `assets/images/splash-icon.png` is corner-masked for the same
 * reason (see `scripts/build-splash-icon.js`).
 *
 * ## Why it does not simply wait a fixed time
 *
 * §8.4 budgets cold start to interactive at under two seconds, and a splash
 * that outstays the work it covers is spending that budget on decoration. This
 * one leaves as soon as the caller says the app is ready, subject only to a
 * short floor so a warm start does not flash it for three frames.
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

/** Sampled from the artwork's night sky, so the icon's edges dissolve into it. */
const GRADIENT = ['#0A1533', '#11235F', '#1D3C7A'] as const;

const ICON_SIZE = 132;
/** The 22.37% squircle proportion the asset itself is masked to. */
const ICON_RADIUS = Math.round(ICON_SIZE * 0.2237);

/** How far the two glow rings sit outside the mark. */
const HALO_INNER = 9;
const HALO_OUTER = 20;

const ENTER_MS = 520;
const TEXT_DELAY_MS = 120;
const EXIT_MS = 320;

/**
 * How long the screen stays even if the app was ready immediately. Just past
 * the entrance animation, so it is never seen half-played.
 */
export const MIN_VISIBLE_MS = 900;

export interface LaunchScreenProps {
  /** The app has finished its startup work and there is something to show. */
  ready: boolean;
  /**
   * Fired once this screen has been laid out — the caller's cue to retire the
   * OS splash. Waiting for layout rather than for mount guarantees there is
   * never a frame of bare app between the two.
   */
  onShown?: () => void;
  /** Called once the exit fade has finished and this can be unmounted. */
  onFinished: () => void;
}

export function LaunchScreen({ ready, onShown, onFinished }: LaunchScreenProps) {
  const reducedMotion = useReducedMotion();

  // Motion is an enhancement; the screen must read correctly without it.
  const enter = useSharedValue(reducedMotion ? 1 : 0);
  const enterText = useSharedValue(reducedMotion ? 1 : 0);
  const exit = useSharedValue(0);

  const [shownAt] = useState(() => Date.now());

  useEffect(() => {
    if (reducedMotion) return;

    const easing = { duration: ENTER_MS, easing: Easing.out(Easing.cubic) };
    enter.value = withTiming(1, easing);
    // The wordmark follows rather than arriving alongside — the mark is what
    // the user tapped, and it should land first.
    enterText.value = withDelay(TEXT_DELAY_MS, withTiming(1, easing));
  }, [enter, enterText, reducedMotion]);

  useEffect(() => {
    if (!ready) return;

    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt));
    const timer = setTimeout(() => {
      exit.value = withTiming(1, { duration: EXIT_MS, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(onFinished)();
      });
    }, remaining);

    return () => clearTimeout(timer);
  }, [ready, shownAt, exit, onFinished]);

  const screenStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));

  const iconStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    // Settling outwards rather than springing: this is a door opening, not a
    // notification arriving.
    transform: [{ scale: 0.92 + enter.value * 0.08 }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: enterText.value,
    transform: [{ translateY: (1 - enterText.value) * 12 }],
  }));

  return (
    <Animated.View
      testID="launch-screen"
      style={[StyleSheet.absoluteFill, screenStyle]}
      onLayout={onShown}
      pointerEvents="none"
      // Hidden from assistive technology on purpose: it is on screen for under
      // a second and then gone, so announcing it would interrupt the reader on
      // the way to a ledger it can already reach underneath.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <LinearGradient colors={GRADIENT} style={StyleSheet.absoluteFill} />

      <View style={styles.centre}>
        <Animated.View style={iconStyle}>
          {/* Two rings of barely-there white behind the mark. A blurred glow
              needs a native filter; concentric low-opacity rounded views give
              the same lift with nothing extra installed. */}
          <View style={[styles.halo, styles.haloOuter]} />
          <View style={[styles.halo, styles.haloInner]} />
          <Image
            source={require('@/assets/images/splash-icon.png')}
            style={styles.icon}
            contentFit="cover"
            // Bundled, decoded once, and on screen for under a second — a
            // transition here would fade in on top of the fade already running.
            transition={0}
          />
        </Animated.View>
      </View>

      <Animated.View style={[styles.wordmarkBlock, textStyle]}>
        <Text style={styles.wordmark}>YourIntelliLedger</Text>
        <Text style={styles.tagline}>Your ledger, on your device</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_RADIUS,
  },
  halo: {
    position: 'absolute',
    borderColor: '#FFFFFF',
    borderWidth: 1,
  },
  /**
   * Each ring's radius follows its own inset, so the three curves stay
   * concentric. Sharing one radius across different insets made the outer ring
   * read as a squarer, separate rectangle — a selection outline rather than a
   * glow. Only visible by looking at the rendered screen.
   */
  haloOuter: {
    top: -HALO_OUTER,
    left: -HALO_OUTER,
    right: -HALO_OUTER,
    bottom: -HALO_OUTER,
    borderRadius: ICON_RADIUS + HALO_OUTER,
    opacity: 0.05,
  },
  haloInner: {
    top: -HALO_INNER,
    left: -HALO_INNER,
    right: -HALO_INNER,
    bottom: -HALO_INNER,
    borderRadius: ICON_RADIUS + HALO_INNER,
    opacity: 0.1,
  },
  /**
   * Absolute, hung off the centre line, so the icon above it stays exactly
   * where the native splash put it. `top: 50%` is the screen's middle; the
   * margin clears the icon's lower half plus a gap.
   */
  wordmarkBlock: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: ICON_SIZE / 2 + 36,
    alignItems: 'center',
    gap: 6,
  },
  wordmark: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  tagline: {
    // 0.66 white on this navy clears 4.5:1 — the tagline is real text, not
    // decoration, and it makes a claim worth being able to read.
    color: 'rgba(255,255,255,0.66)',
    fontSize: 14,
    letterSpacing: 0.1,
  },
});
