import { CAPTURE_IMAGE_CONFIG, resizeScale } from '@/capture/imageScaling';

describe('resizeScale (§5.2)', () => {
  it('leaves an image already within budget alone', () => {
    expect(resizeScale(1600, 1200)).toBe(1);
    expect(resizeScale(2000, 1500)).toBe(1);
  });

  it('scales by the long edge, whichever way the image is oriented', () => {
    // A 12 MP phone frame, portrait and landscape — same factor either way.
    expect(resizeScale(3024, 4032)).toBeCloseTo(2000 / 4032, 10);
    expect(resizeScale(4032, 3024)).toBeCloseTo(2000 / 4032, 10);
  });

  it('brings the long edge to exactly the cap', () => {
    const scale = resizeScale(4032, 3024);
    expect(Math.round(4032 * scale)).toBe(CAPTURE_IMAGE_CONFIG.maxLongEdge);
  });

  it('preserves aspect ratio — the geometry in §5.3/§5.4 depends on it', () => {
    const scale = resizeScale(3000, 1000);
    expect((3000 * scale) / (1000 * scale)).toBeCloseTo(3, 10);
  });

  it('honours a custom cap', () => {
    expect(resizeScale(4000, 2000, 1000)).toBeCloseTo(0.25, 10);
  });
});
