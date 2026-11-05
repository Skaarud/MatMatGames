// Small DOM + UI helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v == null || v === false) return;
      if (Array.isArray(v)) out += v.map(x => (x && x.__raw) ? x.s : esc(x)).join('');
      else if (v.__raw) out += v.s;
      else out += esc(v);
    }
  });
  return { __raw: true, s: out, toString() { return out; } };
}
export const raw = s => ({ __raw: true, s: String(s ?? ''), toString() { return this.s; } });

export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

export function on(root, type, sel, fn, opts) {
  root.addEventListener(type, e => {
    const t = e.target.closest(sel);
    if (t && root.contains(t)) fn(e, t);
  }, opts);
}

/* ---------- time & size ---------- */
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function ago(iso) {
  if (!iso) return '';
  const d = (new Date(iso) - Date.now()) / 1000;
  const a = Math.abs(d);
  if (a < 45) return 'just now';
  if (a < 3600) return rtf.format(Math.round(d / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(d / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(d / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: a > 86400 * 300 ? 'numeric' : undefined });
}
export function fullTime(iso) { return iso ? new Date(iso).toLocaleString() : ''; }
export function bytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}
export function num(n) { return n == null ? '–' : n.toLocaleString(); }
export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- local storage ---------- */
export const store = {
  get(k, d) { try { const v = localStorage.getItem('mmg.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mmg.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('mmg.' + k); } catch {} },
};

/* ---------- toasts ---------- */
export function toast(title, { sub = '', kind = '', ms = 4200, onClick, avatar } = {}) {
  const root = document.getElementById('toasts');
  const t = el(`<div class="toast ${kind}">${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="">` : ''}<div class="grow"><div>${esc(title)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div></div>`);
  root.appendChild(t);
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  t.addEventListener('click', () => { onClick?.(); kill(); });
  setTimeout(kill, ms);
  return kill;
}
export function toastErr(e, title = 'Something went wrong') {
  console.error(e);
  toast(title, { sub: e?.message || String(e), kind: 'err', ms: 7000 });
}

/* ---------- modal ---------- */
let modalStack = [];
export function modal({ title, body, foot, wide = false, cls = '', onClose } = {}) {
  const root = document.getElementById('modal-root');
  const scrim = el(`<div class="modal-scrim"><div class="modal ${wide ? 'wide' : ''} ${cls}" role="dialog" aria-modal="true">
    ${title ? `<div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon" data-x aria-label="Close">${icon('x')}</button></div>` : ''}
    <div class="modal-body"></div>${foot !== undefined ? '<div class="modal-foot"></div>' : ''}</div></div>`);
  const m = scrim.firstElementChild;
  const bodyEl = m.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const footEl = m.querySelector('.modal-foot');
  if (footEl && foot) { if (typeof foot === 'string') footEl.innerHTML = foot; else footEl.appendChild(foot); }
  const close = () => { scrim.remove(); modalStack = modalStack.filter(x => x !== close); onClose?.(); };
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) close(); });
  m.querySelector('[data-x]')?.addEventListener('click', close);
  root.appendChild(scrim);
  modalStack.push(close);
  setTimeout(() => m.querySelector('[autofocus], input, textarea')?.focus(), 30);
  return { el: m, body: bodyEl, foot: footEl, close };
}
export function closeAllModals() { [...modalStack].reverse().forEach(c => c()); }
export function closeTopModal() { const c = modalStack[modalStack.length - 1]; if (c) { c(); return true; } return false; }
export function hasModal() { return modalStack.length > 0; }

export function confirmBox(title, text, { ok = 'OK', danger = false } = {}) {
  return new Promise(res => {
    const f = el(`<div style="display:flex;gap:8px"><button class="btn" data-c>Cancel</button><button class="btn primary ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button></div>`);
    const m = modal({ title, body: `<p class="muted" style="margin:0">${esc(text)}</p>`, foot: f, onClose: () => res(false) });
    f.querySelector('[data-c]').onclick = () => m.close();
    f.querySelector('[data-ok]').onclick = () => { res(true); m.close(); };
    setTimeout(() => f.querySelector('[data-ok]').focus(), 40);
  });
}
export function promptBox(title, { value = '', placeholder = '', ok = 'Save', multiline = false } = {}) {
  return new Promise(res => {
    const inp = multiline ? `<textarea class="textarea" autofocus placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" autofocus value="${esc(value)}" placeholder="${esc(placeholder)}">`;
    const f = el(`<div style="display:flex;gap:8px"><button class="btn" data-c>Cancel</button><button class="btn primary" data-ok>${esc(ok)}</button></div>`);
    let done = false;
    const m = modal({ title, body: inp, foot: f, onClose: () => { if (!done) res(null); } });
    const input = m.body.querySelector('input,textarea');
    const go = () => { done = true; res(input.value); m.close(); };
    f.querySelector('[data-c]').onclick = () => m.close();
    f.querySelector('[data-ok]').onclick = go;
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } });
  });
}

/* ---------- popup menu ---------- */
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
/**
 * items: [{label, icon, value, checked, danger, sub}] or 'sep'
 * opts: {search: bool, multi: bool}
 */
export function menu(anchor, items, onPick, { search = false, multi = false, width } = {}) {
  closeMenu();
  const m = el(`<div class="menu" role="menu"></div>`);
  if (width) m.style.minWidth = width + 'px';
  let q = '';
  const render = () => {
    const list = items.filter(it => it === 'sep' ? !q : (it.label + ' ' + (it.sub || '')).toLowerCase().includes(q));
    m.innerHTML = (search ? `<input class="input" placeholder="Filter…" value="${esc(q)}">` : '') + list.map((it, i) => it === 'sep' ? '<div class="msep"></div>' :
      `<button class="mi ${i === 0 && q ? 'hl' : ''} ${it.danger ? 'danger' : ''}" data-i="${items.indexOf(it)}" style="${it.danger ? 'color:var(--danger)' : ''}">
        ${it.icon ? (it.icon.startsWith('<') ? it.icon : icon(it.icon)) : ''}${it.color ? `<span class="dot" style="--c:${esc(it.color)}"></span>` : ''}<span>${esc(it.label)}</span>${it.sub ? `<span class="faint" style="font-size:11px">${esc(it.sub)}</span>` : ''}${it.checked ? `<span class="check-ic">${icon('check')}</span>` : ''}</button>`).join('');
    if (search) {
      const inp = m.querySelector('input');
      inp.oninput = () => { q = inp.value.toLowerCase(); const p = inp.selectionStart; render(); const ni = m.querySelector('input'); ni.focus(); ni.setSelectionRange(p, p); };
      inp.onkeydown = e => { if (e.key === 'Enter') { m.querySelector('.mi')?.click(); } if (e.key === 'Escape') closeMenu(); };
    }
  };
  render();
  m.addEventListener('click', e => {
    const b = e.target.closest('.mi'); if (!b) return;
    const it = items[+b.dataset.i];
    onPick(it.value, it);
    if (multi) { it.checked = !it.checked; render(); } else closeMenu();
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = r.left, y = r.bottom + 4;
  if (x + mw > innerWidth - 8) x = Math.max(8, r.right - mw);
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  openMenu = m;
  if (search) setTimeout(() => m.querySelector('input')?.focus(), 10);
  setTimeout(() => {
    const off = e => { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', off, true); } };
    document.addEventListener('mousedown', off, true);
  });
  return m;
}

/* ---------- icons (lucide-style, inline) ---------- */
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  board: '<rect x="3" y="3" width="7" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  cube: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m22 7-5 4 5 4z"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  clip: '<path d="m21.4 11-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  up: '<path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.4 22H7V10l4-8a3.1 3.1 0 0 1 4 3.9z"/>',
  dn: '<path d="M17 14V2M9 18.1l1 3.9H4.2a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.6 10H17v12l-4 8a3.1 3.1 0 0 1-4-3.9z" transform="translate(0 -8)"/>',
  reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  pin: '<path d="M12 22s-7-6.3-7-12a7 7 0 1 1 14 0c0 5.7-7 12-7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  focus: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/>',
  grid: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>',
  wire: '<path d="M12 2 2 7l10 5 10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  play: '<path d="m6 3 14 9-14 9z"/>',
  pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  bone: '<path d="M17 10c.7-.7 1.7-.5 2.4 0a2.1 2.1 0 1 0 0-3 2.1 2.1 0 1 0-3 0c.5.7.7 1.7 0 2.4L10 15.6c-.7.7-1.7.5-2.4 0a2.1 2.1 0 1 0 0 3 2.1 2.1 0 1 0 3 0c-.5-.7-.7-1.7 0-2.4z"/>',
  box: '<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 2"/>',
  compare: '<path d="M12 3v18"/><rect x="3" y="5" width="18" height="14" rx="2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  move: '<path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  arrowr: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 15h10"/>',
  checksq: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
};
export function icon(name, cls = '') {
  return `<svg class="${cls}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.file}</svg>`;
}

export function avatarImg(user, cls = '') {
  if (!user) return `<span class="avatar ${cls}" title="Nobody"></span>`;
  const login = user.login || user;
  const src = user.avatar_url || `https://github.com/${encodeURIComponent(login)}.png?size=64`;
  const sized = src.startsWith('data:') ? src : src + (src.includes('?') ? '&' : '?') + 's=64';
  return `<img class="avatar ${cls}" src="${esc(sized)}" alt="${esc(login)}" title="${esc(login)}" loading="lazy">`;
}

/** Turn natural words into a date: today, tomorrow, fri, 3d, 2w, 2026-11-10 */
export function parseDue(s) {
  s = (s || '').trim().toLowerCase();
  if (!s) return null;
  const d = new Date(); d.setHours(12, 0, 0, 0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === 'today') return iso(d);
  if (s === 'tomorrow' || s === 'tmr') { d.setDate(d.getDate() + 1); return iso(d); }
  let m = s.match(/^(\d+)\s*([dw])$/);
  if (m) { d.setDate(d.getDate() + (+m[1]) * (m[2] === 'w' ? 7 : 1)); return iso(d); }
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const i = days.findIndex(x => s.startsWith(x));
  if (i >= 0) { let add = (i - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + add); return iso(d); }
  return null;
}
function iso(d) { return d.toISOString().slice(0, 10); }
export function dueLabel(s) {
  if (!s) return '';
  const d = new Date(s + 'T12:00:00'); const t = new Date(); t.setHours(12, 0, 0, 0);
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function isOverdue(s) { if (!s) return false; const t = new Date(); t.setHours(0, 0, 0, 0); return new Date(s + 'T23:59:59') < t; }

export function fuzzy(q, s) {
  q = q.toLowerCase().trim(); s = s.toLowerCase();
  if (!q) return 1;
  // every word must match; words score independently
  const words = q.split(/\s+/);
  if (words.length > 1) { let t = 0; for (const w of words) { const x = fuzzy(w, s); if (!x) return 0; t += x; } return t; }
  const i = s.indexOf(q);
  if (i >= 0) return 100 - i + (i === 0 ? 50 : 0);
  let si = 0, score = 0;
  for (const c of q) { const f = s.indexOf(c, si); if (f < 0) return 0; score += f === si ? 3 : 1; si = f + 1; }
  return score;
}

/** Fire an app-level action (new task, upload, palette…) without importing main.js. */
export const act = (name, arg) => window.dispatchEvent(new CustomEvent('mmg:action', { detail: { name, arg } }));
export const goTask = n => { location.hash = '#/task/' + n; };

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
