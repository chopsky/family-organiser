/**
 * QrCode - renders a string as a scannable SVG QR code.
 *
 * SVG rather than canvas so it stays crisp at any size, prints cleanly and
 * needs no ref/effect dance. The matrix comes from @paulmillr/qr (zero
 * dependencies, ~4KB) and is collapsed into a single <path>: one subpath per
 * run of dark modules in a row, which keeps a 33x33 code to a few hundred
 * bytes instead of ~500 <rect> nodes.
 *
 * Encoding failures (over-long value, unsupported charset) return null rather
 * than throwing - a QR is always an alternative route to something, never the
 * only one, so a missing code must degrade to the surrounding UI silently.
 */
import { useMemo } from 'react';
import { encodeQR } from '@paulmillr/qr';

// The spec's 4-module quiet zone. Scanners need it; without it a code sitting
// flush against a coloured panel often won't acquire.
const QUIET = 4;

// Deliberately a literal, not a CSS variable. Contrast here is functional -
// the code has to scan under a phone camera - so it must not follow a theme.
const DARK = '#2D2A33';

export default function QrCode({ value, size = 176, label = 'QR code', className = '' }) {
  const code = useMemo(() => {
    if (!value) return null;
    try {
      // 'medium' ECC (~15% recovery) is the usual screen-scanning trade-off:
      // enough tolerance for glare and camera angle without inflating the
      // module count, which is what actually makes a code hard to scan.
      const cells = encodeQR(value, 'raw', { ecc: 'medium', border: 0 });
      const n = cells.length;
      let d = '';
      for (let y = 0; y < n; y++) {
        let x = 0;
        while (x < n) {
          if (!cells[y][x]) { x += 1; continue; }
          let run = 1;
          while (x + run < n && cells[y][x + run]) run += 1;
          d += `M${x} ${y}h${run}v1h-${run}z`;
          x += run;
        }
      }
      return { d, n };
    } catch {
      return null;
    }
  }, [value]);

  if (!code) return null;

  const span = code.n + QUIET * 2;
  return (
    <svg
      viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      // Without this the browser antialiases module edges and a small code
      // can lose its sharp black/white boundaries.
      shapeRendering="crispEdges"
      className={className}
    >
      <rect x={-QUIET} y={-QUIET} width={span} height={span} fill="#FFFFFF" />
      <path d={code.d} fill={DARK} />
    </svg>
  );
}
