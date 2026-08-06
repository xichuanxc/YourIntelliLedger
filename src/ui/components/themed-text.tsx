import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { useTheme } from '@/ui/hooks/use-theme';
import { Fonts, type ThemeColor } from '@/ui/theme';

export type ThemedTextType =
  | 'default'
  | 'title'
  | 'subtitle'
  | 'sectionHeader'
  | 'small'
  | 'smallBold'
  | 'amount'
  | 'amountLarge'
  | 'link'
  | 'code';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        styles[type],
        type === 'link' && { color: theme.primary },
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * Sizes are plain numbers so they scale with the OS font-size setting
 * (spec §7) — RN applies the system `fontScale` to `Text` by default.
 */
const styles = StyleSheet.create({
  default: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  subtitle: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  sectionHeader: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  smallBold: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  /** Tabular figures keep the money column from jittering as digits change. */
  amount: { fontSize: 16, lineHeight: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  amountLarge: { fontSize: 22, lineHeight: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  link: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  code: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontWeight: Platform.select({ android: '700', default: '500' }),
  },
});
