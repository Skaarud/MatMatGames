// Ctrl+K command palette: jump to any task, file or action. Also used as a file picker.
import { S, STATUSES } from './store.js';
import { esc, icon, modal, fuzzy, act } from './ui.js';
import { kindOf, KIND_ICON, HIDE_DIRS } from './files.js';

const ACTIONS = [
  { label: 'New task', icon: 'plus', k: 'C', run: () => act('new-task') },
  { label: 'New idea', icon: 'sparkle', k: 'I', run: () => act('new-idea') },
  { label: 'Upload files', icon: 'upload', k: 'U', run: () => act('upload') },
  { label: 'Go to Home', icon: 'home', k: 'G H', run: () => location.hash = '#/home' },
  { label: 'Go to Board', icon: 'board', k: 'G B', run: () => location.hash = '#/board' },
  { label: 'Go to Ideas', icon: 'bulb', k: 'G I', run: () => location.hash = '#/ideas' },
  { label: 'Go to Files', icon: 'files', k: 'G F', run: () => location.hash = '#/files' },
  { label: 'Go to Inbox', icon: 'bell', k: 'G N', run: () => location.hash = '#/inbox' },
  { label: 'Settings', icon: 'gear', run: () => location.hash = '#/settings' },
  { label: 'Switch theme (Matrix / Ink)', icon: 'sun', k: 'T', run: () => act('theme') },
  { label: 'Keyboard shortcuts', icon: 'keyboard', k: '?', run: () => act('help') },
  { label: 'My tasks', icon: 'user', run: () => { localStorage.setItem('mmg.boardFilter', JSON.stringify({ view: 'board', who: 'me' })); location.hash = '#/board?me'; } },
  { label: 'Models only', icon: 'cube', run: () => { const o = JSON.parse(localStorage.getItem('mmg.galleryOpt') || '{}'); o.kind = 'model'; localStorage.setItem('mmg.galleryOpt', JSON.stringify(o)); location.hash = '#/files/'; } },
];

function search(q, { filesOnly = false } = {}) {
  const groups = [];
  if (!filesOnly) {
    const a = ACTIONS.map(x => ({ x, s: fuzzy(q, x.label) })).filter(r => r.s > 0).sort((a, b) => b.s - a.s).slice(0, q ? 5 : 6);
    if (a.length) groups.push(['Actions', a.map(({ x }) => ({ label: x.label, icon: x.icon, k: x.k, run: x.run }))]);
    const ts = S.tasks().map(t => ({ t, s: Math.max(fuzzy(q, t.title), q.replace('#', '') === String(t.n) ? 500 : 0) })).filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s || Date.parse(b.t.updated) - Date.parse(a.t.updated)).slice(0, q ? 8 : 5);
    if (ts.length) groups.push([q ? 'Tasks & ideas' : 'Recent tasks', ts.map(({ t }) => ({ label: t.title, sub: `#${t.n} · ${STATUSES.find(s => s.key === t.status).label}`, dot: STATUSES.find(s => s.key === t.status).color, run: () => location.hash = '#/task/' + t.n }))]);
  }
  if (q || filesOnly) {
    const fs = [];
    for (const e of S.tree?.entries.values() || []) {
      if (e.type !== 'blob' || HIDE_DIRS.includes(e.path.split('/')[0])) continue;
      const k = kindOf(e.path); if (k === 'other' && !filesOnly) continue;
      const name = e.path.split('/').pop();
      const s = Math.max(fuzzy(q, name) * 2, fuzzy(q, e.path));
      if (s > 0) fs.push({ e, s: s + (k === 'model' ? 5 : k === 'image' ? 3 : 0) });
    }
    fs.sort((a, b) => b.s - a.s);
    if (fs.length) groups.push(['Files', fs.slice(0, 10).map(({ e }) => ({ label: e.path.split('/').pop(), sub: e.path.split('/').slice(0, -1).join('/'), icon: KIND_ICON[kindOf(e.path)], path: e.path, run: () => location.hash = '#/file/' + encodeURIComponent(e.path) }))]);
  }
  return groups;
}

export function openPalette({ filesOnly = false, title, onPick } = {}) {
  const m = modal({ body: '', cls: 'palette' });
  m.el.classList.add('palette');
  m.body.style.padding = '0'; m.body.style.gap = '0';
  m.body.innerHTML = `<input class="input" placeholder="${esc(title || (filesOnly ? 'Find a file…' : 'Search tasks, files, actions…'))}" autofocus><div class="res"></div>`;
  const inp = m.body.querySelector('input'), res = m.body.querySelector('.res');
  let items = [], hl = 0;
  const draw = () => {
    const groups = search(inp.value.trim(), { filesOnly });
    items = groups.flatMap(g => g[1]);
    hl = Math.min(hl, items.length - 1); if (hl < 0) hl = 0;
    let i = 0;
    res.innerHTML = groups.map(([g, list]) => `<div class="grp">${esc(g)}</div>${list.map(x => `<button class="mi ${i === hl ? 'hl' : ''}" data-i="${i++}">${x.dot ? `<span class="dot" style="--c:${x.dot}"></span>` : icon(x.icon || 'file')}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.label)}</span>${x.sub ? `<span class="sub">${esc(x.sub)}</span>` : ''}${x.k ? `<span class="k kbd">${esc(x.k)}</span>` : ''}</button>`).join('')}`).join('') || '<div class="empty" style="padding:24px">Nothing found.</div>';
    res.querySelector('.hl')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = i => { const x = items[i]; if (!x) return; m.close(); onPick ? onPick(x) : x.run(); };
  inp.addEventListener('input', () => { hl = 0; draw(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(items.length - 1, hl + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, hl - 1); draw(); }
    if (e.key === 'Enter') { e.preventDefault(); pick(hl); }
  });
  res.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  draw();
  return m;
}

export function pickFile(title) {
  return new Promise(res => {
    let done = false;
    const m = openPalette({ filesOnly: true, title, onPick: x => { done = true; res(x.path); } });
    const close = m.close; m.close = () => { close(); if (!done) res(null); };
  });
}
