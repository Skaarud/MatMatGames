// Background effects: Matrix digital rain, or slow living ink. Cheap: capped fps, paused when hidden.
const cv = document.getElementById('fx');
const ctx = cv.getContext('2d');
let raf = 0, mode = null, state = null, last = 0;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = () => { try { return localStorage.getItem('mmg.motion') || 'normal'; } catch { return 'normal'; } };

export function startFx(theme) {
  cancelAnimationFrame(raf);
  mode = theme;
  resize();
  state = theme === 'matrix' ? initRain() : initInk();
  const fps = theme === 'matrix' ? 30 : 24;
  const still = reduced || motion() === 'calm';
  const loop = t => {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    if (t - last < 1000 / fps) return;
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    (mode === 'matrix' ? drawRain : drawInk)(dt, t / 1000);
  };
  if (still) { for (let i = 0; i < (mode === 'matrix' ? 220 : 1); i++) (mode === 'matrix' ? drawRain : drawInk)(1 / 30, i / 30); return; }
  raf = requestAnimationFrame(loop);
}
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  cv.width = Math.floor(innerWidth * dpr); cv.height = Math.floor(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = mode === 'matrix' ? '#010603' : 'rgba(0,0,0,0)';
  if (mode === 'matrix') ctx.fillRect(0, 0, innerWidth, innerHeight); else ctx.clearRect(0, 0, innerWidth, innerHeight);
}
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => startFx(mode), 150); });

/* ---------- Matrix rain ---------- */
const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ012345789Z:・."=*+-<>¦|ｸﾘ';
const g = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
function initRain() {
  const lively = motion() === 'lively';
  const layers = [
    { size: 11, alpha: .35, speed: [4, 9] },
    { size: 16, alpha: .95, speed: [7, 16] },
  ];
  return layers.map(L => {
    const cols = Math.min(Math.ceil(innerWidth / L.size), 220);
    return { ...L, cols: Array.from({ length: cols }, (_, i) => ({ x: i * L.size, y: Math.random() * innerHeight / L.size * -1.2, v: (L.speed[0] + Math.random() * (L.speed[1] - L.speed[0])) * (lively ? 1.5 : 1), trail: [], mirror: Math.random() < .3 })) };
  });
}
function drawRain(dt) {
  ctx.fillStyle = 'rgba(1, 6, 3, 0.11)';
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  for (const L of state) {
    ctx.font = `${L.size}px "JetBrains Mono", "MS Gothic", monospace`;
    ctx.textBaseline = 'top';
    for (const c of L.cols) {
      const prev = Math.floor(c.y);
      c.y += c.v * dt;
      const cur = Math.floor(c.y);
      if (cur !== prev) {
        const yy = cur * L.size;
        // the cell behind the head settles to green
        ctx.fillStyle = `rgba(0, 255, 65, ${L.alpha * .9})`;
        drawGlyph(c, (cur - 1) * L.size, L);
        ctx.shadowColor = '#9dffb5'; ctx.shadowBlur = L.size > 12 ? 8 : 0;
        ctx.fillStyle = `rgba(220, 255, 228, ${L.alpha})`;
        drawGlyph(c, yy, L);
        ctx.shadowBlur = 0;
      }
      // random flicker inside the trail
      if (Math.random() < .03) { ctx.fillStyle = `rgba(0, 200, 60, ${L.alpha * .6})`; drawGlyph(c, (cur - 2 - ((Math.random() * 14) | 0)) * L.size, L); }
      if (c.y * L.size > innerHeight + 200 && Math.random() < .02) { c.y = -Math.random() * 20; c.v = L.speed[0] + Math.random() * (L.speed[1] - L.speed[0]); }
    }
  }
}
function drawGlyph(c, y, L) {
  if (y < -L.size) return;
  if (c.mirror) { ctx.save(); ctx.translate(c.x + L.size, y); ctx.scale(-1, 1); ctx.fillText(g(), 0, 0); ctx.restore(); }
  else ctx.fillText(g(), c.x, y);
}

/* ---------- Ink ---------- */
function initInk() {
  const W = innerWidth, H = innerHeight;
  return {
    blots: Array.from({ length: 5 }, (_, i) => ({ x: Math.random() * W, y: Math.random() * H, r: 180 + Math.random() * 260, a: Math.random() * 6, s: .02 + Math.random() * .03, k: i })),
    ring: { x: W - 150, y: H - 150, r: Math.min(110, W / 9) },
  };
}
function noise(a, t, k) { return Math.sin(a * 3 + t * .7 + k) * .5 + Math.sin(a * 7 - t * 1.1 + k * 2) * .3 + Math.sin(a * 13 + t * .4) * .2; }
function drawInk(dt, t) {
  const W = innerWidth, H = innerHeight;
  ctx.clearRect(0, 0, W, H);
  // drifting washes
  for (const b of state.blots) {
    b.a += b.s * dt;
    const x = b.x + Math.cos(b.a) * 60, y = b.y + Math.sin(b.a * 1.3) * 40;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, b.r);
    gr.addColorStop(0, 'rgba(40, 30, 18, 0.07)'); gr.addColorStop(.6, 'rgba(40, 30, 18, 0.025)'); gr.addColorStop(1, 'rgba(40, 30, 18, 0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, b.r, 0, Math.PI * 2); ctx.fill();
  }
  // a breathing logogram ring, Arrival-style
  const { x, y, r } = state.ring;
  const breathe = 1 + Math.sin(t * .6) * .03;
  ctx.save(); ctx.translate(x, y);
  for (let pass = 0; pass < 3; pass++) {
    ctx.beginPath();
    const steps = 160;
    for (let i = 0; i <= steps; i++) {
      const a = i / steps * Math.PI * 2;
      const rr = r * breathe * (1 + noise(a, t * .5, pass) * .05);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.strokeStyle = `rgba(22, 19, 15, ${0.09 - pass * .025})`;
    ctx.lineWidth = 6 + pass * 5 + Math.sin(t + pass) * 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // tendrils
  for (let k = 0; k < 4; k++) {
    const a0 = k * 1.7 + Math.sin(t * .2 + k) * .3;
    ctx.beginPath();
    const sx = Math.cos(a0) * r, sy = Math.sin(a0) * r;
    ctx.moveTo(sx, sy);
    const len = 22 + Math.sin(t * .7 + k * 2) * 12;
    ctx.quadraticCurveTo(Math.cos(a0 + .1) * (r + len * .6), Math.sin(a0 + .1) * (r + len * .6), Math.cos(a0 + .05) * (r + len), Math.sin(a0 + .05) * (r + len));
    ctx.strokeStyle = 'rgba(22, 19, 15, 0.08)'; ctx.lineWidth = 4; ctx.stroke();
  }
  ctx.restore();
}

/* ---------- Matrix boot flourish ---------- */
export function bootFlourish(name) {
  if (reduced) return;
  const d = document.createElement('div');
  d.className = 'boot';
  document.body.appendChild(d);
  const text = `Wake up, ${name}…`;
  let i = 0;
  const step = () => { d.textContent = text.slice(0, ++i) + (i < text.length ? '█' : ''); if (i < text.length) setTimeout(step, 70); };
  step();
  setTimeout(() => d.remove(), 3400);
}
