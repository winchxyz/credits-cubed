// Three.js view of a Cube: rounded cubies, one printed sticker per face,
// layer turns you can drag, a turntable orbit and render-on-demand.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import { FACE_DEF, rotation } from './cube.js';

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;
export const HOME_YAW = -0.62, HOME_PITCH = 0.5;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/** A box with truly rounded edges: subdivided cube pushed onto an inner box + radius. */
function roundedBox(size, radius, m = 4) {
  const s = 2 * m + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, s, s, s);
  const h = size / 2, inner = h - radius;
  const pos = g.attributes.position, nor = g.attributes.normal;
  const map = t => {
    const k = Math.round((t + 0.5) * s);
    if (k <= m) return -h + radius * (k / m);
    if (k >= s - m) return h - radius * ((s - k) / m);
    return 0;
  };
  const p = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.set(map(pos.getX(i)), map(pos.getY(i)), map(pos.getZ(i)));
    c.set(THREE.MathUtils.clamp(p.x, -inner, inner), THREE.MathUtils.clamp(p.y, -inner, inner), THREE.MathUtils.clamp(p.z, -inner, inner));
    d.subVectors(p, c);
    const len = d.length();
    if (len > 1e-6) { d.divideScalar(len); p.copy(c).addScaledVector(d, radius); nor.setXYZ(i, d.x, d.y, d.z); }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeBoundingSphere();
  return g;
}

function roundedRect(w, r) {
  const s = new THREE.Shape();
  const h = w / 2;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

/** A soft studio for reflections: grey room, three softboxes. */
function studio(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: 0x5c5c5c, side: THREE.BackSide }));
  env.add(room);
  const panel = (w, h, x, y, z, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity) }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(9, 5, -5, 5.5, 6, 3.2);
  panel(6, 8, 8, 1, 2, 1.6);
  panel(12, 3, 0, 5.9, -4, 1.2);
  panel(20, 20, 0, -5.9, 0, 0.35);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.035).texture;
  pm.dispose();
  return tex;
}

export class Scene {
  constructor(container, opts = {}) {
    this.container = container;
    this.reduced = !!opts.reduced;
    this.onTurn = opts.onTurn || (() => {});        // (move, source) after a committed layer turn
    this.onPointerTurnStart = opts.onPointerTurnStart || (() => {});
    this.onChange = opts.onChange || (() => {});
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    const el = this.renderer.domElement;
    el.className = 'stage-canvas';
    el.setAttribute('aria-hidden', 'true');
    container.prepend(el);

    this.scene = new THREE.Scene();
    // per-material envMap so envMapIntensity applies (scene.environment ignores it since r163)
    this.envTex = studio(this.renderer);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(0, 0, 30);
    this.camera.lookAt(0, 0, 0);

    // Fixed to the camera like a studio: top reads brightest, front middle, right darkest.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xededed, 1.06);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.92);
    this.key.position.set(-5, 6.5, 12);
    this.scene.add(this.key);
    // A light that only casts: from nearly overhead, so the shadow pools under the cube instead of trailing off-frame.
    this.caster = new THREE.DirectionalLight(0xffffff, 0);
    this.caster.position.set(-1.5, 12, 2.5);
    this.caster.castShadow = true;
    this.caster.shadow.mapSize.set(1024, 1024);
    this.caster.shadow.radius = 16;
    this.caster.shadow.blurSamples = 24;
    this.caster.shadow.bias = -0.0005;
    this.scene.add(this.caster);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.46);
    this.fill.position.set(10, 1, 6);
    this.scene.add(this.fill);

    // The camera stays level and the cube turns in hand, so the floor is tilted to read as seen from above.
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.14 });
    // Fade the shadow out in an ellipse under the cube: wide sideways, short toward the viewer,
    // where only a sliver of frame is left below the cube. No frame or export ever cuts it.
    shadowMat.onBeforeCompile = sh => {
      sh.uniforms.uFade = this.fadeUniform;
      sh.uniforms.uGroundCenter = this.groundCenter;
      sh.uniforms.uToward = this.towardUniform;
      sh.vertexShader = 'varying vec3 vGround;\n' + sh.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vGround;\nuniform vec4 uFade;\nuniform vec3 uGroundCenter;\nuniform vec3 uToward;\n' + sh.fragmentShader.replace(
        'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
        'vec3 dG = vGround - uGroundCenter;\n\tfloat e = length(vec2(dG.x / uFade.x, dot(dG, uToward) / uFade.y));\n\tfloat fade = 1.0 - smoothstep(uFade.z, uFade.w, e);\n\tgl_FragColor = vec4( color, opacity * fade * ( 1.0 - getShadowMask() ) );');
    };
    this.fadeUniform = { value: new THREE.Vector4(2, 1, 0.3, 1) };
    this.groundCenter = { value: new THREE.Vector3() };
    // in-floor direction that points toward the viewer (and down the screen)
    this.towardUniform = { value: new THREE.Vector3(0, -Math.sin(HOME_PITCH), Math.cos(HOME_PITCH)) };
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), shadowMat);
    this.ground.rotation.x = -Math.PI / 2 + HOME_PITCH;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.view = new THREE.Group();        // turntable orbit
    this.scene.add(this.view);
    this.puzzle = new THREE.Group();      // cubies live here in puzzle space
    this.view.add(this.puzzle);
    this.pivot = new THREE.Object3D();
    this.puzzle.add(this.pivot);

    this.yaw = HOME_YAW; this.pitch = HOME_PITCH;
    this.spin = 0;                        // idle turntable speed (rad/s)
    this.animations = [];
    this.queue = [];
    this.busy = false;
    this.drag = null;
    this.dim = null;
    this.textures = [];
    this.body = 'ink';
    this.raycaster = new THREE.Raycaster();
    this.clock = performance.now();
    this.loop = this.loop.bind(this);
    this.rafId = 0;

    this.resize();
    new ResizeObserver(() => { this.resize(); this.request(); }).observe(container);
    this.bindPointer(el);
  }

  // ---- building ----
  /**
   * Three bodies: ink (black plastic), paper (white plastic) and flat, a sharp,
   * full-bleed cube with unlit stickers so each face reads as one plain print.
   */
  build(cube, canvases) {
    this.cube = cube;
    const n = cube.n;
    for (const m of this.cubieMeshes || []) { this.puzzle.remove(m); m.traverse(o => { if (o.geometry && o.geometry !== this.bodyGeo) o.geometry.dispose(); if (o.material && o.material !== this.bodyMat) o.material.dispose(); }); }
    if (canvases) {
      this.textures.forEach(t => t.dispose());
      this.textures = canvases.map(cv => {
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        return t;
      });
    }
    const flat = this.body === 'flat';
    const size = flat ? 1 : 0.965, stickerW = flat ? 1 : 0.81;
    this.bodyGeo?.dispose();
    this.bodyGeo = flat ? new THREE.BoxGeometry(size, size, size) : roundedBox(size, 0.1, 4);
    this.bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0, envMap: this.envTex, envMapIntensity: 0.9 });
    this.paintBody();
    const shape = flat ? null : roundedRect(stickerW, 0.085);
    // keep each sticker a hair inside its window so mipmaps never borrow a neighbour's colour
    const inset = 0.012;
    this.cubieMeshes = [];
    this.stickerMeshes = [];
    const basis = new THREE.Matrix4();
    for (const c of cube.cubies) {
      const mesh = new THREE.Mesh(this.bodyGeo, this.bodyMat);
      mesh.castShadow = true;
      mesh.userData.cubie = c.index;
      for (const si of c.stickers) {
        const s = cube.stickers[si];
        const f = FACE_DEF[s.face];
        const geo = flat ? new THREE.PlaneGeometry(stickerW, stickerW) : new THREE.ShapeGeometry(shape, 5);
        // UVs: this sticker's window of the face image
        const uv = geo.attributes.uv, pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = inset + (pos.getX(i) / stickerW + 0.5) * (1 - 2 * inset), y = inset + (0.5 - pos.getY(i) / stickerW) * (1 - 2 * inset);
          uv.setXY(i, (s.col + x) / n, 1 - (s.row + y) / n);
        }
        const common = { map: this.textures[s.face], polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
        const mat = flat
          ? new THREE.MeshBasicMaterial(common)
          : new THREE.MeshStandardMaterial({ ...common, roughness: 0.62, metalness: 0, envMap: this.envTex, envMapIntensity: 0.15, emissive: 0xffffff, emissiveMap: this.textures[s.face], emissiveIntensity: 0 });
        const st = new THREE.Mesh(geo, mat);
        const r = new THREE.Vector3(...f.r), up = new THREE.Vector3(...f.d).negate(), nn = new THREE.Vector3(...f.n);
        basis.makeBasis(r, up, nn);
        st.quaternion.setFromRotationMatrix(basis);
        st.position.copy(nn).multiplyScalar(size / 2 + (flat ? 0.001 : 0.002));
        st.userData = { sticker: si, cubie: c.index };
        st.receiveShadow = false;
        mesh.add(st);
        this.stickerMeshes[si] = st;
      }
      this.puzzle.add(mesh);
      this.cubieMeshes.push(mesh);
    }
    // flat faces are unlit, so white pixels would melt into a white page: outline the cube instead
    if (this.outline) { this.puzzle.remove(this.outline); this.outline.geometry.dispose(); this.outline = null; }
    if (flat) {
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(n + 0.03, n + 0.03, n + 0.03));
      this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: this.outlineColor || 0x111111 }));
      this.puzzle.add(this.outline);
    }
    this.sync();
    this.frame();
    if (this.dim) this.spotlight(this.dim, this.dimLevel);
    this.request();
  }

  setOutlineColor(hex) { this.outlineColor = hex; if (this.outline) { this.outline.material.color.set(hex); this.request(); } }

  paintBody() {
    const kind = this.body;
    if (!this.bodyMat) return;
    this.bodyMat.color.set(kind === 'paper' ? 0xf1f0ec : kind === 'flat' ? 0x1a1a1a : 0x101010);
    this.bodyMat.roughness = kind === 'paper' ? 0.55 : kind === 'flat' ? 0.9 : 0.6;
    this.bodyMat.envMapIntensity = kind === 'paper' ? 0.5 : kind === 'flat' ? 0.05 : 0.22;
  }

  setBody(kind) {
    const rebuild = this.cube && (kind === 'flat') !== (this.body === 'flat');
    this.body = kind;
    if (rebuild && this.idle) this.build(this.cube);
    else this.paintBody();
    this.request();
  }

  setGroundTone(dark) { this.ground.material.opacity = dark ? 0.4 : 0.16; this.request(); }

  refreshFace(face) { if (this.textures[face]) { this.textures[face].needsUpdate = true; this.request(); } }

  /** Snap every cubie mesh to the logical state. */
  sync() {
    const m4 = new THREE.Matrix4();
    for (const c of this.cube.cubies) {
      const mesh = this.cubieMeshes[c.index];
      if (mesh.parent !== this.puzzle) this.puzzle.attach(mesh);
      mesh.position.set(c.pos[0] / 2, c.pos[1] / 2, c.pos[2] / 2);
      const r = c.rot;
      m4.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      mesh.quaternion.setFromRotationMatrix(m4);
    }
    this.pivot.quaternion.identity();
    this.request();
  }

  frame() {
    const n = this.cube ? this.cube.n : 3;
    const radius = n * Math.sqrt(3) / 2;
    const half = radius * 1.13;
    const w = this.width || 1, h = this.height || 1;
    const aspect = w / h;
    this.camera.left = -half * Math.max(1, aspect); this.camera.right = half * Math.max(1, aspect);
    this.camera.top = half / Math.min(1, aspect); this.camera.bottom = -half / Math.min(1, aspect);
    this.camera.updateProjectionMatrix();
    const down = radius * 1.04;
    this.ground.position.set(0, -down * Math.cos(HOME_PITCH), -down * Math.sin(HOME_PITCH));
    // the overhead caster drops the shadow straight under the cube; the fade is centred there
    this.groundCenter.value.copy(this.ground.position);
    // room left below the cube in the frame, measured along the floor
    const room = (this.camera.top - down * Math.cos(HOME_PITCH)) / Math.sin(HOME_PITCH);
    this.fadeUniform.value.set(radius * 0.8, Math.max(0.3, room * 0.92), 0.3, 1);
    const sc = this.caster.shadow.camera;
    sc.left = -radius * 5; sc.right = radius * 5; sc.top = radius * 5; sc.bottom = -radius * 5; sc.near = 0.5; sc.far = 80;
    sc.updateProjectionMatrix();
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(r.width));
    this.height = Math.max(1, Math.round(r.height));
    this.renderer.setSize(this.width, this.height, false);
    this.frame();
  }

  // ---- rendering ----
  request() { if (!this.rafId) this.rafId = requestAnimationFrame(this.loop); }

  loop(now) {
    this.rafId = 0;
    const dt = Math.min(0.1, (now - this.clock) / 1000);
    this.clock = now;
    this.step(dt, now);
    this.render();
    if (this.animations.length || this.spin || this.drag || this.inertia) this.request();
  }

  /** Advance animations by dt seconds (also used by the debug clock). */
  step(dt, now = performance.now()) {
    if (this.spin && !this.drag) this.yaw += this.spin * dt;
    if (this.inertia && !this.drag) {
      this.yaw += this.inertia.vy * dt; this.pitch = clampPitch(this.pitch + this.inertia.vp * dt);
      this.inertia.vy *= Math.pow(0.02, dt); this.inertia.vp *= Math.pow(0.02, dt);
      if (Math.abs(this.inertia.vy) + Math.abs(this.inertia.vp) < 0.02) this.inertia = null;
    }
    this.clockTime = (this.clockTime || 0) + dt;
    for (const a of this.animations.slice()) {
      a.t = Math.min(1, a.t + dt / a.duration);
      a.update(a.t);
      if (a.t >= 1) { this.animations.splice(this.animations.indexOf(a), 1); a.done(); }
    }
    void now;
  }

  render() {
    this.view.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'XYZ'));
    if (this.outline) this.outline.visible = this.pivot.children.length === 0;
    this.renderer.render(this.scene, this.camera);
  }

  animate(duration, update) {
    return new Promise(resolve => {
      if (duration <= 0) { update(1); resolve(); this.request(); return; }
      this.animations.push({ t: 0, duration, update, done: resolve });
      this.request();
    });
  }

  // ---- turning ----
  cubiesIn(move) { return this.cube.cubies.filter(c => move.layers.includes(this.cube.layerOf(c, move.axis))); }

  grab(move) {
    this.pivot.quaternion.identity();
    this.pivot.updateMatrixWorld();
    for (const c of this.cubiesIn(move)) this.pivot.attach(this.cubieMeshes[c.index]);
  }

  /** Queue a move; resolves once it has been animated and committed. */
  turn(move, { duration, source = 'code' } = {}) {
    return new Promise(resolve => { this.queue.push({ move, duration, source, resolve }); this.pump(); });
  }

  async pump() {
    if (this.busy || this.drag) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    const { move } = job;
    const base = this.reduced ? 0.11 : 0.2; // turns always move: they are how the cube explains itself
    const d = job.duration ?? (move.turns === 2 ? base * 1.45 : base) * (this.queue.length > 2 ? 0.55 : 1);
    this.grab(move);
    const target = move.turns === 3 ? -QUARTER : move.turns * QUARTER;
    const axis = AXES[move.axis];
    await this.animate(d, t => { this.pivot.quaternion.setFromAxisAngle(axis, target * easeOut(t)); });
    this.cube.move(move);
    this.sync();
    this.busy = false;
    this.onTurn(move, job.source);
    job.resolve();
    this.pump();
  }

  get idle() { return !this.busy && !this.queue.length && !this.drag; }
  clearQueue() { this.queue.splice(0).forEach(j => j.resolve()); }

  /** Nudge a layer a little in the direction of `move` and back: a hint. */
  wiggle(move) {
    if (!this.idle) return Promise.resolve();
    this.busy = true;
    this.grab(move);
    const axis = AXES[move.axis];
    const dir = move.turns === 3 ? -1 : 1;
    const amp = (move.turns === 2 ? 0.5 : 0.34) * dir;
    return this.animate(this.reduced ? 0.2 : 0.9, t => {
      const s = Math.sin(Math.min(1, t) * Math.PI) * (t < 0.5 ? 1 : 1);
      this.pivot.quaternion.setFromAxisAngle(axis, amp * s);
    }).then(() => { this.sync(); this.busy = false; this.pump(); });
  }

  // ---- highlighting ----
  /** Dim every sticker whose test() is false (null clears). */
  spotlight(test, level = 0.32) {
    this.dim = test;
    this.dimLevel = level;
    for (const st of this.stickerMeshes || []) {
      const on = !test || test(st.userData.sticker);
      st.material.color.setScalar(on ? 1 : level);
      if (st.material.emissive) st.material.emissiveIntensity = 0;
    }
    this.request();
  }

  flash(color, strength) {
    for (const st of this.stickerMeshes || []) {
      if (st.material.emissive) { st.material.emissive.set(color); st.material.emissiveIntensity = strength; }
      else st.material.color.set(color).lerp(new THREE.Color(1, 1, 1), 1 - strength);
    }
    this.request();
  }

  resetFlash() {
    for (const st of this.stickerMeshes || []) { if (st.material.emissive) st.material.emissive.set(0xffffff); }
    this.spotlight(this.dim, this.dimLevel);
  }

  /** Wait on the scene's own clock (so a paused preview can be stepped through it). */
  hold(seconds) { return this.animate(Math.max(0, seconds), () => {}); }

  /**
   * Where to draw a hint for `move`: the sticker in the turning layer that faces the
   * viewer best and moves the most on screen, with the unit direction it will travel.
   */
  hintVector(move) {
    this.render();
    this.scene.updateMatrixWorld(true);
    const axis = AXES[move.axis], sign = move.turns === 3 ? -1 : 1;
    const toward = new THREE.Vector3(0, 0, 1), p = new THREE.Vector3(), nrm = new THREE.Vector3();
    let best = null;
    for (const c of this.cube.cubies) {
      if (!move.layers.includes(this.cube.layerOf(c, move.axis))) continue;
      for (const si of c.stickers) {
        const st = this.stickerMeshes[si];
        nrm.set(0, 0, 1).transformDirection(st.matrixWorld);
        const facing = nrm.dot(toward);
        if (facing < 0.25) continue;
        st.getWorldPosition(p);
        const local = this.puzzle.worldToLocal(p.clone());
        const w = new THREE.Vector3().crossVectors(axis, local).multiplyScalar(sign * 0.05);
        const s0 = this.toScreen(p), s1 = this.toScreen(this.puzzle.localToWorld(local.clone().add(w)));
        const v = s1.clone().sub(s0), len = v.length();
        if (len < 1e-4) continue;
        const score = facing * len;
        if (!best || score > best.score) best = { score, x: s0.x, y: s0.y, dx: v.x / len, dy: v.y / len };
      }
    }
    return best;
  }

  // ---- view ----
  /** Face index (0–5) whose outward normal points most along world `dir`. */
  faceToward(dir) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'XYZ'));
    let best = 0, bestDot = -Infinity;
    FACE_DEF.forEach((f, i) => {
      const v = new THREE.Vector3(...f.n).applyQuaternion(q);
      const d = v.dot(dir);
      if (d > bestDot) { bestDot = d; best = i; }
    });
    return best;
  }

  /** Turn the view so that face `face` looks at the camera (in its solved place). */
  lookAtFace(face, duration = 0.7) {
    const n = FACE_DEF[face].n;
    // a side face takes the place F has in the home 3/4 view; U and D tilt toward the camera
    const yaw = n[1] !== 0 ? this.yaw : HOME_YAW - Math.atan2(n[0], n[2]);
    const pitch = n[1] === 1 ? 1.0 : n[1] === -1 ? -1.0 : 0.42;
    const y0 = this.yaw, p0 = this.pitch;
    let dy = ((yaw - y0) % TAU + TAU + Math.PI) % TAU - Math.PI;
    if (this.reduced) duration = 0;
    this.inertia = null;
    return this.animate(duration, t => { const e = easeInOut(t); this.yaw = y0 + dy * e; this.pitch = p0 + (pitch - p0) * e; });
  }

  home(duration = 0.8) {
    const y0 = this.yaw, p0 = this.pitch;
    const dy = ((HOME_YAW - y0) % TAU + TAU + Math.PI) % TAU - Math.PI;
    return this.animate(this.reduced ? 0 : duration, t => { const e = easeInOut(t); this.yaw = y0 + dy * e; this.pitch = p0 + (HOME_PITCH - p0) * e; });
  }

  celebrate() {
    const y0 = this.yaw;
    return this.animate(this.reduced ? 0 : 1.5, t => { this.yaw = y0 + TAU * easeInOut(t); });
  }

  // ---- pointer ----
  bindPointer(el) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.moveP(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.up(e, true));
    el.addEventListener('lostpointercapture', e => { if (this.drag && this.drag.id === e.pointerId) this.up(e, true); });
  }

  ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  toScreen(worldPoint) {
    const v = worldPoint.clone().project(this.camera);
    return new THREE.Vector2((v.x + 1) / 2 * this.width, (1 - v.y) / 2 * this.height);
  }

  down(e) {
    if (this.drag || e.button > 0) return;
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch {}
    this.spin = 0;
    this.inertia = null;
    this.render();
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects(this.cubieMeshes || [], true);
    const base = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), lastX: e.clientX, lastY: e.clientY, lastT: performance.now() };
    if (hits.length && this.idle && !this.locked) {
      const hit = hits[0];
      const obj = hit.object;
      const cubie = this.cube.cubies[obj.userData.cubie];
      // face normal in puzzle space, rounded to an axis
      const nWorld = hit.face.normal.clone().transformDirection(obj.matrixWorld);
      const inv = this.puzzle.getWorldQuaternion(new THREE.Quaternion()).invert();
      const nLocal = nWorld.applyQuaternion(inv);
      const a = [Math.abs(nLocal.x), Math.abs(nLocal.y), Math.abs(nLocal.z)];
      const normalAxis = a.indexOf(Math.max(...a));
      const point = this.puzzle.worldToLocal(hit.point.clone());
      this.drag = { ...base, kind: 'turn', cubie, normalAxis, point, axis: -1, angle: 0 };
    } else {
      this.drag = { ...base, kind: 'orbit', yaw0: this.yaw, pitch0: this.pitch, vy: 0, vp: 0 };
    }
    this.request();
  }

  moveP(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const now = performance.now();
    if (d.kind === 'orbit') {
      const k = 3.2 / Math.max(240, Math.min(this.width, this.height));
      this.yaw = d.yaw0 + dx * k;
      this.pitch = clampPitch(d.pitch0 + dy * k);
      const dtm = Math.max(1, now - d.lastT) / 1000;
      d.vy = (e.clientX - d.lastX) * k / dtm; d.vp = (e.clientY - d.lastY) * k / dtm;
    } else {
      if (d.axis < 0) {
        if (Math.hypot(dx, dy) < 7) return;
        this.lockAxis(d, dx, dy);
        if (d.axis < 0) return;
        this.grab(d.move);
        this.onPointerTurnStart();
      }
      const drag = new THREE.Vector2(dx, dy);
      const prev = d.angle;
      d.angle = drag.dot(d.screenDir) / d.screenPerRad;
      const dtm = Math.max(1, now - d.lastT) / 1000;
      d.av = (d.angle - prev) / dtm;
      this.pivot.quaternion.setFromAxisAngle(AXES[d.axis], d.angle);
    }
    d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = now;
    this.request();
  }

  lockAxis(d, dx, dy) {
    const drag = new THREE.Vector2(dx, dy).normalize();
    const p = d.point;
    const pw = this.puzzle.localToWorld(p.clone());
    const s0 = this.toScreen(pw);
    let best = null;
    for (let axis = 0; axis < 3; axis++) {
      if (axis === d.normalAxis) continue;
      const w = new THREE.Vector3().crossVectors(AXES[axis], p); // velocity per radian
      const eps = 0.01;
      const s1 = this.toScreen(this.puzzle.localToWorld(p.clone().addScaledVector(w, eps)));
      const sv = s1.sub(s0).divideScalar(eps);
      const len = sv.length();
      if (len < 1e-3) continue;
      const align = Math.abs(drag.dot(sv.clone().divideScalar(len)));
      if (!best || align > best.align) best = { axis, align, dir: sv.clone().divideScalar(len), perRad: len };
    }
    if (!best) return;
    d.axis = best.axis;
    d.screenDir = best.dir;
    d.screenPerRad = best.perRad;
    const layer = this.cube.layerOf(d.cubie, best.axis);
    d.move = { axis: best.axis, layers: [layer], turns: 1 };
  }

  up(e, cancel = false) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (d.kind === 'orbit') {
      const age = performance.now() - d.lastT;
      if (!cancel && age < 80 && !this.reduced) this.inertia = { vy: d.vy, vp: d.vp };
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.onChange('tap');
      this.request();
      this.pump();
      return;
    }
    if (d.axis < 0) { this.onChange('tap-cube'); this.pump(); return; }
    const q = d.angle / QUARTER;
    let k = Math.round(q);
    const flick = d.av || 0;
    // a quick flick finishes a short turn, but never promotes a turn into a half turn
    if (!cancel && k === 0 && Math.abs(q) > 0.12 && Math.abs(flick) > 3.2 && Math.sign(flick) === Math.sign(q)) k = Math.sign(q);
    if (cancel) k = 0;
    k = Math.max(-2, Math.min(2, k));
    const target = k * QUARTER;
    const from = d.angle;
    const axis = AXES[d.axis];
    this.busy = true;
    const dist = Math.abs(target - from) / QUARTER;
    this.animate(this.reduced ? 0 : 0.08 + 0.16 * Math.min(1, dist), t => {
      this.pivot.quaternion.setFromAxisAngle(axis, from + (target - from) * easeOut(t));
    }).then(() => {
      const turns = ((k % 4) + 4) % 4;
      const move = { axis: d.axis, layers: d.move.layers, turns };
      if (turns) this.cube.move(move);
      this.sync();
      this.busy = false;
      if (turns) this.onTurn(move, 'drag');
      this.pump();
    });
  }

  // ---- export ----
  /** Render the current view into a new 2D canvas at `size` px (transparent ground). */
  snapshotCanvas(size = 1200, { yaw, pitch } = {}) {
    const w0 = this.width, h0 = this.height, pr = this.renderer.getPixelRatio();
    const y0 = this.yaw, p0 = this.pitch;
    if (yaw != null) this.yaw = yaw;
    if (pitch != null) this.pitch = pitch;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size, false);
    this.width = size; this.height = size;
    this.frame();
    this.render();
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d').drawImage(this.renderer.domElement, 0, 0); // same task as the render, so the buffer is intact
    this.yaw = y0; this.pitch = p0;
    this.renderer.setPixelRatio(pr);
    this.width = w0; this.height = h0;
    this.renderer.setSize(w0, h0, false);
    this.frame();
    this.render();
    return out;
  }

  snapshot(size = 1200, view = {}) { return this.snapshotCanvas(size, view).toDataURL('image/png'); }
}

function clampPitch(p) { return Math.max(-1.35, Math.min(1.35, p)); }
export { rotation };
