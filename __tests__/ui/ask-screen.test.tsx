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
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import AskScreen from '@/app/(tabs)/ask';
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

beforeEach(() => {
  send.mockClear();
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
