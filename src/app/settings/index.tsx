/**
 * Settings — the BYOK key, for now.
 *
 * §7 lists a fuller Settings screen (usage and quota, active model, export,
 * delete-all); those arrive with the hub in Week 7 and hardening in Week 9.
 * What exists here is what Week 6 needs: somewhere for the user to supply the
 * key that makes automatic reading possible.
 *
 * The key is stored via `expo-secure-store` and never displayed again — once
 * saved, only a mask is shown. §8.2 keeps keys out of the binary; showing one
 * back in a text field would put it on the screen, in screenshots, and in the
 * recents preview.
 */

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  clearByokKey,
  getByokKey,
  getByokModel,
  maskKey,
  setByokKey,
  setByokModel,
} from '@/agent/byokKey';
import { Button } from '@/ui/components/button';
import { Screen } from '@/ui/components/screen';
import { TextField } from '@/ui/components/text-field';
import { ThemedText } from '@/ui/components/themed-text';
import { Spacing } from '@/ui/theme';

export default function SettingsScreen() {
  const [existing, setExisting] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      setExisting(await getByokKey());
      setModel(await getByokModel());
    })();
  }, []);

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

  const clear = async () => {
    setBusy(true);
    try {
      await clearByokKey();
      setExisting(null);
      setDraft('');
      setStatus('Key removed. Receipts can still be entered by hand.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">Settings</ThemedText>

        <View style={styles.section}>
          <ThemedText type="sectionHeader" themeColor="textSecondary">
            Reading receipts
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Reading a receipt automatically sends its text to an AI provider. Your bills and totals
            stay on this device. Until the app ships its own service, you supply your own API key —
            it is stored in the device keystore and never leaves it except to call that provider.
          </ThemedText>

          <ThemedText type="smallBold">
            {existing ? `Key set: ${maskKey(existing)}` : 'No key set'}
          </ThemedText>

          <TextField
            label={existing ? 'Replace key' : 'API key'}
            value={draft}
            onChangeText={setDraft}
            placeholder="Paste your Gemini API key"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <TextField
            label="Model"
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
            hint="The model that reads receipts. Change only if you know the alternative."
          />

          {status && (
            <ThemedText type="small" themeColor="success">
              {status}
            </ThemedText>
          )}

          <Button label="Save" onPress={save} busy={busy} />
          {existing && <Button label="Remove key" variant="secondary" onPress={clear} busy={busy} />}
        </View>

        <View style={styles.section}>
          <ThemedText type="sectionHeader" themeColor="textSecondary">
            Not built yet
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Usage and quota, the active model, export and delete-all arrive with the hub (§13) and
            the hardening pass. Everything works offline without them.
          </ThemedText>
        </View>

        <Button label="Done" variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.five, paddingBottom: Spacing.seven },
  section: { gap: Spacing.three },
});
