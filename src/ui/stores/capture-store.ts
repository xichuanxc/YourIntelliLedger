/**
 * In-flight capture state.
 *
 * Lives in a store rather than route params because the result — several
 * pages of OCR text plus image URIs — is far too large to serialise through
 * navigation, and because §8.3 requires in-progress parse results to survive
 * the app being killed while the camera is open. Persisting this to MMKV is
 * the Week 6 half of that; the shape is here so it can be added without moving
 * anything.
 */

import { create } from 'zustand';

import { createByokTransport } from '@/agent/byokTransport';
import type { ParseImage } from '@/agent/parseTransport';
import { encodeImageBase64 } from '@/capture/image';
import { getDb } from '@/data/db';
import { getVisionParse } from '@/data/prefs';
import { logQuery, type QueryLogEntry } from '@/data/telemetryRepo';
import { processCapture, type CaptureResult } from '@/capture/pipeline';
import { parseReceipt, type ParseOutcome } from '@/capture/parseReceipt';
import {
  pickFromGallery,
  scanWithSystemScanner,
  ScannerUnavailableError,
} from '@/capture/sources';
import type { CapturePath } from '@/types/vocabulary';

/**
 * Encodes the normalised pages for a vision request, in page order.
 *
 * Sequential rather than `Promise.all`: each page holds a multi-megabyte
 * base64 string, and decoding a whole multi-page receipt at once is how a
 * low-end device (§8.4) runs out of memory mid-parse.
 */
async function encodePages(pages: CaptureResult['pages']): Promise<ParseImage[]> {
  const images: ParseImage[] = [];
  for (const page of pages) {
    images.push({ base64: await encodeImageBase64(page.image.uri), mimeType: 'image/jpeg' });
  }
  return images;
}

/**
 * One capture per page.
 *
 * Splitting here rather than downstream is what keeps this feature small:
 * parse, review and save need no knowledge of batches, because each of them
 * sees an ordinary single-page capture. The image, the cached OCR text
 * (§4.6) and the page numbering all follow without a special case.
 */
function splitByPage(result: CaptureResult): CaptureResult[] {
  return result.pages.map((page) => ({
    ...result,
    // Renumbered to 1: images live at receipts/{bill_id}/{page_no}.jpg, and
    // each of these is the first page of its own bill.
    pages: [{ ...page, pageNo: 1 }],
    text: page.text,
  }));
}

export type CaptureStatus =
  | 'idle'
  | 'acquiring'
  | 'processing'
  | 'ready'
  | 'parsing'
  | 'parsed'
  | 'error';

interface CaptureState {
  status: CaptureStatus;
  result: CaptureResult | null;
  /** The parsed candidate. Never written to the database (§5.6). */
  parse: ParseOutcome | null;
  error: string | null;
  /** Set when the primary scanner was unavailable and a fallback was used. */
  fellBackFromScanner: boolean;
  /**
   * Whether a multi-page scan holds several receipts rather than one long one.
   *
   * Asked rather than guessed. A continued receipt and two separate ones look
   * alike to the app, and merging two shops into one bill is silent: one
   * merchant, one total, and a plausible-looking row in the ledger.
   */
  separate: boolean;
  setSeparate: (value: boolean) => void;
  /** Captures still to be parsed and reviewed, when the scan held several. */
  queue: CaptureResult[];
  /** How many receipts this scan produced; 0 when it was a single one. */
  batchTotal: number;
  /** Loads and parses the next queued receipt, or ends the batch. */
  nextReceipt: () => Promise<'parsed' | 'done' | 'failed'>;

  runPipeline: (uris: string[], path: CapturePath) => Promise<void>;
  startScan: () => Promise<'done' | 'cancelled' | 'needs-camera-fallback'>;
  startGallery: () => Promise<'done' | 'cancelled'>;
  runParse: () => Promise<'parsed' | 'failed'>;
  reset: () => void;
}

/**
 * Records a parse in `query_log` (§15.3).
 *
 * Never allowed to break a capture: telemetry is a diagnostic convenience, and
 * a user who has just read a receipt should not lose it because a counter
 * could not be written.
 */
async function logParse(
  outcome: QueryLogEntry['outcome'],
  fields: Omit<QueryLogEntry, 'route' | 'outcome' | 'toolCalls'>
): Promise<void> {
  try {
    const db = await getDb();
    await logQuery(db, { route: 'agent', outcome, toolCalls: ['parse_receipt'], ...fields });
  } catch {
    // Deliberately swallowed.
  }
}

export const useCaptureStore = create<CaptureState>((set) => ({
  status: 'idle',
  result: null,
  parse: null,
  error: null,
  fellBackFromScanner: false,
  separate: false,
  queue: [],
  batchTotal: 0,

  setSeparate: (value: boolean) => set({ separate: value }),

  reset: () =>
    set({
      status: 'idle',
      result: null,
      parse: null,
      error: null,
      fellBackFromScanner: false,
      separate: false,
      queue: [],
      batchTotal: 0,
    }),

  nextReceipt: async (): Promise<'parsed' | 'done' | 'failed'> => {
    const [next, ...rest] = useCaptureStore.getState().queue;
    if (!next) {
      useCaptureStore.getState().reset();
      return 'done';
    }

    // `status: 'ready'` and a cleared parse, so the review screen is not
    // briefly showing the receipt that was just saved.
    set({ result: next, queue: rest, parse: null, error: null, status: 'ready' });
    return useCaptureStore.getState().runParse();
  },

  /**
   * Sends the reconstructed text to the model. Failure is not fatal — §5.5
   * falls back to manual entry, so the error is surfaced and the raw text
   * stays available rather than the capture being thrown away.
   */
  runParse: async (): Promise<'parsed' | 'failed'> => {
    const { result, separate } = useCaptureStore.getState();
    if (!result) return 'failed';

    // A scan the user said holds several receipts becomes several captures.
    // Only ever splits once: afterwards the live capture is a single page, so
    // parsing the queued ones comes back through here harmlessly.
    if (separate && result.pages.length > 1) {
      const whole = result;
      const [first, ...rest] = splitByPage(whole);
      set({ result: first, queue: rest, batchTotal: rest.length + 1 });

      const outcome = await useCaptureStore.getState().runParse();
      if (outcome !== 'parsed') {
        // Put the scan back the way it was found. Leaving the split in place
        // after a failed parse showed the result screen a one-page capture —
        // "Pages: 1", the other page's text gone, the separate-receipts switch
        // vanished with it — while the rest sat invisibly in the queue. A
        // provider being busy for a moment should cost a retry, not the view
        // of what was scanned.
        set({ result: whole, queue: [], batchTotal: 0 });
      }
      return outcome;
    }

    set({ status: 'parsing', error: null });
    const startedAt = Date.now();

    try {
      // Read at parse time rather than at capture: the switch lives in
      // Settings, and a user who just got a poor read may well go and turn it
      // on before retrying.
      const images = getVisionParse() ? await encodePages(result.pages) : undefined;

      const parse = await parseReceipt(createByokTransport(), result.text, { images });
      set({ parse, status: 'parsed' });

      // §15.3: counters only, no content. `retry` when the first attempt was
      // rejected and the second succeeded — the outcome the user experienced
      // was still a good answer, just a slower one.
      await logParse(parse.retried ? 'retry' : 'ok', {
        tokensIn: parse.usage?.promptTokens,
        tokensOut: parse.usage?.completionTokens,
        modelAlias: parse.modelAlias,
        latencyMs: parse.durationMs,
      });

      return 'parsed';
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'The receipt could not be read.',
      });

      // Failures are logged too, or the usage figures would flatter the app by
      // counting only what worked.
      await logParse('error', {
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof Error ? error.name : 'unknown',
      });

      return 'failed';
    }
  },

  runPipeline: async (uris, path) => {
    if (uris.length === 0) {
      set({ status: 'idle' });
      return;
    }
    set({ status: 'processing', error: null });
    try {
      const result = await processCapture(uris, path);
      set({ result, status: 'ready' });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'The receipt could not be read.',
      });
    }
  },

  /**
   * Primary path. Returns `needs-camera-fallback` when the system scanner is
   * unavailable — §5.7 requires that to happen without an error dialog, so the
   * caller navigates straight on rather than explaining anything.
   */
  startScan: async () => {
    set({ status: 'acquiring', error: null, fellBackFromScanner: false });
    try {
      const scan = await scanWithSystemScanner();
      if (scan.cancelled) {
        set({ status: 'idle' });
        return 'cancelled';
      }
      await useCaptureStore.getState().runPipeline(scan.uris, scan.path);
      return 'done';
    } catch (error) {
      if (error instanceof ScannerUnavailableError) {
        set({ status: 'idle', fellBackFromScanner: true });
        return 'needs-camera-fallback';
      }
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'The scanner could not start.',
      });
      return 'cancelled';
    }
  },

  startGallery: async () => {
    set({ status: 'acquiring', error: null });
    const picked = await pickFromGallery();
    if (picked.cancelled) {
      set({ status: 'idle' });
      return 'cancelled';
    }
    await useCaptureStore.getState().runPipeline(picked.uris, picked.path);
    return 'done';
  },
}));
