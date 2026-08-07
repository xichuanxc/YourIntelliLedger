/**
 * Pins the TypeScript port to the algorithm it was ported from.
 *
 * §5.4 calls line reconstruction "a port of the validated Python logic", and
 * §5.7's ~96.3% accuracy figure was measured with that logic in place — so a
 * silent behavioural drift here would invalidate a number the project is
 * relying on. This runs the reference implementation from
 * `../PyPrototype/ocr_prototype.py` (reproduced below, since the prototype
 * imports `ocrmac` at module scope and cannot be imported without it) against
 * the port on generated inputs.
 *
 * Skipped when `python3` is unavailable, so it never blocks a machine or CI
 * image without it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { reconstructLines } from '@/capture/lineReconstruction';
import type { OcrElement } from '@/capture/types';

const PYTHON = `
import json, statistics, sys
LINE_GAP_FACTOR = 0.6
COLUMN_GAP_FACTOR = 2.5

def reconstruct_lines(annotations):
    elems = [{"x": x, "y": y, "w": w, "h": h, "text": text}
             for text, _c, (x, y, w, h) in annotations if text.strip()]
    if not elems:
        return ""
    median_h = statistics.median(e["h"] for e in elems)
    elems.sort(key=lambda e: -e["y"])
    lines = []
    for e in elems:
        if lines and abs(lines[-1][0]["y"] - e["y"]) <= LINE_GAP_FACTOR * median_h:
            lines[-1].append(e)
        else:
            lines.append([e])
    out = []
    for line in lines:
        line.sort(key=lambda e: e["x"])
        avg = statistics.mean(e["w"] / max(len(e["text"]), 1) for e in line)
        parts = [line[0]["text"]]
        for prev, cur in zip(line, line[1:]):
            gap = cur["x"] - (prev["x"] + prev["w"])
            parts.append("    " if gap > COLUMN_GAP_FACTOR * avg else " ")
            parts.append(cur["text"])
        out.append("".join(parts))
    return "\\n".join(out)

cases = json.load(open(sys.argv[1]))
json.dump([reconstruct_lines(c) for c in cases], open(sys.argv[2], "w"))
`;

/** Vision box: [text, confidence, [x, yBottom, w, h]] in normalised coords. */
type VisionBox = [string, number, [number, number, number, number]];

/** Vision (bottom-left origin) → ML Kit convention (top-left, y downward). */
function toElement([text, , [x, y, w, h]]: VisionBox): OcrElement {
  return { text, x, width: w, height: h, yCenter: 1 - y - h / 2 };
}

function randomCase(rng: () => number, uniformHeight: boolean): VisionBox[] {
  const boxes: VisionBox[] = [];
  const rows = 3 + Math.floor(rng() * 6);
  const h = 0.02;

  for (let row = 0; row < rows; row += 1) {
    const y = 0.9 - row * 0.05 + (rng() - 0.5) * 0.004;
    const height = uniformHeight ? h : h * (0.7 + rng() * 0.8);
    let x = 0.05;
    const words = 1 + Math.floor(rng() * 4);
    for (let word = 0; word < words; word += 1) {
      const text = 'w'.repeat(1 + Math.floor(rng() * 8));
      const width = text.length * 0.012;
      boxes.push([text, 1, [x, y, width, height]]);
      x += width + (rng() < 0.3 ? 0.15 : 0.02); // sometimes a column gap
    }
  }
  return boxes.sort(() => rng() - 0.5); // shuffle: OCR order is not reading order
}

function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function runPython(cases: VisionBox[][]): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
  const script = path.join(dir, 'p.py');
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.json');
  fs.writeFileSync(script, PYTHON);
  fs.writeFileSync(input, JSON.stringify(cases));
  execFileSync('python3', [script, input, output]);
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeWithPython = hasPython() ? describe : describe.skip;

describeWithPython('parity with the prototype (§5.4)', () => {
  it('matches exactly when element heights are uniform', () => {
    const rng = makeRng(42);
    const cases = Array.from({ length: 200 }, () => randomCase(rng, true));
    const expected = runPython(cases);

    cases.forEach((boxes, index) => {
      expect(reconstructLines(boxes.map(toElement))).toBe(expected[index]);
    });
  });

  it('agrees on mixed heights too, despite anchoring on the centre', () => {
    // The port anchors a line on its first element's vertical *centre*, which
    // is what §5.4 specifies; the Python anchors on the bottom edge, because
    // Vision's origin is bottom-left. The two could in principle disagree when
    // heights vary within a row. Measured: they do not, across 200 generated
    // receipts with heights varying 0.7x–1.5x.
    const rng = makeRng(7);
    const cases = Array.from({ length: 200 }, () => randomCase(rng, false));
    const expected = runPython(cases);

    const divergent = cases.filter(
      (boxes, index) => reconstructLines(boxes.map(toElement)) !== expected[index]
    );
    expect(divergent).toHaveLength(0);
  });
});
