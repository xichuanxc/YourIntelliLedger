import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronDownIcon } from '@/ui/components/chevron-icon';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { MinTouchTarget, Radius, Spacing } from '@/ui/theme';

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
  /** A second line, for what the option means when the label cannot say it. */
  caption?: string;
}

export interface SelectMenuProps<T extends string> {
  label: string;
  options: readonly SelectMenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A one-line control that opens its options in a sheet.
 *
 * `ChipSelect` is the right shape for a closed vocabulary of three or four
 * (§4.7's categories and units), where showing every option at once is the
 * feature. It stops being the right shape once the list is long enough to
 * scroll sideways: options past the edge are invisible, and a horizontal
 * scroller inside a vertical one is awkward to hit.
 *
 * So this collapses to the *current* selection, which is the thing worth
 * seeing when you are not changing it, and shows the full list when you are.
 *
 * `onRequestClose` is not optional decoration — §7 makes handling the Android
 * system back button a non-negotiable, and without it back would leave the
 * screen instead of closing the menu.
 */
export function SelectMenu<T extends string>({
  label,
  options,
  value,
  onChange,
}: SelectMenuProps<T>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const current = options.find((option) => option.value === value);

  const choose = (next: T) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        // The value is announced separately from the label, so a screen reader
        // says "Period, Last 3 months" rather than running them together.
        accessibilityValue={{ text: current?.label ?? value }}
        accessibilityHint="Opens the list of options"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}>
        <ThemedText type="smallBold">{current?.label ?? value}</ThemedText>
        <ChevronDownIcon />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => setOpen(false)}>
          {/* A press inside the card must not reach the backdrop behind it. */}
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.sheet,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                marginTop: insets.top + Spacing.four,
                marginBottom: insets.bottom + Spacing.four,
              },
            ]}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sheetTitle}>
              {label}
            </ThemedText>

            <ScrollView bounces={false}>
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => choose(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        backgroundColor: selected ? theme.backgroundElement : 'transparent',
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}>
                    <View style={styles.optionText}>
                      <ThemedText
                        type={selected ? 'smallBold' : 'small'}
                        style={selected ? { color: theme.primary } : undefined}>
                        {option.label}
                      </ThemedText>
                      {option.caption && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {option.caption}
                        </ThemedText>
                      )}
                    </View>
                    {/* A tick as well as the colour: §7 wants selection not to
                        depend on colour alone. */}
                    {selected && (
                      <ThemedText type="smallBold" style={{ color: theme.primary }}>
                        ✓
                      </ThemedText>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  label: { marginLeft: Spacing.half },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: MinTouchTarget,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  sheet: {
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
    maxHeight: '80%',
  },
  sheetTitle: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: MinTouchTarget,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  optionText: { flex: 1, gap: 2 },
});
