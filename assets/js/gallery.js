// Files: folder tree + smart gallery with live thumbnails, filters, search and drag-in upload.
import { S } from './store.js';
import { esc, icon, bytes, store as ls, debounce, act } from './ui.js';
import { listDir, kindOf, baseName, KIND_ICON, HIDE_DIRS } from './files.js';
import { observe } from './thumbs.js';
import { filesFromDrop, uploadModal } from './upload.js';

const KF = [['', 'All', 'files'], ['model', 'Models', 'cube'], ['image', 'Images', 'image'], ['audio', 'Audio', 'audio'], ['text', 'Docs', 'doc']];

export function render(main, route) {
  let dir = route.arg || ls.get('lastDir', 'art');
  if (S.tree && dir && ![...S.tree.entries.keys()].some(p => p.startsWith(dir + '/'))) dir = '';
  ls.set('lastDir', dir);
  const opt = ls.get('galleryOpt', { kind: '', tile: 170, sort: 'name', all: false });
  let q = '';
  const open = new Set(ls.get('treeOpen', ['art']));
  const page = document.createElement('div'); page.className = 'files-layout'; main.appendChild(page);
  page.innerHTML = `<nav class="ftree" data-tree></nav><div class="fmain" data-main></div>`;
  const treeEl = page.querySelector('[data-tree]'), mainEl = page.querySelector('[data-main]');

  const drawTree = () => {
    if (!S.tree) return;
    const kids = new Map(); // dir -> Set(child dirs)
    const counts = new Map();
    for (const e of S.tree.entries.values()) {
      if (e.type !== 'blob') continue;
      const k = kindOf(e.path);
      if (!opt.all && k === 'other') continue;
      const parts = e.path.split('/');
      if (!opt.all && HIDE_DIRS.includes(parts[0])) continue;
      for (let i = 0; i < parts.length - 1; i++) {
        const parent = parts.slice(0, i).join('/'), d = parts.slice(0, i + 1).join('/');
        if (!kids.has(parent)) kids.set(parent, new Set());
        kids.get(parent).add(d);
        counts.set(d, (counts.get(d) || 0) + 1);
      }
    }
    const node = (d, depth) => {
      const ch = [...(kids.get(d) || [])].sort();
      const isOpen = open.has(d);
      return `<div class="node ${d === dir ? 'active' : ''}" data-dir="${esc(d)}" style="padding-left:${8 + depth * 14}px">
        ${ch.length ? `<svg class="caret ${isOpen ? 'open' : ''}" data-caret="${esc(d)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 18 6-6-6-6"/></svg>` : '<span style="width:12px"></span>'}
        ${icon('folder')}<span style="overflow:hidden;text-overflow:ellipsis">${esc(d.split('/').pop())}</span><span class="n">${counts.get(d)}</span></div>
        ${isOpen ? ch.map(c => node(c, depth + 1)).join('') : ''}`;
    };
    const top = [...(kids.get('') || [])].sort();
    const total = [...counts.entries()].filter(([d]) => !d.includes('/')).reduce((a, [, n]) => a + n, 0);
    treeEl.innerHTML = `<div class="node ${dir === '' ? 'active' : ''}" data-dir="">${icon('home')}<span>${esc(S.cfg.repo)}</span><span class="n">${total}</span></div>${top.map(d => node(d, 0)).join('')}
      <label style="display:flex;gap:6px;align-items:center;font-size:11px;color:var(--fg3);padding:14px 10px 0"><input type="checkbox" data-all ${opt.all ? 'checked' : ''}> Show every file type</label>`;
  };

  const drawMain = () => {
    if (!S.tree) { mainEl.innerHTML = '<div class="empty">Loading files…</div>'; return; }
    const kinds = opt.kind ? [opt.kind] : null;
    const { files, folders } = listDir(dir, { showAll: opt.all, kinds, q });
    const sorted = files.sort((a, b) => opt.sort === 'size' ? b.size - a.size : opt.sort === 'type' ? (kindOf(a.path) + a.path).localeCompare(kindOf(b.path) + b.path) : baseName(a.path).localeCompare(baseName(b.path), undefined, { numeric: true }));
    const crumbs = ['', ...dir.split('/').filter(Boolean).map((_, i, a) => a.slice(0, i + 1).join('/'))];
    const threads = new Map(); S.tasks({ files: true }).forEach(t => threads.set(t.meta.file, t));
    const used = new Map(); S.tasks().forEach(t => t.files.forEach(f => used.set(f, (used.get(f) || 0) + 1)));
    mainEl.innerHTML = `
      <div class="page-head" style="margin-bottom:12px"><div class="crumbs">${crumbs.map(c => `<a href="#/files/${encodeURIComponent(c)}">${esc(c ? c.split('/').pop() : S.cfg.repo)}</a>`).join(icon('chevron', 'faint').replace('<svg', '<svg width="14" height="14"'))}</div><div class="grow"></div>
        <button class="btn primary" data-up>${icon('upload')} Upload here</button></div>
      <div class="toolbar" style="margin-bottom:16px">
        <div class="search">${icon('search')}<input class="input" data-search placeholder="Search all files…  (/)" value="${esc(q)}"></div>
        <div class="seg">${KF.map(([k, l, ic]) => `<button data-kind="${k}" class="${opt.kind === k ? 'on' : ''}">${icon(ic)} ${l}</button>`).join('')}</div>
        <div class="seg">${[['name', 'Name'], ['size', 'Size'], ['type', 'Type']].map(([k, l]) => `<button data-sort="${k}" class="${opt.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input type="range" min="110" max="300" value="${opt.tile}" data-tile title="Tile size" style="width:110px;accent-color:var(--accent)">
        <span class="faint" style="font-size:12px">${q ? `${sorted.length} matches` : `${folders.length ? folders.length + ' folders · ' : ''}${sorted.length} files`}</span>
      </div>
      ${folders.length && !q ? `<div class="grid" style="--tile:${Math.max(140, opt.tile)}px;margin-bottom:16px">${folders.map(f => `<a class="tile folder" href="#/files/${encodeURIComponent(f.path)}" style="text-decoration:none;color:inherit"><div class="thumb">${f.sample ? `<img class="hidden" data-sha="${f.sample.sha}" data-path="${esc(f.sample.path)}" data-size="${f.sample.size}" alt="" style="object-fit:cover;opacity:.55">` : ''}${icon('folder')}</div><div class="info"><div class="name">${esc(f.name)}</div><div class="sub">${f.count} files${f.models ? ` · ${f.models} models` : ''}${f.images ? ` · ${f.images} images` : ''}</div></div></a>`).join('')}</div>` : ''}
      <div class="grid" style="--tile:${opt.tile}px">${sorted.map(e => tile(e, threads.get(e.path), used.get(e.path), q)).join('')}</div>
      ${!sorted.length && !folders.length ? `<div class="empty">${icon('files')}<div>${q ? 'Nothing matches.' : 'Nothing previewable in this folder.'} Drop files here to upload them.</div></div>` : ''}`;
    mainEl.querySelectorAll('img[data-sha]').forEach(observe);
  };
  const draw = () => { drawTree(); drawMain(); };

  treeEl.addEventListener('click', e => {
    const c = e.target.closest('[data-caret]');
    if (c) { e.stopPropagation(); const d = c.dataset.caret; open.has(d) ? open.delete(d) : open.add(d); ls.set('treeOpen', [...open]); drawTree(); return; }
    const n = e.target.closest('[data-dir]');
    if (n) { const d = n.dataset.dir; if (d) open.add(d); ls.set('treeOpen', [...open]); location.hash = '#/files/' + encodeURIComponent(d); }
  });
  treeEl.addEventListener('change', e => { if (e.target.matches('[data-all]')) { opt.all = e.target.checked; ls.set('galleryOpt', opt); draw(); } });
  mainEl.addEventListener('click', e => {
    const k = e.target.closest('[data-kind]'); if (k) { opt.kind = k.dataset.kind; ls.set('galleryOpt', opt); return drawMain(); }
    const s = e.target.closest('[data-sort]'); if (s) { opt.sort = s.dataset.sort; ls.set('galleryOpt', opt); return drawMain(); }
    if (e.target.closest('[data-up]')) return act('upload', { dir });
    const t = e.target.closest('[data-file]'); if (t) location.hash = '#/file/' + encodeURIComponent(t.dataset.file);
  });
  mainEl.addEventListener('input', debounce(e => {
    if (e.target.matches('[data-search]')) { q = e.target.value; const p = e.target.selectionStart; drawMain(); const s = mainEl.querySelector('[data-search]'); s.focus(); s.setSelectionRange(p, p); }
  }, 150));
  mainEl.addEventListener('input', e => { if (e.target.matches('[data-tile]')) { opt.tile = +e.target.value; ls.set('galleryOpt', opt); mainEl.querySelectorAll('.grid').forEach((g, i) => g.style.setProperty('--tile', (i === 0 && g.querySelector('.folder') ? Math.max(140, opt.tile) : opt.tile) + 'px')); } });

  // drag files from the desktop straight into the current folder
  let veil = null;
  const dragOver = e => { if (!e.dataTransfer?.types.includes('Files') || document.querySelector('.modal')) return; e.preventDefault(); if (!veil) { veil = document.createElement('div'); veil.className = 'drop-veil'; veil.innerHTML = `<div>Drop to upload into ${esc(dir || S.cfg.repo)}</div>`; document.body.appendChild(veil); } };
  const dragLeave = e => { if (e.relatedTarget == null) { veil?.remove(); veil = null; } };
  const drop = async e => { if (!veil) return; e.preventDefault(); veil.remove(); veil = null; uploadModal({ dir, files: await filesFromDrop(e.dataTransfer) }); };
  document.addEventListener('dragover', dragOver); document.addEventListener('dragleave', dragLeave); document.addEventListener('drop', drop);

  draw();
  const off = [S.on('tree', draw), S.on('issues', drawMain)];
  return () => { off.forEach(f => f()); document.removeEventListener('dragover', dragOver); document.removeEventListener('dragleave', dragLeave); document.removeEventListener('drop', drop); veil?.remove(); };
}

function tile(e, thread, usedIn, q) {
  const k = kindOf(e.path);
  const name = baseName(e.path);
  const thumbable = k === 'model' || k === 'image';
  return `<div class="tile" data-file="${esc(e.path)}" title="${esc(e.path)}">
    ${thread?.comments ? `<span class="chip cbadge" style="--c:var(--accent)">${icon('chat').replace('<svg', '<svg width="11" height="11"')} ${thread.comments}</span>` : ''}
    ${usedIn ? `<span class="chip badge" style="--c:var(--s-doing)">${icon('link').replace('<svg', '<svg width="11" height="11"')} ${usedIn}</span>` : ''}
    <div class="thumb ${k === 'image' ? 'checker' : ''}">${thumbable ? `<img class="hidden" data-sha="${e.sha}" data-path="${esc(e.path)}" data-size="${e.size}" alt="">` : ''}<svg class="ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon(KIND_ICON[k]).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></div>
    <div class="info"><div class="name">${esc(name)}</div><div class="sub"><span>${esc(name.split('.').pop().toUpperCase())}</span><span>${bytes(e.size)}</span>${q ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.path.split('/').slice(0, -1).join('/'))}</span>` : ''}</div></div></div>`;
}
