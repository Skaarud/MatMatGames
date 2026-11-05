// Models: every 3D model in the repo on one shelf, with a big viewer next to it.
// No folder digging: grouped by category, searchable, arrow keys flip through them.
import { S } from './store.js';
import { esc, icon, bytes, num, store as ls, debounce, download, toastErr, avatarImg, act } from './ui.js';
import { kindOf, baseName, dirName, getBlob, ext, mimeOf, HIDE_DIRS } from './files.js';
import { observe } from './thumbs.js';

const CAT_ORDER = ['characters', 'creatures', 'props', 'environment', 'hub', 'import'];
const pretty = s => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** All models, with a category and a short "where" label. Hides .fbx/.obj twins of a .glb unless asked. */
export function allModels({ dupes = false } = {}) {
  if (!S.tree) return [];
  const list = [];
  const glbs = new Set();
  for (const e of S.tree.entries.values()) if (e.type === 'blob' && /\.(glb|gltf)$/i.test(e.path)) glbs.add(e.path.replace(/\.\w+$/, '').toLowerCase());
  for (const e of S.tree.entries.values()) {
    if (e.type !== 'blob' || kindOf(e.path) !== 'model') continue;
    const parts = e.path.split('/');
    if (HIDE_DIRS.includes(parts[0])) continue;
    const twin = /\.(fbx|obj)$/i.test(e.path) && glbs.has(e.path.replace(/\.\w+$/, '').toLowerCase());
    if (twin && !dupes) continue;
    let cat, where;
    if (parts[0] === 'art' && parts.length > 2) { cat = parts[1].replace(/_sol\d*$/, ''); where = parts.slice(2, -1).join(' / '); }
    else if (parts[0] === 'hub') { cat = 'hub'; where = parts.slice(1, -1).join(' / '); }
    else { cat = parts.length > 1 ? parts[0].toLowerCase() : 'other'; where = parts.slice(1, -1).join(' / '); }
    list.push({ ...e, name: baseName(e.path).replace(/\.\w+$/, ''), ext: ext(e.path), cat, where, twin });
  }
  const rank = c => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 50 : i; };
  return list.sort((a, b) => rank(a.cat) - rank(b.cat) || a.cat.localeCompare(b.cat) || a.where.localeCompare(b.where) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}
const catLabel = c => c === 'hub' ? 'Hub uploads' : c === 'import' ? 'Import' : pretty(c);

export async function render(main, route) {
  const opt = ls.get('modelsOpt', { cat: '', dupes: false, view: 'viewer', q: '' });
  let current = route.arg || ls.get('lastModel', '');
  let models = [], shown = [];
  main.style.overflow = 'hidden';
  const page = document.createElement('div');
  page.className = 'models-page viewer-host';
  main.appendChild(page);
  page.innerHTML = `
    <aside class="mlib">
      <div class="mlib-head">
        <div style="display:flex;align-items:center;gap:8px"><h1 class="mtitle">Models</h1><span class="faint mono" data-count></span><span style="flex:1"></span>
          <div class="seg"><button data-view="viewer" title="Viewer">${icon('cube')}</button><button data-view="shelf" title="Shelf: all models as big tiles">${icon('grid')}</button></div></div>
        <div class="search">${icon('search')}<input class="input" data-search placeholder="Find a model…  (/)" value="${esc(opt.q)}" style="width:100%"></div>
        <div class="mcats" data-cats></div>
      </div>
      <div class="mlist" data-list></div>
      <label class="mfoot"><input type="checkbox" data-dupes ${opt.dupes ? 'checked' : ''}> Also show .fbx / .obj copies of .glb files</label>
    </aside>
    <section class="mstage">
      <div class="mstage-top" data-top></div>
      <div class="mcanvas" data-canvas><div class="empty" style="height:100%">${icon('cube')}<div>Pick a model on the left.</div></div></div>
      <div class="mstrip" data-strip></div>
    </section>
    <section class="mshelf hidden" data-shelf></section>`;
  const $ = s => page.querySelector(s);
  const listEl = $('[data-list]'), stripEl = $('[data-strip]'), topEl = $('[data-top]'), canvas = $('[data-canvas]'), shelf = $('[data-shelf]');

  let viewer = null, ctl = null, loadToken = 0, stats = null;
  const cleanups = [];

  /* ---------- library ---------- */
  const filter = () => {
    const q = opt.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    shown = models.filter(m => (!opt.cat || m.cat === opt.cat) && q.every(w => (m.name + ' ' + m.where + ' ' + m.cat + ' ' + m.ext).toLowerCase().includes(w)));
  };
  const threadCount = path => S.fileThread(path)?.comments || 0;
  const drawCats = () => {
    const counts = new Map(); models.forEach(m => counts.set(m.cat, (counts.get(m.cat) || 0) + 1));
    $('[data-cats]').innerHTML = [['', 'All', models.length], ...[...counts].map(([c, n]) => [c, catLabel(c), n])]
      .map(([c, l, n]) => `<button class="chip click ${opt.cat === c ? 'on' : ''}" data-cat="${esc(c)}" style="--c:var(--accent)">${esc(l)} <span style="opacity:.7">${n}</span></button>`).join('');
    $('[data-count]').textContent = models.length;
  };
  const thumb = (m, cls = '') => `<div class="thumb ${cls}"><img class="hidden" data-sha="${m.sha}" data-path="${esc(m.path)}" data-size="${m.size}" alt=""><svg class="ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon('cube').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></div>`;
  const drawList = () => {
    filter();
    let last = null;
    listEl.innerHTML = shown.map(m => {
      const head = m.cat !== last ? `<div class="mgroup">${esc(catLabel(m.cat))}</div>` : '';
      last = m.cat;
      const c = threadCount(m.path);
      return `${head}<button class="mrow ${m.path === current ? 'on' : ''}" data-path="${esc(m.path)}">${thumb(m)}
        <span class="mrow-t"><b>${esc(m.name)}</b><span>${esc(m.where || catLabel(m.cat))}</span></span>
        <span class="mrow-m">${m.ext !== 'glb' ? `<span class="chip">${esc(m.ext)}</span>` : ''}${c ? `<span class="chip" style="--c:var(--accent)">${icon('chat').replace('<svg', '<svg width="10" height="10"')} ${c}</span>` : ''}<span class="faint">${bytes(m.size)}</span></span></button>`;
    }).join('') || `<div class="empty">${icon('search')}<div>No models match.</div></div>`;
    listEl.querySelectorAll('img[data-sha]').forEach(observe);
    drawStrip();
    if (opt.view === 'shelf') drawShelf();
  };
  const drawStrip = () => {
    stripEl.innerHTML = shown.map(m => `<button class="mchip ${m.path === current ? 'on' : ''}" data-path="${esc(m.path)}" title="${esc(m.name)}">${thumb(m)}</button>`).join('');
    stripEl.querySelectorAll('img[data-sha]').forEach(observe);
    stripEl.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  };
  const drawShelf = () => {
    let last = null;
    shelf.innerHTML = `<div class="mshelf-grid">${shown.map(m => {
      const head = m.cat !== last ? `<div class="mgroup big">${esc(catLabel(m.cat))}</div>` : '';
      last = m.cat;
      return `${head}<button class="tile mtile" data-path="${esc(m.path)}">${thumb(m)}<div class="info"><div class="name">${esc(m.name)}</div><div class="sub">${esc(m.where || catLabel(m.cat))} · ${bytes(m.size)}</div></div></button>`;
    }).join('')}</div>`;
    shelf.querySelectorAll('img[data-sha]').forEach(observe);
  };
  const setView = v => {
    opt.view = v; ls.set('modelsOpt', opt);
    page.classList.toggle('shelf-mode', v === 'shelf');
    shelf.classList.toggle('hidden', v !== 'shelf');
    page.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'shelf') drawShelf();
    else viewer?.resize();
  };

  /* ---------- stage ---------- */
  const drawTop = (m, loading) => {
    if (!m) { topEl.innerHTML = ''; return; }
    const i = shown.findIndex(x => x.path === m.path);
    const c = threadCount(m.path);
    const tasks = S.tasksForFile(m.path);
    topEl.innerHTML = `
      <button class="btn icon" data-nav="-1" title="Previous (←)" ${i <= 0 ? 'disabled' : ''}>${icon('back')}</button>
      <button class="btn icon" data-nav="1" title="Next (→)" ${i < 0 || i >= shown.length - 1 ? 'disabled' : ''}>${icon('chevron')}</button>
      <div style="min-width:0;flex:1"><h2 class="mname">${esc(m.name)}<span class="faint">.${esc(m.ext)}</span></h2>
        <div class="faint mono" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(dirName(m.path))} · ${bytes(m.size)}${i >= 0 ? ` · ${i + 1} of ${shown.length}` : ''}</div></div>
      <div class="mstats">${loading ? '<span class="faint">Loading…</span>' : stats ? `
        <span title="Triangles"><b>${num(stats.tris)}</b> tris</span>
        ${stats.bones ? `<span title="Bones"><b>${stats.bones}</b> bones</span>` : ''}
        ${stats.clips ? `<span title="Animations"><b>${stats.clips}</b> anims</span>` : ''}
        <span title="Materials"><b>${stats.materials}</b> mats</span>` : ''}</div>
      ${tasks.length ? `<a class="btn sm" href="#/task/${tasks[0].n}" title="${esc(tasks.map(t => '#' + t.n + ' ' + t.title).join('\n'))}">${icon('board')} #${tasks[0].n}${tasks.length > 1 ? ' +' + (tasks.length - 1) : ''}</a>` : ''}
      <a class="btn sm" href="#/file/${encodeURIComponent(m.path)}" title="Comments, pins, versions">${icon('chat')} ${c ? c + ' comment' + (c > 1 ? 's' : '') : 'Comment'}</a>
      <button class="btn sm icon" data-dl title="Download">${icon('download')}</button>`;
  };

  const open = async (path, { push = true } = {}) => {
    const m = models.find(x => x.path === path) || models[0];
    if (!m) return;
    current = m.path; ls.set('lastModel', current);
    if (push) history.replaceState(null, '', '#/models/' + encodeURIComponent(current));
    listEl.querySelectorAll('.mrow').forEach(r => r.classList.toggle('on', r.dataset.path === current));
    stripEl.querySelectorAll('.mchip').forEach(r => r.classList.toggle('on', r.dataset.path === current));
    listEl.querySelector('.mrow.on')?.scrollIntoView({ block: 'nearest' });
    stripEl.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    if (opt.view === 'shelf') setView('viewer');
    stats = null; drawTop(m, true);
    const token = ++loadToken;
    let veil = canvas.querySelector('.loading-veil');
    if (!veil) { veil = document.createElement('div'); veil.className = 'loading-veil'; canvas.appendChild(veil); }
    veil.style.background = viewer ? 'color-mix(in srgb, var(--viewer-bg) 55%, transparent)' : '';
    veil.innerHTML = `<div class="box"><span class="spin" style="position:static;width:22px;height:22px"></span><div>${esc(m.name)} · ${bytes(m.size)}</div></div>`;
    try {
      const buf = await getBlob(m.sha);
      if (token !== loadToken) return;
      if (!viewer) {
        const { ModelViewer } = await import('./viewer.js');
        canvas.querySelector('.empty')?.remove();
        viewer = new ModelViewer(canvas);
        const saved = ls.get('viewerPrefs', {});
        if (saved.light) viewer.setLight(saved.light);
        if (saved.bg) viewer.setBackground(saved.bg);
        await viewer.load(buf, m.path, { resolve: rel => S.tree.entries.get(dirName(m.path) + '/' + rel) ? getBlob(S.tree.entries.get(dirName(m.path) + '/' + rel).sha) : Promise.reject() });
        const { mountControls } = await import('./controls.js');
        ctl = mountControls(canvas, { viewer, fullscreenEl: page.querySelector('.mstage'), name: () => baseName(current), extraKeys: navKeys });
        cleanups.push(() => { ls.set('viewerPrefs', { light: viewer.light, bg: viewer.bg }); ctl.destroy(); viewer.dispose(); });
      } else {
        await viewer.load(buf, m.path, { resolve: rel => S.tree.entries.get(dirName(m.path) + '/' + rel) ? getBlob(S.tree.entries.get(dirName(m.path) + '/' + rel).sha) : Promise.reject() });
        ctl.refreshAnim();
      }
      if (token !== loadToken) return;
      stats = viewer.stats();
      veil.remove();
      drawTop(m);
      // warm up the neighbours so arrowing feels instant
      const i = shown.findIndex(x => x.path === m.path);
      [shown[i + 1], shown[i - 1]].filter(Boolean).forEach(n => getBlob(n.sha).catch(() => {}));
    } catch (e) {
      if (token !== loadToken) return;
      veil.innerHTML = `<div class="box">${icon('cube')}<div>Could not show ${esc(m.name)}: ${esc(e.message)}</div></div>`;
      drawTop(m);
    }
  };
  const step = d => {
    const i = shown.findIndex(x => x.path === current);
    const n = shown[Math.max(0, Math.min(shown.length - 1, (i < 0 ? 0 : i + d)))];
    if (n && n.path !== current) open(n.path);
  };
  function navKeys(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); step(1); return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); step(-1); return true; }
    return false;
  }
  // arrows also work before the first model has loaded
  const preKeys = e => { if (!ctl && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) navKeys(e); };
  document.addEventListener('keydown', preKeys);
  cleanups.push(() => document.removeEventListener('keydown', preKeys));

  /* ---------- events ---------- */
  page.addEventListener('click', async e => {
    const r = e.target.closest('[data-path]'); if (r) return open(r.dataset.path);
    const c = e.target.closest('[data-cat]'); if (c) { opt.cat = c.dataset.cat; ls.set('modelsOpt', opt); drawCats(); drawList(); return; }
    const v = e.target.closest('[data-view]'); if (v) return setView(v.dataset.view);
    const n = e.target.closest('[data-nav]'); if (n) return step(+n.dataset.nav);
    if (e.target.closest('[data-dl]')) {
      try { const m = models.find(x => x.path === current); download(new Blob([await getBlob(m.sha)], { type: mimeOf(m.path) }), baseName(m.path)); } catch (er) { toastErr(er); }
    }
  });
  page.addEventListener('input', debounce(e => {
    if (!e.target.matches('[data-search]')) return;
    opt.q = e.target.value; ls.set('modelsOpt', opt); drawList();
  }, 120));
  page.addEventListener('keydown', e => {
    if (e.target.matches('[data-search]') && e.key === 'Enter') { const first = shown[0]; if (first) { open(first.path); e.target.blur(); } }
  });
  page.addEventListener('change', e => {
    if (e.target.matches('[data-dupes]')) { opt.dupes = e.target.checked; ls.set('modelsOpt', opt); models = allModels(opt); drawCats(); drawList(); }
  });

  const refresh = () => {
    models = allModels(opt);
    drawCats(); drawList();
  };
  refresh();
  // a hidden .fbx/.obj twin was asked for: show its .glb, or reveal the copies if there is none
  if (current && !models.some(m => m.path === current)) {
    const base = current.replace(/\.\w+$/, '').toLowerCase();
    const twin = models.find(m => m.path.replace(/\.\w+$/, '').toLowerCase() === base && /\.(glb|gltf)$/i.test(m.path));
    if (twin && !route.arg?.match(/\.(fbx|obj)$/i)) current = twin.path;
    else if (S.tree?.entries.has(current)) { opt.dupes = true; page.querySelector('[data-dupes]').checked = true; refresh(); }
  }
  if (current && opt.cat && !shown.some(m => m.path === current)) { opt.cat = ''; drawCats(); drawList(); }
  setView(opt.view === 'shelf' && !route.arg ? 'shelf' : 'viewer');
  if (models.length) open(models.some(m => m.path === current) ? current : (shown[0] || models[0]).path, { push: !!route.arg || true });
  else canvas.innerHTML = `<div class="empty" style="height:100%">${icon('cube')}<div>No .glb, .gltf, .fbx or .obj files in the repo yet. <a href="#" data-up>Upload one</a>.</div></div>`;
  canvas.querySelector('[data-up]')?.addEventListener('click', ev => { ev.preventDefault(); act('upload', { dir: `${S.cfg.hubDir}/models` }); });

  const offs = [
    S.on('tree', () => { const prevSha = models.find(m => m.path === current)?.sha; refresh(); const now = models.find(m => m.path === current); if (now && prevSha && now.sha !== prevSha) open(current); }),
    S.on('issues', () => { drawList(); const m = models.find(x => x.path === current); if (m) drawTop(m); }),
  ];
  return () => { offs.forEach(f => f()); cleanups.forEach(f => { try { f(); } catch {} }); main.style.overflow = ''; };
}
void avatarImg;
