import fs from 'node:fs';
import * as D from '../js/data.js';
import { describe } from '../js/credit.js';
const buf = fs.readFileSync(new URL('../data/credits.bin', import.meta.url));
D.parse(new Uint8Array(buf));
const rows = fs.readFileSync(new URL('./credits-raw.csv', import.meta.url), 'utf8').trim().split('\n').map(l => l.split(','));
let bad = 0;
const t0 = Date.now();
for (const [id, seed, ts] of rows) {
  const i = +id;
  if (D.seedOf(i) !== seed || D.paidAtOf(i) !== +ts) { bad++; if (bad < 5) console.log('bad', id, D.seedOf(i), seed, D.paidAtOf(i), ts); }
}
console.log('decoded all in', Date.now() - t0, 'ms, bad', bad);
for (const id of [1, 5, 7, 11469, 122154]) { const t = D.traitsOf(id); const d = describe(D.seedOf(id), D.paidAtOf(id)); console.log(id, JSON.stringify(t), d.register, d.weight, d.eights, d.colors); }
