// Packs every Credit (seed + payment time) into data/credits.bin.
// Layout (little endian header):
//   'CR3D' | u32 count | u32 firstPaidAt
//   count × 16 B  seed as a big-endian 128-bit base58 number (21 chars)
//   count × 1 B   traits: bits 0-2 print (register), 3-4 weight, 5-7 eights (capped at 7)
//   count × varint  paidAt delta from the previous Credit (time only moves forward)
// Source: tools/credits-raw.csv, scraped from the Distributed events of
// 0x97630aa70ab14ed9883b41dafccbc11349723043 (sealed at 122,154).
import fs from 'node:fs';
import { describe } from '../js/credit.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const rows = fs.readFileSync(new URL('./credits-raw.csv', import.meta.url), 'utf8').trim().split('\n')
  .map(l => { const [id, seed, ts] = l.split(','); return { id: +id, seed, ts: +ts }; });
rows.forEach((r, i) => { if (r.id !== i + 1) throw new Error('gap at ' + i); });

const n = rows.length;
const seeds = new Uint8Array(n * 16);
const traits = new Uint8Array(n);
const deltas = [];
let prev = rows[0].ts;
rows.forEach((r, i) => {
  let v = 0n;
  for (const c of r.seed) { const k = ALPHABET.indexOf(c); if (k < 0) throw new Error('bad char ' + c); v = v * 58n + BigInt(k); }
  for (let b = 15; b >= 0; b--) { seeds[i * 16 + b] = Number(v & 255n); v >>= 8n; }
  const d = describe(r.seed, r.ts);
  traits[i] = d.registerIndex | (d.weightIndex << 3) | (Math.min(7, d.eights) << 5);
  let delta = r.ts - prev; prev = r.ts;
  if (delta < 0) throw new Error('time went backwards at ' + r.id);
  do { let byte = delta & 127; delta = Math.floor(delta / 128); if (delta) byte |= 128; deltas.push(byte); } while (delta);
});

const header = Buffer.alloc(12);
header.write('CR3D', 0, 'ascii');
header.writeUInt32LE(n, 4);
header.writeUInt32LE(rows[0].ts, 8);
const out = Buffer.concat([header, Buffer.from(seeds), Buffer.from(traits), Buffer.from(deltas)]);
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../data/credits.bin', import.meta.url), out);
console.log('credits', n, 'bytes', out.length, 'deltas', deltas.length);
