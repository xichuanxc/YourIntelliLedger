import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { unreviewedFlags } from '@/data/review';
import { PARSE_FLAG_LABELS, type ParseFlag } from '@/types/vocabulary';
import { Radius, Spacing } from '@/ui/theme';

export interface FlagBannerProps {
  flags: readonly ParseFlag[];
  /** Which of them a person has already accepted (`data/review.ts`). */
  reviewedFlags?: readonly ParseFlag[] | null;
  /**
   * Offered for **any** unacknowledged flag, not just `low_confidence`.
   *
   * Three of the four clear only when the numbers change, and some receipts
   * genuinely do not reconcile — a promotion the OCR missed, a line it
   * dropped. Those bills used to say "needs review" for ever with no way to
   * dismiss it, and an indicator that cannot be cleared is one a user learns
   * to ignore.
   */
  onConfirmReviewed?: () => void;
}

/**
 * Surfaces the §4.11 integrity flags as plain language (§5.6).
 *
 * Deliberately advisory: the flags record what looks wrong, and the numbers
 * stay exactly as recorded. A banner that silently "fixed" the total would
 * destroy the evidence that the parse was unreliable.
 */
export function FlagBanner({ flags, reviewedFlags, onConfirmReviewed }: FlagBannerProps) {
  const theme = useTheme();
  if (flags.length === 0) return null;

  // The flags stay on screen once accepted — they are what the receipt looked
  // like, and hiding them would lose the reason the numbers are odd. Only the
  // demand for attention goes away.
  const outstanding = unreviewedFlags({ parseFlags: flags, reviewedFlags: reviewedFlags ?? null });
  const canConfirm = onConfirmReviewed !== undefined && outstanding.length > 0;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: canConfirm ? theme.warning : theme.border,
        },
      ]}>
      {flags.map((flag) => (
        <ThemedText
          key={flag}
          type="small"
          themeColor={outstanding.includes(flag) ? 'warning' : 'textSecondary'}>
          {PARSE_FLAG_LABELS[flag]}
        </ThemedText>
      ))}

      {!canConfirm && (
        <ThemedText type="small" themeColor="textSecondary">
          You have checked these. The figures are recorded exactly as they were read.
        </ThemedText>
      )}

      {canConfirm && (
        <Pressable
          onPress={onConfirmReviewed}
          accessibilityRole="button"
          accessibilityLabel="Mark these lines as checked"
          accessibilityHint="Stops this bill asking for attention. No amount is changed."
          hitSlop={8}
          style={styles.confirm}>
          <ThemedText type="smallBold" themeColor="primary">
            I&apos;ve checked these
          </ThemedText>
        </Pressable>
      )}
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
  confirm: { alignSelf: 'flex-start', paddingVertical: Spacing.one, minHeight: 32, justifyContent: 'center' },
});
