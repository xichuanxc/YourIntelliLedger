/**
 * Capture → raw text, the Week 5 deliverable (§5.1).
 *
 *     image → downscale & compress → ML Kit OCR (blocks + frames)
 *       → geometry correction (§5.3) → line reconstruction (§5.4) → raw text
 *
 * Everything downstream of this — `parse_receipt`, the post-checks, the review
 * screen — is Week 6. The pipeline stops at text on purpose, because that text
 * is the contract the parsing prompt was measured against (§5.7).
 */

import { correctSkew } from '@/capture/geometry';
import { normaliseImage, type NormalisedImage } from '@/capture/image';
import { recogniseText, type TextRecognitionScript } from '@/capture/ocr';
import { reconstructLines } from '@/capture/lineReconstruction';
import type { CapturePath } from '@/types/vocabulary';

export interface CapturedPage {
  /** 1-based, capture order — the order pages are concatenated in (§5.2). */
  pageNo: number;
  image: NormalisedImage;
  /** Reconstructed reading order for this page. */
  text: string;
  /** Skew the geometry step removed, in degrees. Diagnostic. */
  skewDegrees: number;
  elementCount: number;
}

export interface CaptureResult {
  pages: CapturedPage[];
  /** Pages joined in order — what `parse_receipt` receives (§5.2). */
  text: string;
  path: CapturePath;
  /** Wall-clock milliseconds, against §8.4's 1.5 s OCR budget. */
  durationMs: number;
}

export interface PipelineOptions {
  script?: TextRecognitionScript;
}

/** Runs one image through normalise → OCR → deskew → reconstruct. */
export async function processPage(
  uri: string,
  pageNo: number,
  options: PipelineOptions = {}
): Promise<CapturedPage> {
  const image = await normaliseImage(uri);
  const page = await recogniseText(image.uri, options.script);

  const { elements, angleRadians } = correctSkew(page.elements, page.blocks, {
    width: image.width,
    height: image.height,
  });

  return {
    pageNo,
    image,
    text: reconstructLines(elements),
    skewDegrees: (angleRadians * 180) / Math.PI,
    elementCount: elements.length,
  };
}

/**
 * Processes every captured page and concatenates them in capture order.
 *
 * Pages are joined with a blank line, matching how the prototype concatenated
 * multi-page receipts when §5.7's accuracy was measured — the parsing prompt
 * has only ever seen this shape.
 */
export async function processCapture(
  uris: readonly string[],
  path: CapturePath,
  options: PipelineOptions = {}
): Promise<CaptureResult> {
  const startedAt = Date.now();

  const pages: CapturedPage[] = [];
  for (const [index, uri] of uris.entries()) {
    pages.push(await processPage(uri, index + 1, options));
  }

  return {
    pages,
    text: pages.map((page) => page.text).join('\n\n'),
    path,
    durationMs: Date.now() - startedAt,
  };
}
