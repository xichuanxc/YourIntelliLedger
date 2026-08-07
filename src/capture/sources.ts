/**
 * The three ways an image gets into the pipeline — spec §5.2.
 *
 * **Primary: the system document scanner.** VisionKit on iOS, ML Kit Document
 * Scanner on Android, behind one API. It gives edge detection, auto-capture,
 * multi-page capture, and — the reason §5.2 prefers it — **perspective
 * correction before OCR**. That is the distortion §5.3 cannot fix by rotating,
 * and the one that produced the merged-row failures in the prototype.
 *
 * **Both fallbacks must exist.** On Android the scanner depends on Google Play
 * Services and is simply absent on devices without it, so a plain camera path
 * is required, not optional. And the scanner is camera-only, so a photo the
 * user already has can only arrive through the gallery.
 *
 * Availability is detected at runtime by attempting the scan and catching the
 * failure: neither the plugin nor Play Services exposes a capability query.
 * §5.7 requires that this fall back **without an error dialog** — the user
 * asked to scan a receipt, and which native component served them is not their
 * problem.
 */

import * as ImagePicker from 'expo-image-picker';
import DocumentScanner, {
  ResponseType,
  ScanDocumentResponseStatus,
} from 'react-native-document-scanner-plugin';

import type { CapturePath } from '@/types/vocabulary';

export interface CaptureSourceResult {
  /** One entry per page, in capture order. Empty when the user cancelled. */
  uris: string[];
  path: CapturePath;
  cancelled: boolean;
}

/** Long supermarket receipts do not fit one frame (§5.2). */
export const MAX_SCAN_PAGES = 3;

export class ScannerUnavailableError extends Error {
  constructor(readonly cause: unknown) {
    super('The system document scanner is unavailable on this device');
    this.name = 'ScannerUnavailableError';
  }
}

/**
 * Primary path. Throws `ScannerUnavailableError` when the scanner cannot run,
 * so the caller can drop to the camera silently.
 */
export async function scanWithSystemScanner(): Promise<CaptureSourceResult> {
  let response;
  try {
    response = await DocumentScanner.scanDocument({
      responseType: ResponseType.ImageFilePath,
      maxNumDocuments: MAX_SCAN_PAGES,
      // Re-encoding happens in `normaliseImage`; asking the scanner for its
      // best output avoids compressing twice.
      croppedImageQuality: 100,
    });
  } catch (error) {
    throw new ScannerUnavailableError(error);
  }

  if (response.status === ScanDocumentResponseStatus.Cancel) {
    return { uris: [], path: 'scanner', cancelled: true };
  }

  return { uris: response.scannedImages ?? [], path: 'scanner', cancelled: false };
}

/**
 * Gallery import. Permission is requested at the moment of use with the OS's
 * own prompt (§8.1); a denial returns cancelled rather than throwing, because
 * the app stays fully usable through manual entry.
 */
export async function pickFromGallery(): Promise<CaptureSourceResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { uris: [], path: 'gallery', cancelled: true };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_SCAN_PAGES,
    // No cropping UI: the user cannot usefully crop for OCR, and §5.3 handles
    // the geometry from the boxes instead.
    quality: 1,
  });

  if (result.canceled) return { uris: [], path: 'gallery', cancelled: true };
  return { uris: result.assets.map((asset) => asset.uri), path: 'gallery', cancelled: false };
}

/**
 * There is deliberately no `isScannerAvailable()` probe. Neither the plugin nor
 * Play Services exposes a capability query, and the only way to "ask" is to
 * launch the scanner — which opens a camera UI, so it cannot be a silent
 * check. Availability is therefore discovered by attempting the scan and
 * catching `ScannerUnavailableError`, which is exactly the "detect at runtime
 * and switch silently" §5.2 asks for.
 */
