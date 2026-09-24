// A solve prints a receipt. Like a Credit, each 8 on it registers visually:
// one proof-bar mark per 8 in the time and turn count (trailing CMYK, four
// at most), and five or more turn the whole receipt black.
import { CSS } from './credit.js';
import { FACES } from './cube.js';

export const TIERS = ['Common', 'Uncommon', 'Rare', 'Ultra', 'Hyper'];
export const SIDE_NAMES = ['Top', 'Right', 'Front', 'Bottom', 'Left', 'Back'];

export function clock(ms) {
  const t = Math.max(0, Math.floor(ms / 100));
  const tenths = t % 10, s = Math.floor(t / 10) % 60, m = Math.floor(t / 600) % 60, h = Math.floor(t / 36000);
  const two = n => String(n).padStart(2, '0');
  return (h ? h + ':' + two(m) : two(m)) + ':' + two(s) + '.' + tenths;
}

export function eightsIn(...values) { return values.join('').split('').filter(c => c === '8').length; }

/** Proof-bar colours for `n` eights, exactly as CreditDrawing.body lays them out. */
export function bar(n) {
  const k = Math.min(4, n), out = [];
  for (let i = 0; i < k; i++) out.push(CSS[1 << (4 - k + i)]);
  return out;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function describeReceipt(r) {
  const time = clock(r.ms);
  const eights = eightsIn(time, r.turns);
  const assist = r.auto ? 'Solved for you' : r.hints ? `${r.hints} hint${r.hints > 1 ? 's' : ''}` : 'None';
  const d = r.when;
  const date = d.toISOString().slice(0, 10);
  const hms = d.toISOString().slice(11, 19) + ' UTC';
  return {
    ...r, time, eights, tier: TIERS[Math.min(4, eights)], black: eights >= 5, assist, date, hms,
    lines: [
      ['Cube', `${r.n} × ${r.n} × ${r.n} · ${6 * r.n * r.n} stickers`],
      ['Scramble', `${r.scramble} turns`],
      ['Solve', `${r.turns} turns`],
      ['Time', time],
      ['Assist', assist],
      ...(r.undos ? [['Undo', `${r.undos}`]] : []),
      ...(r.streak > 1 ? [['Streak', `${r.streak} days`]] : []),
    ],
  };
}

const MARK = '<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 0v26M0 13h26" stroke="currentColor" stroke-width="1.6"/><circle cx="13" cy="13" r="3" fill="currentColor"/></svg>';

export function receiptHTML(x) {
  const sides = x.sides.map(s => `<div class="rc-line"><span><span class="muted">${s.face}</span><span>#${s.id}</span></span><b>${esc(s.colors)} · ${esc(s.print)}</b></div>`).join('');
  const marks = bar(x.eights).map(c => `<i style="background:${c}"></i>`).join('');
  return `
    <div class="rc-head"><span class="rc-title">Credits³</span><span class="muted">${x.daily ? `Daily № ${x.daily}` : `Receipt № ${String(x.number).padStart(4, '0')}`}</span></div>
    <div class="rc-stamp" id="rcTitle">${MARK}Registered</div>
    <p class="muted">${x.date} · ${x.hms}</p>
    <hr class="rc-rule">
    ${x.lines.map(([k, v]) => `<div class="rc-line"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
    <hr class="rc-rule">
    <div class="rc-sides">${sides}</div>
    <hr class="rc-rule">
    ${x.cubeURL ? `<img class="rc-img" src="${x.cubeURL}" alt="The solved cube">` : ''}
    <div class="rc-line"><span>Eights</span><b>${x.eights ? `${x.eights} · ${x.tier}` : 'None'}</b></div>
    <div class="rc-foot"><span class="muted">Made from acts of patience.</span><span class="rc-bar" aria-label="${x.eights} eights">${marks}</span></div>`;
}

/** The six sides unfolded, drawn from the face canvases. */
export function netCanvas(faces, cell = 200, gap = 0, line = '#e3e3e3') {
  const cv = document.createElement('canvas');
  cv.width = cell * 4 + gap * 3; cv.height = cell * 3 + gap * 2;
  const ctx = cv.getContext('2d');
  const at = { 0: [1, 0], 4: [0, 1], 2: [1, 1], 1: [2, 1], 5: [3, 1], 3: [1, 2] };
  for (const [f, [cx, cy]] of Object.entries(at)) {
    const x = cx * (cell + gap), y = cy * (cell + gap);
    ctx.drawImage(faces[f], x, y, cell, cell);
    ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, cell / 160);
    ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, cell - ctx.lineWidth, cell - ctx.lineWidth);
  }
  return cv;
}

/** 2400 × 3000, the size jack.art exports Credits at. */
export async function posterCanvas(x, cubeImg, faces) {
  try { await document.fonts.ready; } catch {}
  const W = 2400, H = 3000, M = 150;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const ink = x.black ? '#f2f2f2' : '#111111', muted = x.black ? '#8a8a8a' : '#8e8e8e', rule = x.black ? '#333333' : '#e3e3e3';
  ctx.fillStyle = x.black ? '#111111' : '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const font = (w, s) => `${w} ${s}px "Geist Mono", "SF Mono", Menlo, monospace`;
  const text = (s, px, py, { w = 400, size = 40, color = ink, align = 'left' } = {}) => {
    ctx.font = font(w, size); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(s).toUpperCase(), px, py);
  };
  text('Credits³', M, 210, { w: 700, size: 44 });
  text(x.daily ? `Daily № ${x.daily}` : `Receipt № ${String(x.number).padStart(4, '0')}`, W - M, 210, { color: muted, size: 40, align: 'right' });
  if (cubeImg) ctx.drawImage(cubeImg, (W - 1560) / 2, 290, 1560, 1560);
  // stamp
  text('Registered', M, 1990, { w: 700, size: 92 });
  text(`${x.date} · ${x.hms}`, M, 2070, { color: muted, size: 36 });
  let y = 2190;
  for (const [k, v] of x.lines) {
    text(k, M, y, { color: muted, size: 36 });
    text(v, M + 330, y, { size: 36, w: 500 });
    y += 62;
  }
  const net = netCanvas(faces, 200, 0, rule);
  const nx = W - M - net.width, ny = 1940;
  ctx.drawImage(net, nx, ny);
  const sy = ny + net.height + 72;
  x.sides.forEach((s, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    text(`${s.face} #${s.id}`, nx + col * (net.width / 3), sy + row * 54, { size: 30 });
  });
  ctx.fillStyle = rule; ctx.fillRect(M, H - 250, W - 2 * M, 2);
  text('Made from acts of patience.', M, H - 160, { color: muted, size: 36 });
  text(x.eights ? `Eights ${x.eights} · ${x.tier}` : 'Eights none', M, H - 100, { color: muted, size: 36 });
  const marks = bar(x.eights);
  marks.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(W - M - (marks.length - i) * 60, H - 190, 60, 60); });
  return cv;
}

export { FACES };
