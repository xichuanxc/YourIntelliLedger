import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/ui/hooks/use-theme';

/**
 * A plus, drawn for the same reason as the gear: no icon font ships with the
 * app, and `react-native-svg` is already a dependency.
 *
 * Defaults to the accent colour rather than body text — this is a primary
 * action (§7), not a secondary one like Settings.
 */
export function PlusIcon({ size = 26, color }: { size?: number; color?: string }) {
  const theme = useTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5v14M5 12h14"
        stroke={color ?? theme.primary}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
