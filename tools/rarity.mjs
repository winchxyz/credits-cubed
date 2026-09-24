// node tools/rarity.mjs [id ...]
// Jack Butcher's Credits rarity (x.com/jackbutcher/status/2103191042304753976):
//   R(c) = −Σ_{t=1..5} w_t · ln p_t(c),  w = (1, 1, 1, 2, 1) / 6
//   S(c) = 80 + 720 · (N − r(c)) / (N − 1)
// p_t(c) is the share of all Credits that have c's value for trait t, r(c) is c's rank by R
// (1 = rarest). The post does not name the five traits; this reads them in metadata order,
// Eights, Weight, Print, Bits, Colors (Plates is left out, since Colors already decides it).
import fs from 'node:fs';
import * as D from '../js/data.js';
import { describe } from '../js/credit.js';

D.parse(new Uint8Array(fs.readFileSync(new URL('../data/credits.bin', import.meta.url))));
const N = D.count();
const TRAITS = ['Eights', 'Weight', 'Print', 'Bits', 'Colors'];
// --double=<trait> moves the 2/6 weight onto another trait (the post shows only the weights, not their order)
const doubled = (process.argv.find(a => a.startsWith('--double=')) || '--double=Bits').slice(9);
const W = TRAITS.map(t => (t === doubled ? 2 : 1) / 6);

const rows = [];
for (let id = 1; id <= N; id++) {
  const c = describe(D.seedOf(id), D.paidAtOf(id));
  rows.push({ id, v: [c.eightsLabel, c.weight, c.register, c.marks, c.colors] });
}
const counts = TRAITS.map((_, t) => { const m = new Map(); for (const r of rows) m.set(r.v[t], (m.get(r.v[t]) || 0) + 1); return m; });
for (const r of rows) {
  r.parts = r.v.map((v, t) => -W[t] * Math.log(counts[t].get(v) / N));
  r.R = r.parts.reduce((a, b) => a + b, 0);
}
const ranked = rows.slice().sort((a, b) => b.R - a.R || a.id - b.id);
ranked.forEach((r, i) => { r.rank = i + 1; r.S = 80 + 720 * (N - r.rank) / (N - 1); });

const show = r => `#${r.id}  rank ${r.rank.toLocaleString('en-US')}  R ${r.R.toFixed(3)}  S ${r.S.toFixed(1)}  ·  ` +
  TRAITS.map((t, k) => `${t} ${r.v[k]} (${(100 * counts[k].get(r.v[k]) / N).toFixed(k === 3 ? 2 : 1)}%)`).join(' · ');

const ids = process.argv.slice(2).filter(a => !a.startsWith('--')).map(Number).filter(Boolean);
console.log(`weights: ${TRAITS.map((t, k) => `${t} ${Math.round(W[k] * 6)}/6`).join(', ')}`);
if (ids.length) { for (const id of ids) console.log(show(rows[id - 1])); }
else {
  console.log('rarest ten');
  ranked.slice(0, 10).forEach(r => console.log('  ' + show(r)));
  console.log('most common'); console.log('  ' + show(ranked[N - 1]));
  console.log('median'); console.log('  ' + show(ranked[Math.floor(N / 2)]));
}
