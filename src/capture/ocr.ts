/**
 * ML Kit text recognition, adapted to the shared `OcrElement` shape.
 *
 * ## Recognition script is a decision, not a default (§3)
 *
 * The binding takes **one script per call** and defaults to Latin:
 *
 *     recognize(imageURL, script = TextRecognitionScript.LATIN)
 *
 * Apple's Vision took an ordered list of languages, and the prototype found
 * that getting it wrong does not garble non-Latin text — it makes it *vanish*.
 * Zero Chinese characters came back until `zh-Hans` was requested, and
 * requesting `en-US` first recovered none of them. ML Kit is a different
 * engine, but the failure mode is the same category: a script the recogniser
 * was not asked for is not read.
 *
 * That is not cosmetic here. §4.10's bilingual search matches on `name_local`,
 * so a Chinese item name dropped at OCR cannot be searched for later no matter
 * how good the parsing step is — the data never existed.
 *
 * ML Kit's Chinese model recognises Latin as well as Chinese, so a single
 * CHINESE pass covers this corpus (16 of its 41 items carry a `name_local`).
 * **This needs measuring on-device against the fixture corpus** before it can
 * be called settled — that is the §3 Week 5 verification, and it is not done.
 */

import TextRecognition, {
  TextRecognitionScript,
  type TextBlock,
  type TextRecognitionResult,
} from '@react-native-ml-kit/text-recognition';

import type { OcrBlock, OcrElement } from '@/capture/types';

export { TextRecognitionScript };

/**
 * Chosen rather than defaulted: the Latin default would silently drop every
 * Chinese glyph on the corpus.
 */
export const DEFAULT_RECOGNITION_SCRIPT = TextRecognitionScript.CHINESE;

export interface OcrPage {
  elements: OcrElement[];
  blocks: OcrBlock[];
  /** Raw recogniser output, kept for the §5.4 cross-platform comparison. */
  rawText: string;
}

/**
 * Flattens ML Kit's block → line → element tree into the flat element list
 * §5.4 works on.
 *
 * Elements (words) rather than lines, deliberately: ML Kit's own line grouping
 * is what returns a receipt's price column detached from its item names, and
 * regrouping from words is the entire point of §5.4. Where an element carries
 * no frame it is skipped — a box with no coordinates cannot be placed on a row.
 */
export function toOcrElements(result: TextRecognitionResult): OcrElement[] {
  const elements: OcrElement[] = [];

  for (const block of result.blocks) {
    for (const line of block.lines) {
      for (const element of line.elements) {
        const frame = element.frame;
        if (!frame || element.text.trim() === '') continue;

        elements.push({
          text: element.text,
          x: frame.left,
          yCenter: frame.top + frame.height / 2,
          width: frame.width,
          height: frame.height,
        });
      }
    }
  }

  return elements;
}

/** Blocks that carry corner points, which is all §5.3 needs for the skew estimate. */
export function toOcrBlocks(blocks: readonly TextBlock[]): OcrBlock[] {
  return blocks
    .filter((block): block is TextBlock & { cornerPoints: NonNullable<TextBlock['cornerPoints']> } =>
      Boolean(block.cornerPoints)
    )
    .map((block) => ({ cornerPoints: block.cornerPoints }));
}

export async function recogniseText(
  imageUri: string,
  script: TextRecognitionScript = DEFAULT_RECOGNITION_SCRIPT
): Promise<OcrPage> {
  const result = await TextRecognition.recognize(imageUri, script);

  return {
    elements: toOcrElements(result),
    blocks: toOcrBlocks(result.blocks),
    rawText: result.text,
  };
}
