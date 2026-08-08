import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { LaunchScreen, MIN_VISIBLE_MS } from '@/ui/components/launch-screen';

/**
 * What is worth testing here is the timing contract, not the pixels.
 *
 * §8.4 budgets cold start to interactive at under two seconds. A launch screen
 * that outlives the work it covers spends that budget on decoration, and a
 * launch screen that leaves early is a flash. Both failures are invisible in
 * a screenshot and easy to reintroduce.
 */
describe('LaunchScreen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /**
   * `includeHiddenElements` because the screen marks itself hidden to
   * assistive technology — deliberately, since it vanishes after a second.
   * The text still has to be there and correct.
   */
  it('shows the app name and what it promises', async () => {
    await render(<LaunchScreen ready={false} onFinished={jest.fn()} />);
    const options = { includeHiddenElements: true };

    expect(screen.getByText('YourIntelliLedger', options)).toBeTruthy();
    expect(screen.getByText('Your ledger, on your device', options)).toBeTruthy();
  });

  it('tells the caller to retire the OS splash once it has been laid out', async () => {
    const onShown = jest.fn();
    await render(<LaunchScreen ready={false} onShown={onShown} onFinished={jest.fn()} />);

    expect(onShown).not.toHaveBeenCalled();

    await fireEvent(screen.getByTestId('launch-screen', { includeHiddenElements: true }), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    });

    expect(onShown).toHaveBeenCalled();
  });

  it('stays up while the ledger is still opening, however long that takes', async () => {
    const onFinished = jest.fn();
    await render(<LaunchScreen ready={false} onFinished={onFinished} />);

    await act(async () => {
      jest.advanceTimersByTime(MIN_VISIBLE_MS * 4);
    });

    expect(onFinished).not.toHaveBeenCalled();
  });

  /**
   * The floor exists so a warm start does not show the entrance animation for
   * three frames and then rip it away.
   */
  it('does not leave before the floor, even when the app was ready immediately', async () => {
    const onFinished = jest.fn();
    await render(<LaunchScreen ready onFinished={onFinished} />);

    await act(async () => {
      jest.advanceTimersByTime(MIN_VISIBLE_MS - 50);
    });

    expect(onFinished).not.toHaveBeenCalled();
  });

  it('leaves once the app is ready and the floor has passed', async () => {
    const onFinished = jest.fn();
    await render(<LaunchScreen ready onFinished={onFinished} />);

    await act(async () => {
      // The floor, then the exit fade.
      jest.advanceTimersByTime(MIN_VISIBLE_MS + 1000);
    });

    expect(onFinished).toHaveBeenCalled();
  });

  it('does not restart the floor when the app becomes ready later', async () => {
    const onFinished = jest.fn();
    const view = await render(<LaunchScreen ready={false} onFinished={onFinished} />);

    // The database took longer than the floor would have.
    await act(async () => {
      jest.advanceTimersByTime(MIN_VISIBLE_MS * 2);
    });

    await view.rerender(<LaunchScreen ready onFinished={onFinished} />);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(onFinished).toHaveBeenCalled();
  });
});
