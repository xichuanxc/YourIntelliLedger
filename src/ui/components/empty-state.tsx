import { StyleSheet, View } from 'react-native';

import { Button } from '@/ui/components/button';
import { ThemedText } from '@/ui/components/themed-text';
import { Spacing } from '@/ui/theme';

export interface EmptyStateProps {
  title: string;
  /** Say what to do next — §7 requires this on every list, not just a shrug. */
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.centered}>
        {title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.centered}>
        {message}
      </ThemedText>
      {actionLabel && onAction && (
        <Button label={actionLabel} onPress={onAction} style={styles.action} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.six,
    gap: Spacing.three,
  },
  centered: { textAlign: 'center' },
  action: { marginTop: Spacing.three, paddingHorizontal: Spacing.six },
});
