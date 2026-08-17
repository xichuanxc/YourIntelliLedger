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
  const startedAt = Date.now();

  const image = await normaliseImage(uri);
  const normalisedAt = Date.now();

  const page = await recogniseText(image.uri, options.script);
  const recognisedAt = Date.now();

  const { elements, angleRadians } = correctSkew(page.elements, page.blocks, {
    width: image.width,
    height: image.height,
  });

  const text = reconstructLines(elements);
  const finishedAt = Date.now();

  if (__DEV__) {
    // §8.4 budgets OCR at 1.5s and §5.7 the whole capture→review at 6s — and a
    // single total cannot say which stage spent it. The dimensions are here
    // because the usual answer is a full-resolution camera frame: the §5.2
    // downscale is the cheapest lever available, and how far it had to reduce
    // is unanswerable once the source image is gone.
    console.log(
      `[capture] page ${pageNo} ` +
        `src=${image.sourceWidth}x${image.sourceHeight} → ${image.width}x${image.height} ` +
        `normalise=${normalisedAt - startedAt}ms ` +
        `ocr=${recognisedAt - normalisedAt}ms ` +
        `deskew+lines=${finishedAt - recognisedAt}ms ` +
        `elements=${elements.length} chars=${text.length}`
    );
  }

  return {
    pageNo,
    image,
    text,
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
