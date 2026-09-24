// Wallet lookup against the Credits contract: tokensOf(address), plus plain ENS resolution.
import { keccak256 } from './keccak.js';

export const CONTRACT = '0x97630aa70ab14ed9883b41dafccbc11349723043';
const ENS_REGISTRY = '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e';
const RPCS = ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io', 'https://eth.drpc.org', 'https://1rpc.io/eth'];

const toHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const utf8 = s => new TextEncoder().encode(s);

export class WalletError extends Error {
  constructor(code) { super(code); this.code = code; }
}

async function call(to, data) {
  let last = null;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
      });
      const j = await r.json();
      if (typeof j.result === 'string') return j.result;
      if (j.error && /revert/i.test(j.error.message || '')) throw new WalletError('revert');
      last = j.error;
    } catch (e) {
      if (e instanceof WalletError) throw e;
      last = e;
    }
  }
  void last;
  throw new WalletError('network');
}

export function namehash(name) {
  let node = new Uint8Array(32);
  if (!name) return node;
  for (const label of name.split('.').reverse()) {
    const buf = new Uint8Array(64);
    buf.set(node);
    buf.set(keccak256(utf8(label)), 32);
    node = keccak256(buf);
  }
  return node;
}

/** 0x address, or an ENS name resolved through the registry. */
export async function resolve(input) {
  const s = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s.toLowerCase();
  if (/^[^\s.]+(\.[^\s.]+)+$/.test(s)) {
    const node = toHex(namehash(s.toLowerCase()));
    const res = await call(ENS_REGISTRY, '0x0178b8bf' + node);
    const resolver = '0x' + res.slice(-40);
    if (/^0x0+$/.test(resolver)) throw new WalletError('no-name');
    const addr = await call(resolver, '0x3b3b57de' + node);
    const a = '0x' + addr.slice(-40);
    if (/^0x0+$/.test(a)) throw new WalletError('no-name');
    return a;
  }
  throw new WalletError('format');
}

/** Every Credit id the address holds, in the contract's own order. */
export async function tokensOf(address) {
  const res = await call(CONTRACT, '0x5a3f2672' + address.slice(2).toLowerCase().padStart(64, '0'));
  const h = res.slice(2);
  const n = parseInt(h.slice(64, 128), 16) || 0;
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(parseInt(h.slice(128 + i * 64, 192 + i * 64), 16));
  return ids;
}

export const short = a => a.slice(0, 6) + '…' + a.slice(-4);
