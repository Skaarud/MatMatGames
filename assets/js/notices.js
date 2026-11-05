// Notices for each other: comments, mentions, assignments, review requests, uploads, new ideas.
import { S, STATUSES, splitMeta } from './store.js';
import { esc, icon, ago, toast, store as ls, avatarImg, fullTime } from './ui.js';
import { snippet } from './md.js';

let notices = [];
const toasted = new Set();
const sessionStart = Date.now();
let readAt = ls.get('readAt', Date.now() - 3 * 86400000);
let readIds = new Set(ls.get('readIds', []));

export function start() {
  const re = () => recompute();
  ['recent', 'events', 'commits', 'issues', 'ready'].forEach(e => S.on(e, re));
  recompute();
}
export const list = () => notices;
export const isUnread = n => +new Date(n.time) > readAt && !readIds.has(n.id);
export const unreadCount = () => notices.filter(isUnread).length;
export function markRead(id) { readIds.add(id); ls.set('readIds', [...readIds].slice(-3000)); S.emit('inbox', unreadCount()); }
export function markAllRead() { readAt = Date.now(); readIds = new Set(); ls.set('readAt', readAt); ls.set('readIds', []); S.emit('inbox', 0); }

export function targetHref(n) {
  if (n.path) return '#/file/' + encodeURIComponent(n.path);
  if (n.n) return '#/task/' + n.n;
  return '#/home';
}

function recompute() {
  if (!S.me) return;
  const me = S.me.login;
  const out = [];
  const myComments = new Set(), myIssueComments = new Set();
  for (const c of S.recent.values()) if (c.user?.login === me) { myComments.add(c.id); myIssueComments.add(issueNo(c)); }

  // comments
  for (const c of S.recent.values()) {
    if (!c.user || c.user.login === me) continue;
    const n = issueNo(c); const t = S.task(n);
    const { text, meta } = splitMeta(c.body);
    const mention = new RegExp('@' + me + '\\b', 'i').test(text);
    const mine = t && (t.author === me || t.assignees.includes(me));
    const reply = meta.reply && myComments.has(meta.reply);
    const direct = mention || mine || reply || myIssueComments.has(n) || t?.isFile;
    const why = mention ? 'mentioned you' : reply ? 'replied to you' : meta.pin ? 'pinned a comment on' : t?.isFile ? 'commented on' : 'commented on';
    out.push({
      id: 'c' + c.id + (c.updated_at !== c.created_at ? 'e' : ''), kind: mention ? 'mention' : 'comment', actor: c.user.login, time: c.created_at,
      n, path: t?.isFile ? t.meta.file : null, target: t ? (t.isFile ? t.meta.file.split('/').pop() : t.title) : '#' + n,
      text: snippet(text), why, direct, cid: c.id,
    });
  }
  // issue events
  for (const e of S.events) {
    if (!e.actor || e.actor.login === me || !e.issue || e.issue.pull_request) continue;
    const t = S.task(e.issue.number) || { title: e.issue.title, author: e.issue.user?.login, assignees: (e.issue.assignees || []).map(a => a.login), isFile: false };
    if (t.isFile) continue;
    const mine = t.author === me || t.assignees?.includes(me);
    let why = null, direct = false, kind = 'event';
    if (e.event === 'assigned' && e.assignee?.login === me) { why = 'assigned you to'; direct = true; kind = 'assign'; }
    else if (e.event === 'labeled' && e.label?.name === 'status: review') { why = 'asked for a review of'; direct = true; kind = 'review'; }
    else if (e.event === 'labeled' && e.label?.name?.startsWith('status: ')) { const st = STATUSES.find(s => s.name === e.label.name); why = `moved to ${st?.label || e.label.name.slice(8)}`; direct = mine; }
    else if (e.event === 'closed') { why = e.state_reason === 'not_planned' ? 'parked' : 'approved & closed'; direct = mine; kind = e.state_reason === 'not_planned' ? 'event' : 'done'; }
    else if (e.event === 'reopened') { why = 'reopened'; direct = mine; }
    if (!why) continue;
    out.push({ id: 'e' + e.id, kind, actor: e.actor.login, time: e.created_at, n: e.issue.number, target: t.title, why, direct });
  }
  // new tasks & ideas
  for (const t of S.tasks()) {
    if (t.author === me || Date.now() - Date.parse(t.created) > 30 * 86400000) continue;
    out.push({ id: 'i' + t.n, kind: t.status === 'idea' ? 'idea' : 'task', actor: t.author, time: t.created, n: t.n, target: t.title, why: t.status === 'idea' ? 'pitched an idea' : 'added a task', text: snippet(t.text), direct: t.status === 'idea' || t.assignees.includes(me) });
  }
  // uploads (commits by the other person)
  for (const c of S.commits) {
    const login = c.author?.login;
    if (!login || login === me) continue;
    out.push({ id: 'k' + c.sha, kind: 'upload', actor: login, time: c.commit.author.date, sha: c.sha, why: 'pushed', target: c.commit.message.split('\n')[0], direct: false, commit: c });
  }
  out.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  notices = out;
  S.emit('inbox', unreadCount());
  S.emit('notices', notices);
  // toasts for things that arrived while the hub is open
  for (const n of out) {
    if (toasted.has(n.id)) continue;
    toasted.add(n.id);
    if (Date.parse(n.time) < sessionStart - 5000 || !isUnread(n)) continue;
    const actor = S.person(n.actor);
    const title = `${actor.name || actor.login} ${n.why} ${n.target ? '“' + n.target + '”' : ''}`;
    toast(title, { sub: n.text, avatar: actor.avatar_url, ms: 8000, onClick: () => { markRead(n.id); location.hash = targetHref(n); } });
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { const no = new Notification('MatMat Games', { body: title + (n.text ? '\n' + n.text : ''), icon: actor.avatar_url, tag: n.id }); no.onclick = () => { focus(); location.hash = targetHref(n); }; } catch {}
    }
  }
}
const issueNo = c => +c.issue_url.split('/').pop();

const KIND_ICON = { comment: 'chat', mention: 'chat', assign: 'user', review: 'eye', done: 'check', event: 'arrowr', idea: 'bulb', task: 'plus', upload: 'upload' };

export function noticeRow(n, { compact = false } = {}) {
  const a = S.person(n.actor);
  return `<div class="feed-item ${isUnread(n) ? 'unread' : ''}" data-href="${esc(targetHref(n))}" data-nid="${esc(n.id)}">
    ${avatarImg(a)}
    <div class="what"><div><b>${esc(a.name || a.login)}</b> <span class="muted">${esc(n.why)}</span> ${n.target ? `<span>${esc(n.target)}</span>` : ''}</div>
      ${n.text && !compact ? `<div class="snip">${esc(n.text)}</div>` : ''}</div>
    <time title="${esc(fullTime(n.time))}">${icon(KIND_ICON[n.kind] || 'info', 'faint')} ${esc(ago(n.time))}</time>
  </div>`;
}
export function bindFeed(root) {
  root.addEventListener('click', e => {
    const r = e.target.closest('.feed-item'); if (!r) return;
    markRead(r.dataset.nid); r.classList.remove('unread');
    location.hash = r.dataset.href;
  });
}

/* ---------- Inbox page ---------- */
export function renderInbox(main) {
  let tab = ls.get('inboxTab', 'you');
  const page = document.createElement('div'); page.className = 'page'; main.appendChild(page);
  const draw = () => {
    const all = notices;
    const shown = tab === 'you' ? all.filter(n => n.direct) : all;
    const unread = shown.filter(isUnread).length;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    // group by target, Linear-style
    const groups = new Map();
    for (const n of shown.slice(0, 300)) {
      const k = n.path || (n.n ? '#' + n.n : n.id);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    page.innerHTML = `<div class="page-head"><h1>Inbox</h1><div class="grow"></div>
      <div class="seg"><button data-tab="you" class="${tab === 'you' ? 'on' : ''}">For you</button><button data-tab="all" class="${tab === 'all' ? 'on' : ''}">All activity</button></div>
      ${perm === 'default' ? `<button class="btn" data-perm>${icon('bell')} Desktop alerts</button>` : ''}
      <button class="btn" data-all ${unread ? '' : 'disabled'}>${icon('check')} Mark all read</button></div>
      <p class="muted" style="margin:-8px 0 16px">${unread ? `${unread} unread.` : 'All caught up.'} GitHub also emails you about comments on things you're part of.</p>
      <div class="panel" style="padding:8px">${groups.size ? [...groups.values()].map(g => `<div style="padding:4px 0">${g.slice(0, 4).map(n => noticeRow(n)).join('')}${g.length > 4 ? `<div class="faint" style="font-size:12px;padding:0 10px 6px 42px">+${g.length - 4} more on this</div>` : ''}</div>`).join('<div class="side-sep" style="margin:4px 10px"></div>') : `<div class="empty">${icon('bell')}<div>Nothing here yet. When your friend comments, uploads, or moves your tasks, it shows up here.</div></div>`}</div>`;
  };
  page.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; ls.set('inboxTab', tab); draw(); return; }
    if (e.target.closest('[data-all]')) { markAllRead(); draw(); return; }
    if (e.target.closest('[data-perm]')) { Notification.requestPermission().then(draw); return; }
  });
  bindFeed(page);
  draw();
  const off = S.on('notices', draw), off2 = S.on('inbox', () => {});
  return () => { off(); off2(); };
}
