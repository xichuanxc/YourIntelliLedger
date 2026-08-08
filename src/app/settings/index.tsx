/**
 * Settings — spec §7, §8.2, §15.3.
 *
 * What is here: the BYOK key and model, a plain statement of what leaves the
 * device, local usage for this month, and the §8.2 screenshot block.
 *
 * What is deliberately not here yet:
 *  - **Export (§15.1)** and **delete-all (§15.2)**, which belong together —
 *    §15.2 says export should be offered first, so shipping an irreversible
 *    delete before there is any way to back up would be a sharp edge.
 *  - **Quota and the active model alias (§13.3, §13.4)**, which read from the
 *    hub and have nothing to show until it exists.
 */

import { useFocusEffect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import {
  clearByokKey,
  getByokKey,
  getByokModel,
  maskKey,
  setByokKey,
  setByokModel,
} from '@/agent/byokKey';
import { getDb } from '@/data/db';
import { getBlockScreenshots, setBlockScreenshots } from '@/data/prefs';
import { applyScreenshotPolicy } from '@/data/screenPrivacy';
import { getUsageForMonth, type UsageSummary } from '@/data/telemetryRepo';
import { formatMonth } from '@/data/dates';
import { Button } from '@/ui/components/button';
import { Screen } from '@/ui/components/screen';
import { TextField } from '@/ui/components/text-field';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const [existing, setExisting] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [blockShots, setBlockShots] = useState(false);

  useEffect(() => {
    void (async () => {
      setExisting(await getByokKey());
      setModel(await getByokModel());
      setBlockShots(getBlockScreenshots());
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void (async () => setUsage(await getUsageForMonth(await getDb())))();
    }, [])
  );

  const save = async () => {
    setBusy(true);
    try {
      await setByokKey(draft);
      await setByokModel(model);
      setExisting(await getByokKey());
      setDraft('');
      setStatus('Saved.');
    } finally {
      setBusy(false);
    }
  };

  const toggleScreenshots = async (value: boolean) => {
    setBlockShots(value);
    setBlockScreenshots(value);
    await applyScreenshotPolicy(value);
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Reading receipts">
          <ThemedText type="small" themeColor="textSecondary">
            Reading a receipt sends its <ThemedText type="smallBold">text</ThemedText> to an AI
            provider — never the photograph, and never your bills, totals or history. Everything
            else stays on this device. Until the app ships its own service you supply a key, which
            is kept in the device keystore.
          </ThemedText>

          <ThemedText type="smallBold">
            {existing ? `Key set — ${maskKey(existing)}` : 'No key set'}
          </ThemedText>

          <TextField
            label={existing ? 'Replace key' : 'Google AI Studio API key'}
            value={draft}
            onChangeText={setDraft}
            placeholder="Paste your key"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            hint={existing ? 'Leave blank to keep the current key.' : undefined}
          />

          <TextField
            label="Model"
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
            hint="Which model reads receipts. Changing this changes accuracy and speed."
          />

          {status && (
            <ThemedText type="small" themeColor="success">
              {status}
            </ThemedText>
          )}

          <Button label="Save" onPress={save} busy={busy} />
          {existing && (
            <Button
              label="Remove key"
              variant="secondary"
              busy={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await clearByokKey();
                  setExisting(null);
                  setDraft('');
                  setStatus('Key removed. Receipts can still be entered by hand.');
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
        </Section>

        <Section title={usage ? `Usage — ${formatMonth(usage.month)}` : 'Usage'}>
          <ThemedText type="small" themeColor="textSecondary">
            Counted on this device only. No question text, receipt content or amounts are recorded,
            and nothing is sent anywhere.
          </ThemedText>

          {usage && usage.requests === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing read yet this month.
            </ThemedText>
          ) : (
            usage && (
              <View style={[styles.usage, { backgroundColor: theme.backgroundElement }]}>
                <Stat label="Receipts read" value={String(usage.receiptReads)} />
                <Stat label="Requests" value={String(usage.requests)} />
                <Stat
                  label="Tokens"
                  value={`${usage.tokensIn.toLocaleString()} in / ${usage.tokensOut.toLocaleString()} out`}
                />
                <Stat
                  label="Typical time"
                  value={usage.medianLatencyMs ? `${(usage.medianLatencyMs / 1000).toFixed(1)}s` : '—'}
                />
                {usage.failures > 0 && <Stat label="Failed" value={String(usage.failures)} />}
              </View>
            )
          )}
        </Section>

        <Section title="Privacy">
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <ThemedText>Block screenshots</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Hides the app from screenshots and the recents preview. A ledger of everything you
                buy is worth keeping out of both.
              </ThemedText>
            </View>
            <Switch
              value={blockShots}
              onValueChange={toggleScreenshots}
              accessibilityLabel="Block screenshots"
            />
          </View>
        </Section>

        <Section title="Not built yet">
          <ThemedText type="small" themeColor="textSecondary">
            Export and delete-all arrive together, so there is always a backup before anything is
            destroyed. Quota and provider details arrive with this app&apos;s own service.
            Everything works offline without them.
          </ThemedText>
        </Section>

        <Button label="Done" variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="sectionHeader" themeColor="textSecondary">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.five, paddingBottom: Spacing.seven },
  section: { gap: Spacing.three },
  usage: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
    padding: Spacing.four,
    borderRadius: Radius.medium,
  },
  stat: { gap: Spacing.half, minWidth: 90 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  switchLabel: { flex: 1, gap: Spacing.half },
});
