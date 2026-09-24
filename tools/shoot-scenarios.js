// Page states for README screenshots. Loaded only when the URL carries ?shoot=<name>;
// tools/shoot.mjs opens those URLs in headless Chrome and saves what it sees.
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = sel => document.querySelector(sel).click();
// headless screenshots ignore scrolling, so a lower section is shot by hiding everything above it
const only = sel => {
  const st = document.createElement('style');
  st.textContent = `main > :not(${sel}) { display: none !important; } ${sel} { margin-top: 0 !important; padding-top: 0 !important; }`;
  document.head.append(st);
  dispatchEvent(new Event('resize'));
};

async function ready(C3) {
  for (let i = 0; i < 200 && document.getElementById('btnRandom').disabled; i++) await wait(50);
  C3.state.lastInteraction = Infinity; // no idle turntable while the shot is framed
  C3.step(3);
  C3.scene.spin = 0;
}
async function settle(C3, sec = 3) {
  for (let i = 0; i < sec * 20; i++) { C3.scene.step(0.05); await Promise.resolve(); await Promise.resolve(); }
  C3.scene.render();
}

const scenes = {
  async hero(C3) { C3.view(-0.62, 0.5); },
  async dark(C3) { document.documentElement.setAttribute('data-theme', 'dark'); await wait(50); C3.view(-0.62, 0.5); },
  async scrambled(C3) { C3.scramble(4242); await settle(C3, 4); C3.view(-0.62, 0.5); },
  async pixels(C3) { C3.setSize(8); await settle(C3, 0.5); click('[data-body="ink"]'); C3.scramble(88); await settle(C3, 9); C3.view(-0.62, 0.5); },
  async flat(C3) { C3.setSize(8); await settle(C3, 0.5); click('[data-body="flat"]'); await settle(C3, 0.3); C3.scramble(88); await settle(C3, 9); C3.view(-0.62, 0.5); },
  async remix(C3) {
    C3.setSize(8); await settle(C3, 0.5); click('[data-body="flat"]'); await settle(C3, 0.3);
    C3.scramble(88); await settle(C3, 9); C3.view(-0.62, 0.5);
    only('.remix');
  },
  async hint(C3) { C3.scramble(4242); await settle(C3, 4); C3.moves('R'); await settle(C3, 1); C3.view(-0.62, 0.5); C3.hint(); await settle(C3, 0.2); },
  async receipt(C3) {
    C3.scramble(4242); await settle(C3, 4);
    C3.moves("R U R'"); await settle(C3, 1.5);
    C3.solve(); await settle(C3, 12);
    for (let i = 0; i < 60 && document.getElementById('receiptLayer').hidden; i++) { await settle(C3, 0.3); await wait(50); }
    document.getElementById('receipt').classList.add('printed');
  },
  async process(C3) { only('.construction'); },
};

export async function run(name, C3) {
  await ready(C3);
  const scene = scenes[name];
  if (scene) await scene(C3);
  await settle(C3, 0.4);
  C3.scene.spin = 0;
  document.documentElement.dataset.shot = 'ready';
}
