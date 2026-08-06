import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { BillForm, type BillFormValues } from '@/ui/components/bill-form';

/**
 * `render` and `fireEvent` are both async in @testing-library/react-native 14
 * — React 19 made the act() boundary asynchronous. Forgetting an `await` here
 * fails with "`render` function has not been called", which is misleading.
 */
async function renderForm() {
  const onSubmit = jest.fn<Promise<void>, [BillFormValues]>().mockResolvedValue(undefined);
  await render(<BillForm submitLabel="Save bill" onSubmit={onSubmit} onCancel={jest.fn()} />);
  return onSubmit;
}

const type = (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value);

const press = (label: string) => fireEvent.press(screen.getByLabelText(label));

const submit = () => press('Save bill');

describe('BillForm', () => {
  it('converts entered amounts to integer cents (§4.3)', async () => {
    const onSubmit = await renderForm();

    await type('Merchant', "PAK'nSAVE Mill Street");
    await type('Date', '2026-07-19');
    await type('Total', '12.34');
    await submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      merchant: "PAK'nSAVE Mill Street",
      purchasedAt: '2026-07-19',
      totalCents: 1234,
    });
  });

  it('refuses to submit a date that does not exist', async () => {
    const onSubmit = await renderForm();

    await type('Date', '2026-02-30');
    await submit();

    await waitFor(() => expect(screen.getByText(/date that exists/i)).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses to submit an unreadable amount', async () => {
    const onSubmit = await renderForm();

    await type('Total', 'about twenty dollars');
    await submit();

    await waitFor(() => expect(screen.getByText(/isn't an amount I can read/i)).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits an itemless bill, which is a valid shape (§5.1)', async () => {
    const onSubmit = await renderForm();

    await type('Merchant', 'Rice Bowl Cafe');
    await type('Total', '86.50');
    await submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].items).toEqual([]);
    expect(onSubmit.mock.calls[0][0].totalCents).toBe(8650);
  });

  it('leaves a blank item price as unknown rather than zero (§4.3)', async () => {
    const onSubmit = await renderForm();

    await press('Add an item');
    await type('Name', 'Bananas');
    await submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].items[0].priceCents).toBeNull();
  });

  it('carries the vocabulary selection through to the saved values (§4.7)', async () => {
    const onSubmit = await renderForm();

    await press('Add an item');
    await type('Name', 'Bananas');
    await type('Quantity', '0.67');
    await type('Price', '2.45');
    await press('Produce');
    await press('kg');
    await submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].items[0]).toMatchObject({
      name: 'Bananas',
      category: 'produce',
      unit: 'kg',
      qty: 0.67,
      priceCents: 245,
    });
  });

  it('rejects an item with no name instead of saving a blank line', async () => {
    const onSubmit = await renderForm();

    await press('Add an item');
    await submit();

    await waitFor(() => expect(screen.getByText(/Give the item a name/i)).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('removes an item line on request', async () => {
    await renderForm();

    await press('Add an item');
    expect(screen.getByText('Line 1')).toBeTruthy();

    await press('Remove line 1');
    expect(screen.queryByText('Line 1')).toBeNull();
  });
});
