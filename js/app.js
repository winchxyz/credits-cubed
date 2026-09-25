// Credits³ — six Credits, one cube. This file wires the model, the view and the page.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import * as D from './data.js';
import { credit, faceGrid, paintGrid, paintPrinting, paintPlate, paintCredit, stickerSignature, GRID, pixelGrid, paintPixels, paintNewCredit } from './face.js';
import { Cube, FACES, FACE_DEF, ROTATIONS, rotation, mul, scramble as makeScramble, pathHome, invert, mulberry32 } from './cube.js';
import { Scene, HOME_YAW, HOME_PITCH } from './scene.js';
import * as Sound from './audio.js';
import { describeReceipt, receiptHTML, posterCanvas, netCanvas, clock, SIDE_NAMES } from './receipt.js';
import * as Wallet from './wallet.js';
import { projectPoster, processPoster } from './panels.js';
import { CSS, INKS, LETTERS, toHex } from './credit.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
// Motion follows the OS setting unless the viewer picks otherwise (Motion on/off in the header).
const motionPref = (() => { try { return JSON.parse(localStorage.getItem('c3-motion') ?? 'null'); } catch { return null; } })();
let reduced = params.get('motion') === '1' ? false : params.get('motion') === '0' ? true : !(motionPref ?? !motionQuery.matches);
const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
const store = {
  get(k, d) { try { const v = localStorage.getItem('c3-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('c3-' + k, JSON.stringify(v)); } catch {} },
};

const DEFAULT_SIDES = [1, 122154, 11469, 13, 1000, 3]; // U R F D L B: first, last, the only black one, three more
const NET_ORDER = [0, 4, 2, 1, 5, 3];                  // reading order of the unfolded cross
const FULL = { 2: 11, 3: 22, 4: 40, 8: 64 };
const PIXEL = 8;                                       // the 8³ cube: one sticker per Credit pixel
const isPixel = () => cube.n === PIXEL;
const FACE_PX = 960;                                    // 24 half pixels × 40
const NOTES = {
  1: 'The first Credit.',
  11469: 'The only Credit with five 8s, so the only one printed on black.',
  122154: 'The last Credit. The edition sealed at 122,154.',
};
const DAILY_EPOCH = Date.UTC(2026, 8, 24);

// ---------------------------------------------------------------- state
const state = {
  n: 3,
  sides: DEFAULT_SIDES.slice(),
  sidesLabel: 'First · Only black · Last',
  selected: 2,
  scrambleLen: 8,
  visible: 15,
  net: 'target',
  netAuto: true,
  bodyChoice: store.get('body', null),
  mode: 'free',          // free · scrambling · ready · solving · solved
  history: [],
  scrambleCount: 0,
  scrambleLen0: 0,
  turns: 0, autoTurns: 0, hints: 0, undos: 0, auto: false,
  t0: 0, elapsed: 0,
  daily: null,
  lastInteraction: performance.now(),
  receipt: null,
};

let cube = new Cube(state.n);
const faceCanvases = FACES.map(() => { const c = document.createElement('canvas'); c.width = c.height = FACE_PX; return c; });
let scene = null;
let timer = 0;
let traitCounts = null;
let orderedGroups = null;
let lastGroup = null;

// ---------------------------------------------------------------- faces
function drawFace(f, t = 1) {
  const c = credit(state.sides[f]);
  const ctx = faceCanvases[f].getContext('2d');
  if (!c) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, FACE_PX, FACE_PX); }
  else if (isPixel()) paintPixels(ctx, pixelGrid(c, state.visible), 0, 0, FACE_PX);
  else {
    const g = faceGrid(c, state.visible);
    if (t < 1) paintPrinting(ctx, c, g, 0, 0, FACE_PX, t, state.visible);
    else paintGrid(ctx, g, 0, 0, FACE_PX);
  }
  scene?.refreshFace(f);
}
const drawAllFaces = () => FACES.forEach((_, f) => drawFace(f));

function updateSignatures() {
  const intern = new Map();
  const idOf = s => { let v = intern.get(s); if (v === undefined) { v = intern.size; intern.set(s, v); } return v; };
  if (isPixel()) {
    // a pixel sticker is one flat colour: any sticker of that colour reads right, in any turn
    const grids = state.sides.map(i => { const c = credit(i); return c ? pixelGrid(c) : new Uint8Array(64); });
    cube.setSignatures(cube.stickers.map(s => { const v = idOf('p' + grids[s.face][s.row * 8 + s.col]); return [v, v, v, v]; }));
    return;
  }
  const grids = state.sides.map(i => { const c = credit(i); return c ? faceGrid(c) : new Uint8Array(GRID * GRID); });
  cube.setSignatures(cube.stickers.map(s => [0, 1, 2, 3].map(k => idOf(stickerSignature(grids[s.face], cube.n, s.row, s.col, k)))));
}

/** Plates land one after another on every face in `faces`. */
function printFaces(faces, { stagger = 0.11, dur = 0.95 } = {}) {
  if (reduced || !scene) { faces.forEach(f => drawFace(f)); drawNet(); return Promise.resolve(); }
  const total = dur + stagger * (faces.length - 1);
  return scene.animate(total, t => {
    const time = t * total;
    faces.forEach((f, i) => drawFace(f, Math.min(1, Math.max(0, (time - i * stagger) / dur))));
    drawNet();
  });
}

// ---------------------------------------------------------------- net (the unfolded cube)
const sideButtons = [...document.querySelectorAll('.side')];
function drawNet() {
  const live = state.net === 'live';
  const groups = live ? [[], [], [], [], [], []] : null;
  if (live) for (const s of cube.stickers) { const w = cube.where(s); groups[w.face].push({ s, w }); }
  for (const btn of sideButtons) {
    const f = +btn.dataset.face;
    const cv = btn.querySelector('canvas');
    const W = cv.width || 1;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (!live) { ctx.drawImage(faceCanvases[f], 0, 0, W, W); continue; }
    const n = cube.n, cell = W / n, src = FACE_PX / n;
    const body = scene ? scene.body : 'ink';
    ctx.fillStyle = body === 'paper' ? '#dcdad4' : '#121212';
    ctx.fillRect(0, 0, W, W);
    const gap = body === 'flat' ? -0.25 : Math.max(1, W * 0.012);
    for (const { s, w } of groups[f]) {
      ctx.save();
      ctx.translate((w.col + 0.5) * cell, (w.row + 0.5) * cell);
      ctx.rotate(w.k * Math.PI / 2);
      ctx.drawImage(faceCanvases[s.face], s.col * src, s.row * src, src, src, -cell / 2 + gap, -cell / 2 + gap, cell - gap * 2, cell - gap * 2);
      ctx.restore();
    }
  }
  drawRemix();
}

function sizeNetCanvases() {
  for (const btn of sideButtons) {
    const cv = btn.querySelector('canvas');
    const px = Math.max(96, Math.round(btn.getBoundingClientRect().width * Math.min(2, devicePixelRatio || 1)));
    if (cv.width !== px) { cv.width = cv.height = px; }
  }
  drawNet();
}

function setNet(mode, auto = false) {
  if (auto && !state.netAuto) return;
  if (!auto) state.netAuto = false;
  state.net = mode;
  $('btnLive').setAttribute('aria-pressed', String(mode === 'live'));
  $('netNote').textContent = mode === 'live' ? 'Live' : 'Target';
  drawNet();
}

// ---------------------------------------------------------------- HUD
function updateHud() {
  const sc = cube.score();
  const solved = sc.registered === sc.total;
  const stage = $('stage');
  stage.classList.toggle('solved', solved && state.mode === 'solved');
  $('hudRegText').textContent = solved ? 'Registered ✓' : `Registered ${sc.registered} / ${sc.total}`;
  const bar = $('regbar');
  if (bar.children.length !== 6) bar.innerHTML = '<i></i>'.repeat(6);
  [...bar.children].forEach((el, i) => el.classList.toggle('on', sc.sides[i]));
  $('hudTurns').textContent = `${state.turns + state.autoTurns} turn${state.turns + state.autoTurns === 1 ? '' : 's'}`;
  const n = cube.n;
  $('hudMode').textContent = state.daily ? `Daily № ${state.daily.no} · ${n}³`
    : state.mode === 'free' ? `${n}³ · ${6 * n * n} ${n === PIXEL ? 'pixels' : 'stickers'}`
    : `${n}³ · scramble ${state.scrambleLen0}`;
  if (state.mode !== 'solving') $('hudTime').textContent = clock(state.elapsed);
  $('hudTime').classList.toggle('live', state.mode === 'solving');
  const busy = state.mode === 'scrambling' || state.solvingAuto;
  $('btnUndo').disabled = busy || state.history.length <= state.scrambleCount;
  $('btnHint').disabled = busy || solved;
  $('btnSolve').disabled = (busy && !state.solvingAuto) || (solved && !state.solvingAuto);
  $('btnSolve').textContent = state.solvingAuto ? 'Stop' : 'Solve';
  $('btnScramble').disabled = busy;
  $('btnScramble').textContent = state.mode === 'ready' || state.mode === 'solving' ? 'Rescramble' : 'Scramble';
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => { $('hudTime').textContent = clock(performance.now() - state.t0); }, 100);
}
function stopTimer() { clearInterval(timer); timer = 0; }

const announce = msg => { $('announce').textContent = msg; };
function tip(msg, ms = 2600) {
  const el = $('hudTip');
  el.textContent = msg;
  el.classList.remove('gone');
  clearTimeout(tip.t);
  if (ms) tip.t = setTimeout(() => el.classList.add('gone'), ms);
}

// ---------------------------------------------------------------- editor + diagram
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eightsMarked = seed => esc(seed).replace(/8/g, '<b>8</b>');

function rarity(c) {
  if (!traitCounts) return '';
  if (c.eights >= 1) return `${c.tier} · 1 of ${traitCounts.tier[Math.min(4, c.eights)].toLocaleString('en-US')}`;
  if (c.registerIndex) return `${c.register} print · 1 of ${traitCounts.print[c.registerIndex].toLocaleString('en-US')}`;
  return c.tier;
}

function updateEditor() {
  const f = state.selected, id = state.sides[f], c = credit(id);
  $('edSide').textContent = `${SIDE_NAMES[f]} side · ${FACES[f]}`;
  const input = $('edId');
  if (document.activeElement !== input) input.value = id;
  input.setAttribute('aria-invalid', 'false');
  if (c) {
    const eights = c.eights ? `${c.eightsLabel} 8${c.eights > 1 ? 's' : ''}` : 'No 8s';
    $('edTraits').textContent = `${c.colors} · ${c.register} · ${eights} · ${c.weight} · ${c.time}`;
    $('edSeed').innerHTML = `Seed ${eightsMarked(c.seed)}`;
    $('edTier').textContent = rarity(c);
    const note = NOTES[id];
    $('edMsg').textContent = note || '';
    $('edMsg').className = 'ed-msg ok';
  }
  sideButtons.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.face === f)));
  sideButtons.forEach(b => { b.querySelector('.side-id').textContent = '#' + state.sides[+b.dataset.face]; });
  const ready = D.ready();
  $('edRandom').disabled = !ready; $('btnRandom').disabled = !ready; $('btnOrdered').disabled = !ready;
  $('sidesLabel').textContent = state.sidesLabel ? `Sides · ${state.sidesLabel}` : 'Sides';
  updateDiagram();
}

function updateDiagram() {
  const id = state.sides[state.selected], c = credit(id);
  if (!c) return;
  $('dCredit').innerHTML = `<span>Credit #${id} · ${c.time}</span>`;
  $('dSeed').innerHTML = eightsMarked(c.seed);
  const hx = toHex(c.hash);
  $('dHash').innerHTML = [0, 1, 2, 3].map(l => {
    const on = c.mask & (1 << l);
    return `<span class="${on ? '' : 'off'}">${LETTERS[l]}</span><span class="${on ? '' : 'off'}">${hx.slice(l * 16, l * 16 + 16)}</span>`;
  }).join('');
  const plates = $('dPlates');
  if (!plates.children.length) plates.innerHTML = [0, 1, 2, 3].map(l => `<div><span>${LETTERS[l]}</span><canvas width="96" height="96"></canvas></div>`).join('');
  [...plates.children].forEach((cell, l) => {
    cell.classList.toggle('off', !(c.mask & (1 << l)));
    const cv = cell.querySelector('canvas'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 96, 96);
    paintPlate(ctx, c, l, 0, 0, 96, l === 3 ? getComputedStyle(document.documentElement).getPropertyValue('--k-chip').trim() || '#111' : null);
  });
  const r = $('dRaster').getContext('2d'), cut = $('dCut').getContext('2d');
  if (isPixel()) {
    const cells = pixelGrid(c);
    paintPixels(r, cells, 0, 0, 240);
    paintPixels(cut, cells, 0, 0, 240);
    $('dRasterLabel').textContent = '8 × 8 plates, in register';
  } else {
    const g = faceGrid(c);
    paintGrid(r, g, 0, 0, 240);
    paintGrid(cut, g, 0, 0, 240);
    $('dRasterLabel').textContent = '12 × 12 raster';
  }
  const n = cube.n;
  cut.fillStyle = scene && scene.body === 'paper' ? '#cfcdc6' : '#111111';
  for (let i = 1; i < n; i++) { const p = Math.round(i * 240 / n); cut.fillRect(p - 2, 0, 4, 240); cut.fillRect(0, p - 2, 240, 4); }
  $('dCutLabel').textContent = `Cut ${n} × ${n}`;
  $('dFoot').textContent = `${n * n} ${n === PIXEL ? 'pixels' : 'stickers'} a side · ${6 * n * n} in all`;
}

function select(f, { look = true, flash = true } = {}) {
  state.selected = f;
  updateEditor();
  if (flash) spotlightFace(f, 1400);
  if (look && state.mode === 'free' && cube.solved() && scene.idle) { scene.spin = 0; scene.lookAtFace(f); }
}

let spotTimer = 0;
function spotlightFace(f, ms) {
  clearTimeout(spotTimer);
  scene.spotlight(si => cube.stickers[si].face === f);
  if (ms) spotTimer = setTimeout(() => scene.spotlight(null), ms);
}

// ---------------------------------------------------------------- sides
function writeHash() {
  if (state.daily) return;
  const h = `${cube.n}-${state.sides.join('.')}`;
  try { history.replaceState(null, '', '#' + h); } catch {}
}

function setSide(f, id, { animate = true, label } = {}) {
  if (!D.has(id)) return false;
  state.sides[f] = id;
  if (label !== undefined) state.sidesLabel = label;
  else if (state.sidesLabel && !state.daily) state.sidesLabel = 'Mixed';
  updateSignatures();
  if (animate) printFaces([f], { dur: 0.7 }); else drawFace(f);
  drawNet();
  updateEditor();
  updateHud();
  writeHash();
  return true;
}

function setSides(ids, label) {
  ids.forEach((id, f) => { state.sides[f] = id; });
  state.sidesLabel = label || '';
  updateSignatures();
  printFaces(NET_ORDER);
  updateEditor();
  updateHud();
  writeHash();
}

function randomIds(k, pool) {
  const out = new Set();
  const n = pool ? pool.length : D.count();
  let guard = 0;
  while (out.size < Math.min(k, n) && guard++ < 1000) out.add(pool ? pool[(Math.random() * n) | 0] : 1 + ((Math.random() * n) | 0));
  return [...out];
}

function buildGroups() {
  const groups = new Map();
  const traits = [['Colors', t => t.colors], ['Print', t => t.print], ['Weight', t => t.weight], ['Eights', t => ['None', 'One', 'Two', 'Three', 'Four', 'Five'][Math.min(5, t.eights)]]];
  const tier = [0, 0, 0, 0, 0], print = [0, 0, 0, 0, 0, 0];
  for (let id = 1; id <= D.count(); id++) {
    const t = D.traitsOf(id);
    tier[Math.min(4, t.eights)]++; print[t.printIndex]++;
    for (const [name, get] of traits) {
      const key = `${name}: ${get(t)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(id);
    }
  }
  traitCounts = { tier, print };
  orderedGroups = [...groups.entries()].filter(([, ids]) => ids.length >= 6);
}

// ---------------------------------------------------------------- session
const isRotation = m => m.layers.length === cube.n;

async function doScramble(seed = null) {
  if (state.mode === 'scrambling' || state.solvingAuto) return;
  closeReceipt(false);
  scene.clearQueue();
  stopTimer();
  cube.reset();
  scene.sync();
  const n = cube.n;
  const len = state.daily ? 8 : state.scrambleLen === 'full' ? FULL[n] : state.scrambleLen;
  const rand = seed != null ? mulberry32(seed) : Math.random;
  let moves;
  for (let tries = 0; tries < 30; tries++) {
    moves = makeScramble(n, len, rand);
    moves.forEach(m => cube.move(m));
    const trivial = cube.solved();
    cube.reset();
    if (!trivial) break;
  }
  Object.assign(state, { mode: 'scrambling', history: [], scrambleCount: 0, scrambleLen0: len, turns: 0, autoTurns: 0, hints: 0, undos: 0, auto: false, elapsed: 0, t0: 0 });
  scene.locked = true;
  scene.spin = 0;
  scene.spotlight(null);
  setNet('live', true);
  updateHud();
  $('hudTip').classList.add('gone');
  await scene.home(0.45);
  let last;
  for (const m of moves) last = scene.turn(m, { source: 'scramble', duration: (reduced ? 0.07 : 0.12) * (cube.n > 4 ? 0.7 : 1) });
  await last;
  state.scrambleCount = state.history.length;
  scene.locked = false;
  state.mode = 'ready';
  updateHud();
  tip('Scrambled · the clock starts on your first turn', 3200);
  announce(`Scrambled with ${len} turns. The clock starts on your first turn.`);
}

function onTurn(move, source) {
  state.lastInteraction = performance.now();
  clearHint();
  if (source === 'reorient') { drawNet(); return; }
  if (source !== 'undo') state.history.push(move);
  if (source === 'scramble') { drawNet(); updateHud(); return; }
  const rot = isRotation(move);
  if (!rot) {
    if (source === 'auto') state.autoTurns++;
    else if (source !== 'undo') state.turns++;
    Sound.click(source === 'auto' ? 0.6 : 1);
  }
  if (state.mode === 'ready' && !rot) { state.mode = 'solving'; state.t0 = performance.now(); startTimer(); }
  if (state.mode === 'solved') { state.mode = 'free'; state.history = [move]; state.scrambleCount = 0; }
  const solved = cube.solved();
  if (solved) {
    if (state.mode === 'solving') finish();
    else if (state.mode === 'free' && state.history.some(m => !isRotation(m))) {
      state.history = []; state.scrambleCount = 0;
      tip('Registered', 1800);
      Sound.chime();
    }
  }
  drawNet();
  updateHud();
  const sc = cube.score();
  announce(solved ? 'Registered.' : `${sc.registered} of ${sc.total} stickers registered.`);
}

function undo() {
  if (!scene.idle || state.mode === 'scrambling' || state.solvingAuto) return;
  if (state.history.length <= state.scrambleCount) return;
  const m = state.history.pop();
  if (!isRotation(m)) { state.turns = Math.max(0, state.turns - 1); state.undos++; }
  scene.turn(invert(m), { source: 'undo' });
}

// ---------------------------------------------------------------- notation, hints, solve playback
/** Standard names in the cube's own frame: R U F L D B, ′ for back, 2 for a half turn, 2R for the second layer in. */
function notation(m, n = cube.n) {
  const sides = [['L', 'R'], ['D', 'U'], ['B', 'F']][m.axis];
  if (m.layers.length === n) return ['x', 'y', 'z'][m.axis] + (m.turns === 2 ? '2' : m.turns === 3 ? '' : '′');
  return m.layers.map(k => {
    const positive = k >= n / 2, depth = positive ? n - 1 - k : k;
    const cw = positive ? 3 : 1;
    return (depth ? depth + 1 : '') + sides[positive ? 1 : 0] + (m.turns === 2 ? '2' : m.turns === cw ? '' : '′');
  }).join('+');
}
const layerSet = m => new Set(cube.cubies.filter(c => m.layers.includes(cube.layerOf(c, m.axis))).map(c => c.index));

/** One precise hint: an arrow on the layer to turn and its name. Press again to play that turn. */
function hint() {
  if (state.mode === 'scrambling' || state.solvingAuto || !scene.idle) return;
  const path = pathHome(state.history, cube.n);
  if (!path.length || cube.solved()) { tip('Already registered'); return; }
  const m = path[0];
  const key = cube.key();
  if (state.hint && state.hint.key === key) {
    clearHint();
    scene.turn(m, { source: 'hint', duration: reduced ? 0.22 : 0.32 });
    return;
  }
  if (state.mode === 'ready' || state.mode === 'solving') state.hints++;
  state.hint = { key, move: m };
  drawHintArrow(m);
  tip(`Hint · ${notation(m)} · press Hint again to play it`, 0);
  Sound.tick();
}

function drawHintArrow(m) {
  const cv = $('hintLayer'), stage = $('stage');
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  const v = scene.hintVector(m);
  if (!v) return;
  const L = Math.max(34, Math.min(120, (r.width / (cube.n * 1.35)) * 1.25));
  const x0 = v.x - v.dx * L / 2, y0 = v.y - v.dy * L / 2, x1 = v.x + v.dx * L / 2, y1 = v.y + v.dy * L / 2;
  const head = (hx, hy, dx, dy) => {
    const size = 11, a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - size * Math.cos(a - 0.5), hy - size * Math.sin(a - 0.5));
    ctx.lineTo(hx - size * Math.cos(a + 0.5), hy - size * Math.sin(a + 0.5));
    ctx.closePath();
  };
  // a white halo under an ink line reads on every colour a Credit can print
  for (const [w, color] of [[9, 'rgba(255,255,255,0.95)'], [3.5, '#111111']]) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    head(x1, y1, v.dx, v.dy); if (w > 5) ctx.stroke(); ctx.fill();
    if (m.turns === 2) { head(x1 - v.dx * 12, y1 - v.dy * 12, v.dx, v.dy); if (w > 5) ctx.stroke(); ctx.fill(); }
  }
  ctx.fillStyle = '#111111';
  ctx.beginPath(); ctx.arc(x0, y0, 4.5, 0, Math.PI * 2); ctx.fill();
}

function clearHint() {
  if (!state.hint) return;
  state.hint = null;
  const cv = $('hintLayer');
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
  if (/^Hint/.test($('hudTip').textContent)) $('hudTip').classList.add('gone');
}

/** The Solve button plays the way home one named turn at a time, each layer lit before it moves. */
async function autoSolve() {
  if (state.solvingAuto) { state.stopSolve = true; return; }
  if (state.mode === 'scrambling' || !scene.idle) return;
  const path = pathHome(state.history, cube.n);
  if (!path.length) return;
  clearHint();
  state.auto = true;
  state.solvingAuto = true;
  state.stopSolve = false;
  if (state.mode === 'ready') { state.mode = 'solving'; state.t0 = performance.now(); startTimer(); }
  scene.locked = true;
  scene.spin = 0;
  updateHud();
  const per = path.length > 60 ? 0.3 : path.length > 24 ? 0.4 : 0.55;
  for (let i = 0; i < path.length; i++) {
    if (state.stopSolve) break;
    const m = path[i];
    const lit = layerSet(m);
    scene.spotlight(si => lit.has(cube.stickers[si].cubie), 0.55);
    tip(`Solving · ${notation(m)} · ${i + 1} of ${path.length}`, 0);
    await scene.hold(per * 0.35);
    await scene.turn(m, { source: 'auto', duration: per * 0.65 });
  }
  scene.spotlight(null);
  scene.locked = false;
  state.solvingAuto = false;
  const stopped = state.stopSolve;
  state.stopSolve = false;
  if (stopped) tip('Stopped · keep going by hand or press Solve', 2400);
  else $('hudTip').classList.add('gone');
  updateHud();
}

function finish() {
  state.mode = 'solved';
  stopTimer();
  state.elapsed = performance.now() - state.t0;
  const daily = state.daily;
  let streak = 0;
  if (daily) {
    const results = store.get('daily', {});
    if (!results[daily.no] || results[daily.no].ms > state.elapsed) results[daily.no] = { turns: state.turns + state.autoTurns, ms: Math.round(state.elapsed), auto: state.auto };
    store.set('daily', results);
    for (let k = daily.no; results[k]; k--) streak++;
  }
  const number = store.get('receipts', 0) + 1;
  store.set('receipts', number);
  const rec = {
    n: cube.n, scramble: state.scrambleLen0, turns: state.turns + state.autoTurns, ms: state.elapsed,
    hints: state.hints, undos: state.undos, auto: state.auto, when: new Date(), daily: daily?.no, streak, number,
    sides: FACES.map((face, f) => { const c = credit(state.sides[f]); return { face, id: state.sides[f], colors: c.colors, print: c.register }; }),
  };
  updateHud();
  setNet('target', true);
  Sound.chime();
  presentFront().then(celebrate).then(() => openReceipt(rec));
}

/** A solve may land in any orientation; turn the whole cube back so each Credit faces its own side. */
async function presentFront() {
  const moves = reorientMoves(cube.score().orientation);
  let last;
  for (const m of moves) last = scene.turn(m, { source: 'reorient', duration: reduced ? 0 : 0.34 });
  if (last) await last;
}
function reorientMoves(index) {
  const G = ROTATIONS[index], I = '1,0,0,0,1,0,0,0,1';
  if (!G || G.join() === I) return [];
  const all = [...Array(cube.n).keys()];
  const gens = [];
  for (const axis of [0, 1, 2]) for (const turns of [1, 2, 3]) gens.push({ axis, layers: all, turns });
  for (const a of gens) if (mul(rotation(a.axis, a.turns), G).join() === I) return [a];
  for (const a of gens) for (const b of gens) if (mul(rotation(b.axis, b.turns), mul(rotation(a.axis, a.turns), G)).join() === I) return [a, b];
  return [];
}

async function celebrate() {
  confetti();
  const inks = [0x00b5e2, 0xe4007c, 0xffd100, 0xffffff];
  if (!reduced) {
    const spin = scene.celebrate();
    for (const c of inks) { scene.flash(c, c === 0xffffff ? 0.22 : 0.5); await wait(140); }
    scene.resetFlash();
    await spin;
  } else scene.resetFlash();
  await wait(reduced ? 150 : 250);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function confetti() {
  if (reduced) return;
  const cv = $('confetti');
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const ctx = cv.getContext('2d');
  const colors = ['#00b5e2', '#e4007c', '#ffd100', '#111111'];
  const parts = Array.from({ length: 160 }, () => {
    const a = Math.random() * Math.PI * 2, v = 260 + Math.random() * 520;
    return { x: r.width / 2, y: r.height * 0.48, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 260, s: 5 + Math.random() * 7, c: colors[(Math.random() * 4) | 0], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 };
  });
  let prev = 0;
  scene.animate(2.3, t => {
    const dt = (t - prev) * 2.3; prev = t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    for (const p of parts) {
      p.vy += 980 * dt; p.vx *= Math.pow(0.35, dt); p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 0.6) / 0.4);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); ctx.restore();
    }
    if (t >= 1) ctx.clearRect(0, 0, r.width, r.height);
  });
}

// ---------------------------------------------------------------- receipt
function snapshotCube(size) {
  return scene.snapshot(size, { yaw: HOME_YAW, pitch: HOME_PITCH });
}

function xIntent(x) {
  const ids = x.sides.map(s => '#' + s.id).join(' ');
  const text = `${x.daily ? `Credits³ Daily № ${x.daily}: ` : ''}registered six Credits on a ${x.n}³ cube in ${x.turns} turns, ${x.time}${x.auto ? ' (with help)' : ''}.\n\n${ids}`;
  const url = !framed && /^https?:/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.host) ? location.href.split('#')[0] + '#' + (x.daily ? 'daily' : `${x.n}-${x.sides.map(s => s.id).join('.')}`) : '';
  return 'https://x.com/intent/post?text=' + encodeURIComponent(text) + (url ? '&url=' + encodeURIComponent(url) : '');
}

function openReceipt(rec) {
  const x = describeReceipt(rec);
  if (x.black && scene.body === 'ink') { scene.setBody('paper'); x.cubeURL = snapshotCube(900); scene.setBody('ink'); }
  else x.cubeURL = snapshotCube(900);
  state.receipt = x;
  const el = $('receipt');
  el.className = 'receipt' + (x.black ? ' black' : '');
  el.innerHTML = receiptHTML(x);
  $('rcPost').href = xIntent(x);
  $('rcNote').hidden = true;
  $('receiptLayer').hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('printed')));
  if (reduced) el.classList.add('printed');
  setTimeout(() => { $('rcAgain').focus({ preventScroll: true }); $('receiptLayer').scrollTop = 0; }, 60);
  announce(`Registered in ${x.turns} turns, ${x.time}. Receipt printed.`);
}

function closeReceipt(back = true) {
  if ($('receiptLayer').hidden) return;
  $('receiptLayer').hidden = true;
  $('receipt').classList.remove('printed');
  if (state.mode === 'solved') { state.mode = 'free'; state.history = []; state.scrambleCount = 0; }
  if (state.daily && back) { state.daily = null; $('navDaily').setAttribute('aria-pressed', 'false'); writeHash(); }
  updateHud();
  if (back) $('btnScramble').focus();
}

async function savePoster(x) {
  const needPaper = x.black && scene.body === 'ink';
  if (needPaper) scene.setBody('paper');
  const img = scene.snapshotCanvas(1560, { yaw: HOME_YAW, pitch: HOME_PITCH });
  if (needPaper) scene.setBody('ink');
  const cv = await posterCanvas(x, img, faceCanvases);
  await deliver(cv, `credits3-${x.daily ? 'daily-' + x.daily : 'receipt-' + String(x.number).padStart(4, '0')}.png`, $('rcNote'));
}

/** Download where the browser allows it; inside a sandboxed frame show the image to save by hand. */
async function deliver(cv, name, noteEl) {
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  if (!framed) {
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return;
  }
  void noteEl;
  $('saveImg').src = url;
  $('saveImg').alt = name.replace(/\.png$/, '').replace(/-/g, ' ');
  $('saveLayer').hidden = false;
  $('saveClose').focus({ preventScroll: true });
}
function closeSave() {
  if ($('saveLayer').hidden) return false;
  $('saveLayer').hidden = true;
  const src = $('saveImg').src;
  $('saveImg').removeAttribute('src');
  if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  return true;
}

async function exportCube() {
  // the cube as it is now, on a Credit-sized print with its six sides underneath
  const img = scene.snapshotCanvas(1560, { yaw: HOME_YAW, pitch: HOME_PITCH });
  try { await document.fonts.ready; } catch {}
  const W = 2400, H = 3000, M = 150;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, (W - 1560) / 2, 250, 1560, 1560);
  const net = netCanvas(faceCanvases, 230, 0, '#e3e3e3');
  ctx.drawImage(net, (W - net.width) / 2, 1960);
  ctx.fillStyle = '#111111'; ctx.font = '700 44px "Geist Mono", Menlo, monospace'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('CREDITS³', M, 210);
  ctx.fillStyle = '#8e8e8e'; ctx.font = '400 36px "Geist Mono", Menlo, monospace'; ctx.textAlign = 'right';
  const sc = cube.score();
  ctx.fillText(sc.registered === sc.total ? 'REGISTERED' : `REGISTERED ${sc.registered} / ${sc.total}`, W - M, 210);
  ctx.textAlign = 'left';
  ctx.fillText(FACES.map((f, i) => `${f} #${state.sides[i]}`).join('   '), M, H - 160);
  await deliver(cv, `credits3-${state.sides.join('-')}.png`, null);
}

async function exportProject() {
  const lines = [...document.querySelectorAll('#copy p')].map(p => p.textContent.trim());
  await deliver(await projectPoster(lines), 'credits3-project.png');
}
async function exportProcess() {
  const id = state.sides[state.selected], c = credit(id);
  if (!c) return;
  await deliver(await processPoster(c, cube.n, { cutColor: scene.body === 'paper' ? '#cfcdc6' : '#111111' }), `credits3-process-${id}.png`);
}

// ---------------------------------------------------------------- new Credits: every side as it is right now
const remixTiles = [...document.querySelectorAll('.remix-tile')];

/** Where every sticker sits, grouped by the face it is on. */
function placements() {
  const groups = [[], [], [], [], [], []];
  for (const s of cube.stickers) { const w = cube.where(s); groups[w.face].push({ s, w }); }
  return groups;
}
const sideGrids = () => state.sides.map(id => { const c = credit(id); return c ? pixelGrid(c) : new Uint8Array(64); });

/** What one face is now: its 64 cells (pixel cube), whether it is still an original, and which sides fed it. */
function faceInfo(group, grids) {
  const n = cube.n;
  const from = new Set(group.map(({ s }) => s.face));
  let cells = null, original = null;
  if (grids) {
    cells = new Uint8Array(64);
    for (const { s, w } of group) cells[w.row * 8 + w.col] = grids[s.face][s.row * 8 + s.col];
    const k = grids.findIndex(g => g.every((v, i) => v === cells[i]));
    if (k >= 0) original = state.sides[k];
  } else if (from.size === 1) {
    // a whole side, maybe turned: every sticker from one Credit, each where a rotation of home puts it
    const h = group[0].s.face, K = group[0].w.k;
    const rot = (r, c) => (K === 0 ? [r, c] : K === 1 ? [c, n - 1 - r] : K === 2 ? [n - 1 - r, n - 1 - c] : [n - 1 - c, r]);
    if (group.every(({ s, w }) => { const [r, c] = rot(s.row, s.col); return w.k === K && w.row === r && w.col === c; })) original = state.sides[h];
  }
  return { cells, original, from };
}

/**
 * Texture cubes: the face rebuilt cell by cell from the stickers now on it (each turned
 * as it sits), then printed where a Credit keeps its 12 × 12 raster. Working on the grid
 * rather than scaling sticker images keeps every square crisp: no seams, no bleed.
 */
function paintCollage(ctx, group, x, y, size) {
  const n = cube.n, m = GRID / n, out = new Uint8Array(GRID * GRID);
  const grids = state.sides.map(id => { const c = credit(id); return c ? faceGrid(c, state.visible) : new Uint8Array(GRID * GRID); });
  for (const { s, w } of group) {
    const g = grids[s.face];
    for (let yy = 0; yy < m; yy++) for (let xx = 0; xx < m; xx++) {
      // cell (xx, yy) of a block turned k times clockwise comes from (sx, sy) of the original, as in stickerSignature
      const sx = w.k === 0 ? xx : w.k === 1 ? yy : w.k === 2 ? m - 1 - xx : m - 1 - yy;
      const sy = w.k === 0 ? yy : w.k === 1 ? m - 1 - xx : w.k === 2 ? m - 1 - yy : xx;
      out[(w.row * m + yy) * GRID + w.col * m + xx] = g[(s.row * m + sy) * GRID + s.col * m + sx];
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  paintGrid(ctx, out, x + size * 0.125, y + size * 0.125, size * 0.75);
}

function paintFace(ctx, f, x, y, size, groups = placements(), grids = isPixel() ? sideGrids() : null) {
  const info = faceInfo(groups[f], grids);
  if (info.cells) paintNewCredit(ctx, info.cells, x, y, size);
  else paintCollage(ctx, groups[f], x, y, size);
  return info;
}

function sizeRemixCanvases() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  for (const tile of remixTiles) {
    const cv = tile.querySelector('canvas');
    const px = Math.max(80, Math.round(cv.getBoundingClientRect().width * dpr));
    if (cv.width !== px) cv.width = cv.height = px;
  }
  drawRemix();
}

function drawRemix() {
  if (!remixTiles.length || !scene) return;
  const groups = placements(), grids = isPixel() ? sideGrids() : null;
  for (const tile of remixTiles) {
    const f = +tile.dataset.face, cv = tile.querySelector('canvas');
    const info = paintFace(cv.getContext('2d'), f, 0, 0, cv.width, groups, grids);
    const label = tile.querySelector('.rt-state');
    label.textContent = info.original ? `Original #${info.original}` : `New · from ${info.from.size} Credit${info.from.size > 1 ? 's' : ''}`;
    label.classList.toggle('new', !info.original);
    tile.dataset.original = info.original ? '1' : '';
  }
}

/** One new Credit, 2400 × 3000 like jack.art's exports: the art, then the six sides it can draw from (faded if unused here). */
async function exportNewCredit(f) {
  const W = 2400, H = 3000;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const info = paintFace(ctx, f, 0, 0, W);
  ctx.fillStyle = '#e3e3e3';
  ctx.fillRect(0, W, W, 2);
  NET_ORDER.forEach((side, i) => {
    const c = credit(state.sides[side]);
    if (i) ctx.fillRect(i * 400, W, 2, H - W);
    if (!c) return;
    ctx.save();
    ctx.globalAlpha = info.from.has(side) ? 1 : 0.15;
    paintCredit(ctx, c, i * 400 + 80, W + 180, 240);
    ctx.restore();
  });
  await deliver(cv, `credits3-new-${FACES[f]}-${state.sides.join('-')}.png`);
}

/** All six new Credits on one sheet, the way a Statement lays Credits out. */
async function exportAllNew() {
  const W = 2400, H = 3000, pad = W * 0.08;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const groups = placements(), grids = isPixel() ? sideGrids() : null;
  const cw = (W - 2 * pad) / 2, ch = (H - 2 * pad) / 3, size = Math.min(cw, ch) * 0.94;
  NET_ORDER.forEach((f, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    paintFace(ctx, f, pad + col * cw + (cw - size) / 2, pad + row * ch + (ch - size) / 2, size, groups, grids);
  });
  await deliver(cv, `credits3-new-six-${state.sides.join('-')}.png`);
}

remixTiles.forEach(tile => { tile.querySelector('.rt-png').onclick = () => exportNewCredit(+tile.dataset.face); });
$('btnRemixAll').onclick = () => exportAllNew();

// ---------------------------------------------------------------- random Credits
$('btnRandomIds').onclick = () => {
  if (!D.ready()) { tip('Loading 122,154 Credits…'); return; }
  state.daily = null;
  setSides(randomIds(6), 'Random');
  Sound.tick();
};
document.querySelectorAll('.dice').forEach(b => b.onclick = e => {
  e.stopPropagation();
  if (!D.ready()) return;
  const f = +b.dataset.face, [id] = randomIds(1);
  state.daily = null;
  setSide(f, id, { label: 'Mixed' });
  if (state.selected === f) $('edId').value = id;
  Sound.tick();
});

// ---------------------------------------------------------------- keyboard
const WORLD = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
function faceMove(letter, prime, depth = 0, layersOverride = null) {
  const face = scene.faceToward(new THREE.Vector3(...WORLD[letter]));
  const nrm = FACE_DEF[face].n;
  const axis = nrm.findIndex(v => v !== 0), s = nrm[axis];
  const layer = s > 0 ? cube.n - 1 - depth : depth;
  let turns = s > 0 ? 3 : 1;
  if (prime) turns = 4 - turns;
  return { axis, layers: layersOverride || [layer], turns };
}
const middle = () => { const n = cube.n; return n === 3 ? [1] : n === 4 ? [1, 2] : []; };

function keyMove(key, shift, alt) {
  if (state.mode === 'scrambling' || state.solvingAuto || !$('receiptLayer').hidden) return;
  const up = key.toUpperCase();
  let m = null;
  if ('UDLRFB'.includes(up)) m = faceMove(up, shift, alt && cube.n > 2 ? 1 : 0);
  else if (up === 'M' && middle().length) m = faceMove('L', shift, 0, middle());
  else if (up === 'E' && middle().length) m = faceMove('D', shift, 0, middle());
  else if (up === 'S' && middle().length) m = faceMove('F', shift, 0, middle());
  else if ('XYZ'.includes(up)) m = faceMove({ X: 'R', Y: 'U', Z: 'F' }[up], shift, 0, [...Array(cube.n).keys()]);
  if (!m) return;
  noteInteraction();
  scene.turn(m, { source: 'key' });
}

function noteInteraction(keepHint = false) {
  state.lastInteraction = performance.now();
  scene.spin = 0;
  if (!keepHint) clearHint();
  if (!state.solvingAuto && !(keepHint && state.hint)) $('hudTip').classList.add('gone');
}

document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (!$('saveLayer').hidden) { if (e.key === 'Escape') closeSave(); return; }
  if (!$('receiptLayer').hidden) { if (e.key === 'Escape') closeReceipt(); return; }
  if (e.ctrlKey || e.metaKey) { if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); } return; }
  if (e.target.closest && e.target.closest('button, a') && (e.key === ' ' || e.key === 'Enter')) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); doScramble(); return; }
  if (k === 'Backspace') { e.preventDefault(); undo(); return; }
  if (k.length === 1 && /[udlrfbmesxyz]/i.test(k)) { e.preventDefault(); keyMove(k, e.shiftKey, e.altKey); return; }
  if (k === 'h' || k === 'H') { hint(); return; }
  const orbit = { ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0], ArrowUp: [0, -0.35], ArrowDown: [0, 0.35] }[k];
  if (orbit && e.target === document.body || orbit && e.target.id === 'stage') {
    e.preventDefault(); noteInteraction();
    const y0 = scene.yaw, p0 = scene.pitch;
    scene.animate(reduced ? 0 : 0.25, t => { scene.yaw = y0 + orbit[0] * t; scene.pitch = Math.max(-1.35, Math.min(1.35, p0 + orbit[1] * t)); });
  }
});

// ---------------------------------------------------------------- controls
$('btnScramble').onclick = () => { noteInteraction(); doScramble(); };
$('btnUndo').onclick = () => { noteInteraction(); undo(); };
$('btnHint').onclick = () => { noteInteraction(true); hint(); };
$('btnSolve').onclick = () => { noteInteraction(true); autoSolve(); };
$('btnPng').onclick = () => exportCube();
$('btnProjectPng').onclick = () => exportProject();
$('btnProcessPng').onclick = () => exportProcess();
$('saveClose').onclick = () => closeSave();
$('saveLayer').addEventListener('click', e => { if (e.target === $('saveLayer')) closeSave(); });

document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => setSize(+b.dataset.size));
document.querySelectorAll('[data-len]').forEach(b => b.onclick = () => {
  state.scrambleLen = b.dataset.len === 'full' ? 'full' : +b.dataset.len;
  document.querySelectorAll('[data-len]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  Sound.tick();
});
document.querySelectorAll('[data-body]').forEach(b => b.onclick = () => { state.bodyChoice = b.dataset.body; store.set('body', state.bodyChoice); applyBody(); });

document.querySelectorAll('.plate').forEach(b => b.onclick = () => {
  const bit = 1 << +b.dataset.layer;
  state.visible ^= bit;
  b.setAttribute('aria-pressed', String(!!(state.visible & bit)));
  drawAllFaces(); drawNet();
  Sound.tick();
});

function setSize(n) {
  if (n === cube.n || state.mode === 'scrambling' || state.solvingAuto) return;
  closeReceipt(false);
  stopTimer();
  cube = new Cube(n);
  state.n = n;
  drawAllFaces();
  Object.assign(state, { mode: 'free', history: [], scrambleCount: 0, turns: 0, autoTurns: 0, hints: 0, undos: 0, elapsed: 0, auto: false });
  if (state.daily && n !== 3) { state.daily = null; $('navDaily').setAttribute('aria-pressed', 'false'); }
  updateSignatures();
  scene.build(cube, faceCanvases);
  document.querySelectorAll('[data-size]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.size === n)));
  setNet('target', true);
  updateHud(); updateDiagram(); writeHash(); drawRemix();
  if (n === PIXEL) tip('8³ · every pixel of every Credit is a piece', 3200);
  Sound.tick();
}

// sides: select, hover, edit
let lastPointer = 'mouse';
document.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; }, { capture: true, passive: true });
sideButtons.forEach(b => {
  const f = +b.dataset.face;
  // a tap should light the side up, not throw a keyboard over the page
  b.onclick = () => { select(f); if (lastPointer !== 'touch') { $('edId').focus({ preventScroll: true }); $('edId').select(); } };
  b.onpointerenter = e => { if (e.pointerType === 'mouse') { clearTimeout(spotTimer); scene.spotlight(si => cube.stickers[si].face === f); } };
  b.onpointerleave = e => { if (e.pointerType === 'mouse') scene.spotlight(null); };
});

const edId = $('edId');
let editTimer = 0;
function tryId(raw, animate) {
  const s = String(raw).trim().replace(/^#/, '');
  if (!s) return;
  const id = Number(s);
  const msg = $('edMsg');
  if (!/^\d+$/.test(s) || id < 1 || id > D.count()) {
    edId.setAttribute('aria-invalid', 'true');
    msg.className = 'ed-msg';
    msg.textContent = `Credits run from #1 to #${D.count().toLocaleString('en-US')}.`;
    return;
  }
  if (!D.ready() && !D.has(id)) { msg.className = 'ed-msg ok'; msg.textContent = 'Loading 122,154 Credits…'; D.load().then(() => tryId(s, animate)); return; }
  edId.setAttribute('aria-invalid', 'false');
  if (state.sides[state.selected] !== id) setSide(state.selected, id, { animate });
  else updateEditor();
}
edId.addEventListener('input', () => { clearTimeout(editTimer); editTimer = setTimeout(() => tryId(edId.value, false), 90); });
edId.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 100 : 1);
    stepId(step);
  }
});
$('editor').addEventListener('submit', e => { e.preventDefault(); tryId(edId.value, true); spotlightFace(state.selected, 1200); });
edId.addEventListener('blur', () => { if (edId.value.trim() && Number(edId.value) !== state.sides[state.selected]) tryId(edId.value, true); else updateEditor(); });
function stepId(step) {
  const n = D.count();
  const next = ((state.sides[state.selected] - 1 + step) % n + n) % n + 1;
  if (!D.has(next)) return;
  setSide(state.selected, next, { animate: false });
  edId.value = next;
}
$('edPrev').onclick = () => stepId(-1);
$('edNext').onclick = () => stepId(1);
$('edRandom').onclick = () => { const [id] = randomIds(1); setSide(state.selected, id); edId.value = id; };

$('btnRandom').onclick = () => { if (D.ready()) { state.daily = null; setSides(randomIds(6), 'Random'); } };
$('btnOrdered').onclick = () => {
  if (!orderedGroups) return;
  const pool = orderedGroups.filter(g => g !== lastGroup);
  const g = pool[(Math.random() * pool.length) | 0];
  lastGroup = g;
  state.daily = null;
  setSides(randomIds(6, g[1]), g[0]);
};
$('btnLive').onclick = () => setNet(state.net === 'live' ? 'target' : 'live');

// wallet
$('btnWallet').onclick = () => {
  const w = $('wallet');
  w.hidden = !w.hidden;
  $('btnWallet').setAttribute('aria-pressed', String(!w.hidden));
  if (!w.hidden) $('walletAddr').focus();
};
let walletIds = [];
$('walletForm').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = $('walletMsg'), grid = $('walletGrid');
  const input = $('walletAddr').value;
  if (!input.trim()) { msg.textContent = 'Paste an address or an ENS name.'; return; }
  msg.textContent = 'Looking up…';
  grid.innerHTML = ''; $('walletActions').hidden = true;
  try {
    await D.load();
    const addr = await Wallet.resolve(input);
    const ids = await Wallet.tokensOf(addr);
    walletIds = ids;
    if (!ids.length) { msg.textContent = `${Wallet.short(addr)} holds no Credits.`; return; }
    msg.textContent = `${Wallet.short(addr)} holds ${ids.length.toLocaleString('en-US')} Credit${ids.length > 1 ? 's' : ''}${ids.length > 240 ? ' · showing the first 240' : ''}.`;
    const frag = document.createDocumentFragment();
    for (const id of ids.slice(0, 240)) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.id = id; b.setAttribute('aria-label', `Put Credit ${id} on the selected side`);
      const cv = document.createElement('canvas'); cv.width = cv.height = 96;
      const c = credit(id);
      if (c) paintCredit(cv.getContext('2d'), c, 0, 0, 96);
      const s = document.createElement('span'); s.textContent = id;
      b.append(cv, s);
      frag.append(b);
    }
    grid.append(frag);
    $('walletActions').hidden = false;
    state.walletLabel = 'Wallet ' + Wallet.short(addr);
  } catch (err) {
    const code = err && err.code;
    msg.textContent = code === 'format' ? 'That is not an address or an ENS name.'
      : code === 'no-name' ? 'That name does not point to an address.'
      : framed ? 'This view blocks network requests. Open the site itself to load a wallet, or type Credit numbers.'
      : 'Could not reach Ethereum. Try again, or type Credit numbers.';
  }
});
$('walletGrid').addEventListener('click', e => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  const id = +b.dataset.id;
  setSide(state.selected, id, { label: state.walletLabel });
  const k = NET_ORDER.indexOf(state.selected);
  select(NET_ORDER[(k + 1) % 6], { look: false, flash: false });
});
$('walletFill').onclick = () => {
  if (!walletIds.length) return;
  const six = walletIds.length <= 6 ? walletIds.slice() : randomIds(6, walletIds);
  while (six.length < 6) six.push(six[six.length % Math.max(1, walletIds.length)]);
  state.daily = null;
  setSides(six, state.walletLabel);
};

// receipt
$('rcClose').onclick = () => closeReceipt();
$('rcAgain').onclick = () => { closeReceipt(false); doScramble(); };
$('rcPng').onclick = () => state.receipt && savePoster(state.receipt);
$('receiptLayer').addEventListener('click', e => { if (e.target === $('receiptLayer')) closeReceipt(); });

// daily
function dailyNumber() { const d = new Date(); return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - DAILY_EPOCH) / 864e5) + 1; }
async function startDaily() {
  if (state.mode === 'scrambling' || state.solvingAuto) return;
  await D.load();
  const no = dailyNumber();
  const rand = mulberry32(0xc3c3 + no * 7919);
  const ids = new Set();
  while (ids.size < 6) ids.add(1 + Math.floor(rand() * D.count()));
  if (cube.n !== 3) setSize(3);
  state.daily = { no };
  $('navDaily').setAttribute('aria-pressed', 'true');
  setSides([...ids], `Daily № ${no}`);
  try { history.replaceState(null, '', '#daily'); } catch {}
  await wait(reduced ? 0 : 900);
  doScramble(0xda11 + no);
}
$('navDaily').onclick = () => { if (state.daily) { state.daily = null; $('navDaily').setAttribute('aria-pressed', 'false'); cube.reset(); scene.sync(); Object.assign(state, { mode: 'free', history: [], scrambleCount: 0 }); stopTimer(); writeHash(); updateHud(); drawNet(); } else startDaily(); };

// theme, body, sound
function darkNow() {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function applyTheme() {
  $('navTheme').textContent = darkNow() ? 'Light' : 'Dark';
  applyBody();
  updateDiagram();
}
function applyBody() {
  const body = state.bodyChoice || (darkNow() ? 'paper' : 'ink');
  scene.setBody(body);
  scene.setGroundTone(darkNow());
  scene.setOutlineColor(darkNow() ? 0xececec : 0x111111);
  document.querySelectorAll('[data-body]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.body === body)));
  drawNet();
  updateDiagram();
}
$('navTheme').onclick = () => {
  const next = darkNow() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  store.set('theme', next);
  applyTheme();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

Sound.setOn(store.get('sound', true));
function paintSound() { $('navSound').textContent = Sound.isOn() ? 'Sound on' : 'Sound off'; $('navSound').setAttribute('aria-pressed', String(Sound.isOn())); }
$('navSound').onclick = () => { Sound.setOn(!Sound.isOn()); store.set('sound', Sound.isOn()); paintSound(); Sound.tick(); };
paintSound();

function paintMotion() { $('navMotion').textContent = reduced ? 'Motion off' : 'Motion on'; $('navMotion').setAttribute('aria-pressed', String(!reduced)); }
$('navMotion').onclick = () => {
  reduced = !reduced;
  try { localStorage.setItem('c3-motion', JSON.stringify(!reduced)); } catch {}
  scene.reduced = reduced;
  scene.spin = !reduced && state.mode === 'free' && cube.solved() ? 0.12 : 0;
  scene.request();
  paintMotion();
  Sound.tick();
};
paintMotion();

$('brand').onclick = e => { e.preventDefault(); scene.home(); window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); };

// ---------------------------------------------------------------- boot
function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'daily') return { daily: true };
  const m = h.match(/^([2348])-(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { n: +m[1], sides: m.slice(2, 8).map(Number) };
}

function boot() {
  const theme = store.get('theme', null);
  if (theme && !document.documentElement.getAttribute('data-theme')) document.documentElement.setAttribute('data-theme', theme);
  const fromHash = readHash();
  if (fromHash?.n && fromHash.n !== 3) { state.n = fromHash.n; cube = new Cube(state.n); }
  try {
    scene = new Scene($('stage'), {
      reduced,
      onTurn,
      onPointerTurnStart: () => noteInteraction(),
      onChange: kind => { if (kind === 'tap' || kind === 'tap-cube') noteInteraction(); },
    });
  } catch (err) {
    $('hudTip').textContent = 'This browser cannot draw the cube (WebGL is off). The sides below still work.';
    $('hudTip').classList.remove('gone');
    throw err;
  }
  $('stage').addEventListener('pointerdown', () => noteInteraction(), { passive: true });
  document.querySelectorAll('[data-size]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.size === cube.n)));
  drawAllFaces();
  updateSignatures();
  scene.build(cube, faceCanvases);
  applyTheme();
  new ResizeObserver(sizeNetCanvases).observe($('net'));
  sizeNetCanvases();
  new ResizeObserver(sizeRemixCanvases).observe($('remixGrid'));
  sizeRemixCanvases();
  updateEditor();
  updateHud();
  if (!reduced) { printFaces(NET_ORDER, { stagger: 0.14, dur: 1.1 }); scene.spin = 0.16; }
  D.load().then(() => {
    buildGroups();
    if (fromHash?.sides && fromHash.sides.every(id => D.has(id)) && fromHash.sides.join() !== DEFAULT_SIDES.join()) { state.sides = fromHash.sides; state.sidesLabel = ''; updateSignatures(); drawAllFaces(); drawNet(); }
    updateEditor();
    if (fromHash?.daily) startDaily();
  }).catch(() => {
    $('edMsg').className = 'ed-msg';
    $('edMsg').textContent = 'The Credits data did not load. Refresh to try again.';
  });
  // idle turntable comes back after a quiet spell
  setInterval(() => {
    if (reduced || state.mode !== 'free' || !scene.idle || !$('receiptLayer').hidden) return;
    if (performance.now() - state.lastInteraction > 14000 && !scene.spin && cube.solved()) { scene.spin = 0.12; scene.request(); }
  }, 2000);
}

/** The header's GitHub button shows the live star count (cached an hour: the API allows 60 calls an hour per visitor). */
async function showStars() {
  const el = $('starCount');
  if (!el) return;
  const paint = n => { if (n > 0) { el.textContent = n.toLocaleString('en-US'); el.hidden = false; el.parentElement.setAttribute('aria-label', `Star Credits³ on GitHub, ${n} stars`); } };
  const cached = store.get('stars', null);
  if (cached) paint(cached.n);
  if (cached && Date.now() - cached.at < 36e5) return;
  try {
    const r = await fetch('https://api.github.com/repos/winchxyz/credits-cubed');
    if (!r.ok) return;
    const n = (await r.json()).stargazers_count;
    if (typeof n === 'number') { store.set('stars', { n, at: Date.now() }); paint(n); }
  } catch {}
}

boot();
showStars();
// README screenshots only: tools/shoot.mjs opens the page with ?shoot=<scene>
if (params.get('shoot')) import('../tools/shoot-scenarios.js').then(m => m.run(params.get('shoot'), window.C3)).catch(() => {});

// ---------------------------------------------------------------- debug hooks (used to test in a paused preview)
window.C3 = {
  state, get cube() { return cube; }, get scene() { return scene; }, faceCanvases,
  step(sec = 1, fps = 60) { const n = Math.round(sec * fps); for (let i = 0; i < n; i++) scene.step(1 / fps); scene.render(); drawNet(); },
  async shot(name = 'shot', size) {
    const url = size ? scene.snapshot(size) : (scene.render(), scene.renderer.domElement.toDataURL('image/jpeg', 0.92));
    const r = await fetch('/__shot', { method: 'POST', body: JSON.stringify({ name, data: url }) });
    return r.json();
  },
  async saveCanvas(name, cv) { const r = await fetch('/__shot', { method: 'POST', body: JSON.stringify({ name, data: cv.toDataURL('image/jpeg', 0.92) }) }); return r.json(); },
  moves(str) { for (const t of str.trim().split(/\s+/)) keyMove(t[0], t.includes("'"), false); },
  scramble: s => doScramble(s), solve: autoSolve, hint, undo, setSides, setSize, setSide, finish, openReceipt, describeReceipt, startDaily,
  view(yaw, pitch) { scene.yaw = yaw; scene.pitch = pitch; scene.spin = 0; scene.render(); },
};
