// Home: what needs you, the state of the board, fresh uploads, and the activity feed.
import { S, STATUSES } from './store.js';
import { esc, icon, ago, act, avatarImg, dueLabel, isOverdue } from './ui.js';
import * as Notices from './notices.js';
import { kindOf, baseName, KIND_ICON } from './files.js';
import { observe } from './thumbs.js';

export function render(main) {
  const page = document.createElement('div'); page.className = 'page'; main.appendChild(page);
  let recentFiles = null;

  const draw = () => {
    const me = S.me.login;
    const ts = S.tasks();
    const open = ts.filter(t => !['done', 'parked'].includes(t.status));
    const toReview = ts.filter(t => t.status === 'review' && !t.assignees.includes(me) && (t.author !== me || t.assignees.length));
    const mine = open.filter(t => t.assignees.includes(me) && t.status !== 'idea').sort((a, b) => (a.due || '9') .localeCompare(b.due || '9') || a.prioRank - b.prioRank);
    const ideasToVote = ts.filter(t => t.status === 'idea' && t.author !== me && !votedByMe(t));
    const unclaimed = open.filter(t => t.status === 'todo' && !t.assignees.length).sort((a, b) => a.prioRank - b.prioRank).slice(0, 5);
    const h = new Date().getHours();
    const hi = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const counts = Object.fromEntries(STATUSES.map(s => [s.key, ts.filter(t => t.status === s.key).length]));
    const feed = Notices.list().slice(0, 14);

    page.innerHTML = `
      <div class="page-head" style="margin-bottom:6px"><div><div class="hello">${hi}, ${esc((S.me.name || me).split(' ')[0])}.</div>
        <div class="muted" style="margin-top:4px">${summary(toReview.length, mine.length, Notices.unreadCount())}</div></div><div class="grow"></div>
        <button class="btn" data-a="new-idea">${icon('sparkle')} Idea</button><button class="btn" data-a="upload">${icon('upload')} Upload</button><button class="btn primary" data-a="new-task">${icon('plus')} Task</button></div>
      <div class="stat-row" style="margin:16px 0">${['idea', 'todo', 'doing', 'review', 'done'].map(k => { const s = STATUSES.find(x => x.key === k); return `<a class="stat" style="--c:${s.color}" href="#/${k === 'idea' ? 'ideas' : 'board'}"><b>${counts[k]}</b><span>${s.label}</span></a>`; }).join('')}</div>
      <div class="home-grid">
        <section class="panel span-8"><div class="panel-head"><h3>Needs you</h3><span class="faint" style="font-size:12px">${toReview.length + mine.length + ideasToVote.length}</span></div><div class="panel-body">
          ${toReview.length + mine.length + ideasToVote.length === 0 ? `<div class="empty" style="padding:24px">${icon('check')}<div>Nothing waiting on you. ${unclaimed.length ? 'Grab something from “Up for grabs”.' : ''}</div></div>` : ''}
          ${group('Review these', 'eye', 'var(--s-review)', toReview)}
          ${group('Your tasks', 'user', 'var(--s-doing)', mine)}
          ${group('Vote on ideas', 'bulb', 'var(--s-idea)', ideasToVote)}
        </div></section>
        <section class="panel span-4"><div class="panel-head"><h3>Up for grabs</h3><div class="grow"></div><a class="btn ghost sm" href="#/board">Board ${icon('arrowr')}</a></div><div class="panel-body">
          ${unclaimed.length ? unclaimed.map(row).join('') : '<div class="faint" style="padding:6px 10px">No unclaimed tasks.</div>'}
        </div></section>
        <section class="panel span-12"><div class="panel-head"><h3>Fresh files</h3><div class="grow"></div><a class="btn ghost sm" href="#/files">All files ${icon('arrowr')}</a></div><div class="panel-body"><div class="strip" data-recent>${recentFiles ? tiles(recentFiles) : '<div class="faint">Looking at recent commits…</div>'}</div></div></section>
        <section class="panel span-12"><div class="panel-head"><h3>Activity</h3><div class="grow"></div><a class="btn ghost sm" href="#/inbox">Inbox ${icon('arrowr')}</a></div><div class="panel-body"><div class="feed">${feed.length ? feed.map(n => Notices.noticeRow(n)).join('') : '<div class="faint" style="padding:6px 10px">Quiet so far. Activity from your teammate shows up here.</div>'}</div></div></section>
      </div>`;
    page.querySelectorAll('[data-recent] img[data-sha]').forEach(observe);
  };

  page.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (a) { act(a.dataset.a); return; }
    const r = e.target.closest('[data-task]'); if (r) { location.hash = '#/task/' + r.dataset.task; return; }
    const f = e.target.closest('[data-file]'); if (f) { location.hash = '#/file/' + encodeURIComponent(f.dataset.file); }
  });
  Notices.bindFeed(page);

  async function loadRecent() {
    // files touched by the last few commits, newest first, previewable only
    const seen = new Set(), out = [];
    for (const c of S.commits.slice(0, 8)) {
      try {
        const files = (await S.gh.get(`${S.repoPath}/commits/${c.sha}`)).files || [];
        for (const f of files) {
          if (f.status === 'removed' || seen.has(f.filename)) continue;
          const k = kindOf(f.filename); if (k !== 'model' && k !== 'image') continue;
          const e = S.tree?.entries.get(f.filename); if (!e) continue;
          seen.add(f.filename); out.push({ ...e, when: c.commit.author.date, who: c.author?.login });
          if (out.length >= 16) break;
        }
      } catch {}
      if (out.length >= 16) break;
    }
    recentFiles = out;
    const strip = page.querySelector('[data-recent]');
    if (strip) { strip.innerHTML = out.length ? tiles(out) : '<div class="faint">No models or images in recent commits.</div>'; strip.querySelectorAll('img[data-sha]').forEach(observe); }
  }
  draw();
  loadRecent();
  S.loadVotes(S.tasks().filter(t => t.status === 'idea').map(t => t.n));
  const offs = ['issues', 'notices', 'votes'].map(e => S.on(e, draw));
  const offc = S.on('commits', loadRecent);
  return () => { offs.forEach(f => f()); offc(); };
}

function votedByMe(t) { return S.votes?.get(t.n)?.mine; }
function summary(r, m, u) {
  const p = [];
  if (r) p.push(`${r} thing${r > 1 ? 's' : ''} to review`);
  if (m) p.push(`${m} task${m > 1 ? 's' : ''} on your plate`);
  if (u) p.push(`${u} unread`);
  return p.length ? p.join(' · ') : 'All clear. Good time to pitch an idea.';
}
function group(title, ic, color, list) {
  if (!list.length) return '';
  return `<div class="side-label" style="display:flex;gap:6px;align-items:center;color:${color}">${icon(ic)} ${title}</div>${list.slice(0, 6).map(row).join('')}`;
}
function row(t) {
  const s = STATUSES.find(x => x.key === t.status);
  return `<div class="row-item" data-task="${t.n}"><span class="dot" style="--c:${s.color}"></span><span class="t">${esc(t.title)}</span>
    ${t.due ? `<span class="chip" style="--c:${isOverdue(t.due) ? 'var(--danger)' : 'var(--fg3)'}">${esc(dueLabel(t.due))}</span>` : ''}
    ${t.comments ? `<span class="faint" style="font-size:12px">${icon('chat')} ${t.comments}</span>` : ''}
    <span class="avatars">${t.assignees.map(a => avatarImg(S.person(a), 'xs')).join('')}</span><span class="faint mono" style="font-size:11px">#${t.n}</span></div>`;
}
function tiles(list) {
  return list.map(e => `<div class="tile" data-file="${esc(e.path)}"><div class="thumb ${kindOf(e.path) === 'image' ? 'checker' : ''}"><img class="hidden" data-sha="${e.sha}" data-path="${esc(e.path)}" data-size="${e.size}" alt=""><svg class="ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon(KIND_ICON[kindOf(e.path)]).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></div>
    <div class="info"><div class="name">${esc(baseName(e.path))}</div><div class="sub">${e.who ? avatarImg(S.person(e.who), 'xs') : ''}${esc(ago(e.when))}</div></div></div>`).join('');
}
