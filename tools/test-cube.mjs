import fs from 'node:fs';
import * as D from '../js/data.js';
import { credit, faceGrid, faceOrigin, stickerSignature } from '../js/face.js';
import { Cube, scramble, pathHome, simplify, mulberry32, invert, ROTATIONS } from '../js/cube.js';
D.parse(new Uint8Array(fs.readFileSync(new URL('../data/credits.bin', import.meta.url))));
const ids = [1, 3, 13, 1000, 11469, 122154]; // U R F D L B
function signatures(cube, faceIds) {
  const intern = new Map(); const id = s => { if (!intern.has(s)) intern.set(s, intern.size); return intern.get(s); };
  const grids = faceIds.map(i => faceGrid(credit(i)));
  return cube.stickers.map(s => [0, 1, 2, 3].map(k => id(s.face + ':' + stickerSignature(grids[s.face], cube.n, s.row, s.col, k))));
}
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
console.log('rotations', ROTATIONS.length);
for (const n of [2, 3, 4]) {
  const cube = new Cube(n);
  check(cube.stickers.length === 6 * n * n, `n=${n} sticker count ${cube.stickers.length}`);
  cube.setSignatures(signatures(cube, ids));
  check(cube.solved(), `n=${n} starts solved`);
  // every single outer-layer turn unsolves
  for (let axis = 0; axis < 3; axis++) for (let layer = 0; layer < n; layer++) for (const turns of [1, 2, 3]) {
    cube.reset(); cube.move({ axis, layers: [layer], turns });
    const whole = false;
    if (!cube.solved() === whole) {}
    check(!cube.solved(), `n=${n} single turn axis ${axis} layer ${layer} turns ${turns} should unsolve (score ${cube.score().registered})`);
  }
  // whole cube rotations stay solved
  for (let axis = 0; axis < 3; axis++) { cube.reset(); cube.move({ axis, layers: [...Array(n).keys()], turns: 1 }); check(cube.solved(), `n=${n} whole rotation ${axis} stays solved`); }
  // random scrambles + path home
  const rand = mulberry32(42 + n);
  let totalPath = 0, totalScr = 0;
  for (let trial = 0; trial < 200; trial++) {
    cube.reset();
    const len = 1 + Math.floor(rand() * 30);
    const s = scramble(n, len, rand);
    // also sprinkle whole-cube rotations and random user moves
    const history = [];
    for (const m of s) { cube.move(m); history.push(m); }
    for (let u = 0; u < Math.floor(rand() * 6); u++) { const m = { axis: Math.floor(rand() * 3), layers: [Math.floor(rand() * n)], turns: 1 + Math.floor(rand() * 3) }; cube.move(m); history.push(m); }
    if (rand() < 0.3) { const m = { axis: Math.floor(rand() * 3), layers: [...Array(n).keys()], turns: 1 }; cube.move(m); history.push(m); }
    const path = pathHome(history, n);
    totalPath += path.length; totalScr += history.length;
    for (const m of path) cube.move(m);
    check(cube.solved(), `n=${n} trial ${trial} path home solves (history ${history.length}, path ${path.length})`);
  }
  console.log(`n=${n}: path/history moves ${totalPath}/${totalScr}`);
  // simplify sanity
  const p = simplify([{ axis: 0, layers: [n - 1], turns: 1 }, { axis: 0, layers: [n - 1], turns: 3 }], n);
  check(p.length === 0, `n=${n} R R' cancels -> ${JSON.stringify(p)}`);
  const w = simplify([{ axis: 1, layers: [...Array(n).keys()], turns: 1 }, { axis: 0, layers: [n - 1], turns: 1 }], n);
  check(w.length === 1, `n=${n} rotation then R becomes one move -> ${JSON.stringify(w)}`);
}
// Every face is whole pixels, so a sticker edge (every 12, 8 or 6 half pixels) never cuts one in two,
// and snapping a misprint's half-pixel centre never pushes ink out of the face window.
const whole = g => {
  for (let y = 0; y < 24; y += 2) for (let x = 0; x < 24; x += 2) {
    const v = g[y * 24 + x];
    if (g[y * 24 + x + 1] !== v || g[(y + 1) * 24 + x] !== v || g[(y + 1) * 24 + x + 1] !== v) return false;
  }
  return true;
};
let sliced = 0, outside = 0;
for (let id = 1; id <= D.count(); id++) {
  const c = credit(id);
  if (!whole(faceGrid(c))) sliced++;
  const [ox, oy] = faceOrigin(c);
  for (let i = 0; i < 144; i++) {
    if (!c.pixels[i]) continue;
    const sx = ox + (i % 12 - 2) * 20, sy = oy + (((i / 12) | 0) - 2) * 20;
    if (sx < 40 || sx + 20 > 280 || sy < 40 || sy + 20 > 280) outside++;
  }
}
check(sliced === 0, `${sliced} Credits have a face pixel cut in half`);
check(outside === 0, `${outside} inked pixels fall outside their face window`);
console.log(`faces: ${D.count()} Credits checked for whole pixels`);
console.log(fails ? `${fails} failures` : 'all cube tests pass');
