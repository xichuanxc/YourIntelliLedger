import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { PARSE_FLAG_LABELS, type ParseFlag } from '@/types/vocabulary';
import { Radius, Spacing } from '@/ui/theme';

export interface FlagBannerProps {
  flags: readonly ParseFlag[];
}

/**
 * Surfaces the §4.11 integrity flags as plain language (§5.6).
 *
 * Deliberately advisory: the flags record what looks wrong, and the numbers
 * stay exactly as recorded. A banner that silently "fixed" the total would
 * destroy the evidence that the parse was unreliable.
 */
export function FlagBanner({ flags }: FlagBannerProps) {
  const theme = useTheme();
  if (flags.length === 0) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.backgroundElement, borderColor: theme.warning }]}>
      {flags.map((flag) => (
        <ThemedText key={flag} type="small" themeColor="warning">
          {PARSE_FLAG_LABELS[flag]}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: Radius.medium,
    borderLeftWidth: 3,
    padding: Spacing.three,
    gap: Spacing.one,
  },
});
