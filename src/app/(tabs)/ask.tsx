/**
 * Ask — §6's agent, in the thin form Week 7 calls for.
 *
 * A message list, a box, and a typing indicator. Deliberately **not** here:
 * charts, tables, followup chips and confirmation cards, which are §11's Week
 * 8 ("envelope rendering, fastpaths, followups, confirmation cards"). The
 * screen exists now because Week 7's own acceptance criterion — streaming
 * verified on physical hardware (§6.2) — cannot be checked with no UI at all,
 * and because a loop that nothing can reach is a loop nobody has watched work.
 *
 * The answer's structured half is kept on each message even though nothing
 * draws it yet, so Week 8 renders what has already been received rather than
 * asking the model again.
 *
 * Answers are not streamed. §6.2: "correctness must never depend on
 * streaming", so the non-streaming path is the one that is built first and the
 * indicator below is the fallback that §6.2 prescribes if streaming proves
 * unstable — it is what Week 7 ships, not a placeholder for it.
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AnswerView } from '@/render/answer-view';
import { planRender } from '@/render/plan';
import { linkify } from '@/ui/linkify';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { useTabBarInset } from '@/ui/hooks/use-tab-bar-inset';
import { useTheme } from '@/ui/hooks/use-theme';
import { useAskStore, type AskMessage } from '@/ui/stores/ask-store';
import { MinTouchTarget, Radius, Spacing } from '@/ui/theme';

/**
 * Followup chips are hints, not buttons, so they are drawn as small pills
 * rather than at the 44pt touch minimum — four button-sized chips above the
 * composer read as a wall of controls and crowd out the conversation.
 *
 * §7's touch target is not given up for that: `hitSlop` puts the missing
 * height back, so the pill is smaller to look at and the same size to hit.
 */
const FOLLOWUP_HEIGHT = 30;
const FOLLOWUP_SLOP = (MinTouchTarget - FOLLOWUP_HEIGHT) / 2;

/**
 * How much of the bottom of the screen the keyboard is covering, in points.
 *
 * Two separate needs, hence a height rather than a boolean.
 *
 * On **iOS** only the fact matters: `KeyboardAvoidingView` moves the composer,
 * and the height is used to decide whether to keep padding for the translucent
 * tab bar — both want that space and only one of them is there at a time, so
 * padding for both leaves the composer floating a tab bar above the keyboard.
 *
 * On **Android** the height is the whole fix. The manifest asks for
 * `adjustResize`, which would normally lift the composer, but
 * `edgeToEdgeEnabled=true` (android/gradle.properties) means the window no
 * longer resizes when the keyboard appears — so nothing moves and the text box
 * and Send button sit underneath it. `KeyboardAvoidingView` cannot help here
 * either: its Android behaviour is a no-op. The inset has to be applied by
 * hand.
 */
function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // `will` events on iOS so the padding changes with the animation rather
    // than after it; Android only emits `did`.
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const shownSub = Keyboard.addListener(show, (event) =>
      setHeight(event.endCoordinates?.height ?? 0)
    );
    const hiddenSub = Keyboard.addListener(hide, () => setHeight(0));
    return () => {
      shownSub.remove();
      hiddenSub.remove();
    };
  }, []);

  return height;
}

export default function AskScreen() {
  const theme = useTheme();
  const tabBarInset = useTabBarInset();
  const keyboardHeight = useKeyboardInset();
  const keyboardShown = keyboardHeight > 0;
  // Android only: iOS's `KeyboardAvoidingView` already moves the composer, and
  // adding the height there would lift it by the keyboard twice over.
  const androidKeyboardInset = Platform.OS === 'android' ? keyboardHeight : 0;
  const { messages, thinking, streaming, suggestions, send, loadSuggestions, restore, clearConversation } =
    useAskStore();
  const [draft, setDraft] = useState('');
  const list = useRef<FlatList<AskMessage>>(null);
  const input = useRef<TextInput>(null);

  // A new answer is at the bottom, and an answer nobody scrolls to is an
  // answer nobody read.
  useEffect(() => {
    if (messages.length > 0) list.current?.scrollToEnd({ animated: true });
    // `streaming` too: an answer that grows past the fold while the user
    // watches should keep its last line in view.
    //
    // And `keyboardHeight`, because the list changes height when the keyboard
    // opens. Without this the newest messages stay where they were and end up
    // behind the composer — the conversation looks covered, when really it
    // just did not scroll.
  }, [messages.length, thinking, streaming, keyboardHeight]);

  // Loaded when the screen appears rather than once at import, so a question
  // asked on a previous visit is offered on this one.
  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  // A conversation saved on a previous launch, if the user asked for that.
  useEffect(() => {
    void restore();
  }, [restore]);

  /**
   * Offers a question you already asked back to the box.
   *
   * Into the box rather than straight to the model: the reason to reach for
   * an old question is usually that the new one is *nearly* it — last month
   * instead of this one, a different shop. Sending it unchanged would be the
   * one thing you did not want, and the suggestion chips already cover asking
   * something again verbatim.
   */
  const confirmReuse = (text: string) => {
    Alert.alert('Use this question again?', text, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Copy to question box',
        onPress: () => {
          setDraft(text);
          // Focused, so the keyboard is up and the edit can start straight
          // away — the edit is the point.
          input.current?.focus();
        },
      },
    ]);
  };

  /**
   * Destructive and not obviously undoable, so it asks first — the same
   * pattern the development Clear all data button uses. A menu of one item
   * would be a sheet to dismiss on the way to the only thing in it.
   */
  const confirmClear = () => {
    Alert.alert(
      'Clear this conversation?',
      'Removes the questions and answers on this screen, and the saved copy if you are keeping one. Your bills are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => void clearConversation() },
      ]
    );
  };

  const submit = () => {
    const text = draft.trim();
    if (text === '' || thinking) return;
    setDraft('');
    void send(text);
  };

  /**
   * §6.7's followups, from the answer currently at the bottom.
   *
   * Only the latest one. Chips under an older answer would offer to ask about
   * something the reader has scrolled past, and four of them per turn would
   * leave a conversation more chip than content. They also stay away while an
   * answer is arriving — suggesting the next question before this one has
   * finished is a way to lose the answer.
   */
  const latest = messages[messages.length - 1];
  const followups =
    !thinking && streaming === '' && latest?.role === 'assistant'
      ? (latest.envelope?.followups ?? [])
      : [];

  const canSend = draft.trim() !== '' && !thinking;

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="title">Ask</ThemedText>
        {/* Nothing to clear on an empty screen, so nothing to press. */}
        {messages.length > 0 && (
          <Pressable
            onPress={confirmClear}
            accessibilityRole="button"
            accessibilityLabel="Conversation options"
            hitSlop={Spacing.two}
            style={({ pressed }) => [styles.more, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="title" themeColor="textSecondary">
              ⋯
            </ThemedText>
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView
        testID="ask-keyboard-avoider"
        style={[styles.flex, { paddingBottom: androidKeyboardInset }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages.length === 0 ? (
          /*
            Only the empty state needs this. iOS draws the keyboard over the
            tab bar, so while it is up there is no way to leave Ask — and an
            empty conversation has nothing to drag and nothing to tap, which is
            exactly the state a first-time user is in.

            **Not** around the list. A `Pressable` parent claims the touch
            before a `FlatList` can start a scroll, so wrapping the
            conversation in one stops it scrolling at all. The list dismisses
            by other means; see its props below.

            `accessible={false}` so a screen reader reads the empty state as
            text rather than announcing the whole panel as one button.
          */
          <Pressable
            style={styles.flex}
            testID="ask-dismiss-keyboard"
            accessible={false}
            onPress={Keyboard.dismiss}
            android_disableSound>
            <EmptyState
              title="Ask about your spending"
              message={
                suggestions.length > 0
                  ? 'Answers come from the bills on this phone. Ask again, or type something new.'
                  : 'Try “how much did I spend on groceries last month?” or “which shop do I ' +
                    'go to most?”. Answers come from the bills on this phone.'
              }
            />

            {/*
              This user's own questions, once there are any. Examples are a
              guess at what a stranger wants; these are what they actually ask.
            */}
            {suggestions.length > 0 && (
              <View style={styles.suggestions}>
                {suggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion.text}
                    onPress={() => void send(suggestion.text)}
                    disabled={thinking}
                    accessibilityRole="button"
                    accessibilityLabel={`Ask again: ${suggestion.text}`}
                    style={({ pressed }) => [
                      styles.suggestion,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}>
                    <ThemedText type="small">{suggestion.text}</ThemedText>
                  </Pressable>
                ))}
              </View>
            )}
          </Pressable>
        ) : (
          <FlatList
            ref={list}
            data={messages}
            keyExtractor={(message) => message.id}
            // `flex: 1`, or the list sizes to its content: a long conversation
            // then grows past the space available and pushes its newest
            // messages behind the composer instead of scrolling inside it.
            // Only visible once the keyboard takes half the screen away.
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => <Bubble message={item} onReuse={confirmReuse} />}
            // The list holds the answers, so it should not eat a tap meant for
            // the keyboard's dismissal.
            // `interactive` follows the finger on iOS, which is what people
            // expect from a chat; Android has no such mode.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            // "handled" is what makes a tap on the conversation dismiss the
            // keyboard while a tap on a bill link still opens the bill: the
            // list dismisses only when no child claimed the touch. This is
            // also why the list needs no `Pressable` around it — one would
            // claim every touch, scrolls included.
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/*
          The indicator gives way to the answer the moment there is one to
          show. Until then it stays up, and during a tool call there is
          genuinely nothing yet — the model is choosing a query, not writing a
          sentence — which is why this waits for text rather than for the
          request to start.
        */}
        {thinking && streaming === '' && (
          <View style={styles.thinking} accessibilityRole="progressbar" accessibilityLabel="Thinking">
            <ActivityIndicator size="small" />
            <ThemedText type="small" themeColor="textSecondary">
              Reading your ledger…
            </ThemedText>
          </View>
        )}

        {streaming !== '' && (
          <View style={styles.streaming}>
            <Bubble
              message={{ id: 'streaming', role: 'assistant', text: streaming }}
              accessibilityLabel="Answer, still arriving"
            />
          </View>
        )}

        {followups.length > 0 && (
          /*
            Horizontal, because a followup is a sentence and four of them do
            not fit across a phone. `keyboardShouldPersistTaps` so a tap while
            the keyboard is up sends the question rather than only dismissing
            it — the same rule the conversation list follows.
          */
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.followups}>
            {followups.map((followup) => (
              <Pressable
                key={followup}
                onPress={() => void send(followup)}
                accessibilityRole="button"
                accessibilityLabel={`Ask: ${followup}`}
                hitSlop={{ top: FOLLOWUP_SLOP, bottom: FOLLOWUP_SLOP }}
                style={({ pressed }) => [
                  styles.followup,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <ThemedText type="small">{followup}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <View
          style={[
            styles.composer,
            {
              borderTopColor: theme.border,
              backgroundColor: theme.background,
              // The tab bar is only under the composer when the keyboard is
              // not covering it.
              paddingBottom: (keyboardShown ? 0 : tabBarInset) + Spacing.three,
            },
          ]}>
          {/*
            `submitBehavior="submit"` is what makes Return send rather than
            insert a newline. Without it a multiline input ignores
            `returnKeyType` on iOS and `onSubmitEditing` never fires, so the
            keyboard has no key that does anything — which, with the tab bar
            underneath it, left the screen with no way out at all.
          */}
          <TextInput
            ref={input}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            submitBehavior="submit"
            placeholder="Ask a question"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Your question"
            returnKeyType="send"
            multiline
            editable={!thinking}
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
            ]}
          />
          <Pressable
            onPress={submit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            style={({ pressed }) => [
              styles.send,
              {
                backgroundColor: canSend ? theme.primary : theme.backgroundElement,
                opacity: pressed ? 0.8 : 1,
              },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: canSend ? theme.textInverse : theme.textSecondary }}>
              Send
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Bubble({
  message,
  accessibilityLabel,
  onReuse,
}: {
  message: AskMessage;
  /** Set while an answer is still arriving, so it is not read as finished. */
  accessibilityLabel?: string;
  /**
   * Offered only for the user's own messages. An answer is not a question, so
   * there is nothing to put back in the box.
   */
  onReuse?: (text: string) => void;
}) {
  const theme = useTheme();
  const mine = message.role === 'user';

  const segments = mine ? null : linkify(message.text, message.references ?? []);

  // §6.7 decides what may be drawn; an answer with no `render` block, or one
  // that could not be drawn honestly, plans to nothing and shows the sentence
  // alone. The streaming placeholder has no envelope and so lands here too.
  const plan = mine
    ? null
    : planRender(message.envelope?.render, { currency: message.currency ?? 'NZD' });

  const bubble = (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.bubble,
        {
          alignSelf: mine ? 'flex-end' : 'flex-start',
          backgroundColor: mine ? theme.primary : theme.backgroundElement,
        },
      ]}>
      <ThemedText style={mine ? { color: theme.textInverse } : undefined}>
        {segments
          ? segments.map((segment, index) =>
              segment.billId === undefined ? (
                segment.text
              ) : (
                // Nested `Text` rather than a `Pressable`, so the link wraps
                // with the sentence instead of becoming a block that breaks
                // the line around it.
                <ThemedText
                  key={index}
                  onPress={() => router.push({ pathname: '/bill/[id]', params: { id: segment.billId! } })}
                  accessibilityRole="link"
                  accessibilityLabel={`${segment.text}, open the bill`}
                  style={[styles.link, { color: theme.primary, textDecorationColor: theme.primary }]}>
                  {segment.text}
                </ThemedText>
              )
            )
          : message.text}
      </ThemedText>

      {plan && <AnswerView plan={plan} currency={message.currency ?? 'NZD'} />}
    </View>
  );

  // A row, not the list: `keyboardShouldPersistTaps="handled"` lets a child
  // claim a tap while the list still scrolls. Wrapping the *list* in a
  // Pressable is what stopped it scrolling once before.
  if (!mine || !onReuse) return bubble;

  return (
    <Pressable
      onPress={() => onReuse(message.text)}
      accessibilityRole="button"
      accessibilityLabel={`${message.text}, use again`}
      style={({ pressed }) => [styles.reusable, { opacity: pressed ? 0.7 : 1 }]}>
      {bubble}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The bubble inside keeps its own `alignSelf`, so the wrapper spanning the
  // row changes nothing about where it sits.
  reusable: { width: '100%' },
  more: { minWidth: MinTouchTarget, minHeight: MinTouchTarget, alignItems: 'flex-end', justifyContent: 'center' },
  listContent: { padding: Spacing.four, gap: Spacing.three },
  link: { textDecorationLine: 'underline' },
  bubble: {
    maxWidth: '85%',
    borderRadius: Radius.large,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  // Outside the list, so an answer in progress does not need a row inserting
  // and removing on every token.
  streaming: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  suggestions: { paddingHorizontal: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.four },
  suggestion: {
    minHeight: MinTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // A row of its own above the composer, so the suggestions do not scroll
  // away from the box they would be typed into.
  followups: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
    alignItems: 'center',
  },
  followup: {
    height: FOLLOWUP_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: FOLLOWUP_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: MinTouchTarget,
    maxHeight: 120,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  send: {
    minHeight: MinTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.medium,
  },
});
