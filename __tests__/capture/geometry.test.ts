import {
  blockAngle,
  correctSkew,
  deskewElements,
  estimateRotation,
  MAX_CORRECTION_RADIANS,
  rotatePoint,
} from '@/capture/geometry';
import { reconstructLines } from '@/capture/lineReconstruction';
import type { OcrBlock, OcrElement } from '@/capture/types';

const degrees = (value: number) => (value * Math.PI) / 180;

/** A block whose top edge is tilted by `deg`, clockwise-positive (y downward). */
function tiltedBlock(deg: number, width = 100): OcrBlock {
  const radians = degrees(deg);
  const dx = width * Math.cos(radians);
  const dy = width * Math.sin(radians);
  return {
    cornerPoints: [
      { x: 0, y: 0 },
      { x: dx, y: dy },
      { x: dx, y: dy + 20 },
      { x: 0, y: 20 },
    ],
  };
}

const el = (text: string, x: number, yCenter: number, width = text.length * 10): OcrElement => ({
  text,
  x,
  yCenter,
  width,
  height: 20,
});

describe('blockAngle', () => {
  it('is zero for a level block', () => {
    expect(blockAngle(tiltedBlock(0).cornerPoints)).toBeCloseTo(0, 6);
  });

  it('is positive when the block tilts down to the right', () => {
    expect(blockAngle(tiltedBlock(5).cornerPoints)).toBeCloseTo(degrees(5), 6);
  });

  it('is negative when it tilts up to the right', () => {
    expect(blockAngle(tiltedBlock(-5).cornerPoints)).toBeCloseTo(degrees(-5), 6);
  });
});

describe('estimateRotation', () => {
  it('takes the median across blocks', () => {
    const blocks = [tiltedBlock(3), tiltedBlock(4), tiltedBlock(5)];
    expect(estimateRotation(blocks)).toBeCloseTo(degrees(4), 6);
  });

  it('is not dragged by a single misdetected block', () => {
    // A logo or barcode edge read as text at 25 degrees, among level lines.
    const blocks = [tiltedBlock(3), tiltedBlock(3), tiltedBlock(25), tiltedBlock(3)];
    // A mean would land near 8.5 degrees; the median ignores the outlier.
    expect(estimateRotation(blocks)).toBeCloseTo(degrees(3), 6);
  });

  it('ignores skew too small to be worth correcting', () => {
    expect(estimateRotation([tiltedBlock(0.2), tiltedBlock(0.3)])).toBe(0);
  });

  it('refuses an angle too large to be skew', () => {
    // A sideways photo or a misdetection; rotating by a wrong large angle is
    // worse than leaving the boxes alone.
    expect(estimateRotation([tiltedBlock(45), tiltedBlock(45)])).toBe(0);
    expect(Math.abs(estimateRotation([tiltedBlock(29), tiltedBlock(29)]))).toBeLessThanOrEqual(
      MAX_CORRECTION_RADIANS
    );
  });

  it('returns zero with no blocks', () => {
    expect(estimateRotation([])).toBe(0);
  });
});

describe('rotatePoint', () => {
  it('leaves the origin where it is', () => {
    const origin = { x: 50, y: 50 };
    expect(rotatePoint(origin, degrees(30), origin)).toEqual(origin);
  });

  it('rotates a quarter turn clockwise', () => {
    const result = rotatePoint({ x: 10, y: 0 }, degrees(90), { x: 0, y: 0 });
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(10, 6);
  });

  it('round-trips', () => {
    const origin = { x: 5, y: 7 };
    const there = rotatePoint({ x: 30, y: 40 }, degrees(12), origin);
    const back = rotatePoint(there, degrees(-12), origin);
    expect(back.x).toBeCloseTo(30, 6);
    expect(back.y).toBeCloseTo(40, 6);
  });
});

describe('deskewElements', () => {
  it('does nothing at zero', () => {
    const elements = [el('A', 0, 100)];
    expect(deskewElements(elements, 0, { x: 0, y: 0 })).toEqual(elements);
  });

  it('preserves width and height — only the box moves', () => {
    const [result] = deskewElements([el('MILK', 10, 100)], degrees(5), { x: 0, y: 0 });
    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
    expect(result.text).toBe('MILK');
  });
});

describe('correctSkew end to end', () => {
  /**
   * The point of the whole module: on a tilted page, elements from one printed
   * row arrive with different `yCenter`s, and §5.4 groups on `yCenter`. Enough
   * tilt and a row splits into several lines, which is what breaks the
   * name-to-price association.
   */
  it('rejoins a printed row that tilt had split apart', () => {
    const angle = degrees(6);
    const page = { width: 600, height: 800 };
    const centre = { x: 300, y: 400 };

    // One printed row: a name on the left, its price on the right.
    const flat = [el('MILK', 100, 400), el('$6.39', 400, 400)];

    // Photograph it 6 degrees off level: each box rotates about the centre.
    const tilted = flat.map((element) => {
      const cx = element.x + element.width / 2;
      const dx = cx - centre.x;
      const dy = element.yCenter - centre.y;
      const rx = centre.x + dx * Math.cos(angle) - dy * Math.sin(angle);
      const ry = centre.y + dx * Math.sin(angle) + dy * Math.cos(angle);
      return { ...element, x: rx - element.width / 2, yCenter: ry };
    });

    // Tilted, the row no longer reads as one line.
    expect(reconstructLines(tilted).split('\n')).toHaveLength(2);

    const blocks: OcrBlock[] = [tiltedBlock(6), tiltedBlock(6), tiltedBlock(6)];
    const { elements, angleRadians } = correctSkew(tilted, blocks, page);

    expect(angleRadians).toBeCloseTo(angle, 6);
    // Straightened, it is one line again, with the column gap intact.
    const lines = reconstructLines(elements).split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('MILK');
    expect(lines[0]).toContain('$6.39');
  });

  it('leaves a level page untouched', () => {
    const flat = [el('MILK', 100, 400), el('$6.39', 400, 400)];
    const { elements, angleRadians } = correctSkew(flat, [tiltedBlock(0)], {
      width: 600,
      height: 800,
    });

    expect(angleRadians).toBe(0);
    expect(elements).toEqual(flat);
  });
});
