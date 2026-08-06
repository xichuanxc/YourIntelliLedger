/**
 * Merchant normalisation — spec §4.8.
 *
 * Deterministic and pure, because it drives both grouping in the ledger and
 * `merchants_top` in the agent's data catalog (§6.3): two different answers
 * for the same shop would show up as two different merchants in every
 * aggregate the app produces.
 *
 * Branch detail is deliberately **retained** — `"PAK'nSAVE Mill Street"` and
 * `"PAK'nSAVE Hamilton"` are different stores and a user comparing them is
 * asking a real question.
 */

export function normaliseMerchant(merchant: string | null | undefined): string | null {
  if (merchant == null) return null;

  const normalised = merchant
    .normalize('NFKC')
    .toLowerCase()
    // Punctuation is dropped, not replaced with a space — §4.8's worked
    // example is "PAK'nSAVE Mill Street" → "paknsave mill street".
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .trim()
    .replace(/\s+/g, ' ');

  return normalised === '' ? null : normalised;
}

/**
 * Tidies a merchant name for storage as printed: collapses runs of whitespace
 * and trims, but changes nothing else. OCR output is often padded; the casing
 * and punctuation are data.
 */
export function cleanMerchant(merchant: string | null | undefined): string | null {
  if (merchant == null) return null;
  const cleaned = merchant.replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}
