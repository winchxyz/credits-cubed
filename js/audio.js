// Synthesised sounds: a plastic click per turn, a four-ink chime on a solve.
let ctx = null;
let on = true;

export const setOn = v => { on = !!v; };
export const isOn = () => on;

function ac() {
  if (!ctx) {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    try { ctx = new A(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function click(strength = 1) {
  if (!on) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + 0.001;
  const len = Math.floor(a.sampleRate * 0.03);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2100 + Math.random() * 900;
  bp.Q.value = 1.4;
  const g = a.createGain();
  g.gain.value = 0.28 * strength;
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
  const o = a.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(210 + Math.random() * 30, t);
  o.frequency.exponentialRampToValueAtTime(95, t + 0.05);
  const og = a.createGain();
  og.gain.setValueAtTime(0.09 * strength, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  o.connect(og).connect(a.destination);
  o.start(t);
  o.stop(t + 0.09);
}

/** C, M, Y, K: four soft notes, one per ink. */
export function chime() {
  if (!on) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + 0.02;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const t = t0 + i * 0.11;
    for (const detune of [-4, 4]) {
      const o = a.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = detune;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 1.5);
    }
  });
}

export function tick() {
  if (!on) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + 0.001;
  const o = a.createOscillator();
  o.type = 'square';
  o.frequency.value = 1760;
  const g = a.createGain();
  g.gain.setValueAtTime(0.018, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + 0.03);
}
