/**
 * The thin Ask screen (§6, Week 7).
 *
 * The store is mocked, because what is worth testing here is the screen's own
 * contract with the user: a question leaves the box when it is sent, nothing
 * can be sent twice while an answer is in flight, and an empty conversation
 * says what to do next (§7 requires an empty state that explains the next
 * action). The loop behind it has its own suite.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Keyboard, StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import AskScreen from '@/app/(tabs)/ask';
import type { FrequentQuestion } from '@/data/questionsRepo';
import { router } from 'expo-router';
import { useAskStore, type AskMessage } from '@/ui/stores/ask-store';

// A factory rather than an automock: automocking still *loads* the real
// module to learn its shape, and this one reaches MMKV through the data
// catalog, which has no native binding under Jest.
jest.mock('@/ui/stores/ask-store', () => ({ useAskStore: jest.fn() }));

/**
 * `Screen` and `useTabBarInset` both read the safe-area insets, which have no
 * provider under test. Supplying metrics rather than mocking the module keeps
 * the real inset arithmetic in the test — the part that has already gone wrong
 * once, when the tab bar covered the bottom of Insights.
 */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 375, height: 667 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const draw = (ui: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

const mockedStore = useAskStore as unknown as jest.Mock;
const send = jest.fn();
const loadSuggestions = jest.fn().mockResolvedValue(undefined);
const restore = jest.fn().mockResolvedValue(undefined);
const clearConversation = jest.fn().mockResolvedValue(undefined);

function withState(
  messages: AskMessage[],
  thinking = false,
  streaming = '',
  suggestions: FrequentQuestion[] = []
) {
  mockedStore.mockReturnValue({
    messages,
    thinking,
    streaming,
    suggestions,
    send,
    loadSuggestions,
    restore,
    clearConversation,
    history: [],
    clear: jest.fn(),
  });
}

const push = jest.spyOn(router, 'push').mockImplementation(() => undefined);

beforeEach(() => {
  send.mockClear();
  push.mockClear();
  loadSuggestions.mockClear();
  restore.mockClear();
  clearConversation.mockClear();
});

describe('an empty conversation', () => {
  it('says what to do next rather than showing a blank list', async () => {
    withState([]);
    await draw(<AskScreen />);
    expect(screen.getByText('Ask about your spending')).toBeTruthy();
  });
});

/**
 * Someone's own past questions, offered back (§6, Week 8). Static examples are
 * a guess at what a stranger wants; these are what this person actually asks,
 * so they take the empty state's place as soon as there are any.
 */
describe('suggesting questions the user has asked before', () => {
  const asked: FrequentQuestion[] = [
    { text: 'how much on groceries last month?', askedCount: 5 },
    { text: 'which shop do I go to most?', askedCount: 2 },
  ];

  it('loads them when the screen appears', async () => {
    withState([]);
    await draw(<AskScreen />);
    expect(loadSuggestions).toHaveBeenCalled();
  });

  it('offers the user’s own questions in place of the examples', async () => {
    withState([], false, '', asked);
    await draw(<AskScreen />);

    expect(screen.getByText('how much on groceries last month?')).toBeTruthy();
    expect(screen.queryByText(/Try “how much did I spend/)).toBeNull();
  });

  it('falls back to examples for someone who has asked nothing yet', async () => {
    withState([]);
    await draw(<AskScreen />);

    expect(screen.getByText(/Try “how much did I spend/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Ask again/)).toBeNull();
  });

  it('asks the question again when one is tapped', async () => {
    withState([], false, '', asked);
    await draw(<AskScreen />);

    await fireEvent.press(screen.getByLabelText('Ask again: which shop do I go to most?'));

    expect(send).toHaveBeenCalledWith('which shop do I go to most?');
  });

  /** Once there is a conversation, the empty state and its chips are gone. */
  it('stops offering them once the conversation has started', async () => {
    withState([{ id: 'a', role: 'user', text: 'how much?' }], false, '', asked);
    await draw(<AskScreen />);

    expect(screen.queryByLabelText(/^Ask again/)).toBeNull();
  });
});

/**
 * Clearing the conversation (§6, Week 8).
 *
 * Destructive, so it confirms first — and "confirms" has to mean the work
 * only happens on the destructive choice, which is the half of a dialog that
 * is easy to wire backwards.
 */
describe('the conversation menu', () => {
  const asked: AskMessage[] = [
    { id: 'a', role: 'user', text: 'how much?' },
    { id: 'b', role: 'assistant', text: 'You spent $12.' },
  ];

  /** Runs the button with the given label out of the last Alert shown. */
  const choose = async (alert: jest.SpyInstance, label: string) => {
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((button) => button.text === label)?.onPress?.();
    });
  };

  it('offers nothing to clear on an empty conversation', async () => {
    withState([]);
    await draw(<AskScreen />);
    expect(screen.queryByLabelText('Conversation options')).toBeNull();
  });

  it('appears once there is a conversation', async () => {
    withState(asked);
    await draw(<AskScreen />);
    expect(screen.getByLabelText('Conversation options')).toBeTruthy();
  });

  it('asks before clearing rather than clearing on the tap', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    withState(asked);
    await draw(<AskScreen />);

    await fireEvent.press(screen.getByLabelText('Conversation options'));

    expect(alert).toHaveBeenCalled();
    expect(clearConversation).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('clears when the destructive choice is taken', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    withState(asked);
    await draw(<AskScreen />);

    await fireEvent.press(screen.getByLabelText('Conversation options'));
    await choose(alert, 'Clear');

    expect(clearConversation).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('leaves the conversation alone on Cancel', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    withState(asked);
    await draw(<AskScreen />);

    await fireEvent.press(screen.getByLabelText('Conversation options'));
    await choose(alert, 'Cancel');

    expect(clearConversation).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

/** A conversation saved on a previous launch is read back when the screen opens. */
describe('restoring a saved conversation', () => {
  it('asks the store to restore when the screen appears', async () => {
    withState([]);
    await draw(<AskScreen />);
    expect(restore).toHaveBeenCalled();
  });
});

describe('asking', () => {
  it('sends the question and empties the box', async () => {
    withState([]);
    await draw(<AskScreen />);

    await fireEvent.changeText(screen.getByLabelText('Your question'), 'how much in June?');
    await fireEvent.press(screen.getByLabelText('Send'));

    expect(send).toHaveBeenCalledWith('how much in June?');
    expect(screen.getByLabelText('Your question').props.value).toBe('');
  });

  it('trims before sending, and refuses whitespace', async () => {
    withState([]);
    await draw(<AskScreen />);

    await fireEvent.changeText(screen.getByLabelText('Your question'), '   ');
    await fireEvent.press(screen.getByLabelText('Send'));
    expect(send).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Your question'), '  spent where?  ');
    await fireEvent.press(screen.getByLabelText('Send'));
    expect(send).toHaveBeenCalledWith('spent where?');
  });

  /**
   * The loop is one turn at a time, and a second question mid-answer would
   * race the first one's history into the prompt.
   */
  it('refuses a second question while one is in flight', async () => {
    withState([{ id: 'a', role: 'user', text: 'how much?' }], true);
    await draw(<AskScreen />);

    await fireEvent.changeText(screen.getByLabelText('Your question'), 'and last month?');
    await fireEvent.press(screen.getByLabelText('Send'));

    expect(send).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Thinking')).toBeTruthy();
  });
});

describe('the conversation', () => {
  it('shows both sides', async () => {
    withState([
      { id: 'a', role: 'user', text: 'how much in June?' },
      { id: 'b', role: 'assistant', text: 'You spent $214.30 in June.' },
    ]);
    await draw(<AskScreen />);

    expect(screen.getByText('how much in June?')).toBeTruthy();
    expect(screen.getByText('You spent $214.30 in June.')).toBeTruthy();
  });

  it('shows no typing indicator once the answer has landed', async () => {
    withState([{ id: 'b', role: 'assistant', text: 'You spent $12.' }]);
    await draw(<AskScreen />);
    expect(screen.queryByLabelText('Thinking')).toBeNull();
  });
});

/**
 * A name only becomes a link when a tool result vouched for it (§14.6's rule
 * in another form: what the model says is not evidence). The matching rules
 * are covered in `linkify`'s own suite; this checks the screen honours them
 * and that a tap actually goes somewhere.
 */
describe('links to the bill behind an answer', () => {
  it('opens the bill when a vouched-for name is tapped', async () => {
    withState([
      {
        id: 'b',
        role: 'assistant',
        text: 'You bought milk 2l at Countdown.',
        references: [{ billId: 7, label: 'milk 2l' }],
      },
    ]);
    await draw(<AskScreen />);

    await fireEvent.press(screen.getByLabelText('milk 2l, open the bill'));
    expect(push).toHaveBeenCalledWith({ pathname: '/bill/[id]', params: { id: 7 } });
  });

  it('leaves a name with no reference as plain text', async () => {
    withState([
      { id: 'b', role: 'assistant', text: 'You spent $214 on groceries.', references: [] },
    ]);
    await draw(<AskScreen />);
    expect(screen.queryByLabelText(/open the bill/)).toBeNull();
  });

  it('never links inside the user’s own message', async () => {
    withState([
      { id: 'a', role: 'user', text: 'how much milk 2l did I buy?' },
      {
        id: 'b',
        role: 'assistant',
        text: 'Two.',
        references: [{ billId: 7, label: 'milk 2l' }],
      },
    ]);
    await draw(<AskScreen />);
    expect(screen.queryByLabelText('milk 2l, open the bill')).toBeNull();
  });
});

/**
 * iOS draws the keyboard over the tab bar, so while it is up there is no way
 * to leave this screen. That made two ordinary omissions into a trap: a
 * multiline input ignores `returnKeyType` — its Return key inserts a newline
 * and `onSubmitEditing` never fires — and an empty conversation has nothing to
 * drag downwards, which is exactly the state a first-time user is in.
 */
describe('getting the keyboard back down', () => {
  it('sends on Return rather than typing a newline into the question', async () => {
    withState([]);
    await draw(<AskScreen />);

    await fireEvent.changeText(screen.getByLabelText('Your question'), 'how much in June?');
    await fireEvent(screen.getByLabelText('Your question'), 'submitEditing');

    expect(send).toHaveBeenCalledWith('how much in June?');
  });

  /**
   * The populated conversation must **not** get that wrapper. A `Pressable`
   * parent claims the touch before a `FlatList` can start a scroll, so
   * wrapping the list in one stops it scrolling at all — which is what
   * happened the first time this was fixed. The list dismisses through
   * `keyboardShouldPersistTaps="handled"` instead, which fires only when no
   * child claimed the tap.
   */
  it('does not wrap the message list in a press target', async () => {
    withState([{ id: 'b', role: 'assistant', text: 'You spent $12.' }]);
    await draw(<AskScreen />);

    expect(screen.queryByTestId('ask-dismiss-keyboard')).toBeNull();
    // The answer is still there — the list rendered, it is just not wrapped.
    expect(screen.getByText('You spent $12.')).toBeTruthy();
  });

  /** The empty state is the case that had no escape at all. */
  it('dismisses from an empty conversation too', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    withState([]);
    await draw(<AskScreen />);

    await fireEvent.press(screen.getByTestId('ask-dismiss-keyboard'));

    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });
});

/**
 * §6.2's streaming, as the screen shows it. The indicator gives way to the
 * answer the moment there is one; during a tool call there is genuinely
 * nothing to show, because the model is choosing a query rather than writing.
 */
describe('an answer arriving', () => {
  it('shows the indicator while there is nothing yet to read', async () => {
    withState([{ id: 'a', role: 'user', text: 'how much?' }], true, '');
    await draw(<AskScreen />);

    expect(screen.getByLabelText('Thinking')).toBeTruthy();
  });

  it('replaces the indicator with the answer as it arrives', async () => {
    withState([{ id: 'a', role: 'user', text: 'how much?' }], true, 'You spent ');
    await draw(<AskScreen />);

    expect(screen.queryByLabelText('Thinking')).toBeNull();
    expect(screen.getByText('You spent ')).toBeTruthy();
  });

  /** A screen reader should not read a half-written sentence as the answer. */
  it('marks a partial answer as still arriving', async () => {
    withState([], true, 'You spent ');
    await draw(<AskScreen />);

    expect(screen.getByLabelText('Answer, still arriving')).toBeTruthy();
  });

  it('shows nothing extra once the turn is done', async () => {
    withState([{ id: 'b', role: 'assistant', text: 'You spent $12.' }], false, '');
    await draw(<AskScreen />);

    expect(screen.queryByLabelText('Answer, still arriving')).toBeNull();
    expect(screen.queryByLabelText('Thinking')).toBeNull();
  });
});

/**
 * Android-only, and the `ui` project runs the `jest-expo/android` preset, so
 * this is the platform under test.
 *
 * The manifest asks for `adjustResize`, which would normally lift the
 * composer, but `edgeToEdgeEnabled=true` stops the window resizing when the
 * keyboard appears — and `KeyboardAvoidingView` is a no-op on Android. Without
 * an inset applied by hand, the text box and Send button sit underneath the
 * keyboard with no way to type or send.
 */
describe('making room for the Android keyboard', () => {
  /** Captures the handlers the screen registers, so they can be fired. */
  function captureKeyboardHandlers() {
    const handlers = new Map<string, (event: unknown) => void>();
    jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((event: string, handler: (payload: never) => void) => {
        handlers.set(event, handler as (event: unknown) => void);
        return { remove: () => handlers.delete(event) } as never;
      });
    return handlers;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const paddingOf = () =>
    StyleSheet.flatten(screen.getByTestId('ask-keyboard-avoider').props.style).paddingBottom;

  it('reserves no space while the keyboard is down', async () => {
    captureKeyboardHandlers();
    withState([]);
    await draw(<AskScreen />);

    expect(paddingOf()).toBe(0);
  });

  it('lifts the composer by the keyboard height', async () => {
    const handlers = captureKeyboardHandlers();
    withState([]);
    await draw(<AskScreen />);

    await act(async () => {
      handlers.get('keyboardDidShow')?.({ endCoordinates: { height: 312 } });
    });

    expect(paddingOf()).toBe(312);
  });

  it('gives the space back when the keyboard goes away', async () => {
    const handlers = captureKeyboardHandlers();
    withState([]);
    await draw(<AskScreen />);

    await act(async () => {
      handlers.get('keyboardDidShow')?.({ endCoordinates: { height: 312 } });
    });
    await act(async () => {
      handlers.get('keyboardDidHide')?.({});
    });

    expect(paddingOf()).toBe(0);
  });

  /** A malformed event must not collapse the layout to NaN. */
  it('treats a height-less event as no keyboard', async () => {
    const handlers = captureKeyboardHandlers();
    withState([]);
    await draw(<AskScreen />);

    await act(async () => {
      handlers.get('keyboardDidShow')?.({});
    });

    expect(paddingOf()).toBe(0);
  });
});
