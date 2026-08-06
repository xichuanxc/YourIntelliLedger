import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getDb } from '@/data/db';
import { ThemedText } from '@/ui/components/themed-text';
import { useColorScheme } from '@/ui/hooks/use-color-scheme';
import { Spacing } from '@/ui/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Open and migrate before anything renders: every screen below reads
    // through a repository, and a repository call against an unmigrated
    // database is a crash, not a slow path.
    getDb()
      .catch(setError)
      .finally(() => {
        void SplashScreen.hideAsync();
      });
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
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="bill/new" options={{ title: 'New bill', presentation: 'modal' }} />
            <Stack.Screen name="bill/[id]" options={{ title: 'Bill' }} />
            <Stack.Screen name="bill/edit/[id]" options={{ title: 'Edit bill' }} />
          </Stack>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
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
