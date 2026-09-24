// The puzzle itself: an N×N×N picture cube with no idea how it is drawn.
// Coordinates are doubled so every cubie sits on integers: −(N−1) … N−1, step 2.
// A move is { axis: 0|1|2, layers: [k…], turns: 1|2|3 } with quarter turns
// counted right-handed about +axis; layer k counts from the negative side.

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
// Outward normal, image right and image down for each face, as unfolded in a cross net.
export const FACE_DEF = [
  { n: [0, 1, 0], r: [1, 0, 0], d: [0, 0, 1] },   // U
  { n: [1, 0, 0], r: [0, 0, -1], d: [0, -1, 0] }, // R
  { n: [0, 0, 1], r: [1, 0, 0], d: [0, -1, 0] },  // F
  { n: [0, -1, 0], r: [1, 0, 0], d: [0, 0, -1] }, // D
  { n: [-1, 0, 0], r: [0, 0, 1], d: [0, -1, 0] }, // L
  { n: [0, 0, -1], r: [-1, 0, 0], d: [0, -1, 0] },// B
];

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const mul = (a, b) => {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
};
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const transpose = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const neg = v => [-v[0], -v[1], -v[2]];

/** Rotation by `turns` quarter turns (right-handed) about axis 0/1/2. */
export function rotation(axis, turns) {
  let m = I;
  const q = axis === 0 ? [1, 0, 0, 0, 0, -1, 0, 1, 0] : axis === 1 ? [0, 0, 1, 0, 1, 0, -1, 0, 0] : [0, -1, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) m = mul(q, m);
  return m;
}

// All 24 orientations of a cube.
export const ROTATIONS = (() => {
  const seen = new Map([[I.join(), I]]);
  const queue = [I];
  while (queue.length) {
    const m = queue.shift();
    for (const g of [rotation(0, 1), rotation(1, 1)]) {
      const n = mul(g, m);
      if (!seen.has(n.join())) { seen.set(n.join(), n); queue.push(n); }
    }
  }
  return [...seen.values()];
})();

export const faceOfNormal = v => FACE_DEF.findIndex(f => eq(f.n, v));

export class Cube {
  constructor(n) {
    this.n = n;
    this.max = n - 1;
    this.cubies = [];
    this.stickers = [];
    for (let x = -this.max; x <= this.max; x += 2)
      for (let y = -this.max; y <= this.max; y += 2)
        for (let z = -this.max; z <= this.max; z += 2) {
          const p = [x, y, z];
          if (!p.some(c => Math.abs(c) === this.max)) continue;
          const cubie = { index: this.cubies.length, home: p, pos: p.slice(), rot: I.slice(), stickers: [] };
          FACE_DEF.forEach((f, face) => {
            if (p[0] * f.n[0] + p[1] * f.n[1] + p[2] * f.n[2] !== this.max) return;
            const s = { index: this.stickers.length, cubie: cubie.index, face, ...this.place(face, p) };
            this.stickers.push(s);
            cubie.stickers.push(s.index);
          });
          this.cubies.push(cubie);
        }
    this.sig = null;
  }

  /** Row/column of a point on a face (doubled coordinates). */
  place(face, p) {
    const f = FACE_DEF[face];
    const dot = v => p[0] * v[0] + p[1] * v[1] + p[2] * v[2];
    return { col: (dot(f.r) + this.max) / 2, row: (dot(f.d) + this.max) / 2 };
  }

  layerOf(cubie, axis) { return (cubie.pos[axis] + this.max) / 2; }

  move(m) {
    const R = rotation(m.axis, m.turns);
    for (const c of this.cubies) {
      if (!m.layers.includes(this.layerOf(c, m.axis))) continue;
      c.pos = apply(R, c.pos);
      c.rot = mul(R, c.rot);
    }
  }

  reset() { for (const c of this.cubies) { c.pos = c.home.slice(); c.rot = I.slice(); } }

  /** Where a sticker is now: face, row, col and quarter turns clockwise of its image. */
  where(s) {
    const c = this.cubies[s.cubie];
    const home = FACE_DEF[s.face];
    const face = faceOfNormal(apply(c.rot, home.n));
    const { row, col } = this.place(face, c.pos);
    const right = apply(c.rot, home.r), f = FACE_DEF[face];
    const k = eq(right, f.r) ? 0 : eq(right, f.d) ? 1 : eq(right, neg(f.r)) ? 2 : 3;
    return { face, row, col, k };
  }

  slot(face, row, col) { return (face * this.n + row) * this.n + col; }

  /**
   * signatures[s][k]: an id for what sticker s looks like after k clockwise turns.
   * Stickers that look the same share ids, so a solve is judged by eye.
   */
  setSignatures(signatures) {
    this.sig = signatures;
    const total = 6 * this.n * this.n;
    this.targets = ROTATIONS.map(G => {
      const t = new Int32Array(total);
      for (const s of this.stickers) {
        const c = this.cubies[s.cubie], home = FACE_DEF[s.face];
        const face = faceOfNormal(apply(G, home.n));
        const { row, col } = this.place(face, apply(G, c.home));
        const right = apply(G, home.r), f = FACE_DEF[face];
        const k = eq(right, f.r) ? 0 : eq(right, f.d) ? 1 : eq(right, neg(f.r)) ? 2 : 3;
        t[this.slot(face, row, col)] = signatures[s.index][k];
      }
      return t;
    });
  }

  /** How many stickers read correctly under the best whole-cube orientation. */
  score() {
    const total = 6 * this.n * this.n;
    const cur = new Int32Array(total);
    for (const s of this.stickers) {
      const w = this.where(s);
      cur[this.slot(w.face, w.row, w.col)] = this.sig ? this.sig[s.index][w.k] : s.index * 4 + w.k;
    }
    let best = -1, bestG = 0;
    const targets = this.targets || [];
    targets.forEach((t, g) => {
      let hit = 0;
      for (let i = 0; i < total; i++) if (t[i] === cur[i]) hit++;
      if (hit > best) { best = hit; bestG = g; }
    });
    const per = this.n * this.n, sides = [0, 0, 0, 0, 0, 0];
    const t = targets[bestG];
    if (t) for (let i = 0; i < total; i++) if (t[i] === cur[i]) sides[(i / per) | 0]++;
    return { registered: Math.max(0, best), total, orientation: bestG, sides: sides.map(v => v === per), perSide: per };
  }

  solved() { const s = this.score(); return s.registered === s.total; }

  /** A fixed-state snapshot, for undo-free comparisons and debugging. */
  key() { return this.cubies.map(c => c.pos.join(',') + ':' + c.rot.join('')).join('|'); }
}

// ---- move algebra ----
export const invert = m => ({ axis: m.axis, layers: m.layers.slice(), turns: (4 - m.turns) % 4 });

/** Conjugate a move by a whole-cube rotation Q: the same turn seen in Q's frame. */
function conjugate(m, Q, n) {
  if (Q === I) return m;
  const e = [0, 0, 0]; e[m.axis] = 1;
  const v = apply(transpose(Q), e);
  const axis = v.findIndex(x => x !== 0);
  const sign = v[axis];
  return { axis, layers: sign > 0 ? m.layers.slice() : m.layers.map(k => n - 1 - k), turns: sign > 0 ? m.turns : (4 - m.turns) % 4 };
}

/**
 * Shortest-known way home: the inverse of everything done so far, with
 * same-axis turns merged and whole-cube rotations folded away (the cube is
 * judged solved in any orientation).
 */
export function simplify(moves, n) {
  const out = [];
  let A = I;
  let block = null;
  const finish = () => {
    if (!block) return;
    const counts = [0, 0, 0, 0];
    block.t.forEach(t => counts[t]++);
    let c = 0;
    for (let v = 1; v < 4; v++) if (counts[v] > counts[c]) c = v;
    if (c) { block.t = block.t.map(t => (t - c + 4) % 4); A = mul(A, rotation(block.axis, c)); }
    for (let v = 1; v < 4; v++) {
      const layers = [];
      block.t.forEach((t, k) => { if (t === v) layers.push(k); });
      if (layers.length) out.push({ axis: block.axis, layers, turns: v });
    }
    block = null;
  };
  for (const raw of moves) {
    let m = conjugate(raw, A, n);
    if (block && block.axis !== m.axis) { finish(); m = conjugate(raw, A, n); }
    if (!block) block = { axis: m.axis, t: new Array(n).fill(0) };
    for (const k of m.layers) block.t[k] = (block.t[k] + m.turns) % 4;
  }
  finish();
  // merged blocks can leave empty neighbours that now meet on one axis: run again until stable
  if (out.length && out.length < moves.length) return simplify(out, n);
  return out;
}

export const pathHome = (history, n) => simplify(history.slice().reverse().map(invert), n);

// ---- scrambles ----
/** `rand` returns [0,1). Outer layers only on 2³/3³; 4³ also turns inner slices. */
export function scramble(n, length, rand = Math.random) {
  const moves = [];
  let lastAxis = -1, lastLayer = -1;
  const layersFor = n <= 3 ? [0, n - 1] : [...Array(n).keys()];
  while (moves.length < length) {
    const axis = Math.floor(rand() * 3);
    const layer = layersFor[Math.floor(rand() * layersFor.length)];
    if (axis === lastAxis && (layer === lastLayer || n === 2)) continue;
    if (n === 2 && layer === 0) continue; // 2³: keep the D-L-B corner fixed, like WCA
    const turns = [1, 2, 3][Math.floor(rand() * 3)];
    moves.push({ axis, layers: [layer], turns });
    lastAxis = axis; lastLayer = layer;
  }
  return moves;
}

/** Deterministic PRNG for shareable scrambles and the daily cube. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
