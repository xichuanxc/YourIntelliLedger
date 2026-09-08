/**
 * The thin Ask screen (§6, Week 7).
 *
 * The store is mocked, because what is worth testing here is the screen's own
 * contract with the user: a question leaves the box when it is sent, nothing
 * can be sent twice while an answer is in flight, and an empty conversation
 * says what to do next (§7 requires an empty state that explains the next
 * action). The loop behind it has its own suite.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import AskScreen from '@/app/(tabs)/ask';
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

function withState(messages: AskMessage[], thinking = false) {
  mockedStore.mockReturnValue({ messages, thinking, send, history: [], clear: jest.fn() });
}

const push = jest.spyOn(router, 'push').mockImplementation(() => undefined);

beforeEach(() => {
  send.mockClear();
  push.mockClear();
});

describe('an empty conversation', () => {
  it('says what to do next rather than showing a blank list', async () => {
    withState([]);
    await draw(<AskScreen />);
    expect(screen.getByText('Ask about your spending')).toBeTruthy();
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

  it('dismisses the keyboard when the conversation is tapped', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    withState([{ id: 'b', role: 'assistant', text: 'You spent $12.' }]);
    await draw(<AskScreen />);

    await fireEvent.press(screen.getByTestId('ask-dismiss-keyboard'));

    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
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
