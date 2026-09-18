/**
 * Choosing a start and end date (§7).
 *
 * A calendar drawn out of `View`s rather than a native picker, for the reason
 * `calendar.ts` records: a native module would mean a rebuild and more weight
 * on a toolchain that has already cost this project a day. The arithmetic
 * lives there and is tested; this file is the surface.
 *
 * It follows `SelectMenu`'s sheet exactly — trigger, backdrop, card, Android
 * back through `onRequestClose` (§7) — because the two sit side by side in one
 * row and a second sheet style two inches away would read as a mistake.
 */

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatMonth, todayLocalDate, type Period } from '@/data/dates';
import type { LocalDate } from '@/types/ledger';
import {
  formatRange,
  isInMonth,
  monthGrid,
  nextMonth,
  openingMonth,
  orderedRange,
  previousMonth,
  WEEKDAY_INITIALS,
  withinPeriod,
} from '@/ui/calendar';
import { Button } from '@/ui/components/button';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { MinTouchTarget, Radius, Spacing } from '@/ui/theme';

export interface DateRangeFieldProps {
  label: string;
  /** The range in force, or null while a preset is doing the choosing. */
  value: Period | null;
  onChange: (period: Period) => void;
  /** Nothing after this can be picked — a ledger holds no future bills. */
  maxDate?: LocalDate;
}

export function DateRangeField({ label, value, onChange, maxDate }: DateRangeFieldProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const latest = maxDate ?? todayLocalDate();

  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => openingMonth(value, latest));
  const [start, setStart] = useState<LocalDate | null>(value?.from ?? null);
  const [end, setEnd] = useState<LocalDate | null>(value?.to ?? null);

  /** Reopens where the current range is, not where it was last left. */
  const show = () => {
    setMonth(openingMonth(value, latest));
    setStart(value?.from ?? null);
    setEnd(value?.to ?? null);
    setOpen(true);
  };

  /**
   * First tap starts a range, second finishes it, third starts again.
   *
   * No "now pick the end" instruction anywhere: the highlight between the two
   * dates says what is happening, and a third tap starting over is what people
   * try when they mis-tap.
   */
  const pick = (date: LocalDate) => {
    if (start === null || end !== null) {
      setStart(date);
      setEnd(null);
      return;
    }
    setEnd(date);
  };

  // What the grid should shade: the finished range, or the day chosen so far.
  const chosen = start !== null ? orderedRange(start, end ?? start) : null;

  const apply = () => {
    if (chosen) onChange(chosen);
    setOpen(false);
  };

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>

      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ? formatRange(value) : 'Not set' }}
        accessibilityHint="Opens a calendar to choose a start and end date"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {value ? formatRange(value) : 'Choose dates'}
        </ThemedText>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
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
            <View style={styles.monthRow}>
              <Pressable
                onPress={() => setMonth(previousMonth(month))}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                style={({ pressed }) => [styles.arrow, { opacity: pressed ? 0.6 : 1 }]}>
                <ThemedText type="smallBold">‹</ThemedText>
              </Pressable>

              <ThemedText type="smallBold">{formatMonth(month)}</ThemedText>

              <Pressable
                onPress={() => setMonth(nextMonth(month))}
                accessibilityRole="button"
                accessibilityLabel="Next month"
                style={({ pressed }) => [styles.arrow, { opacity: pressed ? 0.6 : 1 }]}>
                <ThemedText type="smallBold">›</ThemedText>
              </Pressable>
            </View>

            <View style={styles.week}>
              {WEEKDAY_INITIALS.map((initial, index) => (
                <ThemedText
                  // The initials repeat (T, T and S, S), so the position is the key.
                  key={index}
                  type="small"
                  themeColor="textSecondary"
                  style={styles.weekday}>
                  {initial}
                </ThemedText>
              ))}
            </View>

            {monthGrid(month).map((days) => (
              <View key={days[0]} style={styles.week}>
                {days.map((date) => {
                  const outside = !isInMonth(date, month);
                  const future = date > latest;
                  const inRange = chosen !== null && withinPeriod(date, chosen);
                  const isEnd = date === chosen?.from || date === chosen?.to;

                  return (
                    <Pressable
                      key={date}
                      onPress={() => pick(date)}
                      disabled={future}
                      accessibilityRole="button"
                      accessibilityLabel={formatRange({ from: date, to: date })}
                      accessibilityState={{ selected: inRange, disabled: future }}
                      style={({ pressed }) => [
                        styles.day,
                        inRange && { backgroundColor: theme.backgroundElement },
                        isEnd && { backgroundColor: theme.primary },
                        { opacity: future ? 0.25 : pressed ? 0.6 : outside ? 0.4 : 1 },
                      ]}>
                      <ThemedText
                        type={isEnd ? 'smallBold' : 'small'}
                        style={isEnd ? { color: theme.textInverse } : undefined}>
                        {Number(date.slice(8, 10))}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <ThemedText type="small" themeColor="textSecondary" style={styles.chosen}>
              {chosen ? formatRange(chosen) : 'Tap a day to start, and another to finish.'}
            </ThemedText>

            <View style={styles.actions}>
              <Button label="Cancel" variant="plain" onPress={() => setOpen(false)} />
              <Button label="Apply" onPress={apply} disabled={chosen === null} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two, flex: 1 },
  label: { marginLeft: Spacing.half },
  trigger: {
    minHeight: MinTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  backdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: Spacing.four },
  sheet: {
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: {
    minWidth: MinTouchTarget,
    minHeight: MinTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center' },
  day: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.medium },
  chosen: { textAlign: 'center', marginTop: Spacing.two },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.three },
});
