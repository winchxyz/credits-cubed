// Reads data/credits.bin (see tools/build-data.mjs) and answers seed/time/trait
// questions for any Credit id without touching the network again.
import { maskAt, LETTERS } from './credit.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const PRINTS = ['Registered', 'Nudge', 'Slip', 'Skew', 'Drift', 'Loose'];
export const WEIGHTS = ['Even', 'Lean', 'Sparse', 'Extreme'];
export const TIERS = ['Common', 'Uncommon', 'Rare', 'Ultra', 'Hyper'];

// A handful of Credits ship inline so the first cube draws before the data file lands.
export const STARTERS = {
  1: ['Ce7FArT96LoPcNpyz2ZAm', 1786920623],
  3: ['CfFTpv1AYhcWwbNq6Sb5F', 1789942532],
  13: ['CfFUB5m6cQWXEhQdeuiQJ', 1789942806],
  1000: ['CfFaaaNspj12EWa5AYG9S', 1789947845],
  11469: ['CfGBBD9888ceFdGsKW88H', 1789975071],
  122154: ['CfHVkfSgrpzkm4dgTvnLX', 1790035323],
};

let db = null;
let pending = null;

export const ready = () => !!db;
export const count = () => (db ? db.n : 122154);

// The page can point at another copy (the Artifact build ships base64 text, since it can't serve .bin).
const DEFAULT_URL = (typeof document !== 'undefined' && document.querySelector('meta[name="credits-data"]')?.content) || 'data/credits.bin';

export function load(url = DEFAULT_URL) {
  if (pending) return pending;
  pending = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Credits data: ' + res.status);
    let buf;
    if (url.endsWith('.txt')) {
      const bin = atob((await res.text()).trim());
      buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    } else buf = new Uint8Array(await res.arrayBuffer());
    parse(buf);
    return db;
  })();
  pending.catch(() => { pending = null; });
  return pending;
}

export function parse(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'CR3D') throw new Error('Not a Credits data file');
  const n = dv.getUint32(4, true);
  let t = dv.getUint32(8, true);
  const seeds = buf.subarray(12, 12 + n * 16);
  const traits = buf.subarray(12 + n * 16, 12 + n * 17);
  const paid = new Float64Array(n);
  let p = 12 + n * 17;
  for (let i = 0; i < n; i++) {
    let delta = 0, mul = 1, byte;
    do { byte = buf[p++]; delta += (byte & 127) * mul; mul *= 128; } while (byte & 128);
    t += delta;
    paid[i] = t;
  }
  db = { n, seeds, traits, paid };
  return db;
}

const scratch = new Uint8Array(16);
export function seedOf(id) {
  if (!db) { const s = STARTERS[id]; return s ? s[0] : null; }
  if (id < 1 || id > db.n) return null;
  scratch.set(db.seeds.subarray((id - 1) * 16, id * 16));
  let out = '';
  for (let k = 0; k < 21; k++) {
    let rem = 0;
    for (let i = 0; i < 16; i++) {
      const cur = rem * 256 + scratch[i];
      scratch[i] = (cur / 58) | 0;
      rem = cur % 58;
    }
    out = ALPHABET[rem] + out;
  }
  return out;
}

export function paidAtOf(id) {
  if (!db) { const s = STARTERS[id]; return s ? s[1] : null; }
  if (id < 1 || id > db.n) return null;
  return db.paid[id - 1];
}

export const has = id => Number.isInteger(id) && (db ? id >= 1 && id <= db.n : !!STARTERS[id]);

/** Cheap trait lookup (no hashing) for filtering the whole collection. */
export function traitsOf(id) {
  if (!db) return null;
  const b = db.traits[id - 1];
  const mask = maskAt(db.paid[id - 1]);
  return {
    print: PRINTS[b & 7], printIndex: b & 7,
    weight: WEIGHTS[(b >> 3) & 3], weightIndex: (b >> 3) & 3,
    eights: b >> 5,
    mask, colors: [0, 1, 2, 3].filter(i => mask & (1 << i)).map(i => LETTERS[i]).join(''),
  };
}

/** All ids whose traits pass `test`. */
export function filter(test) {
  const out = [];
  if (!db) return out;
  for (let id = 1; id <= db.n; id++) if (test(traitsOf(id), id)) out.push(id);
  return out;
}
