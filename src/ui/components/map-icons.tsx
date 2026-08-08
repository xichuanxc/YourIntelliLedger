import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/ui/hooks/use-theme';

/**
 * Drawn rather than imported, for the same reason as the gear: the project
 * ships no icon font, and `react-native-svg` is already a dependency.
 */

export function MapPinIcon({
  size = 18,
  color,
  filled = false,
}: {
  size?: number;
  color?: string;
  /**
   * Solid body with a white outline, for the pin that sits on map tiles — an
   * outlined glyph disappears against a busy or dark patch of map.
   */
  filled?: boolean;
}) {
  const theme = useTheme();
  const tint = color ?? theme.textSecondary;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"
        stroke={filled ? '#FFFFFF' : tint}
        strokeWidth={filled ? 1.4 : 1.7}
        strokeLinejoin="round"
        fill={filled ? tint : 'none'}
      />
      <Circle
        cx={12}
        cy={10}
        r={2.6}
        stroke={filled ? '#FFFFFF' : tint}
        strokeWidth={filled ? 1.6 : 1.7}
        fill={filled ? tint : 'none'}
      />
    </Svg>
  );
}

/** The filled arrow every maps app uses for "directions". */
export function NavigateIcon({ size = 16, color }: { size?: number; color?: string }) {
  const theme = useTheme();
  const fill = color ?? theme.primary;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 3 3 10.5l7.5 3L14 21l7-18z"
        stroke={fill}
        strokeWidth={1.8}
        strokeLinejoin="round"
        fill={fill}
        fillOpacity={0.15}
      />
    </Svg>
  );
}
