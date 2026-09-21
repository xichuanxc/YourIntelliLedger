/**
 * What a map label says, and how much room it wants (§4.14).
 *
 * Split out of the map itself because both halves are fiddly and neither
 * needs a phone to check: the arrangement in `labels.ts` asks only for
 * widths, and what it can never be allowed to do is measure one string and
 * draw another.
 *
 * ## Measuring without a measurement
 *
 * React Native offers no text measurement before layout, so a chip's width is
 * estimated. A flat average per character was the first attempt and it cost
 * small shops their labels: the average had to be wide enough for capitals,
 * because receipts shout — BORMAN FRESH, PAK'nSAVE — and every mixed-case
 * name was then measured as though it were shouting too. "Garden Fresh" was
 * claiming about a third more room than it occupies, and a label that claims
 * room it does not need pushes its neighbours off the map.
 *
 * Counting the classes separately keeps capitals exactly as generous as they
 * were and lets lower case take what it uses. Every figure still leans wide of
 * the truth, because over-estimating costs a little space while
 * under-estimating lets two chips touch.
 *
 * ## Why a label has several forms
 *
 * The map is about 330pt across and a chip has to sit beside its own pin, so
 * a long name simply has nowhere to go — "PAK'nSAVE Mill Street  $46" wants
 * most of the width of the map and failed in every slot, however early it was
 * placed. The shops being dropped were the ones with the longest names, which
 * on this ledger were also the two largest amounts.
 *
 * So a label offers the arrangement a series of forms and the arrangement
 * takes the first that fits:
 *
 * 1. the name as the receipt printed it;
 * 2. for a chain, the name without its branch — the pin is already sitting on
 *    the branch, and one PAK'nSAVE is much like another;
 * 3. the amount alone.
 *
 * Only the last has no name in it, and it is genuinely last.
 *
 * There was briefly a fourth form between the second and the third: the name
 * cut short with an ellipsis, so that a shop with no branch to drop still had
 * something bearing a name. It is gone, and deliberately. "The Ware…" is not
 * a shop, and it was only ever needed because the map was being asked to fit
 * every label into a 220pt strip without anything ever running under a button
 * or off an edge. That is not a constraint worth mangling a name for: the map
 * pans, and a reader who wants the exact wording moves it or taps the pin.
 */

import { shortMerchantName } from '@/ui/merchantBrand';

/** The chip's side padding. Small: every pixel of it is map it hides. */
export const LABEL_PADDING = 4;

/**
 * A ceiling, so one long shop name cannot run the width of the map. Reached
 * at around two dozen characters, which most receipts stay under.
 */
export const LABEL_MAX_WIDTH = 190;

/** Roughly how wide a character is at the label's size, by what kind it is. */
const WIDE_CHARACTER = 9.5;
const NARROW_CHARACTER = 7.4;
const SPACE_CHARACTER = 4;
const THIN_CHARACTER = 5.5;

export function textWidth(text: string): number {
  let total = 0;
  for (const character of text) {
    if (character === ' ') total += SPACE_CHARACTER;
    else if (character >= 'a' && character <= 'z') total += NARROW_CHARACTER;
    else if (/[A-Z0-9$]/.test(character)) total += WIDE_CHARACTER;
    else total += THIN_CHARACTER;
  }
  return total;
}

/** One way of writing a shop's label. A null name is the amount on its own. */
export interface LabelForm {
  name: string | null;
  amount: string;
}

/** The two parts are set differently, so the text is only rebuilt to measure it. */
export const formText = (form: LabelForm): string =>
  form.name === null ? form.amount : `${form.name}  ${form.amount}`;

export const labelWidthFor = (text: string): number =>
  Math.min(LABEL_MAX_WIDTH, Math.round(textWidth(text)) + LABEL_PADDING * 2);

export const formWidth = (form: LabelForm): number => labelWidthFor(formText(form));

/**
 * The ways this shop's label could be written, most complete first.
 *
 * Duplicates are left out rather than offered twice, so an independent shop
 * — which has no branch to drop — simply has two forms where a chain has
 * three.
 */
export function labelFormsFor(
  label: string,
  merchantNorm: string | null,
  amount: string
): LabelForm[] {
  const forms: LabelForm[] = [{ name: label, amount }];
  const add = (name: string) => {
    if (!forms.some((form) => form.name === name)) forms.push({ name, amount });
  };

  add(shortMerchantName(merchantNorm, label));

  forms.push({ name: null, amount });

  return forms;
}
