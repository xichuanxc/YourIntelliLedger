/**
 * Image normalisation before OCR — spec §5.2, "common to all paths".
 *
 * Long edge capped at 2000 px, JPEG quality ~85. §5.2 is explicit that larger
 * inputs cost time without buying accuracy, and OCR has a 1.5 s budget (§8.4)
 * on a low-end device — a 12 MP camera frame would blow that on decode alone.
 *
 * The sizing arithmetic lives in `imageScaling.ts` so it stays testable; this
 * module is the thin native-facing half.
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { CAPTURE_IMAGE_CONFIG, resizeScale } from '@/capture/imageScaling';

export { CAPTURE_IMAGE_CONFIG, resizeScale };

export interface NormalisedImage {
  uri: string;
  width: number;
  height: number;
}

/** Downscales and re-encodes a captured image, preserving aspect ratio. */
export async function normaliseImage(
  uri: string,
  config: { maxLongEdge: number; jpegQuality: number } = CAPTURE_IMAGE_CONFIG
): Promise<NormalisedImage> {
  // A manipulate with no actions still decodes the image and reports its
  // dimensions, which is how we learn whether a resize is needed at all.
  const probe = await manipulateAsync(uri, [], { compress: 1, format: SaveFormat.JPEG });
  const scale = resizeScale(probe.width, probe.height, config.maxLongEdge);

  const actions =
    scale === 1
      ? []
      : [
          {
            resize: {
              width: Math.round(probe.width * scale),
              height: Math.round(probe.height * scale),
            },
          },
        ];

  const output = await manipulateAsync(uri, actions, {
    compress: config.jpegQuality,
    format: SaveFormat.JPEG,
  });

  return { uri: output.uri, width: output.width, height: output.height };
}

/**
 * Re-encodes an already-normalised image as base64, for a vision parse.
 *
 * A separate function rather than an option on `normaliseImage`, because the
 * base64 string is about a third larger than the file and is held in memory
 * for the whole request. Every capture normalises; almost none need this, and
 * a multi-page receipt would otherwise carry megabytes of string it never
 * sends.
 */
export async function encodeImageBase64(uri: string): Promise<string> {
  const output = await manipulateAsync(uri, [], {
    // Already downscaled and compressed by normaliseImage — re-compressing
    // would soften exactly the small print this exists to read.
    compress: 1,
    format: SaveFormat.JPEG,
    base64: true,
  });

  if (!output.base64) throw new Error('The image could not be encoded for sending.');
  return output.base64;
}
