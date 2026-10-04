/**
 * Settings — spec §7, §8.2, §15.3.
 *
 * What is here: the BYOK key and model, a plain statement of what leaves the
 * device, local usage for this month, and the §8.2 screenshot block.
 *
 * "Your data" is export, import and delete-all (§15.1, §15.2), and they are
 * one section on purpose. §15.2 asks that an export be offered before an
 * irreversible delete, and the surest way to offer it is to put it directly
 * above, in the same block, rather than trusting somebody to have found it
 * earlier.
 *
 * What is deliberately not here yet:
 *  - **Quota and the active model alias (§13.3, §13.4)**, which read from the
 *    hub and have nothing to show until it exists.
 */

import { useFocusEffect, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import {
  clearAskKey,
  clearByokKey,
  getAskKey,
  getByokKey,
  getByokModelOverride,
  hasOwnAskKey,
  maskKey,
  setAskKey,
  setByokKey,
  setByokModel,
} from '@/agent/byokKey';
import { eraseLedger, exportLedger, importLedger } from '@/data/backupFile';
import { clearConversation } from '@/data/conversationRepo';
import { CONFIRM_PHRASE, confirmationMatches } from '@/data/eraseAll';
import { getDb } from '@/data/db';
import {
  getBlockScreenshots,
  getMapPreviews,
  getPriceLookup,
  setBlockScreenshots,
  getVisionParse,
  getSaveAskHistory,
  setMapPreviews as setMapPreviewsPref,
  setPriceLookup as setPriceLookupPref,
  setSaveAskHistory as setSaveAskHistoryPref,
  setVisionParse as setVisionParsePref,
} from '@/data/prefs';
import { applyScreenshotPolicy, SCREENSHOT_BLOCKING_SUPPORTED } from '@/data/screenPrivacy';
import {
  getResponseTimes,
  getUsageForMonth,
  type ResponseTimes,
  type UsageSummary,
} from '@/data/telemetryRepo';
import { modelForAlias } from '@/agent/modelConfig';
import { formatMonth } from '@/data/dates';
import { Button } from '@/ui/components/button';
import { DEMO_KEYS } from '@/ui/devKeys';
import { Screen } from '@/ui/components/screen';
import { SelectMenu, type SelectMenuOption } from '@/ui/components/select-menu';
import { TextField } from '@/ui/components/text-field';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

/**
 * "No choice of my own" — stored as the absence of an override, so the hub's
 * alias table decides (§13.5). A sentinel rather than an empty string because
 * `SelectMenu` identifies the current option by value, and '' reads as "none
 * of these" instead of as a choice.
 */
const HUB_CHOICE = 'hub';

/**
 * The models offered for reading receipts.
 *
 * A list rather than a text box because the names are not guessable and a
 * typo is indistinguishable from a provider outage: `gemini-3.6-flash-lite`
 * was published as an alias for months and does not exist, and a request for
 * it fails with the same 404 as a dead key.
 *
 * It is also the daily-quota escape. The free tier counts per model, so when
 * one name stops answering partway through a batch of receipts, the next one
 * down has its own allowance and is one tap away.
 *
 * Every name here was checked against the live model list. Adding one is a
 * line in this array; nothing else in the app knows the list exists.
 */
const PARSE_MODELS: readonly SelectMenuOption<string>[] = [
  { value: 'gemini-3.6-flash', label: 'gemini-3.6-flash', caption: 'The default — what the accuracy figures were measured on' },
  { value: 'gemini-3.7-flash', label: 'gemini-3.7-flash', caption: 'Newer, same family, its own daily allowance' },
  { value: 'gemini-3.8-flash', label: 'gemini-3.8-flash', caption: 'Newer again' },
  { value: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite', caption: 'Lighter and cheaper, usually a larger daily allowance' },
  { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite', caption: 'Older lite model, another allowance again' },
  { value: HUB_CHOICE, label: 'Automatic', caption: 'Whichever model the hub names' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const [existing, setExisting] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [askKey, setAskKeyState] = useState<string | null>(null);
  const [askOwn, setAskOwn] = useState(false);
  // Whether Ask shares the receipt key. Separate from `askOwn` because the
  // switch can be off while no key has been entered yet — that is the state
  // the field exists for, and deriving it from storage would flip it back.
  const [askShared, setAskShared] = useState(true);
  const [askDraft, setAskDraft] = useState('');
  const [askStatus, setAskStatus] = useState<string | null>(null);
  const [model, setModel] = useState(HUB_CHOICE);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [times, setTimes] = useState<ResponseTimes | null>(null);
  const [blockShots, setBlockShots] = useState(false);
  const [screenshotNote, setScreenshotNote] = useState<string | null>(null);
  const [mapPreviews, setMapPreviews] = useState(true);
  const [priceLookup, setPriceLookup] = useState(true);
  const [visionParse, setVisionParse] = useState(false);
  const [saveHistory, setSaveHistory] = useState(false);

  useEffect(() => {
    void (async () => {
      setExisting(await getByokKey());
      setAskKeyState(await getAskKey());
      const own = await hasOwnAskKey();
      setAskOwn(own);
      setAskShared(!own);
      setModel((await getByokModelOverride()) ?? HUB_CHOICE);
      setBlockShots(getBlockScreenshots());
      setMapPreviews(getMapPreviews());
      setPriceLookup(getPriceLookup());
      setVisionParse(getVisionParse());
      setSaveHistory(getSaveAskHistory());
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const db = await getDb();
        setUsage(await getUsageForMonth(db));
        setTimes(await getResponseTimes(db));
      })();
    }, [])
  );

  /**
   * Saves the receipt key — and nothing else.
   *
   * This used to save the Ask key too, which is why there was no way to tell
   * what the button did: the Ask section had a box and no button, so its value
   * was committed by a button in another section that also rewrote the receipt
   * key. Each key is now saved only by its own control, and the model — a
   * dropdown that writes as it is used — no longer rides along with one.
   */
  const save = async () => {
    setBusy(true);
    try {
      await setByokKey(draft);
      setExisting(await getByokKey());
      // Ask inherits this key while sharing, so its display follows.
      setAskKeyState(await getAskKey());
      setDraft('');
      setStatus('Saved.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Turning sharing back on drops the separate key.
   *
   * Keeping it dormant would leave a key in the keystore that nothing uses and
   * nothing shows — and §8.2's rule is that a key exists only while it is
   * needed. Switching back off asks for it again, which is the honest cost.
   */
  const shareKey = async (share: boolean) => {
    setAskShared(share);
    setAskStatus(null);
    if (!share) return;

    setBusy(true);
    try {
      await clearAskKey();
      setAskKeyState(await getAskKey());
      setAskOwn(false);
      setAskDraft('');
      setAskStatus('Ask is using the receipt key.');
    } finally {
      setBusy(false);
    }
  };

  /** The Ask key's own save, independent of the receipts one. */
  const saveAskKey = async () => {
    if (askDraft.trim() === '') return;
    setBusy(true);
    try {
      await setAskKey(askDraft);
      setAskKeyState(await getAskKey());
      setAskOwn(await hasOwnAskKey());
      setAskDraft('');
      setAskStatus('Saved. Ask is using its own key.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Turning it off deletes what was kept.
   *
   * The same rule as the Ask key above: data that nothing reads and nothing
   * shows should not sit in storage. Leaving the transcript behind would mean
   * a switch that says "off" while a record of every answer survives.
   */
  const toggleSaveHistory = async (value: boolean) => {
    setSaveHistory(value);
    setSaveAskHistoryPref(value);
    if (value) return;

    try {
      await clearConversation(await getDb());
    } catch {
      // The preference is what governs future writes; a failed delete is
      // worth not crashing Settings over.
    }
  };

  const toggleScreenshots = async (value: boolean) => {
    setBlockShots(value);
    setBlockScreenshots(value);

    // The preference is stored either way, so it takes effect on the next
    // launch that has the native side. But saying "on" when nothing happened
    // would be a privacy promise the app is not keeping.
    const applied = await applyScreenshotPolicy(value);
    setScreenshotNote(
      applied || !value
        ? null
        : SCREENSHOT_BLOCKING_SUPPORTED
          ? 'Saved, but not active until the app is rebuilt with this feature.'
          : 'Not available on this platform — iOS has no equivalent (§8.2).'
    );
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Reading receipts">
          <ThemedText type="small" themeColor="textSecondary">
            Reading a receipt sends its <ThemedText type="smallBold">text</ThemedText> straight to
            an AI provider — and the photograph as well, if you switch that on below. Never your
            bills, totals or history. You supply the key, which is kept in the device keystore and
            is never included in an export.
          </ThemedText>

          <ThemedText type="smallBold">
            {existing ? `Key set — ${maskKey(existing)}` : 'No key set'}
          </ThemedText>

          {/* Only in a build that was handed keys — see `devKeys.ts`. Shown
              masked, because a demonstration is often also a screen
              recording. */}
          {DEMO_KEYS.length > 0 && (
            <SelectMenu
              label="Use a build-in key"
              options={[
                { value: '', label: 'Choose a key', caption: 'Compiled into this demo build' },
                ...DEMO_KEYS.map((key, index) => ({
                  value: key,
                  label: `Key ${index + 1} · ${maskKey(key)}`,
                })),
              ]}
              value=""
              onChange={(key) => {
                if (key === '') return;
                void (async () => {
                  await setByokKey(key);
                  setExisting(await getByokKey());
                  setAskKeyState(await getAskKey());
                  setStatus('Saved.');
                })();
              }}
            />
          )}

          <TextField
            label={existing ? 'Replace key' : 'Provider API key'}
            value={draft}
            onChangeText={setDraft}
            placeholder="Paste your key"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            hint={existing ? 'Leave blank to keep the current key.' : undefined}
          />

          <SelectMenu
            label="Model"
            options={PARSE_MODELS}
            value={model}
            onChange={(next) => {
              setModel(next);
              // Written on choosing, like the switches below, rather than
              // waiting on Save: a model swapped because a quota ran out is
              // not an edit anybody wants to half-finish.
              void setByokModel(next === HUB_CHOICE ? '' : next);
            }}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Which model reads receipts. Changing it changes accuracy, speed, and which daily free
            allowance is being spent.
            {model === HUB_CHOICE ? ` Currently ${modelForAlias('parse-strong')}.` : ''}
          </ThemedText>

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

        {/*
          §8.2 requires Settings to say which service is active, and §9.1
          requires this to match the data-safety declaration. Ask no longer
          talks to a provider directly — it goes through the project's own
          Worker — and a screen that did not say so would be under-describing
          where a user's question goes.
        */}
        <Section title="Ask">
          <ThemedText type="small" themeColor="textSecondary">
            Asking a question sends the question itself, plus a short summary of
            what is in your ledger — the categories, your most frequent shops, the
            date range and the number of bills. Amounts reach the assistant only
            when they are part of an answer it looked up. It goes through this
            project&rsquo;s own service, which chooses the model and records no
            message content, and on to the AI provider from there.
          </ThemedText>

          <ThemedText type="smallBold">
            {askKey
              ? askOwn
                ? `Key set — ${maskKey(askKey)}`
                : `Using the receipt key — ${maskKey(askKey)}`
              : 'No key set'}
          </ThemedText>

          {/*
            Sharing is the common case — most people run both on one Gemini
            key — so it is the default and needs no typing. The separate key
            only appears once someone says the two providers differ.
          */}
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <ThemedText>Use the same key as reading receipts</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Switch this off only if Ask uses a different provider.
              </ThemedText>
            </View>
            <Switch
              value={askShared}
              onValueChange={shareKey}
              disabled={busy}
              accessibilityLabel="Use the same key as reading receipts"
            />
          </View>

          {/*
            Hidden rather than disabled while sharing: a greyed-out box still
            invites a tap and still has to be explained.
          */}
          {!askShared && (
            <>
              <TextField
                label={askOwn ? 'Replace the Ask key' : 'Key for Ask'}
                value={askDraft}
                onChangeText={setAskDraft}
                placeholder="Paste your key"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                hint={
                  askOwn
                    ? 'Leave blank to keep the current Ask key.'
                    : 'Until this is saved, Ask keeps using the receipt key.'
                }
              />

              <Button
                label="Save Ask key"
                busy={busy}
                disabled={askDraft.trim() === ''}
                onPress={saveAskKey}
              />
            </>
          )}

          {askStatus && (
            <ThemedText type="small" themeColor="success">
              {askStatus}
            </ThemedText>
          )}

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <ThemedText>Save conversation records</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Keeps your questions and their answers on this device so they are still
                here next time you open the app. Nothing is uploaded either way, and
                turning this off deletes what was kept.
              </ThemedText>
            </View>
            <Switch
              value={saveHistory}
              onValueChange={toggleSaveHistory}
              accessibilityLabel="Save conversation records"
            />
          </View>
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
          {/* Grouped with the other "what leaves the device" switches rather
              than in Reading receipts, where it sat above a Save button it has
              nothing to do with — it writes immediately, like these two. */}
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <ThemedText>Send the receipt photo</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Normally only the text this device reads off a receipt is sent. Switch this on and
                the photograph goes too, and the model is told to trust the picture where the two
                disagree — better on faint, creased or crowded receipts. Slower, more data, and
                more cost per read.
              </ThemedText>
            </View>
            <Switch
              value={visionParse}
              onValueChange={(value) => {
                setVisionParse(value);
                setVisionParsePref(value);
              }}
              accessibilityLabel="Send the receipt photo to the AI provider"
            />
          </View>

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
          {screenshotNote && (
            <ThemedText type="small" themeColor="warning">
              {screenshotNote}
            </ThemedText>
          )}

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <ThemedText>Map previews</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Draws a map behind a bill&apos;s store address. Looking one up sends that address —
                and nothing else — to OpenStreetMap when you open the bill. Turn this off and no
                part of a bill ever leaves the device except receipt text you choose to read.
              </ThemedText>
            </View>
            <Switch
              value={mapPreviews}
              onValueChange={(value) => {
                setMapPreviews(value);
                setMapPreviewsPref(value);
              }}
              accessibilityLabel="Map previews"
            />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <ThemedText>Compare prices</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Lets you tap a line on a bill to see what that product costs around the country
                today, on grocer.nz. Nothing is sent until you tap, and what is sent is a few words
                of the product name — never the price you paid, the shop, or anything else from the
                bill.
              </ThemedText>
            </View>
            <Switch
              value={priceLookup}
              onValueChange={(value) => {
                setPriceLookup(value);
                setPriceLookupPref(value);
              }}
              accessibilityLabel="Compare prices on grocer.nz"
            />
          </View>
        </Section>

        <Section title="Speed">
          <ThemedText type="small" themeColor="textSecondary">
            Measured from your own use on this device, not from a benchmark. The instant answers
            aim to land under 100&#8239;ms; the assistant aims to start speaking within four
            seconds.
          </ThemedText>

          {times && times.fastpathCount + times.agentCount === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Ask a few questions and the figures will appear here.
            </ThemedText>
          ) : (
            times && (
              <View style={[styles.usage, { backgroundColor: theme.backgroundElement }]}>
                <Stat
                  label={`Instant answers p95 (${times.fastpathCount})`}
                  value={times.fastpathP95Ms === null ? '—' : `${times.fastpathP95Ms} ms`}
                />
                <Stat
                  label={`Assistant, first words p50 (${times.agentCount})`}
                  value={
                    times.agentFirstTokenP50Ms === null
                      ? '—'
                      : `${(times.agentFirstTokenP50Ms / 1000).toFixed(1)}s`
                  }
                />
                <Stat
                  label="Assistant, first words p95"
                  value={
                    times.agentFirstTokenP95Ms === null
                      ? '—'
                      : `${(times.agentFirstTokenP95Ms / 1000).toFixed(1)}s`
                  }
                />
              </View>
            )
          )}
        </Section>

        <YourDataSection />

        <Section title="Not built yet">
          <ThemedText type="small" themeColor="textSecondary">
            Quota and provider details arrive with this app&apos;s own service. Everything works
            offline without them.
          </ThemedText>
        </Section>

        <Button label="Done" variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

/**
 * Export, import and delete-all (§15.1, §15.2).
 *
 * Grouped, and in that order, because §15.2 asks that an export be offered
 * before anything irreversible. Putting the backup immediately above the
 * delete is a stronger guarantee than a sentence telling somebody they
 * should have made one.
 *
 * The delete needs a word typed. A second "are you sure" button is answered
 * by the same reflex that pressed the first; typing is a different action and
 * cannot be done by accident.
 */
function YourDataSection() {
  const theme = useTheme();
  const [busy, setBusy] = useState<'export' | 'import' | 'erase' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');

  /** Errors here are shown, never swallowed: a silent failed backup is a lie. */
  const run = async (
    which: 'export' | 'import' | 'erase',
    work: () => Promise<string | null>
  ) => {
    setBusy(which);
    setNote(null);
    setProblem(null);
    try {
      const said = await work();
      if (said) setNote(said);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Your data">
      <ThemedText type="small" themeColor="textSecondary">
        Nothing here is backed up for you — that is the point of keeping it on your phone. An
        export is how you keep a copy.
      </ThemedText>

      <Button
        label="Export…"
        variant="plain"
        busy={busy === 'export'}
        disabled={busy !== null}
        onPress={() =>
          run('export', async () => {
            const done = await exportLedger();
            return `Exported ${done.bills} bill${done.bills === 1 ? '' : 's'}.`;
          })
        }
      />
      <ThemedText type="small" themeColor="textSecondary">
        Writes a backup file you can restore later, plus two spreadsheets for reading. Receipt
        photographs are not included.
      </ThemedText>

      <Button
        label="Import a backup…"
        variant="plain"
        busy={busy === 'import'}
        disabled={busy !== null}
        onPress={() =>
          run('import', async () => {
            const done = await importLedger();
            if (!done) return null; // The picker was dismissed. Not an error.
            const added = `Imported ${done.imported} bill${done.imported === 1 ? '' : 's'}`;
            return done.skipped > 0
              ? `${added}; ${done.skipped} were already here.`
              : `${added}.`;
          })
        }
      />

      {!confirming ? (
        <Button
          label="Delete everything…"
          variant="danger"
          disabled={busy !== null}
          onPress={() => {
            setConfirming(true);
            setNote(null);
            setProblem(null);
          }}
        />
      ) : (
        <View style={[styles.confirmBox, { borderColor: theme.danger }]}>
          <ThemedText type="smallBold">This cannot be undone.</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Every bill, every receipt&apos;s text, your saved questions and the caches built from
            them. Export first if you have not. Your API keys are kept — clear those above.
          </ThemedText>
          <TextField
            label={`Type ${CONFIRM_PHRASE} to confirm`}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <View style={styles.confirmActions}>
            <Button
              label="Cancel"
              variant="plain"
              onPress={() => {
                setConfirming(false);
                setTyped('');
              }}
            />
            <Button
              label="Delete everything"
              variant="danger"
              busy={busy === 'erase'}
              disabled={!confirmationMatches(typed) || busy !== null}
              onPress={() =>
                run('erase', async () => {
                  const gone = await eraseLedger();
                  setConfirming(false);
                  setTyped('');
                  return `Deleted ${gone.bills} bill${gone.bills === 1 ? '' : 's'}.`;
                })
              }
            />
          </View>
        </View>
      )}

      {note && (
        <ThemedText type="small" themeColor="success">
          {note}
        </ThemedText>
      )}
      {problem && (
        <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
          {problem}
        </ThemedText>
      )}
    </Section>
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
  confirmBox: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.three },
});
