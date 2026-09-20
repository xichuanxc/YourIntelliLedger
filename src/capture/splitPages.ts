/**
 * One capture per page, for a scan that holds several receipts (§5.2).
 *
 * §5.2's assumption is that a multi-page scan is one long receipt whose pages
 * are concatenated before parsing. When the user says otherwise, this is what
 * makes the difference: each page becomes its own capture, so `parse_receipt`
 * sees **one receipt's text per request** instead of two stuck together.
 *
 * That matters beyond tidiness. Two receipts in one prompt asks the model to
 * merge two shops into a single object — one merchant, one total — which it
 * will attempt, and the result looks plausible in the ledger afterwards.
 *
 * Here rather than in the store so it can be tested: the store reaches MMKV,
 * the transport and the native scanner, none of which load in the `node`
 * project. This file imports nothing at runtime.
 */

import type { CaptureResult } from '@/capture/pipeline';

export function splitByPage(result: CaptureResult): CaptureResult[] {
  return result.pages.map((page) => ({
    ...result,
    // Renumbered to 1: images live at receipts/{bill_id}/{page_no}.jpg, and
    // each of these becomes the first page of its own bill.
    pages: [{ ...page, pageNo: 1 }],
    // The single page's own text, never the joined text — this is the whole
    // point of the split.
    text: page.text,
  }));
}
