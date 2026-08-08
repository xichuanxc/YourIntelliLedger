/**
 * Capture entry point — chooses among the three paths of §5.2.
 *
 * The scanner is offered first because it corrects perspective before OCR.
 * When it is unavailable the app drops to the camera **silently**: §5.7
 * requires the fallback to happen without an error dialog, since which native
 * component served the user is not their problem.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button } from '@/ui/components/button';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { useCaptureStore } from '@/ui/stores/capture-store';
import { Spacing } from '@/ui/theme';

export default function CaptureScreen() {
  const { status, error, startScan, startGallery, reset } = useCaptureStore();
  const [busy, setBusy] = useState(false);

  const withBusy = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const scan = () =>
    withBusy(async () => {
      const outcome = await startScan();
      if (outcome === 'needs-camera-fallback') router.replace('/capture/camera');
      else if (outcome === 'done') router.replace('/capture/result');
    });

  const gallery = () =>
    withBusy(async () => {
      if ((await startGallery()) === 'done') router.replace('/capture/result');
    });

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
          <Button label="Scan a receipt" onPress={scan} busy={busy} />
          <Button
            label="Take a photo"
            variant="secondary"
            onPress={() => router.push('/capture/camera')}
          />
          <Button label="Choose from photos" variant="secondary" onPress={gallery} busy={busy} />
          <Button
            label="Enter by hand"
            variant="plain"
            onPress={() => {
              reset();
              router.replace('/bill/new');
            }}
          />
          {/* Reading a receipt needs an API key until the hub exists (§8.2). */}
          <Button label="Settings" variant="plain" onPress={() => router.push('/settings')} />
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
