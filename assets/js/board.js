// Board (kanban), List, and the Ideas inbox. Drag cards between columns; everything syncs to GitHub Issues.
import { S, STATUSES, TYPES, PRIOS } from './store.js';
import { esc, icon, ago, toastErr, toast, store as ls, avatarImg, menu, dueLabel, isOverdue, parseDue, debounce, goTask, act } from './ui.js';
import { observe } from './thumbs.js';
import { kindOf } from './files.js';

const BOARD_COLS = ['todo', 'doing', 'review', 'done'];
const st = k => STATUSES.find(s => s.key === k);
let dragging = false;
const ty = k => TYPES.find(t => t.key === k);

/* ---------------- shared bits ---------------- */
export function parseQuick(s) {
  const out = { type: '', prio: '', assignees: [], due: null };
  const team = S.team().map(p => p.login.toLowerCase());
  const words = s.split(/\s+/).filter(w => {
    let m;
    if ((m = w.match(/^#(\w+)$/)) && ty(m[1].toLowerCase())) { out.type = m[1].toLowerCase(); return false; }
    if ((m = w.match(/^!(urgent|high|low)$/i))) { out.prio = m[1].toLowerCase(); return false; }
    if ((m = w.match(/^@([\w-]+)$/))) {
      const l = m[1].toLowerCase() === 'me' ? S.me.login : S.team().find(p => p.login.toLowerCase() === m[1].toLowerCase())?.login;
      if (l || team.length < 2) { out.assignees.push(l || m[1]); return false; }
    }
    if ((m = w.match(/^due:(\S+)$/i)) && parseDue(m[1])) { out.due = parseDue(m[1]); return false; }
    return true;
  });
  out.title = words.join(' ').trim();
  return out;
}

export function cardHtml(t, { cover = true } = {}) {
  const type = ty(t.type);
  const coverPath = cover && t.files.find(p => ['image', 'model'].includes(kindOf(p)) && S.tree?.entries.has(p));
  const ce = coverPath && S.tree.entries.get(coverPath);
  const prog = t.checklist.length ? Math.round(t.done / t.checklist.length * 100) : null;
  return `<div class="card ${isOverdue(t.due) && t.status !== 'done' ? 'overdue' : ''}" data-n="${t.n}" style="--c:${type ? type.color : 'transparent'}" tabindex="0">
    ${ce ? `<div class="cover"><img class="hidden" data-sha="${ce.sha}" data-path="${esc(coverPath)}" data-size="${ce.size}" alt=""></div>` : ''}
    <div class="title">${t.prio === 'urgent' ? '<span class="urgent-flag">! </span>' : ''}${esc(t.title)}</div>
    ${prog !== null ? `<div class="bar"><i style="width:${prog}%"></i></div>` : ''}
    <div class="meta">
      <span class="num">#${t.n}</span>
      ${type ? `<span class="chip" style="--c:${type.color}">${esc(t.type)}</span>` : ''}
      ${t.prio && t.prio !== 'urgent' ? `<span class="prio p${PRIOS.find(p => p.key === t.prio).rank}" title="${esc(t.prio)} priority"><i></i><i></i><i></i></span>` : ''}
      ${t.labels.slice(0, 2).map(l => `<span class="chip">${esc(l)}</span>`).join('')}
      ${t.due ? `<span class="m due">${icon('calendar')}${esc(dueLabel(t.due))}</span>` : ''}
      ${prog !== null ? `<span class="m">${icon('checksq')}${t.done}/${t.checklist.length}</span>` : ''}
      ${t.files.length ? `<span class="m">${icon('clip')}${t.files.length}</span>` : ''}
      ${t.comments ? `<span class="m">${icon('chat')}${t.comments}</span>` : ''}
      ${t.status === 'idea' && (t.up || t.down) ? `<span class="m">👍${t.up} 👎${t.down}</span>` : ''}
      <span class="grow"></span>
      <span class="avatars">${t.assignees.map(a => avatarImg(S.person(a), 'xs')).join('')}</span>
    </div></div>`;
}

function filterBar(f, { views = true } = {}) {
  const who = f.who === 'me' ? 'Me' : f.who === 'none' ? 'Unassigned' : f.who ? '@' + f.who : 'Everyone';
  return `<div class="toolbar">
    <div class="search">${icon('search')}<input class="input" data-search placeholder="Filter…  (/)" value="${esc(f.q || '')}"></div>
    <button class="btn" data-f="who">${icon('user')} ${esc(who)} ${icon('down')}</button>
    <button class="btn" data-f="type">${icon('tag')} ${esc(f.type ? ty(f.type).label : 'Any type')} ${icon('down')}</button>
    ${views ? `<div class="seg"><button data-view="board" class="${f.view !== 'list' ? 'on' : ''}">${icon('board')} Board</button><button data-view="list" class="${f.view === 'list' ? 'on' : ''}">${icon('list')} List</button></div>` : ''}
  </div>`;
}
function applyFilter(ts, f) {
  const q = (f.q || '').toLowerCase();
  return ts.filter(t => {
    if (f.who === 'me' && !t.assignees.includes(S.me.login)) return false;
    if (f.who === 'none' && t.assignees.length) return false;
    if (f.who && !['me', 'none'].includes(f.who) && !t.assignees.includes(f.who)) return false;
    if (f.type && t.type !== f.type) return false;
    if (q && !(`#${t.n} ${t.title} ${t.text} ${t.labels.join(' ')} ${t.type}`.toLowerCase().includes(q))) return false;
    return true;
  });
}
function bindFilter(root, f, key, redraw) {
  root.addEventListener('input', debounce(e => {
    if (!e.target.matches('[data-search]')) return;
    f.q = e.target.value; ls.set(key, f); redraw(true);
  }, 120));
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (b?.dataset.f === 'who') {
      menu(b, [{ label: 'Everyone', value: '' }, { label: 'Me', value: 'me', icon: 'user' }, { label: 'Unassigned', value: 'none' }, 'sep',
        ...S.team().map(p => ({ label: p.login, value: p.login, icon: avatarImg(p, 'xs') }))].map(i => i === 'sep' ? i : { ...i, checked: (f.who || '') === i.value }),
        v => { f.who = v; ls.set(key, f); redraw(); });
    }
    if (b?.dataset.f === 'type') {
      menu(b, [{ label: 'Any type', value: '' }, ...TYPES.map(t => ({ label: t.label, value: t.key, color: t.color }))].map(i => ({ ...i, checked: (f.type || '') === i.value })),
        v => { f.type = v; ls.set(key, f); redraw(); });
    }
    const v = e.target.closest('[data-view]');
    if (v) { f.view = v.dataset.view; ls.set(key, f); redraw(); }
  });
}
const keepSearchFocus = (root, fn) => {
  const a = document.activeElement; const had = a?.matches?.('[data-search]'); const pos = had ? a.selectionStart : 0;
  fn();
  if (had) { const s = root.querySelector('[data-search]'); s?.focus(); s?.setSelectionRange(pos, pos); }
};

/* ---------------- Board + List ---------------- */
export function render(main) {
  const f = ls.get('boardFilter', { view: 'board' });
  const page = document.createElement('div'); page.className = 'page full'; main.appendChild(page);
  let showAllDone = false;
  let sort = ls.get('listSort', { k: 'order', dir: 1 });

  const redraw = () => keepSearchFocus(page, () => {
    if (dragging) return;
    const ts = applyFilter(S.tasks(), f);
    const head = `<div class="page-head" style="padding:22px 28px 0"><h1>Board</h1><div class="grow"></div>${filterBar(f)}
      <button class="btn primary" data-new>${icon('plus')} New task <span class="kbd" style="background:transparent;color:inherit;border-color:currentColor;opacity:.6">C</span></button></div>`;
    if (f.view === 'list') { page.innerHTML = head + `<div style="padding:0 28px 30px;overflow:auto;flex:1">${listHtml(ts, sort)}</div>`; }
    else {
      page.innerHTML = head + `<div class="board">${BOARD_COLS.map(k => {
        const s = st(k);
        let col = ts.filter(t => t.status === k);
        if (k === 'done') col.sort((a, b) => Date.parse(b.closed || b.updated) - Date.parse(a.closed || a.updated));
        else col.sort((a, b) => a.order - b.order);
        const total = col.length;
        if (k === 'done' && !showAllDone) col = col.slice(0, 15);
        return `<section class="col" data-col="${k}"><div class="col-head"><span class="dot" style="--c:${s.color}"></span><h3>${s.label}</h3><span class="n">${total}</span>
          ${k !== 'done' ? `<button class="btn ghost sm icon" data-add="${k}" title="Add to ${s.label}">${icon('plus')}</button>` : ''}</div>
          ${k === 'todo' ? `<div class="quick-add"><input class="input" data-quick="${k}" placeholder="+ Add a task, press Enter"><div class="quick-hint hidden">#art !high @me due:fri</div></div>` : ''}
          <div class="col-body">${col.map(t => cardHtml(t)).join('') || `<div class="faint" style="font-size:12px;text-align:center;padding:16px 0">${k === 'review' ? 'Drop finished work here' : k === 'doing' ? 'Drag a task here to claim it' : 'Empty'}</div>`}
          ${k === 'done' && total > 15 && !showAllDone ? `<button class="btn ghost sm" data-moredone>Show all ${total}</button>` : ''}</div></section>`;
      }).join('')}</div>`;
      page.querySelectorAll('.card img[data-sha]').forEach(observe);
    }
  });

  page.addEventListener('click', e => {
    if (e.target.closest('[data-new]')) return act('new-task');
    const add = e.target.closest('[data-add]'); if (add) return act('new-task', { status: add.dataset.add });
    if (e.target.closest('[data-moredone]')) { showAllDone = true; return redraw(); }
    const th = e.target.closest('th[data-sort]');
    if (th) { sort = { k: th.dataset.sort, dir: sort.k === th.dataset.sort ? -sort.dir : 1 }; ls.set('listSort', sort); return redraw(); }
    const r = e.target.closest('tr[data-n]'); if (r) return goTask(r.dataset.n);
  });
  page.addEventListener('focusin', e => { if (e.target.matches('[data-quick]')) e.target.nextElementSibling?.classList.remove('hidden'); });
  page.addEventListener('focusout', e => { if (e.target.matches('[data-quick]')) e.target.nextElementSibling?.classList.add('hidden'); });
  page.addEventListener('keydown', async e => {
    if (e.target.matches('[data-quick]') && e.key === 'Enter' && e.target.value.trim()) {
      const inp = e.target, q = parseQuick(inp.value);
      if (!q.title) return;
      inp.value = ''; inp.disabled = true;
      try { await S.createTask({ title: q.title, status: inp.dataset.quick, type: q.type, prio: q.prio, assignees: q.assignees, meta: { due: q.due } }); toast('Task added', { kind: 'ok', ms: 1800 }); }
      catch (er) { toastErr(er); inp.value = q.title; }
      inp.disabled = false; page.querySelector(`[data-quick="${inp.dataset.quick}"]`)?.focus();
    }
    if (e.key === 'Enter' && e.target.matches('.card')) goTask(e.target.dataset.n);
  });
  bindFilter(page, f, 'boardFilter', redraw);
  const stopDrag = enableDrag(page, () => redraw());
  redraw();
  const off = S.on('issues', redraw), off2 = S.on('tree', redraw);
  return () => { off(); off2(); stopDrag(); };
}

function listHtml(ts, sort) {
  const key = {
    order: t => t.order, title: t => t.title.toLowerCase(), type: t => t.type || 'zz', prio: t => t.prioRank,
    who: t => t.assignees[0] || 'zz', due: t => t.due || '9999', updated: t => -Date.parse(t.updated), n: t => t.n,
  }[sort.k] || (t => t.order);
  const rows = [];
  for (const k of ['idea', 'todo', 'doing', 'review', 'done', 'parked']) {
    const g = ts.filter(t => t.status === k).sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
    if (!g.length) continue;
    const s = st(k);
    rows.push(`<tr class="group"><td colspan="7"><span class="dot" style="--c:${s.color}"></span> ${s.label} <span class="faint">${g.length}</span></td></tr>`);
    g.forEach(t => rows.push(`<tr class="r" data-n="${t.n}"><td class="faint mono">#${t.n}</td><td><b style="font-weight:600">${esc(t.title)}</b>${t.checklist.length ? ` <span class="faint" style="font-size:11px">${t.done}/${t.checklist.length}</span>` : ''}</td>
      <td>${t.type ? `<span class="chip" style="--c:${ty(t.type).color}">${esc(t.type)}</span>` : ''}</td>
      <td>${t.prio ? esc(t.prio) : '<span class="faint">–</span>'}</td>
      <td><span class="avatars">${t.assignees.map(a => avatarImg(S.person(a), 'xs')).join('') || '<span class="faint">–</span>'}</span></td>
      <td class="${isOverdue(t.due) && k !== 'done' ? '' : 'muted'}" style="${isOverdue(t.due) && k !== 'done' ? 'color:var(--danger)' : ''}">${t.due ? esc(dueLabel(t.due)) : ''}</td>
      <td class="faint">${esc(ago(t.updated))}</td></tr>`));
  }
  const th = (k, l) => `<th data-sort="${k}">${l}${sort.k === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  return rows.length ? `<table class="tlist"><thead><tr>${th('n', '#')}${th('title', 'Title')}${th('type', 'Type')}${th('prio', 'Priority')}${th('who', 'Who')}${th('due', 'Due')}${th('updated', 'Updated')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
    : `<div class="empty">${icon('board')}<div>No tasks match.</div></div>`;
}

/* ---------------- pointer drag & drop ---------------- */
function enableDrag(root, after) {
  let st0 = null, flying = null, ph = null, src = null, over = null;
  const down = e => {
    const card = e.target.closest('.col .card');
    if (!card || e.button !== 0 || e.pointerType === 'touch' || e.target.closest('a,button,input')) return;
    st0 = { x: e.clientX, y: e.clientY, card, id: e.pointerId, dx: 0, dy: 0 };
  };
  const move = e => {
    if (!st0) return;
    if (!flying) {
      if (Math.hypot(e.clientX - st0.x, e.clientY - st0.y) < 6) return;
      src = st0.card;
      const r = src.getBoundingClientRect();
      st0.dx = e.clientX - r.left; st0.dy = e.clientY - r.top;
      flying = src.cloneNode(true); flying.classList.add('flying'); flying.style.setProperty('--w', r.width + 'px');
      document.body.appendChild(flying);
      ph = document.createElement('div'); ph.className = 'placeholder'; ph.style.height = r.height + 'px';
      src.after(ph); src.classList.add('hidden');
      document.body.style.cursor = 'grabbing'; dragging = true;
    }
    flying.style.left = e.clientX - st0.dx + 'px'; flying.style.top = e.clientY - st0.dy + 'px';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const col = under?.closest('.col');
    root.querySelectorAll('.col.drop-on').forEach(c => c !== col && c.classList.remove('drop-on'));
    if (col) {
      col.classList.add('drop-on'); over = col;
      const body = col.querySelector('.col-body');
      const cards = [...body.querySelectorAll('.card:not(.hidden)')];
      const next = cards.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (next) body.insertBefore(ph, next); else body.insertBefore(ph, body.querySelector('[data-moredone]') || null);
      // autoscroll the column
      const br = body.getBoundingClientRect();
      if (e.clientY < br.top + 40) body.scrollTop -= 12; else if (e.clientY > br.bottom - 40) body.scrollTop += 12;
    }
    const board = root.querySelector('.board');
    if (board) { const r = board.getBoundingClientRect(); if (e.clientX < r.left + 50) board.scrollLeft -= 14; else if (e.clientX > r.right - 50) board.scrollLeft += 14; }
  };
  const up = async e => {
    const s = st0; st0 = null;
    if (!s) return;
    if (!flying) { if (e.target.closest('.card') === s.card) goTask(s.card.dataset.n); return; }
    const n = +src.dataset.n;
    const col = over?.dataset.col;
    const prev = ph.previousElementSibling?.closest('.card'), next = ph.nextElementSibling?.closest('.card');
    flying.remove(); flying = null; document.body.style.cursor = ''; dragging = false;
    root.querySelectorAll('.col.drop-on').forEach(c => c.classList.remove('drop-on'));
    ph.replaceWith(src); src.classList.remove('hidden'); ph = null;
    if (!col) return after();
    const po = prev ? S.task(+prev.dataset.n).order : null, no = next ? S.task(+next.dataset.n).order : null;
    const order = po == null && no == null ? 1000 : po == null ? no - 1000 : no == null ? po + 1000 : (po + no) / 2;
    const cur = S.task(n);
    if (cur.status === col && Math.abs(cur.order - order) < 1e-9) return after();
    try {
      const p = S.move(n, col, order);
      after();
      await p;
      if (col !== cur.status) {
        if (col === 'doing' && !cur.assignees.length) await S.updateTask(n, { assignees: [S.me.login] });
        toast(`Moved to ${st(col).label}`, { sub: cur.title, kind: 'ok', ms: 2000 });
      }
    } catch (er) { toastErr(er, 'Could not move the task'); after(); }
  };
  root.addEventListener('pointerdown', down);
  // phones: a tap opens the card (dragging is mouse only; change the column inside the card)
  let lastPointer = 'mouse';
  root.addEventListener('pointerdown', e => { lastPointer = e.pointerType; }, true);
  root.addEventListener('click', e => {
    if (lastPointer !== 'touch') return;
    const c = e.target.closest('.col .card');
    if (c && !e.target.closest('a,button,input')) goTask(c.dataset.n);
  });
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
}

/* ---------------- Ideas ---------------- */
export function renderIdeas(main) {
  const f = ls.get('ideaFilter', {});
  let sortBy = ls.get('ideaSort', 'new');
  const page = document.createElement('div'); page.className = 'page'; main.appendChild(page);
  const redraw = () => keepSearchFocus(page, () => {
    const all = applyFilter(S.tasks(), f);
    let ideas = all.filter(t => t.status === 'idea');
    const parked = all.filter(t => t.status === 'parked');
    const score = t => t.up - t.down;
    if (sortBy === 'top') ideas.sort((a, b) => score(b) - score(a) || Date.parse(b.created) - Date.parse(a.created));
    else if (sortBy === 'talk') ideas.sort((a, b) => b.comments - a.comments);
    else ideas.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    const votes = S.votes || new Map();
    page.innerHTML = `<div class="page-head"><h1>Ideas</h1><div class="grow"></div>${filterBar(f, { views: false })}
      <div class="seg">${[['new', 'Newest'], ['top', 'Top voted'], ['talk', 'Most talked']].map(([k, l]) => `<button data-sort="${k}" class="${sortBy === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="panel" style="padding:14px;margin-bottom:18px;display:flex;gap:10px;align-items:center">${icon('sparkle')}
        <input class="input" data-quickidea placeholder="Pitch an idea in one line and press Enter. Add details after." style="flex:1">
        <button class="btn primary" data-a="new-idea">Write it out</button></div>
      <p class="muted" style="margin:0 0 14px;font-size:13px">Vote 👍 or 👎. When you both agree, <b>Make it a task</b> sends it to the board. <b>Park</b> keeps it for later.</p>
      <div class="ideas">${ideas.map(t => ideaCard(t, votes.get(t.n))).join('') || `<div class="empty" style="grid-column:1/-1">${icon('bulb')}<div>No ideas yet. Pitch the first one above.</div></div>`}</div>
      ${parked.length ? `<details style="margin-top:26px"><summary class="section-title" style="cursor:pointer">Parked · ${parked.length}</summary><div class="ideas" style="margin-top:12px">${parked.map(t => ideaCard(t, votes.get(t.n), true)).join('')}</div></details>` : ''}`;
  });
  page.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (a) return act(a.dataset.a);
    const s = e.target.closest('[data-sort]'); if (s) { sortBy = s.dataset.sort; ls.set('ideaSort', sortBy); return redraw(); }
    const v = e.target.closest('[data-vote]');
    if (v) {
      e.stopPropagation(); v.disabled = true;
      try { await S.toggleReaction({ n: +v.dataset.n }, v.dataset.vote); await S.loadVotes([+v.dataset.n]); } catch (er) { toastErr(er); }
      return;
    }
    const pr = e.target.closest('[data-promote]');
    if (pr) { e.stopPropagation(); try { await S.updateTask(+pr.dataset.promote, { status: 'todo' }); toast('Sent to the board', { kind: 'ok' }); } catch (er) { toastErr(er); } return; }
    const pk = e.target.closest('[data-park]');
    if (pk) { e.stopPropagation(); try { await S.updateTask(+pk.dataset.park, { status: pk.dataset.to }); } catch (er) { toastErr(er); } return; }
    const c = e.target.closest('.idea'); if (c) goTask(c.dataset.n);
  });
  page.addEventListener('keydown', async e => {
    if (e.target.matches('[data-quickidea]') && e.key === 'Enter' && e.target.value.trim()) {
      const inp = e.target, q = parseQuick(inp.value); inp.value = '';
      try { await S.createTask({ title: q.title, status: 'idea', type: q.type, prio: q.prio }); toast('Idea pitched', { kind: 'ok', ms: 1800 }); } catch (er) { toastErr(er); }
    }
  });
  bindFilter(page, f, 'ideaFilter', redraw);
  redraw();
  const load = () => S.loadVotes(S.tasks().filter(t => t.status === 'idea' || t.status === 'parked').map(t => t.n));
  load();
  const offs = [S.on('issues', () => { redraw(); load(); }), S.on('votes', redraw)];
  return () => offs.forEach(f => f());
}
function ideaCard(t, v, parked = false) {
  const type = ty(t.type);
  const both = v && S.team().length > 1 && S.team().every(p => v.up.includes(p.login));
  return `<article class="idea panel" data-n="${t.n}" style="${type ? `border-top:3px solid ${type.color}` : ''}">
    <div style="display:flex;gap:8px;align-items:center">${avatarImg(S.person(t.author), 'xs')}<span class="faint" style="font-size:12px">${esc(t.author)} · ${esc(ago(t.created))}</span><span class="grow" style="flex:1"></span>${type ? `<span class="chip" style="--c:${type.color}">${esc(t.type)}</span>` : ''}${both ? '<span class="chip" style="--c:var(--ok)">both 👍</span>' : ''}</div>
    <h3>${esc(t.title)}</h3>
    ${t.text.trim() ? `<div class="body">${esc(t.text.replace(/[#*_`>]/g, '').slice(0, 400))}</div>` : ''}
    <div class="acts">
      <button class="btn sm vote ${v?.mine === 'up' ? 'mine' : ''}" data-vote="+1" data-n="${t.n}" title="${esc((v?.up || []).join(', ') || 'Vote up')}">👍 ${t.up}</button>
      <button class="btn sm vote ${v?.mine === 'down' ? 'mine' : ''}" data-vote="-1" data-n="${t.n}" title="${esc((v?.down || []).join(', ') || 'Vote down')}">👎 ${t.down}</button>
      <span class="faint" style="font-size:12px">${icon('chat')} ${t.comments}</span>
      <span style="flex:1"></span>
      ${parked ? `<button class="btn sm" data-park="${t.n}" data-to="${esc(t.meta.parkedFrom && t.meta.parkedFrom !== 'parked' ? t.meta.parkedFrom : 'idea')}">${t.meta.parkedFrom && !['idea', 'parked'].includes(t.meta.parkedFrom) ? 'Back to the board' : 'Unpark'}</button>` : `<button class="btn sm ghost" data-park="${t.n}" data-to="parked">${icon('archive')} Park</button><button class="btn sm primary" data-promote="${t.n}">Make it a task</button>`}
    </div></article>`;
}
