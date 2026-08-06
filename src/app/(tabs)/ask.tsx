import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { Spacing } from '@/ui/theme';

/**
 * Placeholder for the agent chat (§6, Weeks 7–8). It exists now so the tab
 * bar is the shape the spec describes and so the route is stable before the
 * loop, hub client and envelope renderer land behind it.
 */
export default function AskScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="title">Ask</ThemedText>
      </View>
      <EmptyState
        title="Not built yet"
        message="Asking questions about your spending arrives with the agent, in a later build. Your bills are already being recorded — nothing here is needed to keep using the ledger."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.four },
});
