// Boot, login, shell, router, keyboard, theme.
import { S } from './store.js';
import { $, el, esc, icon, toast, toastErr, store as ls, closeTopModal, closeAllModals, closeMenu, hasModal, avatarImg, html } from './ui.js';
import { startFx, bootFlourish } from './fx.js';
import * as Notices from './notices.js';

const app = document.getElementById('app');
let current = { name: null, cleanup: null, arg: null };
let drawerCleanup = null;
let baseHash = '#/home';

/* ---------------- theme ---------------- */
export function setTheme(t, { flourish = true } = {}) {
  document.documentElement.dataset.theme = t;
  ls.set('theme', t); localStorage.setItem('mmg.theme', t);
  startFx(t);
  document.querySelectorAll('.theme-switch button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  window.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  if (flourish && t === 'matrix') bootFlourish(S.me?.name?.split(' ')[0] || S.me?.login || 'Neo');
}
const themeNow = () => document.documentElement.dataset.theme || 'matrix';

/* ---------------- login ---------------- */
function loginScreen(err = '') {
  app.innerHTML = '';
  const tokUrl = 'https://github.com/settings/tokens/new?scopes=repo&description=MatMat%20Games%20Hub';
  const v = el(`<div class="login"><form class="login-card panel" autocomplete="off">
    <div class="brand" style="padding:0">${brandMark()}<div><div class="brand-name" style="font-size:22px">MatMat Games</div><div class="brand-sub">Studio hub</div></div></div>
    <h1>Log in with GitHub</h1>
    <ol>
      <li><a href="${tokUrl}" target="_blank" rel="noopener">Create a GitHub token</a> (the "repo" box is already ticked). Pick a long expiry.</li>
      <li>Copy the token GitHub shows you (it starts with <span class="mono">ghp_</span>).</li>
      <li>Paste it here. It stays in this browser only.</li>
    </ol>
    <label class="field">GitHub token<input class="input mono" name="token" type="password" placeholder="ghp_…" autofocus required></label>
    <div class="err">${esc(err)}</div>
    <button class="btn primary" style="height:40px">Enter the hub</button>
    <details><summary>Which repo? (${esc(S.cfg.owner)}/${esc(S.cfg.repo)})</summary>
      <div class="row"><input class="input" name="owner" value="${esc(S.cfg.owner)}" placeholder="owner"><input class="input" name="repo" value="${esc(S.cfg.repo)}" placeholder="repo"><input class="input" name="branch" value="${esc(S.cfg.branch)}" placeholder="branch"></div>
    </details>
    <div class="theme-switch" style="width:180px"><button type="button" data-t="matrix">Matrix</button><button type="button" data-t="ink">Ink</button></div>
  </form></div>`);
  app.appendChild(v);
  v.querySelectorAll('.theme-switch button').forEach(b => { b.classList.toggle('on', b.dataset.t === themeNow()); b.onclick = () => setTheme(b.dataset.t); });
  const f = v.querySelector('form');
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector('.btn.primary'); btn.disabled = true; btn.textContent = 'Checking…';
    S.setCfg({ owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main' });
    try { await S.login(f.token.value.trim()); await enter(); }
    catch (er) { loginScreen(er.message); }
  };
}

function brandMark() {
  return `<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--accent)" opacity=".12"/><path d="M12 46V18l10 14 10-14 10 14 10-14v28" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/* ---------------- shell ---------------- */
const NAV = [
  { r: 'home', label: 'Home', icon: 'home', key: 'h' },
  { r: 'board', label: 'Board', icon: 'board', key: 'b' },
  { r: 'ideas', label: 'Ideas', icon: 'bulb', key: 'i' },
  { r: 'models', label: 'Models', icon: 'cube', key: 'm' },
  { r: 'files', label: 'Files', icon: 'files', key: 'f' },
  { r: 'inbox', label: 'Inbox', icon: 'bell', key: 'n' },
];
function shell() {
  app.innerHTML = '';
  const s = el(`<div class="shell">
    <aside class="side">
      <div class="brand">${brandMark()}<div><div class="brand-name">MatMat Games</div><div class="brand-sub mono">${esc(S.cfg.owner)}/${esc(S.cfg.repo)}</div></div></div>
      <button class="btn" data-act="palette" style="justify-content:flex-start;color:var(--fg3)">${icon('search')}<span style="flex:1;text-align:left">Search or jump…</span><span class="kbd">Ctrl K</span></button>
      <div style="height:8px"></div>
      <nav class="nav">${NAV.map(n => `<a href="#/${n.r}" data-r="${n.r}">${icon(n.icon)}<span>${n.label}</span>${n.r === 'inbox' ? '<span class="count" data-count="inbox"></span>' : n.r === 'ideas' ? '<span class="count" data-count="ideas"></span>' : n.r === 'board' ? '<span class="count" data-count="review"></span>' : ''}</a>`).join('')}</nav>
      <div class="side-sep"></div>
      <div class="side-label">Quick</div>
      <nav class="nav">
        <a href="#" data-act="new-task">${icon('plus')}<span>New task</span><span class="kbd" style="margin-left:auto">C</span></a>
        <a href="#" data-act="new-idea">${icon('sparkle')}<span>New idea</span><span class="kbd" style="margin-left:auto">I</span></a>
        <a href="#" data-act="upload">${icon('upload')}<span>Upload files</span><span class="kbd" style="margin-left:auto">U</span></a>
      </nav>
      <div class="side-foot">
        <div class="theme-switch"><button data-t="matrix">Matrix</button><button data-t="ink">Ink</button></div>
        <div class="me">${avatarImg(S.me, 'lg')}<div class="who"><b>${esc(S.me.name || S.me.login)}</b><span class="faint" style="font-size:11px">@${esc(S.me.login)}</span></div>
          <a class="btn ghost icon sm" href="#/settings" title="Settings">${icon('gear')}</a></div>
        <div class="sync" title="Live sync with GitHub"><span class="dot"></span><span data-sync>Live</span></div>
      </div>
    </aside>
    <header class="mtop">${brandMark()}<b class="brand-name" style="font-size:15px;flex:1">MatMat Games</b>
      <button class="btn ghost icon" data-act="palette" title="Search">${icon('search')}</button>
      <button class="btn ghost icon" data-act="mobile-new" title="New">${icon('plus')}</button>
      <button class="btn ghost icon" data-act="theme" title="Matrix / Ink">${icon('sun')}</button>
      <a class="btn ghost icon" href="#/settings" title="Settings">${icon('gear')}</a></header>
    <main class="main" id="main"></main>
    <nav class="mnav">${NAV.map(n => `<a href="#/${n.r}" data-r="${n.r}">${icon(n.icon)}<span>${n.label}</span>${n.r === 'inbox' ? '<span class="count hidden" data-count="inbox-m"></span>' : ''}</a>`).join('')}</nav>
  </div>`);
  app.appendChild(s);
  s.querySelectorAll('.theme-switch button').forEach(b => { b.classList.toggle('on', b.dataset.t === themeNow()); b.onclick = () => setTheme(b.dataset.t); });
  s.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    e.preventDefault(); action(a.dataset.act, a.dataset.act === 'mobile-new' ? a : undefined);
  });
  const syncEl = s.querySelector('.sync'), syncTxt = s.querySelector('[data-sync]');
  const upd = st => {
    syncEl.classList.toggle('busy', st === 'busy'); syncEl.classList.toggle('err', st === 'err');
    syncTxt.textContent = st === 'err' ? 'Offline, retrying' : st === 'busy' ? 'Syncing…' : 'Live · ' + (S.lastSync ? S.lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  };
  S.on('sync', upd); S.on('synced', () => upd(S.syncState));
  const counts = () => {
    const ts = S.tasks();
    setCount('ideas', ts.filter(t => t.status === 'idea' && !t.issue.reactions?.['+1'] && t.author !== S.me.login).length || ts.filter(t => t.status === 'idea').length, false);
    const rv = ts.filter(t => t.status === 'review' && t.author !== S.me.login && !t.assignees.includes(S.me.login)).length;
    setCount('review', rv || '', rv > 0);
  };
  S.on('issues', counts); counts();
  S.on('inbox', n => setInboxCount(n));
}
function setCount(k, v, hot) { document.querySelectorAll(`[data-count="${k}"]`).forEach(c => { c.textContent = v || ''; c.classList.toggle('hot', !!hot); c.style.display = v ? '' : 'none'; }); }
function setInboxCount(n) {
  setCount('inbox', n || '', n > 0);
  document.querySelectorAll('[data-count="inbox-m"]').forEach(c => { c.textContent = n; c.classList.toggle('hidden', !n); });
  document.title = (n ? `(${n}) ` : '') + 'MatMat Games Hub';
}

/* ---------------- actions ---------------- */
export async function action(name, arg) {
  closeMenu();
  try {
    if (name === 'palette') return (await import('./palette.js')).openPalette();
    if (name === 'new-task') return (await import('./task.js')).newTaskModal({ status: arg?.status || 'todo' });
    if (name === 'new-idea') return (await import('./task.js')).newTaskModal({ status: 'idea' });
    if (name === 'upload') return (await import('./upload.js')).uploadModal({ dir: arg?.dir, task: arg?.task, replace: arg?.replace });
    if (name === 'help') return showHelp();
    if (name === 'theme') return setTheme(themeNow() === 'matrix' ? 'ink' : 'matrix');
    if (name === 'mobile-new') {
      const { menu } = await import('./ui.js');
      return menu(arg || document.querySelector('.mtop [data-act="mobile-new"]'), [
        { label: 'New task', value: 'new-task', icon: 'plus' }, { label: 'New idea', value: 'new-idea', icon: 'sparkle' }, { label: 'Upload files', value: 'upload', icon: 'upload' },
      ], v => action(v));
    }
  } catch (e) { toastErr(e); }
}

function showHelp() {
  import('./ui.js').then(({ modal }) => modal({ title: 'Keyboard shortcuts', body: `<div class="help-grid">
    ${[['Ctrl K', 'Search everything, run any action'], ['C', 'New task'], ['I', 'New idea'], ['U', 'Upload files'], ['G then H / B / I / M / F / N', 'Go to Home, Board, Ideas, Models, Files, Inbox'], ['← →', 'Next / previous model (Models page)'], ['/', 'Filter the current page'], ['T', 'Switch Matrix / Ink'], ['Esc', 'Close'], ['?', 'This help'],
      ['', ''], ['In the 3D viewer', ''], ['F', 'Frame the model'], ['W', 'Wireframe'], ['B', 'Skeleton'], ['L', 'Lighting'], ['1–5', 'Lit, clay, matcap, normals, UV'], ['R', 'Turntable'], ['P', 'Drop a comment pin'], ['Space', 'Play / pause animation'],
      ['', ''], ['In a task', ''], ['Ctrl Enter', 'Send comment'], ['Quick add', 'Fix troll rig #art !high @friend due:fri']].map(([k, v]) => k || v ? `<span>${k ? k.split(' ').map(x => x.length <= 6 && x !== 'then' && x !== 'In' ? `<span class="kbd">${x}</span>` : x).join(' ') : ''}</span><span class="${k ? 'muted' : ''}" style="${k ? '' : 'font-weight:700;margin-top:6px'}">${v}</span>` : '<span></span><span></span>').join('')}
  </div>` }));
}

/* ---------------- router ---------------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/');
  return { name: parts[0] || 'home', arg: decodeURIComponent(parts.slice(1).join('/')), q: new URLSearchParams(qs || '') };
}
async function route() {
  if (!S.ready) return;
  closeAllModals(); closeMenu();
  const r = parseHash();
  if (r.name === 'task') {
    if (!current.name) await show(parseBase());
    return openDrawer(+r.arg);
  }
  closeDrawer(false);
  baseHash = location.hash || '#/home';
  await show(r);
}
function parseBase() {
  const hh = baseHash.replace(/^#\/?/, ''); const [path, qs] = hh.split('?'); const parts = path.split('/');
  return { name: parts[0] || 'home', arg: decodeURIComponent(parts.slice(1).join('/')), q: new URLSearchParams(qs || '') };
}

const VIEWS = {
  home: () => import('./home.js'),
  board: () => import('./board.js'),
  ideas: () => import('./board.js').then(m => ({ render: m.renderIdeas })),
  models: () => import('./models.js'),
  files: () => import('./gallery.js'),
  file: () => import('./fileview.js'),
  inbox: () => import('./notices.js').then(m => ({ render: m.renderInbox })),
  settings: () => import('./settings.js'),
};
async function show(r) {
  const key = r.name + '|' + r.arg + '|' + r.q.toString();
  if (current.key === key) return;
  const loader = VIEWS[r.name] || VIEWS.home;
  current.cleanup?.();
  current = { key, name: r.name, cleanup: null };
  document.querySelectorAll('.nav a[data-r], .mnav a[data-r]').forEach(a => a.classList.toggle('active', a.dataset.r === r.name || (r.name === 'file' && a.dataset.r === 'files')));
  const main = $('#main');
  main.scrollTop = 0;
  main.innerHTML = '';
  try {
    const mod = await loader();
    if (current.key !== key) return;
    const cleanup = await mod.render(main, r) || null;
    if (current.key !== key) { try { cleanup?.(); } catch {} return; }  // user already left this page
    current.cleanup = cleanup;
  } catch (e) { toastErr(e, 'Could not open this page'); main.innerHTML = `<div class="page"><div class="empty">${icon('info')}<div>${esc(e.message)}</div></div></div>`; }
}

async function openDrawer(n) {
  const { openTask } = await import('./task.js');
  drawerCleanup?.();
  drawerCleanup = openTask(n, () => { location.hash = baseHash; });
}
function closeDrawer(nav = true) {
  if (!drawerCleanup) return false;
  drawerCleanup(); drawerCleanup = null;
  if (nav) location.hash = baseHash;
  return true;
}
export function goTask(n) { location.hash = '#/task/' + n; }

/* ---------------- keyboard ---------------- */
let gPending = 0;
function keys(e) {
  const t = e.target;
  const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); action('palette'); return; }
  if (e.key === 'Escape') {
    if (document.querySelector('.menu')) { closeMenu(); return; }
    if (closeTopModal()) return;
    if (typing) { t.blur(); return; }
    if (closeDrawer()) return;
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || hasModal()) return;
  if (document.querySelector('.viewer-host') && 'fwrblp12345 '.includes(e.key.toLowerCase()) && !gPending) return; // the 3D viewer owns these
  const k = e.key.toLowerCase();
  if (gPending) {
    gPending = 0;
    const n = NAV.find(n => n.key === k); if (n) { location.hash = '#/' + n.r; e.preventDefault(); }
    return;
  }
  if (k === 'g') { gPending = 1; setTimeout(() => gPending = 0, 900); return; }
  if (k === 'c') { e.preventDefault(); action('new-task'); }
  else if (k === 'i') { e.preventDefault(); action('new-idea'); }
  else if (k === 'u') { e.preventDefault(); action('upload'); }
  else if (k === 't') { action('theme'); }
  else if (e.key === '?') { action('help'); }
  else if (e.key === '/') { const s = document.querySelector('#main [data-search]'); if (s) { e.preventDefault(); s.focus(); } }
}

/* ---------------- boot ---------------- */
async function enter() {
  app.innerHTML = `<div class="login"><div class="empty" style="color:var(--fg2)"><div class="progress"><i style="width:60%"></i></div><div class="mono" data-boot>Connecting to ${esc(S.cfg.owner)}/${esc(S.cfg.repo)}…</div></div></div>`;
  await S.boot();
  shell();
  Notices.start();
  if (!ls.get('welcomed')) {
    ls.set('welcomed', true);
    toast(`Welcome, ${S.me.name || S.me.login}`, { sub: 'Press ? for shortcuts, Ctrl K to search anything.', ms: 7000 });
  }
  if (!location.hash || location.hash === '#') location.hash = '#/home';
  route();
}

/* ---------------- new version check ---------------- */
function watchVersion() {
  const mine = document.querySelector('meta[name="hub-version"]')?.content;
  if (!mine) return;
  let told = false;
  const check = async () => {
    if (told || document.hidden) return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const { version } = await r.json();
      if (version && version !== mine) {
        told = true;
        toast('A new version of the hub is out', { sub: 'Click here to reload and get it.', ms: 600000, onClick: () => location.reload() });
      }
    } catch {}
  };
  setInterval(check, 90000);
  document.addEventListener('visibilitychange', check);
}

async function boot() {
  watchVersion();
  startFx(themeNow());
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', keys);
  window.addEventListener('mmg:action', e => action(e.detail.name, e.detail.arg));
  const token = ls.get('token');
  if (!token) return loginScreen();
  try { await S.login(token); await enter(); }
  catch (e) { console.error(e); loginScreen(e.status === 401 ? 'Your saved token stopped working. Paste a new one.' : e.message); }
}
boot();

export { html };
