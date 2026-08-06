import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/ui/hooks/use-theme';
import { MaxContentWidth } from '@/ui/theme';

export interface ScreenProps {
  children: ReactNode;
  /**
   * Which insets to apply. Safe areas are one of the two most common
   * cross-platform defects (§7), so every screen goes through this component
   * rather than hand-rolling padding: notch and Dynamic Island **[i]**,
   * status and navigation bars **[A]**.
   */
  edges?: readonly Edge[];
}

export function Screen({ children, edges = ['top', 'left', 'right'] }: ScreenProps) {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={edges}>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
