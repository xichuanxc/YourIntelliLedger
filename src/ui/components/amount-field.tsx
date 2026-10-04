/**
 * A number field that lets a person finish typing.
 *
 * The bug this exists to stop: a field whose `value` is a rendering of the
 * number it parsed. Editing a price that way rewrites the box under the
 * cursor — type `8` into an empty price, it parses to 800 cents, comes back
 * as `8.00`, and the next digit makes `8.002`, which parses to nothing and
 * empties the field. Two digits typed, neither of them kept.
 *
 * So the text is the state and the number is derived from it, never the other
 * way round. The stored value is read once, to fill the box; after that the
 * box belongs to whoever is typing.
 *
 * ## Half-typed is not wrong
 *
 * `8.` is not an amount and is not a mistake either — it is `8.50` two
 * keystrokes early. A field that complained there would be scolding someone
 * mid-word, so a text that could still *become* an amount is accepted in
 * silence, the dot is dropped to read it, and `8.` therefore means $8.00
 * until the next keystroke says otherwise. Someone who stops there and saves
 * gets the amount they can see. Only a text that cannot be an amount at all
 * (`8.002`, `1..2`) raises an error.
 *
 * The error matters because the parent keeps the last value that parsed: a
 * box reading one thing while the bill holds another is the one outcome worse
 * than either, so the field says so on screen rather than letting a save go
 * quietly past it.
 *
 * Leaving the field commits once more, so a value is never left on screen
 * without having reached the bill behind it.
 */

import { useState } from 'react';
import type { ViewStyle } from 'react-native';

import { TextField } from '@/ui/components/text-field';

export interface AmountFieldProps {
  label: string;
  /** The stored value as text, read once. Later changes do not reach the box. */
  initialText: string;
  /** Cents for money, a plain count for a quantity — the field does not care. */
  parse: (text: string) => number | null;
  onCommit: (value: number | null) => void;
  /** Whether an empty box is a value (`null`) or merely unfinished. */
  allowEmpty?: boolean;
  /** How many decimals this quantity can have, for judging a half-typed one. */
  maxDecimals?: number;
  invalidMessage?: string;
  placeholder?: string;
  containerStyle?: ViewStyle;
}

/** Could this text still grow into a number? A trailing dot can. */
function partialPattern(maxDecimals: number): RegExp {
  return new RegExp(`^-?\\d*(\\.\\d{0,${maxDecimals}})?$`);
}

export function AmountField({
  label,
  initialText,
  parse,
  onCommit,
  allowEmpty = false,
  maxDecimals = 2,
  invalidMessage = "That isn't an amount I can read.",
  placeholder,
  containerStyle,
}: AmountFieldProps) {
  const [text, setText] = useState(initialText);
  const [invalid, setInvalid] = useState(false);
  const partial = partialPattern(maxDecimals);

  /** The text as a number, with a half-typed decimal point settled. */
  const commit = (value: string) => {
    const settled = value.trim().replace(/\.$/, '');
    if (settled === '' || settled === '-') {
      if (allowEmpty) onCommit(null);
      return;
    }
    const parsed = parse(settled);
    if (parsed !== null) onCommit(parsed);
  };

  return (
    <TextField
      label={label}
      value={text}
      keyboardType="decimal-pad"
      placeholder={placeholder}
      error={invalid ? invalidMessage : undefined}
      containerStyle={containerStyle}
      onChangeText={(next) => {
        setText(next);
        if (!partial.test(next.trim())) {
          // Kept on screen rather than swallowed: the parent still holds the
          // last value that parsed, and the mismatch has to be visible.
          setInvalid(true);
          return;
        }
        setInvalid(false);
        commit(next);
      }}
      onBlur={() => {
        if (!invalid) commit(text);
      }}
    />
  );
}
