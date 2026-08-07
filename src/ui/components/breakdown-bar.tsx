import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

export interface BreakdownBarProps {
  label: string;
  /** Already formatted for display. */
  value: string;
  /** 0–1. Width of the filled portion, relative to the largest row. */
  fraction: number;
  caption?: string;
  /** Renders muted, for the "not itemised" remainder. */
  muted?: boolean;
}

/**
 * One labelled proportional bar.
 *
 * Deliberately not a chart-library component. A category breakdown can run to
 * eleven rows including the remainder, which a donut handles badly — §6.7 caps
 * donuts at eight slices for the same reason — and a plain bar keeps the exact
 * figure next to its label, which is what makes a spending breakdown useful.
 */
export function BreakdownBar({ label, value, fraction, caption, muted }: BreakdownBarProps) {
  const theme = useTheme();
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%` as const;

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={`${label}, ${value}${caption ? `, ${caption}` : ''}`}>
      <View style={styles.labels}>
        <ThemedText numberOfLines={1} style={styles.label}>
          {label}
        </ThemedText>
        <ThemedText type="amount" themeColor={muted ? 'textSecondary' : 'text'}>
          {value}
        </ThemedText>
      </View>

      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        <View
          style={[
            styles.fill,
            { width, backgroundColor: muted ? theme.textSecondary : theme.primary },
          ]}
        />
      </View>

      {caption && (
        <ThemedText type="small" themeColor="textSecondary">
          {caption}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.one, paddingVertical: Spacing.two },
  labels: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  label: { flex: 1 },
  track: { height: 8, borderRadius: Radius.small, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.small },
});
