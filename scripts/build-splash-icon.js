#!/usr/bin/env node
/**
 * Derives `assets/images/splash-icon.png` from `assets/images/icon.png`.
 *
 * The launch screen and the native splash must show the *same* mark, or the
 * handoff between them pops: the native splash is a static PNG the OS draws
 * before any JavaScript exists, and the JS launch screen replaces it mid-fade.
 * A square asset behind a rounded one is visible as a flicker at the corners.
 *
 * So the corners are masked here, once, into a committed asset, rather than
 * with a `borderRadius` the native side has no way to apply.
 *
 * The radius is 22.37% of the side — the proportion iOS uses for its squircle
 * and close to Android's adaptive-icon mask, so the launch screen reads as a
 * continuation of the icon the user just tapped.
 *
 * The output is committed. Run this only when `icon.png` changes.
 */

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets/images/icon.png');
const OUTPUT = path.join(ROOT, 'assets/images/splash-icon.png');

const SIZE = 1024;
const RADIUS = Math.round(SIZE * 0.2237);

function main() {
  if (!existsSync(SOURCE)) {
    console.error(`Missing source icon: ${SOURCE}`);
    process.exit(1);
  }

  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error(
      'ImageMagick is not installed (brew install imagemagick).\n' +
        'The generated asset is committed, so this is only needed to regenerate it.'
    );
    process.exit(1);
  }

  execFileSync('magick', [
    SOURCE,
    '-resize',
    `${SIZE}x${SIZE}`,
    // A transparent canvas with the rounded rectangle drawn opaque, used as
    // the alpha channel of the artwork.
    '(',
    '-size',
    `${SIZE}x${SIZE}`,
    'xc:none',
    '-draw',
    `roundrectangle 0,0,${SIZE - 1},${SIZE - 1},${RADIUS},${RADIUS}`,
    ')',
    '-alpha',
    'set',
    '-compose',
    'DstIn',
    '-composite',
    OUTPUT,
  ]);

  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${SIZE}px, ${RADIUS}px corners)`);
}

main();
