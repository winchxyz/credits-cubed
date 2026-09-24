// node tools/scrape-events.mjs
// Rebuilds tools/credits-raw.csv (id, seed, paidAt) from the Credits contract's Distributed events.
// The edition is sealed at 122,154, so this only ever needs to run once; data/credits.bin is packed
// from its output by tools/build-data.mjs.
import fs from 'node:fs';

const CONTRACT = '0x97630aa70ab14ed9883b41dafccbc11349723043';
// Distributed(uint256 indexed tokenId, address indexed to, bytes21 seed, uint64 paidAt)
const TOPIC = '0xd531eb90fd214f28c84ac8e9b86c5b3cbb798ceceb98046d1de96857d283cd0c';
const FROM_BLOCK = 26037200; // just before Credit #1 was distributed
const RPCS = (process.env.RPC ? [process.env.RPC] : []).concat(['https://rpc.mevblocker.io', 'https://rpc.flashbots.net']);
const EXPECTED = 122154;

async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(90000) });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { error: { message: 'not JSON: ' + text.slice(0, 60) } }; }
}

const out = new Map();
const latest = parseInt((await rpc(RPCS[0], 'eth_blockNumber', [])).result, 16);
let from = FROM_BLOCK, step = 150, k = 0, fails = 0;
while (from <= latest) {
  const to = Math.min(latest, from + step - 1);
  const url = RPCS[k % RPCS.length];
  const r = await rpc(url, 'eth_getLogs', [{ address: CONTRACT, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [TOPIC] }]);
  if (r.error) {
    const msg = JSON.stringify(r.error);
    if (/more than 10000|too many|limit/i.test(msg) && step > 10) { step = Math.floor(step / 2); continue; }
    if (++fails > 20) throw new Error('giving up: ' + msg);
    k++;
    await new Promise(res => setTimeout(res, 2000));
    continue;
  }
  for (const log of r.result) {
    const id = parseInt(log.topics[1], 16);
    const seed = Buffer.from(log.data.slice(2, 44), 'hex').toString('latin1');
    const paidAt = parseInt(log.data.slice(66 + 48, 130), 16);
    out.set(id, [seed, paidAt]);
  }
  if (r.result.length < 4000) step = Math.min(4000, step * 2);
  if (r.result.length) console.log(`${from}–${to}: ${r.result.length} events, ${out.size} Credits`);
  from = to + 1;
  if (out.size >= EXPECTED && r.result.length === 0 && step >= 4000) break;
}

const ids = [...out.keys()].sort((a, b) => a - b);
if (ids.length !== EXPECTED || ids[0] !== 1 || ids[ids.length - 1] !== EXPECTED) console.warn(`expected 1…${EXPECTED}, got ${ids.length} (${ids[0]}…${ids[ids.length - 1]})`);
fs.writeFileSync(new URL('./credits-raw.csv', import.meta.url), ids.map(id => `${id},${out.get(id)[0]},${out.get(id)[1]}`).join('\n'));
console.log(`wrote tools/credits-raw.csv · ${ids.length} Credits`);
