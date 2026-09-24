// Credits renderer, ported line for line from the verified onchain source
// (CreditDrawing.sol + CreditArt.sol, contract 0x97630aa7…3043, art 0xfbe816b8…1985).
// Everything is derived from two onchain values per token: the 21-character
// X Money transaction id (seed) and the payment time (paidAt, unix seconds).

export const INKS = [0x00b5e2, 0xe4007c, 0xffd100, 0x111111]; // C M Y K
export const LETTERS = 'CMYK';

// Premultiplied overprint: every mask of plates gets its own colour.
export const PALETTE = (() => {
  const out = new Array(16);
  for (let mask = 0; mask < 16; mask++) {
    let r = 255, g = 255, b = 255;
    for (let layer = 0; layer < 4; layer++) {
      if (!(mask & (1 << layer))) continue;
      const ink = INKS[layer];
      r = Math.floor((r * ((ink >> 16) & 255) + 127) / 255);
      g = Math.floor((g * ((ink >> 8) & 255) + 127) / 255);
      b = Math.floor((b * (ink & 255) + 127) / 255);
    }
    out[mask] = (r << 16) | (g << 8) | b;
  }
  return out;
})();

export const hex = c => '#' + c.toString(16).padStart(6, '0');
export const CSS = PALETTE.map(hex);

// ---- SHA-256 (synchronous, so a whole Statement can render in one frame) ----
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);

export function sha256(bytes) {
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[len] = 0x80;
  const bits = len * 8;
  m[total - 4] = bits >>> 24; m[total - 3] = bits >>> 16; m[total - 2] = bits >>> 8; m[total - 1] = bits;
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = (m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => {
    out[i * 4] = v >>> 24; out[i * 4 + 1] = v >>> 16; out[i * 4 + 2] = v >>> 8; out[i * 4 + 3] = v;
  });
  return out;
}

const ascii = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
const MISPRINT = ascii('/misprint');
export const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

// ---- CreditDrawing ----
export const platesAt = paidAt => {
  const mask = (paidAt % 15) + 1;
  return [0, 1, 2, 3].map(i => (mask & (1 << i)) !== 0);
};
export const maskAt = paidAt => (paidAt % 15) + 1;
export const eightsOf = seed => { let n = 0; for (const c of seed) if (c === '8') n++; return n; };

export function slips(seed) {
  const dxs = [0, 0, 0, 0], dys = [0, 0, 0, 0];
  const s = ascii(seed);
  const pre = new Uint8Array(s.length + MISPRINT.length);
  pre.set(s); pre.set(MISPRINT, s.length);
  const h = sha256(pre);
  if (h[0] >= 32) return { dxs, dys, h };
  const dice = h[1];
  let maxStep = 1, movers = 1, kMoves = false;
  if (dice < 80) movers = 1;
  else if (dice < 160) movers = 2;
  else if (dice < 210) movers = 3;
  else if (dice < 240) { maxStep = 2; movers = 2 + (h[2] % 2); }
  else { maxStep = 2; movers = 3 + (h[2] % 2); kMoves = true; }
  const pool = kMoves ? [0, 1, 2, 3] : [0, 1, 2];
  let cursor = 3;
  const selected = [];
  while (selected.length < movers && pool.length > 0) {
    const idx = h[cursor++ % 32] % pool.length;
    selected.push(pool.splice(idx, 1)[0]);
  }
  const UX = [-1, 1, 0, 0, -1, -1, 1, 1], UY = [0, 0, -1, 1, -1, 1, -1, 1];
  for (const layer of selected) {
    const b = h[(layer + cursor) % 32];
    const c = h[(layer + cursor + 4) % 32];
    let dx, dy;
    if (maxStep === 1) { const d = b % 8; dx = UX[d]; dy = UY[d]; }
    else {
      dx = (b % 5) - 2; dy = (c % 5) - 2;
      if (dx === 0 && dy === 0) dx = (b & 1) ? 2 : -2;
    }
    dxs[layer] = dx; dys[layer] = dy;
  }
  return { dxs, dys, h };
}

// Four 8×8 plates in a 12×12 raster; each byte is the OR of the plates inked there.
export function raster(hash, dx, dy, enabled) {
  const px = new Uint8Array(144);
  for (let layer = 0; layer < 4; layer++) {
    if (!enabled[layer]) continue;
    const ox = 2 + dx[layer], oy = 2 + dy[layer];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const bit = layer * 64 + y * 8 + x;
      if ((hash[bit >> 3] >> (7 - (bit & 7))) & 1) px[(y + oy) * 12 + x + ox] |= 1 << layer;
    }
  }
  return px;
}

export function center(hash, dx, dy) {
  const px = raster(hash, dx, dy, [true, true, true, true]);
  let minX = 12, minY = 12, maxX = 0, maxY = 0;
  for (let i = 0; i < 144; i++) {
    if (!px[i]) continue;
    const x = i % 12, y = (i / 12) | 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + 1 > maxX) maxX = x + 1;
    if (y + 1 > maxY) maxY = y + 1;
  }
  if (minX >= 12) return [80, 80];
  return [80 + (12 - minX - maxX) * 10, 80 + (12 - minY - maxY) * 10];
}

const REGISTER = ['Registered', 'Nudge', 'Slip', 'Skew', 'Drift', 'Loose'];
const registerOf = h => {
  if (h[0] >= 32) return 0;
  const d = h[1];
  return d < 80 ? 1 : d < 160 ? 2 : d < 210 ? 3 : d < 240 ? 4 : 5;
};
const WEIGHTS = ['even', 'lean', 'sparse', 'extreme'];
const weightOf = (marks, cap) => {
  const m = marks * 256;
  if (m >= 120 * cap && m <= 136 * cap) return 0;
  if (m >= 112 * cap && m <= 144 * cap) return 1;
  if (m >= 96 * cap && m <= 160 * cap) return 2;
  return 3;
};
const TIERS = ['Common', 'Uncommon', 'Rare', 'Ultra', 'Hyper'];
const EIGHT_WORDS = ['None', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty', 'Twenty-one'];

/** Everything needed to draw and describe one Credit. `plateMask` overrides the timed plates. */
export function describe(seed, paidAt, plateMask) {
  const hash = sha256(ascii(seed));
  const { dxs, dys, h } = slips(seed);
  const mask = plateMask ?? maskAt(paidAt);
  const enabled = [0, 1, 2, 3].map(i => (mask & (1 << i)) !== 0);
  let pad = 0;
  for (let i = 0; i < 4; i++) pad = Math.max(pad, Math.abs(dxs[i]), Math.abs(dys[i]));
  const [ox, oy] = pad ? center(hash, dxs, dys) : [80, 80];
  const pixels = raster(hash, dxs, dys, enabled);
  const eights = eightsOf(seed);
  const timed = maskAt(paidAt);
  let marks = 0, plates = 0, colors = '';
  for (let layer = 0; layer < 4; layer++) {
    if (!(timed & (1 << layer))) continue;
    plates++; colors += LETTERS[layer];
    for (let bit = 0; bit < 64; bit++) {
      const i = layer * 64 + bit;
      marks += (hash[i >> 3] >> (7 - (i & 7))) & 1;
    }
  }
  const capacity = plates * 64;
  const reg = registerOf(h);
  const sec = paidAt % 86400;
  const two = n => String(n).padStart(2, '0');
  return {
    seed, paidAt, hash, dxs, dys, pad, ox, oy, pixels, mask, eights,
    ground: eights >= 5 ? 0x111111 : 0xffffff,
    marks, capacity, plates, colors,
    weight: WEIGHTS[weightOf(marks, capacity)], weightIndex: weightOf(marks, capacity),
    register: REGISTER[reg], registerIndex: reg,
    tier: TIERS[Math.min(4, eights)],
    eightsLabel: EIGHT_WORDS[eights],
    time: `${two((sec / 3600) | 0)}:${two(((sec / 60) | 0) % 60)}:${two(sec % 60)} UTC`,
  };
}

/** Proof bar: one mark per 8 in the transaction id (max four), trailing CMYK, bottom right. */
export function proofBar(eights) {
  const n = Math.min(4, eights);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: (16 - n + i) * 20, y: 300, color: PALETTE[1 << (4 - n + i)] });
  return out;
}

const d3 = n => String(n).padStart(3, '0');
/** Byte-identical to CreditArt.svg(seed, paidAt): used to prove the port. */
export function svg(seed, paidAt) {
  const c = describe(seed, paidAt);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" shape-rendering="crispEdges">';
  s += `<rect width="320" height="320" fill="${c.eights >= 5 ? '#111111' : '#ffffff'}"/>`;
  s += `<rect x="${d3(c.ox)}" y="${d3(c.oy)}" width="160" height="160" fill="#ffffff"/>`;
  for (let y = -c.pad; y < 8 + c.pad; y++) for (let x = -c.pad; x < 8 + c.pad; x++) {
    const m = c.pixels[(y + 2) * 12 + x + 2];
    if (!m) continue;
    s += `<rect x="${d3(c.ox + x * 20)}" y="${d3(c.oy + y * 20)}" width="020" height="020" fill="${CSS[m]}"/>`;
  }
  for (const p of proofBar(c.eights)) s += `<rect x="${d3(p.x)}" y="${d3(p.y)}" width="020" height="020" fill="${hex(p.color)}"/>`;
  return s + '</svg>';
}
