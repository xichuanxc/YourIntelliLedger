import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

export interface ChipSelectProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** Display text per option; defaults to the raw value. */
  labels?: Record<T, string>;
  /** Lay the chips out in a scrolling row instead of wrapping. */
  scroll?: boolean;
}

/**
 * Selector for a closed vocabulary (§4.7). Every category and unit in the app
 * is chosen from one of these, so an invalid value cannot be typed in the
 * first place — the `CHECK` constraint stays the backstop, not the UI.
 */
export function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  labels,
  scroll = false,
}: ChipSelectProps<T>) {
  const theme = useTheme();

  const chips = options.map((option) => {
    const selected = option === value;
    return (
      <Pressable
        key={option}
        onPress={() => onChange(option)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={labels?.[option] ?? option}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: selected ? theme.primary : theme.backgroundElement,
            borderColor: selected ? theme.primary : theme.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}>
        <ThemedText type="smallBold" style={{ color: selected ? theme.textInverse : theme.text }}>
          {labels?.[option] ?? option}
        </ThemedText>
      </Pressable>
    );
  });

  return (
    <View style={styles.container} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>
      {scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.row}>{chips}</View>
        </ScrollView>
      ) : (
        <View style={[styles.row, styles.wrap]}>{chips}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  label: { marginLeft: Spacing.half },
  row: { flexDirection: 'row', gap: Spacing.two },
  wrap: { flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    justifyContent: 'center',
  },
});
