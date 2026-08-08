import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/ui/hooks/use-theme';

/**
 * Icons for the two development-only ledger actions.
 *
 * They sit in the title row beside the gear, so they have to read at 22px and
 * be told apart at a glance — the two operations are "add eleven receipts" and
 * "delete everything", and confusing them is expensive even with a confirm
 * dialog in between. Hence a downward tray for one and a bin for the other,
 * with the bin tinted danger.
 */

/** Import: an arrow going down into a tray. */
export function LoadSamplesIcon({ size = 22, color }: { size?: number; color?: string }) {
  const theme = useTheme();
  const stroke = color ?? theme.text;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Delete: a bin. Tinted danger by default — this is the destructive one. */
export function ClearDataIcon({ size = 22, color }: { size?: number; color?: string }) {
  const theme = useTheme();
  const stroke = color ?? theme.danger;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7m4 4v6m4-6v6"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
