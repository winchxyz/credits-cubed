// node tools/shoot.mjs [scene ...]
// Headless Chrome captures of the running dev server (node dev-server.js 8880) for the README.
// Each scene is a page state in tools/shoot-scenarios.js; output lands in media/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome']
  .find(p => p && fs.existsSync(p));
if (!CHROME) { console.log('Chrome not found; set CHROME=path'); process.exit(1); }

const BASE = process.env.BASE || 'http://localhost:8880/';
const SHOTS = {
  hero: { w: 1440, h: 980 },
  dark: { w: 1440, h: 980 },
  scrambled: { w: 1440, h: 980 },
  pixels: { w: 1440, h: 980 },
  flat: { w: 1440, h: 980 },
  remix: { w: 1440, h: 900 },
  hint: { w: 1440, h: 980 },
  receipt: { w: 1440, h: 1500 },
  process: { w: 1440, h: 1180 },
  mobile: { w: 390, h: 844, scale: 3, scene: 'hero', frame: true },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
fs.mkdirSync(path.join(root, 'media'), { recursive: true });
for (const name of wanted) {
  const s = SHOTS[name];
  if (!s) { console.log('unknown scene', name); continue; }
  const out = path.join(root, 'media', `shot-${name}.png`);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-'));
  const page = `?motion=1&shoot=${s.scene || name}#3-1.122154.11469.13.1000.3`;
  // phones render inside an iframe of the real width; the window itself stays wide enough for Chrome
  const url = s.frame ? `${BASE}tools/frame.html?w=${s.w}&h=${s.h}&src=${encodeURIComponent('/' + page)}` : BASE + page;
  const win = s.frame ? [Math.max(520, s.w), s.h] : [s.w, s.h];
  const r = spawnSync(CHROME, [
    '--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    `--user-data-dir=${prof}`, `--window-size=${win[0]},${win[1]}`, `--force-device-scale-factor=${s.scale || 2}`,
    '--virtual-time-budget=45000', `--screenshot=${out}`, url,
  ], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  if (s.frame && fs.existsSync(out)) {
    // keep only the iframe: crop the PNG to w × h at the device scale (python + Pillow)
    const k = s.scale || 2;
    spawnSync('python', ['-c', `from PIL import Image; im=Image.open(r'${out}'); im.crop((0,0,${s.w * k},${s.h * k})).save(r'${out}')`]);
  }
  console.log(fs.existsSync(out) ? `${name} -> media/shot-${name}.png` : `${name} FAILED ${r.status} ${(r.stderr || '').slice(-400)}`);
}
