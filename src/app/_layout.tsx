import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getDb } from '@/data/db';
import { getBlockScreenshots } from '@/data/prefs';
import { applyScreenshotPolicy } from '@/data/screenPrivacy';
import { LaunchScreen } from '@/ui/components/launch-screen';
import { ThemedText } from '@/ui/components/themed-text';
import { useColorScheme } from '@/ui/hooks/use-color-scheme';
import { Spacing } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);
  const [launching, setLaunching] = useState(true);

  useEffect(() => {
    // Open and migrate before anything renders: every screen below reads
    // through a repository, and a repository call against an unmigrated
    // database is a crash, not a slow path.
    getDb()
      .catch(setError)
      .finally(() => setReady(true));

    // §8.2: the screenshot block is a stored preference, so it has to be
    // re-applied on every launch — the flag itself does not persist.
    // Never throws by contract, so no catch is needed here (see screenPrivacy).
    void applyScreenshotPolicy(getBlockScreenshots());
  }, []);

  if (error) {
    return (
      <ThemeProvider value={dark ? DarkTheme : DefaultTheme}>
        <SafeAreaProvider>
          <View style={styles.error}>
            <ThemedText type="subtitle">Your ledger could not be opened</ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.centered}>
              {error.message}
            </ThemedText>
          </View>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ThemeProvider value={dark ? DarkTheme : DefaultTheme}>
          {/* The launch screen is navy in both schemes, so the status bar has
              to be light while it is up regardless of the system setting. */}
          <StatusBar style={launching ? 'light' : 'auto'} />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="bill/new" options={{ title: 'New bill', presentation: 'modal' }} />
            <Stack.Screen name="bill/[id]" options={{ title: 'Bill' }} />
            <Stack.Screen name="bill/edit/[id]" options={{ title: 'Edit bill' }} />
            <Stack.Screen name="capture/index" options={{ title: 'Add a receipt' }} />
            {/* Full-screen: the camera overlay guidance in §5.2 needs the frame. */}
            <Stack.Screen name="capture/camera" options={{ headerShown: false }} />
            <Stack.Screen name="capture/result" options={{ title: 'Receipt text' }} />
            <Stack.Screen name="capture/review" options={{ title: 'Check this receipt' }} />
            {/* Titled at runtime with the slice that was tapped. */}
            <Stack.Screen name="insights/breakdown" options={{ title: '' }} />
            <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
          </Stack>

          {launching && (
            <LaunchScreen
              ready={ready}
              onShown={hideNativeSplash}
              onFinished={() => setLaunching(false)}
            />
          )}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Retires the OS splash the instant the launch screen has been laid out.
 *
 * Tying this to the database instead would leave a static PNG up for the whole
 * of startup and play the entrance animation underneath it, unseen. Laying out
 * first also means there is never a frame of bare app between the two.
 */
function hideNativeSplash() {
  void SplashScreen.hideAsync();
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.six,
  },
  centered: { textAlign: 'center' },
});
