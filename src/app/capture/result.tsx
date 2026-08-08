/**
 * The Week 5 end point: the reconstructed text, shown as-is.
 *
 * This is a **development surface, not the product**. Week 6 replaces it with
 * `parse_receipt` and the review screen (§5.6). It exists because §11's Week 5
 * bar is "prototype fixtures reproduce on-device within tolerance (§5.4
 * check)", and that cannot be judged without seeing the reconstructed text
 * that comes off a real device — the whole reason §5.4 flags ML Kit's
 * block/line granularity as something to compare per platform.
 */

import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { useCaptureStore } from '@/ui/stores/capture-store';
import { Radius, Spacing } from '@/ui/theme';

export default function CaptureResultScreen() {
  const theme = useTheme();
  const { result, reset, runParse, status, error } = useCaptureStore();

  if (!result) {
    return (
      <Screen>
        <EmptyState
          title="Nothing captured"
          message="Scan or choose a receipt to read it."
          actionLabel="Back to capture"
          onAction={() => router.replace('/capture')}
        />
      </Screen>
    );
  }

  const elements = result.pages.reduce((sum, page) => sum + page.elementCount, 0);
  const lines = result.text.split('\n').filter((line) => line.trim() !== '').length;
  // §8.4 budgets 1.5 s from capture to raw text.
  const withinBudget = result.durationMs <= 1500;

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">Receipt text</ThemedText>

        <View style={[styles.stats, { backgroundColor: theme.backgroundElement }]}>
          <Stat label="Path" value={result.path} />
          <Stat label="Pages" value={String(result.pages.length)} />
          <Stat label="Words" value={String(elements)} />
          <Stat label="Lines" value={String(lines)} />
          <Stat
            label="Time"
            value={`${result.durationMs} ms`}
            tone={withinBudget ? 'success' : 'warning'}
          />
        </View>

        {result.pages.map((page) => (
          <View key={page.pageNo} style={styles.page}>
            <ThemedText type="sectionHeader" themeColor="textSecondary">
              Page {page.pageNo} · skew {page.skewDegrees.toFixed(2)}°
            </ThemedText>
            <View style={[styles.textBlock, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="code" selectable>
                {page.text || '(no text recognised)'}
              </ThemedText>
            </View>
          </View>
        ))}

        {error && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}

        <View style={styles.actions}>
          <Button
            label="Read this receipt"
            onPress={async () => {
              if ((await runParse()) === 'parsed') router.replace('/capture/review');
            }}
            busy={status === 'parsing'}
          />
          <Button
            label="Enter by hand instead"
            variant="secondary"
            onPress={() => {
              reset();
              router.replace('/bill/new');
            }}
          />
          <Button
            label="Discard"
            variant="plain"
            onPress={() => {
              reset();
              router.dismissTo('/');
            }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning';
}) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" themeColor={tone}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.seven },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
    padding: Spacing.four,
    borderRadius: Radius.medium,
  },
  stat: { gap: Spacing.half },
  page: { gap: Spacing.two },
  textBlock: { padding: Spacing.three, borderRadius: Radius.medium },
  actions: { gap: Spacing.three, marginTop: Spacing.three },
});
