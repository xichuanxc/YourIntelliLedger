import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useColorScheme } from '@/ui/hooks/use-color-scheme';
import { Colors } from '@/ui/theme';

/**
 * Native tab bar — a UIKit tab bar on iOS, a Material one on Android.
 *
 * §7 marks the tab bar as a platform-idiomatic detail that is deliberately
 * *not* unified, so the icons are named per platform (SF Symbols **[i]**,
 * Material symbols **[A]**) rather than shipped as one flat PNG set.
 */
export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundSelected}
      labelStyle={{ selected: { color: colors.primary } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Ledger</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="list.bullet.rectangle" md="receipt_long" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="ask">
        <NativeTabs.Trigger.Label>Ask</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right" md="forum" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="insights">
        <NativeTabs.Trigger.Label>Insights</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.bar" md="insights" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
