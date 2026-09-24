// Proves js/credit.js against the chain: tokenURI SVG + attributes for a sample of Credits.
import fs from 'node:fs';
import { svg, describe, eightsOf } from '../js/credit.js';
const C = '0x97630aa70ab14ed9883b41dafccbc11349723043';
const rows = fs.readFileSync(new URL('./credits-raw.csv', import.meta.url), 'utf8').trim().split('\n').map(l => { const [id, seed, ts] = l.split(','); return { id: +id, seed, ts: +ts }; });
const byId = new Map(rows.map(r => [r.id, r]));
// pick a sample: random + special cases
const pick = new Set([1, 2, 5, 7, 9, 12, 20, 24, 25, 100, 122154]);
const want = { e3: 6, e4: 6, e5: 6, reg: {} };
for (const r of rows) {
  const e = eightsOf(r.seed);
  if (e === 3 && want.e3-- > 0) pick.add(r.id);
  if (e === 4 && want.e4-- > 0) pick.add(r.id);
  if (e >= 5 && want.e5-- > 0) pick.add(r.id);
}
for (let i = 0; i < 4000 && pick.size < 150; i++) { const r = rows[(Math.random() * rows.length) | 0]; const d = describe(r.seed, r.ts); const k = d.register; want.reg[k] = (want.reg[k] || 0) + 1; if (want.reg[k] <= 12 || Math.random() < 0.01) pick.add(r.id); }
const ids = [...pick];
const pad = x => x.toString(16).padStart(64, '0');
let ok = 0, bad = 0;
for (let i = 0; i < ids.length; i += 25) {
  const chunk = ids.slice(i, i + 25);
  const body = chunk.map((id, k) => ({ jsonrpc: '2.0', id: k, method: 'eth_call', params: [{ to: C, data: '0xc87b56dd' + pad(id) }, 'latest'] }));
  const res = await (await fetch('https://ethereum-rpc.publicnode.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  for (const x of res) {
    const id = chunk[x.id];
    const h = x.result.slice(2); const len = parseInt(h.slice(64, 128), 16);
    const j = JSON.parse(Buffer.from(Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8').split(',')[1], 'base64').toString('utf8'));
    const chainSvg = Buffer.from(j.image.split(',')[1], 'base64').toString('utf8');
    const r = byId.get(id); const mine = svg(r.seed, r.ts); const d = describe(r.seed, r.ts);
    const a = Object.fromEntries(j.attributes.map(t => [t.trait_type, t.value]));
    const attrOk = a.Seed === r.seed && a.Print === d.register && a.Bits === d.marks && a.Plates === d.plates && a.Colors === d.colors && a['Payment Time'] === d.time && a.Eights === d.eightsLabel && a.Weight.toLowerCase() === d.weight && a['SHA-256'] === Buffer.from(d.hash).toString('hex');
    if (chainSvg === mine && attrOk) ok++; else { bad++; console.log('MISMATCH', id, chainSvg === mine ? 'svg ok' : 'svg differs', attrOk ? 'attrs ok' : JSON.stringify({ a, d: { reg: d.register, marks: d.marks, w: d.weight, t: d.time, e: d.eightsLabel } })); if (chainSvg !== mine) { fs.writeFileSync(`tools/_chain-${id}.svg`, chainSvg); fs.writeFileSync(`tools/_mine-${id}.svg`, mine); } }
  }
}
console.log('checked', ids.length, 'ok', ok, 'bad', bad, 'register sample', JSON.stringify(want.reg));
