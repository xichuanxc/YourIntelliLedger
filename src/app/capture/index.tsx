/**
 * Capture entry point — chooses among the three paths of §5.2.
 *
 * The scanner is offered first because it corrects perspective before OCR.
 * When it is unavailable the app drops to the camera **silently**: §5.7
 * requires the fallback to happen without an error dialog, since which native
 * component served the user is not their problem.
 *
 * ## Two ways in
 *
 * `?start=scan` runs the scanner immediately and never shows this list — it is
 * what the ledger's + button does, because scanning is the answer almost every
 * time and a menu in front of it charged a tap for a decision already made.
 * Arriving without the parameter (a long-press on the same button) shows the
 * list.
 *
 * Cancelling differs between the two, deliberately. From the list, cancelling
 * the scanner returns to the list — the user came here to choose, and may want
 * a different path. From the shortcut, it returns to the ledger, because the
 * user asked for the scanner rather than for this screen, and stranding them
 * on a menu they never opened would be a strange reward for changing their
 * mind.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/ui/components/button';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { useCaptureStore } from '@/ui/stores/capture-store';
import { Spacing } from '@/ui/theme';

export default function CaptureScreen() {
  const { status, error, startScan, startGallery, reset } = useCaptureStore();
  const [busy, setBusy] = useState(false);
  const { start } = useLocalSearchParams<{ start?: string }>();
  const shortcut = start === 'scan';
  const started = useRef(false);

  const withBusy = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const scan = (cancelGoesBack = false) =>
    withBusy(async () => {
      const outcome = await startScan();
      if (outcome === 'needs-camera-fallback') router.replace('/capture/camera');
      else if (outcome === 'done') router.replace('/capture/result');
      // `canGoBack` because a deep link (the app has a scheme, §2.3) can open
      // this screen with nothing behind it, and `back()` would then go nowhere.
      else if (cancelGoesBack) {
        if (router.canGoBack()) router.back();
        else router.replace('/');
      }
    });

  // Once per arrival. The ref rather than the store's status, because status
  // returns to 'idle' after a cancelled scan and would start a second one.
  useEffect(() => {
    if (!shortcut || started.current) return;
    started.current = true;
    void scan(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcut]);

  const gallery = () =>
    withBusy(async () => {
      if ((await startGallery()) === 'done') router.replace('/capture/result');
    });

  // Coming in by shortcut, this screen is a corridor rather than a
  // destination, so it shows a spinner instead of flashing a list of choices
  // behind the scanner that is about to cover it.
  if (shortcut && status !== 'error') {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator />
          <ThemedText themeColor="textSecondary">
            {status === 'processing' ? 'Reading the receipt…' : 'Opening the scanner…'}
          </ThemedText>
        </View>
      </Screen>
    );
  }

  if (status === 'processing') {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator />
          <ThemedText themeColor="textSecondary">Reading the receipt…</ThemedText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.content}>
        <ThemedText type="title">Add a receipt</ThemedText>
        <ThemedText themeColor="textSecondary">
          Scanning straightens the receipt before reading it, which gives the best result. Use a
          photo when the scanner is not available or the picture is already taken.
        </ThemedText>

        {error && (
          <ThemedText themeColor="danger" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}

        <View style={styles.actions}>
          <Button label="Scan a receipt" onPress={() => scan()} busy={busy} />
          <Button
            label="Take a photo"
            variant="secondary"
            onPress={() => router.push('/capture/camera')}
          />
          <Button label="Choose from photos" variant="secondary" onPress={gallery} busy={busy} />
          {/* Settings is not repeated here. It is one tap away in the ledger
              header, and this list should offer ways to add a receipt — an
              item that leaves without adding one made the shortest path to
              capture longer for everyone who never needed it. */}
          <Button
            label="Enter by hand"
            variant="plain"
            onPress={() => {
              reset();
              router.replace('/bill/new');
            }}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.four, flex: 1 },
  actions: { gap: Spacing.three, marginTop: Spacing.four },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
});
