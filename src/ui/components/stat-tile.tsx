import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

export interface StatTileProps {
  label: string;
  /** Already formatted — the tile does no money or number formatting itself. */
  value: string;
  caption?: string;
}

export function StatTile({ label, value, caption }: StatTileProps) {
  const theme = useTheme();

  return (
    <View
      style={[styles.tile, { backgroundColor: theme.backgroundElement }]}
      accessibilityRole="summary"
      accessibilityLabel={`${label}: ${value}${caption ? `, ${caption}` : ''}`}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="amountLarge" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </ThemedText>
      {caption && (
        <ThemedText type="small" themeColor="textSecondary">
          {caption}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    borderRadius: Radius.medium,
    padding: Spacing.four,
    gap: Spacing.half,
    minWidth: 96,
  },
});
