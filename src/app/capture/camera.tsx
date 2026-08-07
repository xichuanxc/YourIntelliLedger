/**
 * The fallback camera (§5.2).
 *
 * Required, not optional: on Android the system document scanner depends on
 * Google Play Services and is absent on devices without it. This path also has
 * no perspective correction, so §5.2 asks for overlay guidance — fill the
 * frame, flatten the receipt, avoid shadow — because the user framing it well
 * is the only thing standing in for what the scanner would have done.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { useCaptureStore } from '@/ui/stores/capture-store';
import { Radius, Spacing } from '@/ui/theme';

export default function CameraCaptureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const run = useCaptureStore((state) => state.runPipeline);

  // §8.1: ask at the moment of use, with a plain-language reason, and stay
  // usable when refused — manual entry needs no camera at all.
  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <Screen>
        <EmptyState
          title="Camera access needed"
          message="YourIntelliLedger uses the camera to photograph receipts so purchases can be recorded automatically. You can still add bills by hand without it."
          actionLabel="Allow camera"
          onAction={() => void requestPermission()}
        />
        <View style={styles.footer}>
          <Button label="Add by hand instead" variant="plain" onPress={() => router.replace('/bill/new')} />
        </View>
      </Screen>
    );
  }

  const takePhoto = async () => {
    setBusy(true);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 1, skipProcessing: true });
      if (photo?.uri) {
        await run([photo.uri], 'camera');
        router.replace('/capture/result');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.fill}>
      <CameraView ref={camera} style={styles.fill} facing="back" />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.guide} />
        <ThemedText style={styles.hint}>
          Fill the frame with the receipt. Flatten it, and keep your shadow off it.
        </ThemedText>
      </View>

      <View style={styles.controls} pointerEvents="box-none">
        <Button label="Capture" onPress={takePhoto} busy={busy} />
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <ThemedText style={styles.cancel}>Cancel</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guide: {
    width: '82%',
    height: '62%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: Radius.medium,
  },
  hint: {
    color: '#fff',
    textAlign: 'center',
    marginTop: Spacing.four,
    paddingHorizontal: Spacing.five,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.six,
    paddingHorizontal: Spacing.five,
    gap: Spacing.three,
  },
  cancel: { color: '#fff', textAlign: 'center' },
  footer: { padding: Spacing.four },
});
