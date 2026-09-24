// A cube face is the Credit's own 12×12 raster window: SVG units 40–280, the
// area the contract reserves so four 8×8 plates fit "even at the maximum
// two-pixel slip". Misprints re-center by half pixels, so faces are kept as a
// 24×24 half-pixel grid. 24 divides by 2, 3, 4, 6 and 12, so sticker edges
// always fall on that grid. The proof bar (one mark per 8 in the transaction
// id) moves from the Credit's outer corner into the face's bottom-right corner.
import { describe, proofBar, PALETTE, CSS, INKS } from './credit.js';
import * as D from './data.js';

export const GRID = 24;          // half pixels per face side
export const WINDOW = 40;        // SVG unit where the face window starts
const PAPER = 0;                 // code 0 = paper white, 1–15 = ink masks

const cache = new Map();

/** describe() for a Credit id from the local dataset (null if unknown). */
export function credit(id, plateMask) {
  const key = id + ':' + (plateMask ?? '');
  if (cache.has(key)) return cache.get(key);
  const seed = D.seedOf(id), paidAt = D.paidAtOf(id);
  if (!seed) return null;
  const c = describe(seed, paidAt, plateMask);
  c.id = id;
  if (cache.size > 600) cache.clear();
  cache.set(key, c);
  return c;
}

/** 24×24 codes (0 paper, 1–15 ink masks; a black ground reads as K = 8). */
export function faceGrid(c, visible = 15) {
  const g = new Uint8Array(GRID * GRID);
  const ground = c.eights >= 5 ? 8 : PAPER;
  g.fill(ground);
  const fill = (x0, y0, w, h, code) => {
    // x0, y0, w, h in SVG units; the window starts at 40 and one cell is 10 units
    const gx = (x0 - WINDOW) / 10, gy = (y0 - WINDOW) / 10;
    for (let y = Math.max(0, gy); y < Math.min(GRID, gy + h / 10); y++)
      for (let x = Math.max(0, gx); x < Math.min(GRID, gx + w / 10); x++) g[y * GRID + x] = code;
  };
  fill(c.ox, c.oy, 160, 160, PAPER);
  for (let y = -c.pad; y < 8 + c.pad; y++) for (let x = -c.pad; x < 8 + c.pad; x++) {
    const m = c.pixels[(y + 2) * 12 + x + 2] & visible;
    if (m) fill(c.ox + x * 20, c.oy + y * 20, 20, 20, m);
  }
  for (const p of proofBar(c.eights)) fill(p.x - 40, p.y - 40, 20, 20, maskOf(p.color));
  return g;
}
const maskOf = color => PALETTE.indexOf(color);

/** Fill a rectangle on whole device pixels, so neighbouring cells never leave a hairline between them. */
function snapRect(ctx, x0, y0, x1, y1) {
  const l = Math.round(x0), t = Math.round(y0);
  ctx.fillRect(l, t, Math.round(x1) - l, Math.round(y1) - t);
}

/** Paint a grid into a square canvas region. */
export function paintGrid(ctx, g, x, y, size) {
  const cell = size / GRID;
  ctx.fillStyle = CSS[0];
  snapRect(ctx, x, y, x + size, y + size);
  for (let gy = 0; gy < GRID; gy++) {
    let code = -1, start = 0;
    const flush = end => {
      if (code <= 0) return;
      ctx.fillStyle = CSS[code];
      snapRect(ctx, x + start * cell, y + gy * cell, x + end * cell, y + (gy + 1) * cell);
    };
    for (let gx = 0; gx <= GRID; gx++) {
      const k = gx < GRID ? g[gy * GRID + gx] : -2;
      if (k !== code) { flush(gx); code = k; start = gx; }
    }
  }
}

/** The full Credit exactly as the SVG draws it (320 units into `size` px). */
export function paintCredit(ctx, c, x, y, size, visible = 15) {
  const u = size / 320;
  ctx.fillStyle = c.eights >= 5 ? '#111111' : '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + c.ox * u, y + c.oy * u, 160 * u, 160 * u);
  for (let yy = -c.pad; yy < 8 + c.pad; yy++) for (let xx = -c.pad; xx < 8 + c.pad; xx++) {
    const m = c.pixels[(yy + 2) * 12 + xx + 2] & visible;
    if (!m) continue;
    ctx.fillStyle = CSS[m];
    const px = c.ox + xx * 20, py = c.oy + yy * 20;
    snapRect(ctx, x + px * u, y + py * u, x + (px + 20) * u, y + (py + 20) * u);
  }
  for (const p of proofBar(c.eights)) { ctx.fillStyle = CSS[maskOf(p.color)]; snapRect(ctx, x + p.x * u, y + p.y * u, x + (p.x + 20) * u, y + (p.y + 20) * u); }
}

/** One plate on its own (for plate chips): the ink of `layer` wherever its bits land. */
export function paintPlate(ctx, c, layer, x, y, size, color) {
  const cell = size / 8;
  ctx.fillStyle = color || CSS[1 << layer];
  for (let i = 0; i < 64; i++) {
    const bit = layer * 64 + i;
    if ((c.hash[bit >> 3] >> (7 - (bit & 7))) & 1) ctx.fillRect(x + (i % 8) * cell, y + ((i / 8) | 0) * cell, cell + 0.3, cell + 0.3);
  }
}

const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));
/**
 * Registration animation: each timed plate lands in C, M, Y, K order with a
 * multiply overprint, then the exact palette takes over at t = 1.
 */
export function paintPrinting(ctx, c, g, x, y, size, t, visible = 15) {
  if (t >= 1) { paintGrid(ctx, g, x, y, size); return; }
  const cell = size / GRID;
  const layers = [0, 1, 2, 3].filter(l => c.mask & visible & (1 << l));
  ctx.save();
  ctx.fillStyle = c.eights >= 5 ? '#111111' : '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + (c.ox - WINDOW) / 10 * cell, y + (c.oy - WINDOW) / 10 * cell, 16 * cell, 16 * cell);
  ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  const span = 1 / (layers.length + 0.6);
  layers.forEach((layer, k) => {
    const p = ease((t - k * span * 0.8) / (span * 1.6));
    if (p <= 0) return;
    const drift = (1 - p) * 3.5 * cell * 2;
    const dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const offX = dirs[layer][0] * drift, offY = dirs[layer][1] * drift;
    ctx.globalAlpha = Math.min(1, p * 1.4);
    ctx.fillStyle = '#' + INKS[layer].toString(16).padStart(6, '0');
    const px0 = 2 + c.dxs[layer], py0 = 2 + c.dys[layer];
    for (let i = 0; i < 64; i++) {
      const bit = layer * 64 + i;
      if (!((c.hash[bit >> 3] >> (7 - (bit & 7))) & 1)) continue;
      const rx = px0 + (i % 8), ry = py0 + ((i / 8) | 0);
      // raster pixel → SVG units: ox + (rx - 2) * 20
      const sx = (c.ox + (rx - 2) * 20 - WINDOW) / 10 * cell, sy = (c.oy + (ry - 2) * 20 - WINDOW) / 10 * cell;
      ctx.fillRect(x + sx + offX, y + sy + offY, cell * 2 + 0.5, cell * 2 + 0.5);
    }
  });
  ctx.restore();
  ctx.save();
  for (const p of proofBar(c.eights)) { ctx.fillStyle = CSS[maskOf(p.color)]; ctx.fillRect(x + (p.x - 80) / 10 * cell, y + (p.y - 80) / 10 * cell, cell * 2, cell * 2); }
  ctx.restore();
}

/**
 * Sticker signatures: the half-pixel block a sticker carries, read after k
 * clockwise quarter turns. Equal strings look identical on the cube, which is
 * how a solve is judged (a blank sticker may sit anywhere, in any rotation).
 */
export function stickerSignature(g, n, row, col, k) {
  const m = GRID / n;
  let s = '';
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    // pixel (x, y) of the turned block comes from (sx, sy) of the original
    let sx, sy;
    if (k === 0) { sx = x; sy = y; }
    else if (k === 1) { sx = y; sy = m - 1 - x; }
    else if (k === 2) { sx = m - 1 - x; sy = m - 1 - y; }
    else { sx = m - 1 - y; sy = x; }
    s += String.fromCharCode(97 + g[(row * m + sy) * GRID + col * m + sx]);
  }
  return s;
}

// ---- the pixel cube (8³): one sticker per pixel of the Credit's 8×8 plates ----
// Plates are taken in register (misprint slips are ignored), exactly as the
// Credits³ contract reads them: cell (x, y) is the OR of every timed plate's bit.
export const PIXELS = 8;

/** 64 ink masks, row-major: cell y * 8 + x. */
export function pixelGrid(c, visible = 15) {
  const out = new Uint8Array(64);
  for (let layer = 0; layer < 4; layer++) {
    if (!(c.mask & visible & (1 << layer))) continue;
    for (let i = 0; i < 64; i++) {
      const bit = layer * 64 + i;
      if ((c.hash[bit >> 3] >> (7 - (bit & 7))) & 1) out[i] |= 1 << layer;
    }
  }
  return out;
}

/** Paint 64 masks as an 8×8 grid filling the square. */
export function paintPixels(ctx, cells, x, y, size) {
  const cell = size / PIXELS;
  ctx.fillStyle = CSS[0];
  snapRect(ctx, x, y, x + size, y + size);
  for (let i = 0; i < 64; i++) {
    if (!cells[i]) continue;
    ctx.fillStyle = CSS[cells[i]];
    const cx = i % 8, cy = (i / 8) | 0;
    snapRect(ctx, x + cx * cell, y + cy * cell, x + (cx + 1) * cell, y + (cy + 1) * cell);
  }
}

/** A new Credit as its own print: white field, the 8×8 grid on the centre half, like the originals. */
export function paintNewCredit(ctx, cells, x, y, size) {
  ctx.fillStyle = '#ffffff';
  snapRect(ctx, x, y, x + size, y + size);
  paintPixels(ctx, cells, x + size / 4, y + size / 4, size / 2);
}
