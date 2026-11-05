// One file: smart viewer (3D / image / audio / video / text), pinned comments, versions & compare, linked tasks.
import { S } from './store.js';
import { esc, icon, bytes, ago, fullTime, avatarImg, menu, toast, toastErr, download, confirmBox, promptBox, num, el, act } from './ui.js';
import { getFile, kindOf, baseName, dirName, history, commitFiles, mimeOf, ext } from './files.js';
import { mountThread } from './comments.js';
import { uploadModal } from './upload.js';

export async function render(main, route) {
  const path = route.arg;
  const entry = S.tree?.entries.get(path);
  const page = el(`<div class="fileview viewer-host"><section class="fv-stage"><div class="fv-top"></div><div class="fv-canvas"><div class="pane" data-pane="a"></div></div></section>
    <aside class="fv-side"><div class="fv-tabs"></div><div class="fv-side-body"></div></aside></div>`);
  main.appendChild(page);
  main.style.overflow = 'hidden';
  const top = page.querySelector('.fv-top'), canvas = page.querySelector('.fv-canvas'), paneA = page.querySelector('[data-pane="a"]');
  const tabsEl = page.querySelector('.fv-tabs'), side = page.querySelector('.fv-side-body');
  const kind = kindOf(path);
  const cleanups = [];
  let viewer = null, viewerB = null, unlink = null, pins = [], draft = null, pinMode = false, activePin = null;
  let imgCtl = null, ctl = null;
  let tab = 'comments';
  let compareSha = null;

  if (!entry) {
    top.innerHTML = `<a class="btn ghost icon" href="#/files/${encodeURIComponent(dirName(path))}">${icon('back')}</a><h2>${esc(baseName(path))}</h2>`;
    paneA.innerHTML = `<div class="empty" style="height:100%">${icon('file')}<div>This file is not in the repo (anymore). It may have been moved or deleted.</div></div>`;
    return () => { main.style.overflow = ''; };
  }

  /* ---------- top bar ---------- */
  const drawTop = () => {
    const e = S.tree.entries.get(path) || entry;
    top.innerHTML = `<a class="btn ghost icon" href="#/files/${encodeURIComponent(dirName(path))}" title="Back to folder">${icon('back')}</a>
      <div style="min-width:0"><h2>${esc(baseName(path))}</h2><div class="faint mono" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(dirName(path))} · ${bytes(e.size)}</div></div>
      <span class="grow"></span>
      <button class="btn" data-a="task">${icon('plus')} Task from this</button>
      <button class="btn" data-a="version">${icon('upload')} New version</button>
      <button class="btn primary" data-a="download">${icon('download')} Download</button>
      <button class="btn icon" data-a="more" title="More">${icon('more')}</button>`;
  };
  top.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const k = a.dataset.a;
    try {
      if (k === 'download') { const { buf } = await getFile(path); download(new Blob([buf], { type: mimeOf(path) }), baseName(path)); }
      if (k === 'version') uploadModal({ replace: path });
      if (k === 'task') { const { newTaskModal } = await import('./task.js'); newTaskModal({ title: `Review ${baseName(path)}`, files: [path] }); }
      if (k === 'more') menu(a, [
        { label: 'Copy hub link', value: 'link', icon: 'link' },
        { label: 'Open on GitHub', value: 'gh', icon: 'expand' },
        { label: 'Rename / move', value: 'move', icon: 'move' },
        'sep',
        { label: 'Delete from repo', value: 'del', icon: 'trash', danger: true },
      ], async v => {
        if (v === 'link') { navigator.clipboard?.writeText(location.href); toast('Link copied', { ms: 1400 }); }
        if (v === 'gh') open(`${S.webRepo}/blob/${S.cfg.branch}/${path.split('/').map(encodeURIComponent).join('/')}`, '_blank');
        if (v === 'move') {
          const to = await promptBox('Rename or move', { value: path, ok: 'Move' });
          const dest = to?.trim().replace(/^\/+/, '');
          if (dest && dest !== path) {
            try {
              await commitFiles([{ path: dest, from: path }], `Move ${baseName(path)} to ${dest} (hub)`);
              // keep the comment thread and every task link pointing at the file
              const th = S.fileThread(path);
              if (th) { await S.patchBody(th.n, ({ meta }) => ({ meta: { ...meta, file: dest } })); await S.updateTask(th.n, { title: `💬 ${baseName(dest)}` }); }
              for (const t of S.tasksForFile(path)) await S.patchBody(t.n, ({ meta }) => ({ meta: { ...meta, files: (meta.files || []).map(f => f === path ? dest : f) } }));
              location.hash = '#/file/' + encodeURIComponent(dest);
            } catch (er) { toastErr(er); }
          }
        }
        if (v === 'del' && await confirmBox('Delete file?', `${path} will be removed from the repo. It stays in the git history, so it can be recovered.`, { ok: 'Delete', danger: true })) {
          await commitFiles([{ path, delete: true }], `Delete ${baseName(path)} (hub)`).catch(toastErr);
          location.hash = '#/files/' + encodeURIComponent(dirName(path));
        }
      });
    } catch (er) { toastErr(er); }
  });
  drawTop();

  /* ---------- side tabs ---------- */
  const TABS = [['comments', 'chat', 'Comments'], ['info', 'info', 'Info'], ['versions', 'history', 'Versions'], ['tasks', 'board', 'Tasks']];
  const drawTabs = () => {
    const th = S.fileThread(path);
    const linked = S.tasksForFile(path).length;
    tabsEl.innerHTML = TABS.map(([k, ic, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${icon(ic)} ${l}${k === 'comments' && th?.comments ? ` <span class="faint">${th.comments}</span>` : ''}${k === 'tasks' && linked ? ` <span class="faint">${linked}</span>` : ''}</button>`).join('');
  };
  tabsEl.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; drawTabs(); drawSide(); } });

  let thread = null, threadHost = null;
  const threadNum = create => create === false ? (S.fileThread(path)?.n || null) : S.ensureFileThread(path);
  const drawSide = () => {
    // keep the comment thread alive across tab switches
    if (thread && threadHost) threadHost.remove();
    side.innerHTML = '';
    if (tab === 'comments') {
      if (!threadHost) {
        threadHost = document.createElement('div');
        threadHost.style.display = 'grid'; threadHost.style.gap = '12px';
        const hint = el(`<div class="muted" style="font-size:12px">${kind === 'model' || kind === 'image' ? `${icon('pin').replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} Press <span class="kbd">P</span> or the pin button, click on the ${kind === 'model' ? 'model' : 'image'}, then write. The comment remembers the exact spot${kind === 'model' ? ' and camera angle' : ''}.` : 'Comments here are visible to both of you.'}</div>`);
        const tHost = document.createElement('div'), cHost = document.createElement('div');
        threadHost.append(hint, cHost, tHost);
        thread = mountThread(tHost, threadNum, {
          composer: cHost, emptyText: 'No comments on this file yet.',
          draftPin: () => { const d = draft; draft = null; pinMode = false; drawPins(); return d; },
          onPins: list => { pins = list; drawPins(); },
          onPinClick: (c, meta) => focusPin(c.id, meta.pin),
          onSent: () => drawTabs(),
        });
      }
      side.appendChild(threadHost);
    }
    if (tab === 'info') side.appendChild(infoPanel());
    if (tab === 'versions') versionsPanel(side);
    if (tab === 'tasks') tasksPanel(side);
  };
  const offIss = S.on('issues', () => { drawTabs(); if (tab === 'tasks') drawSide(); });
  cleanups.push(offIss, () => thread?.destroy());

  /* ---------- stage ---------- */
  const loading = el(`<div class="loading-veil"><div class="box"><div class="progress"><i style="width:15%"></i></div><div>Loading ${esc(baseName(path))} (${bytes(entry.size)})…</div></div></div>`);
  canvas.appendChild(loading);
  const bar = loading.querySelector('.progress i');
  let buf;
  try { buf = (await getFile(path)).buf; bar.style.width = '70%'; }
  catch (e) { loading.innerHTML = `<div class="box">${esc(e.message)}</div>`; return () => { cleanups.forEach(f => { try { f(); } catch {} }); main.style.overflow = ''; }; }

  const pinLayer = el('<div class="pins"></div>');
  if (kind === 'model') await mountModel();
  else if (kind === 'image') await mountImage();
  else if (kind === 'audio') mountAudio();
  else if (kind === 'video') { paneA.innerHTML = ''; const v = el(`<video controls style="width:100%;height:100%;background:#000"></video>`); v.src = URL.createObjectURL(new Blob([buf], { type: mimeOf(path) })); paneA.appendChild(v); cleanups.push(() => { v.pause(); URL.revokeObjectURL(v.src); }); }
  else if (kind === 'text') await mountText();
  else paneA.innerHTML = `<div class="empty" style="height:100%">${icon('file')}<div>No preview for .${esc(ext(path))} files. Download it to open it.</div></div>`;
  loading.remove();
  drawTabs(); drawSide();

  /* ---------- model ---------- */
  async function mountModel() {
    const { ModelViewer } = await import('./viewer.js');
    viewer = new ModelViewer(paneA);
    try { await viewer.load(buf, path, { resolve: rel => getFile(dirName(path) + '/' + rel).then(r => r.buf) }); }
    catch (e) { viewer.dispose(); viewer = null; paneA.innerHTML = `<div class="empty" style="height:100%">${icon('cube')}<div>Could not read this model: ${esc(e.message)}</div></div>`; return; }
    paneA.appendChild(pinLayer);
    const { mountControls } = await import('./controls.js');
    ctl = mountControls(paneA, { viewer, others: () => viewerB ? [viewerB] : [], pin: () => setPinMode(!pinMode), fullscreenEl: page.querySelector('.fv-stage'), name: () => baseName(path) });
    // pin placement
    let downAt = null;
    viewer.renderer.domElement.addEventListener('pointerdown', e => downAt = [e.clientX, e.clientY]);
    viewer.renderer.domElement.addEventListener('pointerup', e => {
      if (!pinMode || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
      const hit = viewer.pick(e.clientX, e.clientY);
      if (!hit) return toast('Click on the model itself', { ms: 1400 });
      draft = { ...hit, view: viewer.getView() };
      pinMode = false; paneA.querySelector('.pin-mode-hint')?.remove(); ctl?.setPinOn(false);
      drawPins();
      tab = 'comments'; drawTabs(); drawSide();
      setTimeout(() => thread?.composer.focus(), 30);
    });
    let lastOcc = 0;
    viewer.onFrame.add(() => {
      const now = performance.now(); const occ = now - lastOcc > 250; if (occ) lastOcc = now;
      pinLayer.querySelectorAll('.pin').forEach(p => {
        const pt = JSON.parse(p.dataset.p);
        const s = viewer.project(pt);
        p.style.left = s.x + 'px'; p.style.top = s.y + 'px'; p.style.display = s.off ? 'none' : '';
        if (occ) p.classList.toggle('behind', viewer.occluded(pt));
      });
    });
    cleanups.push(() => ctl?.destroy(), () => viewer.dispose(), () => viewerB?.dispose());
  }

  function setPinMode(v) {
    pinMode = v;
    paneA.querySelector('[data-t="pin"]')?.classList.toggle('on', v);
    ctl?.setPinOn(v);
    paneA.querySelector('.pin-mode-hint')?.remove();
    if (v) paneA.appendChild(el(`<div class="pin-mode-hint">Click where your comment goes · Esc to cancel</div>`));
  }

  function drawPins() {
    pinLayer.innerHTML = pins.map(p => `<div class="pin ${p.resolved ? 'resolved' : ''} ${activePin === p.id ? 'active' : ''}" data-id="${p.id}" data-p="${esc(JSON.stringify(kind === 'model' ? p.pin.p : [p.pin.x, p.pin.y]))}" title="Comment by ${esc(p.author)}">${p.k}</div>`).join('')
      + (draft ? `<div class="pin draft" data-p="${esc(JSON.stringify(kind === 'model' ? draft.p : [draft.x, draft.y]))}">+</div>` : '');
    if (viewer) viewer._dirty = true;
    imgCtl?.layout();
  }
  pinLayer.addEventListener('click', e => {
    const p = e.target.closest('.pin[data-id]'); if (!p) return;
    const pin = pins.find(x => x.id === +p.dataset.id);
    focusPin(pin.id, pin.pin);
  });
  function focusPin(id, pin) {
    activePin = id; drawPins();
    if (viewer && pin.view) viewer.flyTo(pin.view);
    if (imgCtl && pin.x != null) imgCtl.center(pin.x, pin.y);
    if (tab !== 'comments') { tab = 'comments'; drawTabs(); drawSide(); }
    thread?.flash(id);
  }

  /* ---------- image ---------- */
  async function mountImage() {
    const { imageUrl } = await import('./files.js');
    const url = await imageUrl(buf, path);
    const stage = el(`<div class="img-stage"><div class="layer"><img alt="" draggable="false"></div></div>`);
    const layer = stage.querySelector('.layer'), img = layer.querySelector('img');
    layer.appendChild(pinLayer);
    paneA.innerHTML = ''; paneA.appendChild(stage);
    const tools = el(`<div class="vtools tr"><button class="btn icon" data-t="pin" title="Drop a comment pin (P)">${icon('pin')}</button><button class="btn icon" data-t="fit" title="Fit (F)">${icon('focus')}</button><button class="btn sm" data-t="1:1" title="Actual pixels">1:1</button><button class="btn icon" data-t="full" title="Fullscreen">${icon('expand')}</button></div>`);
    const zoomLbl = el(`<div class="vtools bottom"><span class="mono" data-z style="padding:0 8px;font-size:12px">100%</span></div>`);
    paneA.append(tools, zoomLbl);
    let s = 1, x = 0, y = 0, W = 0, H = 0, cmpUrl = null, wipe = .5;
    const apply = () => {
      layer.style.transform = `translate(${x}px,${y}px) scale(${s})`;
      stage.classList.toggle('pixel', s >= 3);
      zoomLbl.querySelector('[data-z]').textContent = Math.round(s * 100) + '%';
      pinLayer.querySelectorAll('.pin').forEach(p => { const [px, py] = JSON.parse(p.dataset.p); p.style.left = px * W + 'px'; p.style.top = py * H + 'px'; p.style.scale = String(1 / s); });
      const w = stage.querySelector('.wipe'); if (w) w.style.left = x + wipe * W * s + 'px';
      const ov = layer.querySelector('[data-old]'); if (ov) ov.style.clipPath = `inset(0 ${100 - wipe * 100}% 0 0)`;
    };
    const fit = () => { const r = stage.getBoundingClientRect(); s = Math.min(r.width / W, r.height / H, 4) * .92; x = (r.width - W * s) / 2; y = (r.height - H * s) / 2; apply(); };
    img.onload = () => { W = img.naturalWidth; H = img.naturalHeight; img.style.width = W + 'px'; img.style.height = H + 'px'; pinLayer.style.width = W + 'px'; pinLayer.style.height = H + 'px'; fit(); infoExtra = { w: W, h: H }; if (tab === 'info') drawSide(); };
    img.src = url;
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.exp(-e.deltaY * .0015), ns = Math.min(40, Math.max(.05, s * k));
      x = mx - (mx - x) * ns / s; y = my - (my - y) * ns / s; s = ns; apply();
    }, { passive: false });
    let drag = null;
    const fingers = new Map(); let pinch = null;
    stage.addEventListener('pointerdown', e => {
      if (e.target.closest('.pin, .wipe')) return;
      fingers.set(e.pointerId, [e.clientX, e.clientY]);
      stage.setPointerCapture(e.pointerId);
      if (fingers.size === 2) {
        const [a, b] = [...fingers.values()], r = stage.getBoundingClientRect();
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s, x, y, mx: (a[0] + b[0]) / 2 - r.left, my: (a[1] + b[1]) / 2 - r.top };
        drag = null; return;
      }
      drag = { x: e.clientX, y: e.clientY, ox: x, oy: y, moved: false }; stage.classList.add('grabbing');
    });
    stage.addEventListener('pointermove', e => {
      if (fingers.has(e.pointerId)) fingers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && fingers.size === 2) {
        const [a, b] = [...fingers.values()];
        const ns = Math.min(40, Math.max(.05, pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
        x = pinch.mx - (pinch.mx - pinch.x) * ns / pinch.s; y = pinch.my - (pinch.my - pinch.y) * ns / pinch.s; s = ns; apply();
        return;
      }
      if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 3) drag.moved = true; x = drag.ox + dx; y = drag.oy + dy; apply();
    });
    const lift = e => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
    stage.addEventListener('pointercancel', lift);
    stage.addEventListener('pointerup', e => {
      const wasPinch = !!pinch || fingers.size > 1; lift(e); if (wasPinch) { drag = null; return; }
      stage.classList.remove('grabbing');
      const d = drag; drag = null;
      if (!d || d.moved || !pinMode) return;
      const r = img.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      if (px < 0 || py < 0 || px > 1 || py > 1) return;
      draft = { x: +px.toFixed(4), y: +py.toFixed(4) };
      setPinMode(false); drawPins();
      tab = 'comments'; drawTabs(); drawSide(); setTimeout(() => thread?.composer.focus(), 30);
    });
    tools.addEventListener('click', e => {
      const t = e.target.closest('[data-t]')?.dataset.t;
      if (t === 'fit') fit();
      if (t === '1:1') { const r = stage.getBoundingClientRect(); s = 1; x = (r.width - W) / 2; y = (r.height - H) / 2; apply(); }
      if (t === 'pin') setPinMode(!pinMode);
      if (t === 'full') { const fs = page.querySelector('.fv-stage'); document.fullscreenElement ? document.exitFullscreen() : fs.requestFullscreen?.(); }
    });
    const keys = e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || document.querySelector('.modal, .drawer')) return;
      if (e.key === 'f') fit(); if (e.key === 'p') setPinMode(!pinMode); if (e.key === 'Escape' && pinMode) setPinMode(false);
    };
    document.addEventListener('keydown', keys);
    const ro = new ResizeObserver(() => W && fit()); ro.observe(stage);
    cleanups.push(() => document.removeEventListener('keydown', keys), () => ro.disconnect(), () => URL.revokeObjectURL(url));
    imgCtl = {
      layout: apply,
      center(px, py) { const r = stage.getBoundingClientRect(); s = Math.max(s, 1.5); x = r.width / 2 - px * W * s; y = r.height / 2 - py * H * s; apply(); },
      async compare(sha, label) {
        layer.querySelector('[data-old]')?.remove(); stage.querySelector('.wipe')?.remove(); paneA.querySelector('.pane-label')?.remove();
        if (cmpUrl) URL.revokeObjectURL(cmpUrl); cmpUrl = null;
        if (!sha) return apply();
        const { getBlob } = await import('./files.js');
        const { imageUrl } = await import('./files.js');
        cmpUrl = await imageUrl(await getBlob(sha), path);
        const old = el(`<img data-old alt="" draggable="false" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:contain;background:var(--viewer-bg)">`); old.src = cmpUrl;
        old.onload = () => { if (old.naturalWidth !== W || old.naturalHeight !== H) toast(`Old version was ${old.naturalWidth}×${old.naturalHeight}, now ${W}×${H}`, { ms: 4000 }); };
        layer.insertBefore(old, pinLayer);
        const w = el('<div class="wipe"></div>'); stage.appendChild(w);
        paneA.appendChild(el(`<div class="pane-label">◀ ${esc(label)} · current ▶</div>`));
        w.addEventListener('pointerdown', ev => {
          ev.stopPropagation(); w.setPointerCapture(ev.pointerId);
          const mv = e2 => { const r = layer.getBoundingClientRect(); wipe = Math.min(1, Math.max(0, (e2.clientX - r.left) / r.width)); apply(); };
          w.addEventListener('pointermove', mv); w.addEventListener('pointerup', () => w.removeEventListener('pointermove', mv), { once: true });
        });
        apply();
      },
    };
  }
  let infoExtra = null;

  /* ---------- audio ---------- */
  function mountAudio() {
    const url = URL.createObjectURL(new Blob([buf], { type: mimeOf(path) }));
    const st = el(`<div class="audio-stage"><div style="width:100%;max-width:900px;display:grid;gap:14px"><canvas></canvas><audio controls style="width:100%"></audio><div class="faint mono" data-ai style="font-size:12px;text-align:center"></div></div></div>`);
    paneA.innerHTML = ''; paneA.appendChild(st);
    const au = st.querySelector('audio'), cv = st.querySelector('canvas');
    au.src = url;
    let peaks = null;
    (async () => {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const ab = await ac.decodeAudioData(buf.slice(0));
        const ch = ab.getChannelData(0), N = 600; peaks = new Float32Array(N);
        const step = Math.floor(ch.length / N);
        for (let i = 0; i < N; i++) { let m = 0; for (let j = 0; j < step; j += 8) m = Math.max(m, Math.abs(ch[i * step + j])); peaks[i] = m; }
        st.querySelector('[data-ai]').textContent = `${ab.duration.toFixed(2)}s · ${ab.sampleRate} Hz · ${ab.numberOfChannels === 1 ? 'mono' : ab.numberOfChannels + ' channels'}`;
        infoExtra = { duration: ab.duration, rate: ab.sampleRate, channels: ab.numberOfChannels };
        ac.close(); paint();
      } catch { }
    })();
    const paint = () => {
      if (!peaks) return;
      const w = cv.clientWidth, h = cv.clientHeight; cv.width = w * devicePixelRatio; cv.height = h * devicePixelRatio;
      const g = cv.getContext('2d'); g.scale(devicePixelRatio, devicePixelRatio);
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), dim = getComputedStyle(document.documentElement).getPropertyValue('--fg3').trim();
      const prog = au.duration ? au.currentTime / au.duration : 0;
      const bw = w / peaks.length;
      peaks.forEach((p, i) => { g.fillStyle = i / peaks.length < prog ? acc : dim; const bh = Math.max(1, p * h * .95); g.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - .5), bh); });
    };
    au.addEventListener('timeupdate', paint);
    cv.addEventListener('click', e => { const r = cv.getBoundingClientRect(); if (au.duration) au.currentTime = (e.clientX - r.left) / r.width * au.duration; au.play(); });
    const ro = new ResizeObserver(paint); ro.observe(cv);
    cleanups.push(() => { au.pause(); ro.disconnect(); URL.revokeObjectURL(url); });
  }

  /* ---------- text ---------- */
  async function mountText() {
    const txt = new TextDecoder().decode(buf.byteLength > 2e6 ? buf.slice(0, 2e6) : buf);
    const st = el(`<div class="text-stage"></div>`);
    paneA.innerHTML = ''; paneA.appendChild(st);
    paneA.parentElement.style.background = 'var(--bg2)';
    if (ext(path) === 'md') {
      const { renderMarkdown, enhance } = await import('./md.js');
      st.innerHTML = `<div class="md" style="max-width:820px;margin:0 auto">${await renderMarkdown(txt)}</div>`; enhance(st);
    } else st.innerHTML = `<pre>${esc(txt)}</pre>`;
  }

  /* ---------- side panels ---------- */
  function infoPanel() {
    const e = S.tree.entries.get(path) || entry;
    const box = el('<div style="display:grid;gap:14px"></div>');
    let h = `<div class="stats"><div><b>${bytes(e.size)}</b><span>File size</span></div><div><b>.${esc(ext(path))}</b><span>Format</span></div>`;
    if (viewer) {
      const s = viewer.stats();
      const u = viewer.gridStep;
      h += `<div><b>${num(s.tris)}</b><span>Triangles</span></div><div><b>${num(s.verts)}</b><span>Vertices</span></div>
        <div><b>${s.meshes}</b><span>Meshes</span></div><div><b>${s.materials}</b><span>Materials</span></div>
        <div><b>${s.textures}</b><span>Textures</span></div><div><b>${s.bones || '–'}</b><span>Bones</span></div>
        <div><b>${s.clips || '–'}</b><span>Animations</span></div><div><b>${s.morph || '–'}</b><span>Morph targets</span></div>
        <div style="grid-column:span 2"><b>${s.size.map(v => fmtLen(v)).join(' × ')}</b><span>Width × height × depth (file units)${u ? ` · grid square ${fmtLen(u)}` : ''}</span></div>`;
    }
    if (infoExtra?.w) h += `<div><b>${infoExtra.w} × ${infoExtra.h}</b><span>Pixels</span></div><div><b>${(infoExtra.w / infoExtra.h).toFixed(3)}</b><span>Aspect</span></div>${isPow2(infoExtra.w) && isPow2(infoExtra.h) ? '<div style="grid-column:span 2"><b>✓ power of two</b><span>Good for game textures</span></div>' : ''}`;
    if (infoExtra?.duration) h += `<div><b>${infoExtra.duration.toFixed(2)}s</b><span>Length</span></div><div><b>${infoExtra.rate / 1000} kHz</b><span>${infoExtra.channels === 1 ? 'Mono' : 'Stereo'}</span></div>`;
    h += '</div>';
    if (viewer) {
      h += `<div class="section-title">Materials & textures</div><div class="mat-list" data-mats></div>`;
      if (viewer.clips.length) h += `<div class="section-title">Animations</div><div style="display:grid;gap:4px">${viewer.clips.map((c, i) => `<button class="row-item" data-clip="${i}" style="border:0;background:none;color:inherit;width:100%;text-align:left"><span class="t">${icon('play').replace('<svg', '<svg width="12" height="12"')} ${esc(c.name || 'Clip ' + (i + 1))}</span><span class="faint mono" style="font-size:11px">${c.duration.toFixed(2)}s · ${c.tracks.length} tracks</span></button>`).join('')}</div>`;
    }
    h += `<div class="section-title">Path</div><div class="mono faint" style="font-size:12px;word-break:break-all">${esc(path)}</div><div class="faint" style="font-size:11px">git blob ${esc(e.sha.slice(0, 10))}</div>`;
    box.innerHTML = h;
    if (viewer) {
      import('./viewer.js').then(({ textureToCanvas, MAP_LABEL }) => {
        const host = box.querySelector('[data-mats]');
        const mats = viewer.materials();
        host.innerHTML = mats.length ? '' : '<div class="faint">No materials.</div>';
        mats.forEach(m => {
          const d = el(`<div class="mat"><div style="display:flex;gap:8px;align-items:center">${m.color ? `<span class="swatch" style="background:${m.color}"></span>` : ''}<b style="font-size:13px">${esc(m.name)}</b><span class="faint" style="font-size:11px;margin-left:auto">${esc(m.type.replace('Material', ''))}</span></div><div class="maps"></div></div>`);
          m.maps.forEach(mp => {
            const f = el(`<figure></figure>`); const c = textureToCanvas(mp.tex); f.appendChild(c);
            f.insertAdjacentHTML('beforeend', `<figcaption>${esc(MAP_LABEL[mp.key] || mp.key)}<br>${mp.tex.image?.width || '?'}²</figcaption>`);
            c.title = 'Click to view full size';
            c.onclick = () => { const big = textureToCanvas(mp.tex, Math.min(1024, mp.tex.image?.width || 512)); big.style.cssText = 'width:100%;height:auto;border-radius:8px'; import('./ui.js').then(({ modal }) => modal({ title: `${m.name} · ${MAP_LABEL[mp.key]}`, body: big, wide: true })); };
            d.querySelector('.maps').appendChild(f);
          });
          if (!m.maps.length) d.querySelector('.maps').innerHTML = '<span class="faint" style="font-size:11px">No textures (flat colour)</span>';
          host.appendChild(d);
        });
      });
      box.addEventListener('click', e => { const c = e.target.closest('[data-clip]'); if (c) { viewer.play(+c.dataset.clip, true); const sel = paneA.querySelector('[data-clip]'); if (sel) sel.value = c.dataset.clip; } });
    }
    return box;
  }

  async function versionsPanel(host) {
    host.innerHTML = '<div class="faint">Loading history…</div>';
    let list;
    try { list = await history(path); } catch (e) { host.innerHTML = `<div class="faint">${esc(e.message)}</div>`; return; }
    const canCompare = kind === 'model' || kind === 'image';
    host.innerHTML = `<div class="muted" style="font-size:12px">${list.length} version${list.length === 1 ? '' : 's'}. ${canCompare && list.length > 1 ? 'Click an older one to compare it side by side with the current file.' : ''}</div>
      <div class="versions">${list.map((c, i) => `<div class="ver ${compareSha === c.sha ? 'on' : ''}" data-sha="${c.sha}" data-i="${i}">${avatarImg(c.author || { login: c.commit.author.name })}<div style="min-width:0"><div class="msg">${esc(c.commit.message.split('\n')[0])}</div><div class="when" title="${esc(fullTime(c.commit.author.date))}">${esc(c.author?.login || c.commit.author.name)} · ${esc(ago(c.commit.author.date))}</div></div>${i === 0 ? '<span class="chip" style="--c:var(--ok)">current</span>' : canCompare ? `<span class="faint" style="font-size:11px">${compareSha === c.sha ? 'comparing' : 'compare'}</span>` : ''}</div>`).join('')}</div>
      ${compareSha ? '<button class="btn" data-stopcmp>Stop comparing</button>' : ''}`;
    host.onclick = async e => {
      if (e.target.closest('[data-stopcmp]')) { compareSha = null; await stopCompare(); return versionsPanel(host); }
      const v = e.target.closest('.ver'); if (!v || v.dataset.i === '0' || !canCompare) return;
      const c = list[+v.dataset.i];
      try {
        const meta = await S.gh.get(`${S.repoPath}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${c.sha}`, { etag: false });
        compareSha = c.sha;
        await startCompare(meta.sha, `${c.commit.message.split('\n')[0].slice(0, 40)} · ${ago(c.commit.author.date)}`);
        versionsPanel(host);
      } catch (er) { toastErr(er, 'Could not load that version'); }
    };
  }
  async function startCompare(blobSha, label) {
    const { getBlob } = await import('./files.js');
    if (kind === 'image') return imgCtl.compare(blobSha, label);
    await stopCompare();
    const { ModelViewer } = await import('./viewer.js');
    const paneB = el(`<div class="pane" data-pane="b"><div class="pane-label">${esc(label)}</div></div>`);
    canvas.insertBefore(paneB, paneA);
    paneA.insertAdjacentHTML('beforeend', '<div class="pane-label" data-curlabel style="left:auto;right:12px;top:58px">current</div>');
    viewerB = new ModelViewer(paneB);
    viewerB.setMode(viewer.mode); viewerB.setLight(viewer.light); viewerB.setBackground(viewer.bg);
    await viewerB.load(await getBlob(blobSha), path);
    unlink = viewer.link(viewerB);
    const a = viewer.stats(), b = viewerB.stats();
    paneB.querySelector('.pane-label').textContent += ` · ${num(b.tris)} tris (${a.tris - b.tris >= 0 ? '+' : ''}${num(a.tris - b.tris)} now)`;
  }
  async function stopCompare() {
    if (kind === 'image') return imgCtl?.compare(null);
    unlink?.(); unlink = null;
    viewerB?.dispose(); viewerB = null;
    canvas.querySelector('[data-pane="b"]')?.remove(); paneA.querySelector('[data-curlabel]')?.remove();
  }

  function tasksPanel(host) {
    const linked = S.tasksForFile(path);
    host.innerHTML = `<div class="muted" style="font-size:12px">Tasks this file belongs to. Upload a task's deliverables from the task itself, or link this file here.</div>
      <div class="links">${linked.map(t => `<a class="row-item" href="#/task/${t.n}" style="color:inherit;text-decoration:none"><span class="dot" style="--c:var(--s-${t.status})"></span><span class="t">${esc(t.title)}</span><span class="faint mono" style="font-size:11px">#${t.n}</span></a>`).join('') || '<div class="faint">Not linked to any task.</div>'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-link>${icon('link')} Link to a task</button><button class="btn primary" data-new>${icon('plus')} New task with this file</button></div>`;
    host.onclick = async e => {
      if (e.target.closest('[data-new]')) { const { newTaskModal } = await import('./task.js'); newTaskModal({ title: `Review ${baseName(path)}`, files: [path] }); }
      if (e.target.closest('[data-link]')) {
        const open = S.tasks().filter(t => !['done', 'parked'].includes(t.status) && !t.files.includes(path));
        menu(e.target.closest('[data-link]'), open.map(t => ({ label: t.title, value: t.n, sub: '#' + t.n })), async n => {
          try { await S.patchBody(n, ({ meta }) => ({ meta: { ...meta, files: [...new Set([...(meta.files || []), path])] } })); toast('Linked', { kind: 'ok' }); }
          catch (er) { toastErr(er); }
        }, { search: true, width: 340 });
      }
    };
  }

  // reload when a new version lands (from us or the other person)
  let lastSha = entry.sha;
  const offTree = S.on('tree', () => {
    const e = S.tree.entries.get(path);
    if (e && e.sha !== lastSha) {
      lastSha = e.sha;
      toast('A new version of this file arrived', { sub: 'Click to reload it', ms: 10000, onClick: () => { const h = location.hash; location.hash = '#/home'; setTimeout(() => location.hash = h, 30); } });
      drawTop();
    }
  });
  cleanups.push(offTree);
  const escPin = e => { if (e.key === 'Escape' && (pinMode || draft)) { draft = null; setPinMode(false); drawPins(); } };
  document.addEventListener('keydown', escPin); cleanups.push(() => document.removeEventListener('keydown', escPin));

  return () => { cleanups.forEach(f => { try { f(); } catch {} }); main.style.overflow = ''; };
}

function fmtLen(v) { if (!isFinite(v)) return '–'; const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3); }
const isPow2 = n => n > 0 && (n & (n - 1)) === 0;
void act;
