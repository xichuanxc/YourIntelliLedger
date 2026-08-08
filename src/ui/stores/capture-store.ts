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
import { processCapture, type CaptureResult } from '@/capture/pipeline';
import { parseReceipt, type ParseOutcome } from '@/capture/parseReceipt';
import {
  pickFromGallery,
  scanWithSystemScanner,
  ScannerUnavailableError,
} from '@/capture/sources';
import type { CapturePath } from '@/types/vocabulary';

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

  runPipeline: (uris: string[], path: CapturePath) => Promise<void>;
  startScan: () => Promise<'done' | 'cancelled' | 'needs-camera-fallback'>;
  startGallery: () => Promise<'done' | 'cancelled'>;
  runParse: () => Promise<'parsed' | 'failed'>;
  reset: () => void;
}

export const useCaptureStore = create<CaptureState>((set) => ({
  status: 'idle',
  result: null,
  parse: null,
  error: null,
  fellBackFromScanner: false,

  reset: () =>
    set({ status: 'idle', result: null, parse: null, error: null, fellBackFromScanner: false }),

  /**
   * Sends the reconstructed text to the model. Failure is not fatal — §5.5
   * falls back to manual entry, so the error is surfaced and the raw text
   * stays available rather than the capture being thrown away.
   */
  runParse: async () => {
    const { result } = useCaptureStore.getState();
    if (!result) return 'failed';

    set({ status: 'parsing', error: null });
    try {
      const parse = await parseReceipt(createByokTransport(), result.text);
      set({ parse, status: 'parsed' });
      return 'parsed';
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'The receipt could not be read.',
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
