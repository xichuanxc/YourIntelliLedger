import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/ui/hooks/use-theme';

/**
 * The "there is more behind this" affordance, drawn rather than imported for
 * the same reason as the gear and the map pin: no icon font ships with the
 * app, and `react-native-svg` is already a dependency.
 */
export function ChevronRightIcon({ size = 14, color }: { size?: number; color?: string }) {
  const theme = useTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m9 5 7 7-7 7"
        stroke={color ?? theme.textSecondary}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The "this opens a list" affordance, for a closed menu. */
export function ChevronDownIcon({ size = 14, color }: { size?: number; color?: string }) {
  const theme = useTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m5 9 7 7 7-7"
        stroke={color ?? theme.textSecondary}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
