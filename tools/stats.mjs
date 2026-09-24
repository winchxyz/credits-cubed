import fs from 'node:fs';
import { describe } from '../js/credit.js';
const rows = fs.readFileSync(new URL('./credits-raw.csv', import.meta.url), 'utf8').trim().split('\n').map(l => { const [id, seed, ts] = l.split(','); return { id: +id, seed, ts: +ts }; });
const t0 = Date.now();
const count = (o, k) => (o[k] = (o[k] || 0) + 1);
const E = {}, R = {}, Wt = {}, Col = {}, tier = {}, black = [], hyper = [];
let tsMin = Infinity, tsMax = 0, nonMono = 0, prev = 0, maxDelta = 0, negDelta = 0;
for (const r of rows) {
  const d = describe(r.seed, r.ts);
  count(E, d.eights); count(R, d.register); count(Wt, d.weight); count(Col, d.colors); count(tier, d.tier);
  if (d.eights >= 5) black.push(r.id);
  if (d.eights === 4) hyper.push(r.id);
  tsMin = Math.min(tsMin, r.ts); tsMax = Math.max(tsMax, r.ts);
  if (prev && r.ts < prev) { nonMono++; negDelta = Math.min(negDelta, r.ts - prev); }
  if (prev) maxDelta = Math.max(maxDelta, r.ts - prev);
  prev = r.ts;
}
console.log('ms', Date.now() - t0);
console.log('eights', JSON.stringify(E)); console.log('register', JSON.stringify(R)); console.log('weight', JSON.stringify(Wt)); console.log('tier', JSON.stringify(tier));
console.log('colors', JSON.stringify(Col));
console.log('black ground ids', black.length, black.slice(0, 40).join(' '));
console.log('4-eights sample', hyper.slice(0, 20).join(' '));
console.log('ts range', new Date(tsMin * 1000).toISOString(), new Date(tsMax * 1000).toISOString(), 'nonmonotonic', nonMono, 'most negative delta', negDelta, 'max delta', maxDelta);
const alpha = new Set(rows.flatMap(r => [...r.seed])); console.log('alphabet', alpha.size, [...alpha].sort().join(''));
const lens = new Set(rows.map(r => r.seed.length)); console.log('seed lengths', [...lens]);
