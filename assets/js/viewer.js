// The 3D model viewer: inspect modes, lighting, animations, stats, pins, screenshots, compare.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const themeIsInk = () => document.documentElement.dataset.theme === 'ink';

/** Parse a model from bytes. `resolve(relPath)` may return a Promise<ArrayBuffer> for external .gltf resources. */
export async function loadModel(buf, path, { resolve } = {}) {
  const ext = path.split('.').pop().toLowerCase();
  const manager = new THREE.LoadingManager();
  const urls = new Map();
  manager.setURLModifier(u => urls.get(u) || urls.get(decodeURIComponent(u)) || u);
  if (ext === 'glb' || ext === 'gltf') {
    let data = buf;
    if (ext === 'gltf' && resolve) {
      const json = JSON.parse(new TextDecoder().decode(buf));
      const rel = [...(json.buffers || []), ...(json.images || [])].map(x => x.uri).filter(u => u && !/^data:|^https?:/.test(u));
      await Promise.all(rel.map(async u => {
        try { const b = await resolve(decodeURIComponent(u)); urls.set(u, URL.createObjectURL(new Blob([b]))); } catch {}
      }));
      data = new TextDecoder().decode(buf);
    }
    const loader = new GLTFLoader(manager);
    const g = await new Promise((res, rej) => loader.parse(data, '', res, rej));
    return { root: g.scene || g.scenes[0], clips: g.animations || [], urls };
  }
  if (ext === 'fbx') {
    const obj = new FBXLoader(manager).parse(buf, '');
    return { root: obj, clips: obj.animations || [], urls };
  }
  if (ext === 'obj') {
    const obj = new OBJLoader(manager).parse(new TextDecoder().decode(buf));
    obj.traverse(o => { if (o.isMesh && (!o.material || o.material.type === 'MeshPhongMaterial')) o.material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: .7 }); });
    return { root: obj, clips: [], urls };
  }
  throw new Error('Unsupported model type: .' + ext);
}

function checkerTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  const n = 8, s = 512 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = (x + y) % 2 ? `hsl(${(x * 40 + y * 12) % 360} 60% 55%)` : '#f2f2f2';
    g.fillRect(x * s, y * s, s, s);
    g.fillStyle = (x + y) % 2 ? '#fff' : '#333'; g.font = 'bold 20px monospace';
    g.fillText(String.fromCharCode(65 + y) + (x + 1), x * s + 8, y * s + 26);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function matcapTexture(ink) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(95, 85, 10, 128, 128, 135);
  if (ink) { gr.addColorStop(0, '#fffaf0'); gr.addColorStop(.45, '#b9ad98'); gr.addColorStop(.85, '#3a332a'); gr.addColorStop(1, '#100d0a'); }
  else { gr.addColorStop(0, '#eaffef'); gr.addColorStop(.4, '#36d46a'); gr.addColorStop(.85, '#06351a'); gr.addColorStop(1, '#000'); }
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const LIGHTS = {
  studio: { label: 'Studio', env: 1, key: [0xffffff, 2.2], fill: [0xffffff, 0x444444, .6], exp: 1 },
  sunset: { label: 'Sunset', env: .45, key: [0xffa25a, 3], fill: [0x6b8cff, 0x40210f, .7], exp: 1.05 },
  night: { label: 'Moonlight', env: .2, key: [0x8fb4ff, 1.6], fill: [0x223355, 0x05070c, .5], exp: 1.15 },
  flat: { label: 'Flat (no shadows)', env: 1.3, key: [0xffffff, 0], fill: [0xffffff, 0xffffff, 1.2], exp: 1 },
  theme: { label: 'Theme', env: .6, key: [0xffffff, 2], fill: [0xffffff, 0x222222, .5], exp: 1 },
};
export const LIGHT_PRESETS = Object.entries(LIGHTS).map(([k, v]) => ({ key: k, label: v.label }));
export const MODES = [
  { key: 'lit', label: 'Lit', hint: 'Materials as authored' },
  { key: 'clay', label: 'Clay', hint: 'Plain grey, judge the form' },
  { key: 'matcap', label: 'Matcap', hint: 'Shiny sculpt look' },
  { key: 'normals', label: 'Normals', hint: 'Normal directions as colours' },
  { key: 'uv', label: 'UV checker', hint: 'Spot stretched or flipped UVs' },
];

export class ModelViewer {
  constructor(container, { interactive = true } = {}) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, .01, 1000);
    this.camera.position.set(2, 1.4, 3);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .08;
    this.controls.autoRotateSpeed = 1.6;
    this.controls.enabled = interactive;

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pm.fromScene(new RoomEnvironment(), .04).texture;
    this.scene.environment = this.envTex;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, .6);
    this.key = new THREE.DirectionalLight(0xffffff, 2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = .02;
    this.scene.add(this.hemi, this.key, this.key.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: .28 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.clock = new THREE.Clock();
    this.mixer = null; this.clips = []; this.action = null; this.speed = 1; this.playing = false;
    this.mode = 'lit'; this.wire = false; this.showGrid = true; this.showSkel = false; this.showBounds = false;
    this.light = 'studio';
    this.bg = 'theme';
    this.onFrame = new Set();
    this.onChange = new Set();
    this._raf = 0; this._dirty = true;
    this.controls.addEventListener('change', () => { this._dirty = true; this.onChange.forEach(f => f()); });
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.applyTheme();
    this.resize();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this._dirty = true;
  }

  applyTheme() {
    const ink = themeIsInk();
    this.matcap?.dispose(); this.matcap = matcapTexture(ink);
    const bgc = this.bg === 'dark' ? '#15171a' : this.bg === 'light' ? '#e9e9ea' : cssVar('--viewer-bg') || '#111';
    this.scene.background = this.bg === 'transparent' ? null : new THREE.Color(bgc);
    this.gridColor = new THREE.Color(this.bg === 'light' ? '#c7c7c9' : this.bg === 'dark' ? '#2b2e33' : (cssVar('--viewer-grid') || '#333'));
    this.ground.material.opacity = ink || this.bg === 'light' ? .22 : .5;
    if (this.grid) this._makeGrid();
    this.setLight(this.light);
    if (this.mode !== 'lit') this.setMode(this.mode);
    this._dirty = true;
  }
  setBackground(bg) { this.bg = bg; this.applyTheme(); }

  async load(buf, path, opts) {
    const { root, clips, urls } = await loadModel(buf, path, opts);
    this.setObject(root, clips);
    this._urls = urls;
    this.path = path;
    return this.stats();
  }

  setObject(root, clips = []) {
    if (this.root) { this.scene.remove(this.root); disposeTree(this.root); }
    this._clearHelpers();
    this.root = root;
    this.meshes = [];
    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        o.userData.orig = o.material;
        this.meshes.push(o);
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m => { if (m && m.map) m.map.anisotropy = 8; });
      }
    });
    this.scene.add(root);
    this.mixer = clips.length ? new THREE.AnimationMixer(root) : null;
    this.clips = clips;
    this.action = null; this.playing = false;
    // pose the model with its first animation before framing, so skinned rigs (FBX in cm, etc.) fit the view
    if (clips.length) { this.play(0, false); this.mixer.update(0); }
    this.frame(false);
    this._makeGrid();
    if (this.mode !== 'lit') this.setMode(this.mode);
    if (this.wire) { this.wire = false; this.toggleWire(); }
    if (this.showSkel) { this.showSkel = false; this.toggleSkeleton(); }
    if (this.showBounds) { this.showBounds = false; this.toggleBounds(); }
    if (clips.length) this.play(0, false);
    this._dirty = true;
  }

  bounds() {
    this.root.updateMatrixWorld(true);
    this.root.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.boundingBox = null; } });
    return new THREE.Box3().setFromObject(this.root);
  }

  frame(animate = true) {
    if (!this.root) return;
    this.root.updateMatrixWorld(true);
    const box = this.bounds();
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    this.size = size; this.center = center; this.box = box;
    const r = Math.max(size.length() / 2, 1e-3);
    const fov = this.camera.fov * Math.PI / 180;
    const dist = r / Math.sin(fov / 2) * 1.05;
    const dir = new THREE.Vector3(.85, .5, 1.2).normalize();
    this.camera.near = Math.max(dist / 500, 1e-4); this.camera.far = dist * 50; this.camera.updateProjectionMatrix();
    this.controls.minDistance = r * .05; this.controls.maxDistance = dist * 8;
    const pos = center.clone().addScaledVector(dir, dist);
    if (animate) this.flyTo({ pos: pos.toArray(), target: center.toArray() });
    else { this.camera.position.copy(pos); this.controls.target.copy(center); this.controls.update(); }
    // ground + light follow the model
    this.ground.position.set(center.x, box.min.y - r * .002, center.z);
    this.ground.scale.setScalar(r * 12);
    this.key.position.copy(center).add(new THREE.Vector3(r * 2, r * 3.5, r * 1.8));
    this.key.target.position.copy(center);
    const sc = this.key.shadow.camera; sc.left = sc.bottom = -r * 2; sc.right = sc.top = r * 2; sc.near = r * .1; sc.far = r * 10; sc.updateProjectionMatrix();
    this._dirty = true;
  }

  _makeGrid() {
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }
    if (!this.box) return;
    const r = Math.max(this.size.x, this.size.z, this.size.y * .6);
    // pick a "nice" cell size so the grid reads as real units
    const step = Math.pow(10, Math.floor(Math.log10(r / 2 || 1)));
    const span = Math.ceil(r * 3 / step) * step;
    this.grid = new THREE.GridHelper(span, Math.round(span / step) * 2, this.gridColor, this.gridColor);
    this.grid.material.transparent = true; this.grid.material.opacity = .55; this.grid.material.depthWrite = false;
    this.grid.position.set(this.center.x, this.box.min.y, this.center.z);
    this.grid.visible = this.showGrid;
    this.gridStep = step / 2;
    this.scene.add(this.grid);
  }
  toggleGrid(v = !this.showGrid) { this.showGrid = v; if (this.grid) this.grid.visible = v; this._dirty = true; return v; }

  setMode(mode) {
    this.mode = mode;
    const ink = themeIsInk();
    let over = null;
    if (mode === 'clay') over = new THREE.MeshStandardMaterial({ color: ink ? 0xd8cfbf : 0xb8bcc2, roughness: .85, metalness: 0 });
    if (mode === 'matcap') over = new THREE.MeshMatcapMaterial({ matcap: this.matcap });
    if (mode === 'normals') over = new THREE.MeshNormalMaterial();
    if (mode === 'uv') over = new THREE.MeshBasicMaterial({ map: (this._checker ??= checkerTexture()) });
    for (const m of this.meshes || []) {
      if (!over) { m.material = m.userData.orig; continue; }
      m.material = Array.isArray(m.userData.orig) ? m.userData.orig.map(() => over) : over;
    }
    this._dirty = true;
  }

  toggleWire(v = !this.wire) {
    this.wire = v;
    (this._wires || []).forEach(w => w.parent?.remove(w));
    this._wires = [];
    if (v) {
      const col = themeIsInk() ? 0x16130f : 0x00ff41;
      const mat = new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: .45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
      for (const m of this.meshes) {
        const w = m.clone(false);
        w.material = Array.isArray(m.material) ? m.material.map(() => mat) : mat;
        w.castShadow = w.receiveShadow = false;
        w.raycast = () => {};
        m.parent.add(w);
        this._wires.push(w);
      }
    }
    this._dirty = true; return v;
  }
  toggleSkeleton(v = !this.showSkel) {
    this.showSkel = v;
    if (this._skel) { this.scene.remove(this._skel); this._skel = null; }
    if (v && this.root) {
      this._skel = new THREE.SkeletonHelper(this.root);
      this._skel.material.linewidth = 2; this._skel.material.depthTest = false; this._skel.material.transparent = true;
      if (!this._skel.bones.length) { this._skel = null; this.showSkel = false; return false; }
      this.scene.add(this._skel);
    }
    this._dirty = true; return this.showSkel;
  }
  toggleBounds(v = !this.showBounds) {
    this.showBounds = v;
    if (this._bh) { this.scene.remove(this._bh); this._bh = null; }
    if (v && this.box) { this._bh = new THREE.Box3Helper(this.box, themeIsInk() ? 0xa3271b : 0xe8ff3b); this.scene.add(this._bh); }
    this._dirty = true; return v;
  }
  _clearHelpers() {
    (this._wires || []).forEach(w => w.parent?.remove(w)); this._wires = [];
    if (this._skel) this.scene.remove(this._skel); this._skel = null;
    if (this._bh) this.scene.remove(this._bh); this._bh = null;
  }
  setAutoRotate(v) { this.controls.autoRotate = v; this._dirty = true; }

  setLight(key) {
    this.light = key;
    const L = LIGHTS[key] || LIGHTS.studio;
    const ink = themeIsInk();
    this.scene.environmentIntensity = L.env;
    let kc = L.key[0];
    if (key === 'theme') kc = ink ? 0xfff1d8 : 0xb5ffc8;
    this.key.color.set(kc); this.key.intensity = L.key[1]; this.key.castShadow = L.key[1] > 0;
    this.hemi.color.set(key === 'theme' ? (ink ? 0xfff6e8 : 0x9dffb5) : L.fill[0]);
    this.hemi.groundColor.set(key === 'theme' ? (ink ? 0x6b5a45 : 0x001a07) : L.fill[1]);
    this.hemi.intensity = L.fill[2];
    this.renderer.toneMappingExposure = (this.exposure ?? 1) * L.exp;
    this._dirty = true;
  }
  setExposure(v) { this.exposure = v; this.setLight(this.light); }

  /* ---------- animation ---------- */
  play(i, start = true) {
    if (!this.mixer) return;
    this.action?.stop();
    this.clipIndex = i;
    this.action = this.mixer.clipAction(this.clips[i]);
    this.action.reset().play();
    this.action.paused = !start;
    this.playing = start;
    this._dirty = true;
  }
  togglePlay() { if (!this.action) return false; this.playing = !this.playing; this.action.paused = !this.playing; this._dirty = true; return this.playing; }
  setTime(t) { if (!this.action) return; this.action.time = t; this.mixer.update(0); this._dirty = true; }
  get duration() { return this.action?.getClip().duration || 0; }
  get time() { return this.action?.time || 0; }

  /* ---------- camera ---------- */
  getView() { return { pos: this.camera.position.toArray().map(r4), target: this.controls.target.toArray().map(r4) }; }
  setView(v) { this.camera.position.fromArray(v.pos); this.controls.target.fromArray(v.target); this.controls.update(); this._dirty = true; }
  flyTo(v, ms = 650) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const p1 = new THREE.Vector3().fromArray(v.pos), t1 = new THREE.Vector3().fromArray(v.target);
    const start = performance.now();
    this._fly = now => {
      const k = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(p0, p1, e); this.controls.target.lerpVectors(t0, t1, e);
      this.controls.update();
      if (k >= 1) this._fly = null;
      this._dirty = true;
    };
  }
  /** Keep two viewers looking from the same place (compare mode). */
  link(other) {
    const sync = (a, b) => () => { if (this._syncing) return; this._syncing = true; b.camera.position.copy(a.camera.position); b.controls.target.copy(a.controls.target); b.controls.update(); b._dirty = true; this._syncing = false; };
    const f1 = sync(this, other), f2 = sync(other, this);
    this.controls.addEventListener('change', f1); other.controls.addEventListener('change', f2);
    f1();
    return () => { this.controls.removeEventListener('change', f1); other.controls.removeEventListener('change', f2); };
  }

  /* ---------- picking & projection (pins) ---------- */
  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.meshes || [], false)[0];
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { p: hit.point.toArray().map(r4), n: n.toArray().map(r4) };
  }
  project(p) {
    const v = new THREE.Vector3().fromArray(p);
    const d = v.clone().project(this.camera);
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    return { x: (d.x + 1) / 2 * w, y: (1 - d.y) / 2 * h, off: d.z > 1 || d.z < -1 };
  }
  occluded(p) {
    const v = new THREE.Vector3().fromArray(p);
    const dir = v.clone().sub(this.camera.position); const dist = dir.length(); dir.normalize();
    const ray = new THREE.Raycaster(this.camera.position, dir, 0, dist * .995);
    return ray.intersectObjects(this.meshes || [], false).length > 0;
  }

  /* ---------- info ---------- */
  stats() {
    let tris = 0, verts = 0;
    const mats = new Set(), texs = new Set(), bones = new Set();
    let skinned = 0, morph = 0;
    for (const m of this.meshes || []) {
      const g = m.geometry; const pos = g.attributes.position;
      verts += pos ? pos.count : 0;
      tris += g.index ? g.index.count / 3 : (pos ? pos.count / 3 : 0);
      (Array.isArray(m.userData.orig) ? m.userData.orig : [m.userData.orig]).forEach(x => { if (x) { mats.add(x); for (const k of MAP_KEYS) if (x[k]) texs.add(x[k]); } });
      if (m.isSkinnedMesh) { skinned++; m.skeleton.bones.forEach(b => bones.add(b)); }
      if (g.morphAttributes?.position?.length) morph += g.morphAttributes.position.length;
    }
    const s = this.size || new THREE.Vector3();
    return { tris: Math.round(tris), verts, meshes: (this.meshes || []).length, materials: mats.size, textures: texs.size, bones: bones.size, skinned, morph, clips: this.clips.length, size: [s.x, s.y, s.z] };
  }
  materials() {
    const out = [], seen = new Set();
    for (const m of this.meshes || []) {
      for (const x of (Array.isArray(m.userData.orig) ? m.userData.orig : [m.userData.orig])) {
        if (!x || seen.has(x)) continue; seen.add(x);
        out.push({ name: x.name || '(unnamed)', type: x.type, color: x.color ? '#' + x.color.getHexString() : null, maps: MAP_KEYS.filter(k => x[k]?.image).map(k => ({ key: k, tex: x[k] })), mat: x });
      }
    }
    return out;
  }
  screenshot(scale = 2) {
    const { width, height } = this.renderer.domElement;
    const prev = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(prev * scale / Math.max(1, prev));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight, false);
    this.renderer.render(this.scene, this.camera);
    const p = new Promise(res => this.renderer.domElement.toBlob(res, 'image/png'));
    this.renderer.setPixelRatio(prev); this.resize();
    void width; void height;
    return p;
  }

  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = this.clock.getDelta();
    if (this._fly) this._fly(now);
    if (this.controls.autoRotate || this.controls.enableDamping) this.controls.update();
    if (this.mixer && this.playing) { this.mixer.update(dt * this.speed); this._dirty = true; }
    if (!this._dirty && !this.controls.autoRotate) return;
    this._dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.onFrame.forEach(f => f());
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.controls.dispose();
    if (this.root) disposeTree(this.root);
    (this._urls ? [...this._urls.values()] : []).forEach(u => URL.revokeObjectURL(u));
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}

export const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'specularColorMap', 'specularIntensityMap', 'bumpMap', 'lightMap'];
export const MAP_LABEL = { map: 'Base colour', normalMap: 'Normal', roughnessMap: 'Roughness', metalnessMap: 'Metalness', aoMap: 'AO', emissiveMap: 'Emissive', alphaMap: 'Alpha', specularColorMap: 'Spec colour', specularIntensityMap: 'Spec', bumpMap: 'Bump', lightMap: 'Lightmap' };
const r4 = x => Math.round(x * 1e4) / 1e4;

export function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.userData?.orig ? (Array.isArray(o.userData.orig) ? o.userData.orig : [o.userData.orig]) : (o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []);
    ms.forEach(m => { if (!m) return; for (const k of MAP_KEYS) m[k]?.dispose?.(); m.dispose?.(); });
  });
}

/** Draw a texture into a small canvas (material inspector). */
export function textureToCanvas(tex, size = 108) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const img = tex.image;
  try { c.getContext('2d').drawImage(img, 0, 0, size, size); } catch {}
  return c;
}

/* ---------- thumbnails: one shared offscreen renderer ---------- */
let thumbR = null;
export async function renderThumb(buf, path, size = 320) {
  if (!thumbR) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(size, size); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    const pm = new THREE.PMREMGenerator(r);
    const env = pm.fromScene(new RoomEnvironment(), .04).texture;
    thumbR = { r, env };
  }
  const { r, env } = thumbR;
  const { root, clips, urls } = await loadModel(buf, path);
  const scene = new THREE.Scene(); scene.environment = env; scene.environmentIntensity = .9;
  const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(2, 4, 3); scene.add(dl, new THREE.HemisphereLight(0xffffff, 0x444444, .6));
  scene.add(root);
  if (clips.length) { const mx = new THREE.AnimationMixer(root); mx.clipAction(clips[0]).play(); mx.update(clips[0].duration * .25); }
  root.updateMatrixWorld(true);
  root.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.boundingBox = null; } });
  const box = new THREE.Box3().setFromObject(root);
  const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const rad = Math.max(s.length() / 2, 1e-3);
  const cam = new THREE.PerspectiveCamera(35, 1, rad / 100, rad * 100);
  const dir = new THREE.Vector3(.85, .45, 1.2).normalize();
  cam.position.copy(c).addScaledVector(dir, rad / Math.sin(35 * Math.PI / 360) * 1.02); cam.lookAt(c);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const blob = await new Promise(res => r.domElement.toBlob(res, 'image/webp', .85));
  disposeTree(root); urls.forEach(u => URL.revokeObjectURL(u));
  return { blob, stats: { tris: countTris(root) } };
}
function countTris(root) { let t = 0; root.traverse(o => { if (o.isMesh) { const g = o.geometry; t += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } }); return Math.round(t); }
