/**
 * Editing a number without the box fighting back.
 *
 * The reported bug, in one sentence: typing a price changed the digits by
 * itself. The field rendered its `value` from the number it had parsed, so
 * `8` became `8.00` under the cursor and the next keystroke made `8.002`,
 * which parsed to nothing and emptied the box.
 *
 * Every test below is about one rule: what is on screen is what was typed.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { parseCents } from '@/data/money';
import { AmountField } from '@/ui/components/amount-field';

/**
 * `render` and `fireEvent` are both async in @testing-library/react-native 14
 * — React 19 made the act() boundary asynchronous. A missing `await` fails
 * with "`render` function has not been called", which implicates the wrong
 * thing entirely.
 */
async function draw(over: Partial<React.ComponentProps<typeof AmountField>> = {}) {
  const onCommit = jest.fn();
  await render(
    <AmountField
      label="Price"
      initialText="7.50"
      parse={parseCents}
      onCommit={onCommit}
      allowEmpty
      {...over}
    />
  );
  return { onCommit, field: () => screen.getByLabelText(over.label ?? 'Price') };
}

/** Typing a whole amount, one keystroke at a time, as a person does. */
async function type(field: () => ReturnType<typeof screen.getByLabelText>, text: string) {
  for (let end = 1; end <= text.length; end += 1) {
    await fireEvent.changeText(field(), text.slice(0, end));
  }
}

describe('what is on screen', () => {
  it('shows the stored amount when it opens', async () => {
    const { field } = await draw();
    expect(field().props.value).toBe('7.50');
  });

  it('does not add decimals the person has not typed', async () => {
    const { field } = await draw({ initialText: '' });

    await fireEvent.changeText(field(), '8');

    expect(field().props.value).toBe('8');
  });

  /** The exact sequence from the report: 8, then . then 2 then 5. */
  it('keeps every digit of an amount typed one key at a time', async () => {
    const { field, onCommit } = await draw({ initialText: '' });

    await type(field, '8.25');

    expect(field().props.value).toBe('8.25');
    expect(onCommit).toHaveBeenLastCalledWith(825);
  });

  it('lets the decimal point be typed and stay', async () => {
    const { field } = await draw({ initialText: '' });

    await type(field, '8.');

    expect(field().props.value).toBe('8.');
  });

  it('does not rewrite the box when the amount is edited down', async () => {
    const { field } = await draw();

    await fireEvent.changeText(field(), '7.5');

    expect(field().props.value).toBe('7.5');
  });
});

describe('what reaches the bill', () => {
  it('commits as soon as the text is a readable amount', async () => {
    const { field, onCommit } = await draw({ initialText: '' });

    await fireEvent.changeText(field(), '12.34');

    expect(onCommit).toHaveBeenCalledWith(1234);
  });

  /**
   * Half-typed is not wrong. `8.` reads as $8.00 and the dot stays on screen,
   * so someone who stops there and saves gets the amount they can see rather
   * than nothing at all.
   */
  it('reads a trailing decimal point as the whole amount', async () => {
    const { field, onCommit } = await draw({ initialText: '' });

    await fireEvent.changeText(field(), '8.');

    expect(onCommit).toHaveBeenCalledWith(800);
    expect(field().props.value).toBe('8.');
  });

  it('still commits when the field is left rather than typed in', async () => {
    const { field, onCommit } = await draw({ initialText: '' });

    await fireEvent.changeText(field(), '9.99');
    onCommit.mockClear();
    await fireEvent(field(), 'blur');

    expect(onCommit).toHaveBeenCalledWith(999);
  });

  it('reports an emptied price as illegible rather than as zero', async () => {
    const { field, onCommit } = await draw();

    await fireEvent.changeText(field(), '');

    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('treats an empty box as unfinished where emptiness is not a value', async () => {
    const { field, onCommit } = await draw({ allowEmpty: false });

    await fireEvent.changeText(field(), '');

    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('text that cannot be an amount', () => {
  it('says so rather than silently keeping the old number', async () => {
    const { field } = await draw({ initialText: '' });

    await fireEvent.changeText(field(), '8.002');

    expect(screen.getByText("That isn't an amount I can read.")).toBeTruthy();
  });

  it('leaves the unreadable text on screen to be corrected', async () => {
    const { field } = await draw({ initialText: '' });

    await fireEvent.changeText(field(), '8.002');

    expect(field().props.value).toBe('8.002');
  });

  it('commits nothing while the text is unreadable', async () => {
    const { field, onCommit } = await draw({ initialText: '' });

    await fireEvent.changeText(field(), '1..2');

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('clears the complaint once the text is readable again', async () => {
    const { field } = await draw({ initialText: '' });

    await fireEvent.changeText(field(), '8.002');
    await fireEvent.changeText(field(), '8.00');

    expect(screen.queryByText("That isn't an amount I can read.")).toBeNull();
  });
});

describe('a quantity, which is not money', () => {
  const parseQuantity = (text: string) => {
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };

  it('accepts the third decimal a weighed line needs', async () => {
    const { field, onCommit } = await draw({
      label: 'Quantity',
      initialText: '1',
      parse: parseQuantity,
      maxDecimals: 3,
      allowEmpty: false,
    });

    await type(field, '1.255');

    expect(field().props.value).toBe('1.255');
    expect(onCommit).toHaveBeenLastCalledWith(1.255);
  });
});
