// The two construction panels as 2400 × 3000 prints (the size jack.art exports at):
// the project statement, and the process that turns one Credit into a side of the cube.
import { faceGrid, paintGrid, paintPlate } from './face.js';
import { LETTERS, toHex } from './credit.js';

const W = 2400, H = 3000;
const INK = '#111111', MUTED = '#8e8e8e', RULE = '#e3e3e3', OFF = '#cdcdcd', ARROW = '#bbbbbb';
const font = (w, s) => `${w} ${s}px "Geist Mono", "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`;

async function fonts() {
  try {
    await Promise.all([400, 500, 700].map(w => document.fonts.load(font(w, 40), 'CREDITS 0123456789')));
    await document.fonts.ready;
  } catch {}
}

function sheet() {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  return { cv, ctx };
}

function text(ctx, s, x, y, { w = 400, size = 36, color = INK, align = 'left', spacing = 0.02, upper = true } = {}) {
  ctx.font = font(w, size);
  if ('letterSpacing' in ctx) ctx.letterSpacing = (size * spacing).toFixed(2) + 'px';
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(upper ? String(s).toUpperCase() : String(s), x, y);
}

/** Runs of text in several weights on one line, centred on x. `parts`: [[string, weight, color]]. */
function mixed(ctx, parts, x, y, size) {
  const widths = parts.map(([s, w]) => { ctx.font = font(w, size); if ('letterSpacing' in ctx) ctx.letterSpacing = (size * 0.06).toFixed(2) + 'px'; return ctx.measureText(s).width; });
  let cx = x - widths.reduce((a, b) => a + b, 0) / 2;
  parts.forEach(([s, w, color], i) => {
    ctx.font = font(w, size);
    if ('letterSpacing' in ctx) ctx.letterSpacing = (size * 0.06).toFixed(2) + 'px';
    ctx.fillStyle = color; ctx.textAlign = 'left';
    ctx.fillText(s, cx, y);
    cx += widths[i];
  });
}

function box(ctx, x, y, w, h) {
  ctx.strokeStyle = RULE; ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

function arrow(ctx, x, y) { text(ctx, '↓', x, y, { size: 40, color: ARROW, align: 'center', spacing: 0 }); }

/** Left panel: the statement, one line per sentence, first and last in bold. */
export async function projectPoster(lines) {
  await fonts();
  const { cv, ctx } = sheet();
  const size = 36, pitch = 168;
  const top = H / 2 - ((lines.length - 1) * pitch) / 2;
  lines.forEach((line, i) => {
    const bold = i === 0 || i === lines.length - 1;
    text(ctx, line, 200, top + i * pitch, { w: bold ? 700 : 400, size });
  });
  return cv;
}

/** Right panel: Credit → transaction id → SHA-256 → four plates → 12 × 12 raster → the cut. */
export async function processPoster(c, n, { cutColor = INK } = {}) {
  if (c.eights >= 5 && cutColor === INK) cutColor = '#ffffff'; // on the black ground a black cut would vanish
  await fonts();
  const { cv, ctx } = sheet();
  const L = 300, R = 2100, CW = R - L, CX = W / 2;

  // Credit
  let y = 250;
  box(ctx, L, y, CW, 130);
  text(ctx, `Credit #${c.id} · ${c.time}`, CX, y + 65, { size: 40, align: 'center' });
  arrow(ctx, CX, y + 180);

  // transaction id, with every 8 in bold
  y = 480;
  box(ctx, L, y, CW, 200);
  text(ctx, 'X Money transaction ID', CX, y + 66, { size: 36, color: MUTED, align: 'center' });
  const parts = [];
  for (const ch of c.seed) {
    const w = ch === '8' ? 700 : 400;
    if (parts.length && parts[parts.length - 1][1] === w) parts[parts.length - 1][0] += ch;
    else parts.push([ch, w, INK]);
  }
  mixed(ctx, parts, CX, y + 134, 42);
  arrow(ctx, CX, y + 250);

  // SHA-256, one line of hex per plate; plates the payment time leaves out are greyed
  y = 780;
  box(ctx, L, y, CW, 380);
  text(ctx, 'SHA-256 · 256 bits', CX, y + 66, { size: 36, color: MUTED, align: 'center' });
  const hx = toHex(c.hash);
  for (let l = 0; l < 4; l++) {
    const on = c.mask & (1 << l);
    const yy = y + 146 + l * 58;
    text(ctx, LETTERS[l], CX - 250, yy, { size: 36, color: on ? INK : OFF, align: 'left' });
    text(ctx, hx.slice(l * 16, l * 16 + 16), CX - 190, yy, { size: 36, color: on ? INK : OFF, align: 'left', spacing: 0.01, upper: false });
  }
  arrow(ctx, CX, y + 430);

  // the four plates
  y = 1260;
  const cell = CW / 4;
  for (let l = 0; l < 4; l++) {
    const x = L + l * cell, on = c.mask & (1 << l);
    box(ctx, x, y, cell + (l < 3 ? 3 : 0), cell);
    text(ctx, LETTERS[l], x + 30, y + 44, { size: 30, color: on ? INK : MUTED });
    const s = cell * 0.46;
    ctx.save();
    if (!on) ctx.globalAlpha = 0.16;
    paintPlate(ctx, c, l, x + (cell - s) / 2, y + (cell - s) / 2, s, on ? null : '#8e8e8e');
    ctx.restore();
  }
  arrow(ctx, CX, y + cell + 60);

  // raster → cut
  y = 1880;
  const sq = 760, gap = CW - sq * 2;
  const g = faceGrid(c);
  paintGrid(ctx, g, L, y, sq);
  box(ctx, L, y, sq, sq);
  const cx2 = R - sq;
  paintGrid(ctx, g, cx2, y, sq);
  ctx.fillStyle = cutColor;
  for (let i = 1; i < n; i++) {
    const p = Math.round((i * sq) / n);
    ctx.fillRect(cx2 + p - 6, y, 12, sq);
    ctx.fillRect(cx2, y + p - 6, sq, 12);
  }
  box(ctx, cx2, y, sq, sq);
  text(ctx, '→', CX, y + sq / 2, { size: 40, color: ARROW, align: 'center', spacing: 0 });
  void gap;
  text(ctx, '12 × 12 raster', L + sq / 2, y + sq + 70, { size: 30, color: MUTED, align: 'center' });
  text(ctx, `Cut ${n} × ${n}`, cx2 + sq / 2, y + sq + 70, { size: 30, color: MUTED, align: 'center' });

  text(ctx, `${n * n} stickers a side · ${6 * n * n} in all`, CX, 2860, { size: 30, color: MUTED, align: 'center' });
  return cv;
}
