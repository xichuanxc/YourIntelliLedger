/**
 * Colour, type and spacing tokens. Shared across platforms — the only
 * platform branching permitted here is trivial cosmetics (spec §2.2 rule 3).
 *
 * Dark mode is a hard requirement (spec §7), so every colour is defined for
 * both schemes and consumed through `useTheme()`, never as a literal.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    textSecondary: '#60646C',
    textInverse: '#FFFFFF',
    background: '#FFFFFF',
    backgroundElement: '#F3F4F6',
    backgroundSelected: '#E0E1E6',
    border: '#DCDFE3',
    primary: '#208AEF',
    danger: '#D93A3A',
    warning: '#B45309',
    success: '#12805C',
  },
  dark: {
    text: '#ECEDEE',
    textSecondary: '#B0B4BA',
    textInverse: '#11181C',
    background: '#000000',
    backgroundElement: '#1A1B1E',
    backgroundSelected: '#2E3135',
    border: '#2A2D31',
    primary: '#4C9EF5',
    danger: '#F16A6A',
    warning: '#E0A458',
    success: '#3DBF95',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type Theme = (typeof Colors)['light'];

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    rounded: 'normal',
    mono: 'monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
} as const;

export const Radius = {
  small: 6,
  medium: 10,
  large: 16,
} as const;

/**
 * Minimum touch target. 44pt is Apple's HIG floor and comfortably clears
 * Material's 48dp guidance once padding is included.
 */
export const MinTouchTarget = 44;

export const MaxContentWidth = 800;
