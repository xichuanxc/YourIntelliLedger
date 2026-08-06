import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { Spacing } from '@/ui/theme';

/**
 * Placeholder for the category/merchant/period summaries (§7, Week 4).
 */
export default function InsightsScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="title">Insights</ThemedText>
      </View>
      <EmptyState
        title="Not built yet"
        message="Category and merchant breakdowns arrive in a later build. Keep adding bills — the summaries will read whatever is already in your ledger."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.four },
});
