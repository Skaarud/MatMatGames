// App state + GitHub sync. Tasks and ideas are GitHub Issues; files live in the repo tree.
import { GH, GHError } from './gh.js';
import { store as ls } from './ui.js';

export const STATUSES = [
  { key: 'idea', label: 'Ideas', name: 'status: idea', color: 'var(--s-idea)', hex: 'a371f7', desc: 'Not decided yet' },
  { key: 'todo', label: 'To do', name: 'status: todo', color: 'var(--s-todo)', hex: '8b949e', desc: 'Agreed, waiting for someone' },
  { key: 'doing', label: 'Doing', name: 'status: doing', color: 'var(--s-doing)', hex: '2f81f7', desc: 'Someone is on it' },
  { key: 'review', label: 'Review', name: 'status: review', color: 'var(--s-review)', hex: 'd29922', desc: 'Done, needs a look' },
  { key: 'done', label: 'Done', name: null, color: 'var(--s-done)', hex: '3fb950', desc: 'Approved and closed' },
  { key: 'parked', label: 'Parked', name: 'status: parked', color: 'var(--s-parked)', hex: '6e7681', desc: 'Not now, maybe later' },
];
export const TYPES = [
  { key: 'art', label: 'Art / model', color: 'var(--t-art)', hex: 'f778ba' },
  { key: 'code', label: 'Code', color: 'var(--t-code)', hex: '58a6ff' },
  { key: 'design', label: 'Design', color: 'var(--t-design)', hex: 'a371f7' },
  { key: 'level', label: 'Level', color: 'var(--t-level)', hex: '56d364' },
  { key: 'audio', label: 'Audio', color: 'var(--t-audio)', hex: 'e3b341' },
  { key: 'writing', label: 'Writing', color: 'var(--t-writing)', hex: 'f0883e' },
  { key: 'bug', label: 'Bug', color: 'var(--t-bug)', hex: 'f85149' },
];
export const PRIOS = [
  { key: 'urgent', label: 'Urgent', rank: 1, hex: 'f85149' },
  { key: 'high', label: 'High', rank: 2, hex: 'db6d28' },
  { key: '', label: 'Normal', rank: 3 },
  { key: 'low', label: 'Low', rank: 4, hex: '8b949e' },
];
export const FILE_LABEL = 'hub: file';
const META_RE = /\s*<!--\s*hub:(\{[\s\S]*?\})\s*-->\s*$/;

export function splitMeta(body) {
  body = body || '';
  const m = body.match(META_RE);
  if (!m) return { text: body, meta: {} };
  let meta = {};
  try { meta = JSON.parse(m[1]); } catch {}
  return { text: body.slice(0, m.index), meta };
}
export function joinMeta(text, meta) {
  const clean = Object.fromEntries(Object.entries(meta || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
  text = (text || '').replace(/\s+$/, '');
  return Object.keys(clean).length ? `${text}\n\n<!-- hub:${JSON.stringify(clean)} -->` : text;
}
export function parseChecklist(text) {
  const out = [];
  (text || '').split('\n').forEach((line, i) => {
    const m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) out.push({ line: i, done: m[1] !== ' ', text: m[2] });
  });
  return out;
}

class Emitter {
  constructor() { this.m = new Map(); }
  on(e, f) { if (!this.m.has(e)) this.m.set(e, new Set()); this.m.get(e).add(f); return () => this.m.get(e)?.delete(f); }
  emit(e, d) { this.m.get(e)?.forEach(f => { try { f(d); } catch (err) { console.error(err); } }); this.m.get('*')?.forEach(f => f(e, d)); }
}

export const DEFAULT_CFG = { owner: 'Skaarud', repo: 'MatMatGame', branch: 'main', hubDir: 'hub' };

class Store extends Emitter {
  constructor() {
    super();
    this.cfg = { ...DEFAULT_CFG, ...ls.get('cfg', {}) };
    this.gh = null;
    this.me = null;
    this.people = new Map();
    this.issues = new Map();
    this.comments = new Map();     // issue number -> [comments] (full thread, loaded on demand)
    this.recent = new Map();       // comment id -> comment (repo-wide recent, for notices)
    this.events = [];              // issue events
    this.commits = [];             // recent commits
    this.tree = null;              // { sha, entries: Map(path -> entry) }
    this.head = null;
    this.perm = null;
    this.ready = false;
    this.syncState = 'idle';
    this.lastSync = null;
    this._timer = null;
  }

  get repoPath() { return `/repos/${this.cfg.owner}/${this.cfg.repo}`; }
  get webRepo() { return `https://github.com/${this.cfg.owner}/${this.cfg.repo}`; }

  setCfg(c) { this.cfg = { ...this.cfg, ...c }; ls.set('cfg', this.cfg); }

  /** Validate a token and load everything. */
  async login(token) {
    const gh = new GH(token);
    const me = await gh.get('/user');
    let repo;
    try { repo = await gh.get(this.repoPath); }
    catch (e) {
      if (e.status === 404) throw new GHError(404, `Logged in as ${me.login}, but this token can't see ${this.cfg.owner}/${this.cfg.repo}. Ask for collaborator access, or give the token the "repo" scope.`);
      throw e;
    }
    this.gh = gh;
    this.me = me;
    this.perm = repo.permissions || {};
    this.repoInfo = repo;
    if (!this.cfg.branch || this.cfg.branch === 'main') this.cfg.branch = repo.default_branch || 'main';
    this.people.set(me.login, me);
    ls.set('token', token);
    gh.onActivity(n => this._setSync(n > 0 ? 'busy' : (this.syncState === 'err' ? 'err' : 'ok')));
    return me;
  }
  logout() { ls.del('token'); this.stop(); location.hash = ''; location.reload(); }

  _setSync(s) { if (s !== this.syncState) { this.syncState = s; this.emit('sync', s); } }

  async boot() {
    const jobs = [
      this.loadIssues(true),
      this.loadTree(),
      this.loadPeople(),
      this.loadRecent(true),
      this.loadEvents(),
      this.loadCommits(),
    ];
    const results = await Promise.allSettled(jobs);
    results.forEach(r => r.status === 'rejected' && console.warn(r.reason));
    if (results[0].status === 'rejected') throw results[0].reason;
    this.ensureLabels().catch(e => console.warn('labels', e));
    this.ready = true;
    this.lastSync = new Date();
    this.emit('ready');
    this.start();
  }

  start() {
    this.stop();
    const tick = async () => {
      const visible = document.visibilityState === 'visible';
      try { await this.sync(); this._setSync('ok'); }
      catch (e) { console.warn('sync', e); this._setSync('err'); }
      this._timer = setTimeout(tick, visible ? 15000 : 60000);
    };
    this._timer = setTimeout(tick, 15000);
    this._vis = () => { if (document.visibilityState === 'visible') { clearTimeout(this._timer); tick(); } };
    document.addEventListener('visibilitychange', this._vis);
  }
  stop() { clearTimeout(this._timer); if (this._vis) document.removeEventListener('visibilitychange', this._vis); }

  async sync() {
    // overlap a little with the last successful sync, so a sleeping laptop never misses anything
    const since = new Date(Math.min(Date.now() - 10 * 60 * 1000, (this.lastSync?.getTime() || Date.now()) - 2 * 60 * 1000)).toISOString();
    await Promise.all([
      this.loadIssues(false, since),
      this.loadRecent(false),
      this.loadEvents(),
      this.checkHead(),
    ]);
    this.lastSync = new Date();
    this.emit('synced');
  }

  /* ---------------- issues ---------------- */
  async loadIssues(full, since) {
    const accept = 'application/vnd.github.full+json';
    let list;
    if (full) list = await this.gh.all(`${this.repoPath}/issues?state=all&sort=updated&direction=desc`, { accept });
    else list = await this.gh.get(`${this.repoPath}/issues?state=all&sort=updated&direction=desc&per_page=100&since=${since}`, { accept });
    const changed = [];
    for (const it of list) {
      if (it.pull_request) continue;
      const prev = this.issues.get(it.number);
      if (!prev || prev.updated_at !== it.updated_at || prev.body !== it.body) {
        this.issues.set(it.number, it);
        changed.push(it.number);
      }
      for (const u of [it.user, ...(it.assignees || [])]) if (u && !this.people.has(u.login)) this.people.set(u.login, u);
    }
    if (full || changed.length) this.emit('issues', changed);
    changed.forEach(n => this.emit('issue:' + n));
    return changed;
  }
  _put(issue) {
    this.issues.set(issue.number, issue);
    this.emit('issues', [issue.number]);
    this.emit('issue:' + issue.number);
    return issue;
  }

  task(n) { const i = typeof n === 'object' ? n : this.issues.get(+n); return i ? toTask(i) : null; }
  tasks({ files = false } = {}) {
    return [...this.issues.values()].map(toTask).filter(t => files ? t.isFile : !t.isFile);
  }
  fileThread(path) {
    for (const i of this.issues.values()) {
      if (i.labels?.some(l => (l.name || l) === FILE_LABEL)) { const t = toTask(i); if (t.meta.file === path) return t; }
    }
    return null;
  }
  tasksForFile(path) {
    return this.tasks().filter(t => (t.meta.files || []).includes(path));
  }

  labelsFor({ status, type, prio, keep = [] }) {
    const labs = keep.filter(l => !/^(status|type|prio): /.test(l) && l !== FILE_LABEL);
    const st = STATUSES.find(s => s.key === status);
    if (st?.name) labs.push(st.name);
    if (type) labs.push('type: ' + type);
    if (prio) labs.push('prio: ' + prio);
    return labs;
  }

  async createTask({ title, text = '', status = 'todo', type = '', prio = '', assignees = [], labels = [], meta = {} }) {
    const t = this.tasks().filter(x => x.status === status);
    const order = t.length ? Math.min(...t.map(x => x.order)) - 1000 : 1000;
    const body = joinMeta(text, { ...meta, order });
    const issue = await this.gh.post(`${this.repoPath}/issues`, {
      title, body, assignees, labels: this.labelsFor({ status, type, prio, keep: labels }),
    }, { accept: 'application/vnd.github.full+json' });
    return this._put(issue);
  }

  /** Change status/type/prio/assignees/title in one PATCH. */
  async updateTask(n, ch) {
    const cur = this.task(n);
    const status = ch.status ?? cur.status;
    const patch = {};
    if (ch.title !== undefined) patch.title = ch.title;
    if (ch.assignees !== undefined) patch.assignees = ch.assignees;
    if (ch.status !== undefined || ch.type !== undefined || ch.prio !== undefined || ch.labels !== undefined) {
      patch.labels = this.labelsFor({ status, type: ch.type ?? cur.type, prio: ch.prio ?? cur.prio, keep: ch.labels ?? cur.labels });
      if (cur.isFile) patch.labels.push(FILE_LABEL);
    }
    if (ch.status !== undefined) {
      if (status === 'done') { patch.state = 'closed'; patch.state_reason = 'completed'; }
      else if (cur.state === 'closed') { patch.state = 'open'; }
    }
    // optimistic
    const prev = this.issues.get(+n);
    const opt = { ...prev, title: patch.title ?? prev.title, state: patch.state ?? prev.state, updated_at: new Date().toISOString() };
    if (patch.labels) opt.labels = patch.labels.map(name => ({ name }));
    if (patch.assignees) opt.assignees = patch.assignees.map(l => this.people.get(l) || { login: l });
    this._put(opt);
    try {
      const issue = await this.gh.patch(`${this.repoPath}/issues/${n}`, patch, { accept: 'application/vnd.github.full+json' });
      return this._put(issue);
    } catch (e) { this._put(prev); throw e; }
  }

  /** Read-modify-write on the body with a fresh copy so we never clobber the other person's edit. */
  async patchBody(n, fn) {
    const fresh = await this.gh.get(`${this.repoPath}/issues/${n}`, { accept: 'application/vnd.github.full+json', etag: false });
    const { text, meta } = splitMeta(fresh.body);
    const r = fn({ text, meta: { ...meta } }) || {};
    const body = joinMeta(r.text ?? text, r.meta ?? meta);
    if (body === fresh.body) return this._put(fresh);
    const prev = this.issues.get(+n);
    this._put({ ...fresh, body });
    try {
      const issue = await this.gh.patch(`${this.repoPath}/issues/${n}`, { body }, { accept: 'application/vnd.github.full+json' });
      return this._put(issue);
    } catch (e) { this._put(prev); throw e; }
  }
  setMeta(n, patch) { return this.patchBody(n, ({ meta }) => ({ meta: { ...meta, ...patch } })); }

  /** Move a card to a status at a position (order value between neighbours). */
  async move(n, status, order) {
    const cur = this.task(n);
    const jobs = [];
    // optimistic order
    const prev = this.issues.get(+n);
    const { text, meta } = splitMeta(prev.body);
    this.issues.set(+n, { ...prev, body: joinMeta(text, { ...meta, order }) });
    if (status !== cur.status) jobs.push(this.updateTask(n, { status }));
    else this.emit('issues', [+n]);
    jobs.push(this.setMeta(n, { order }));
    await Promise.all(jobs);
  }

  async ensureLabels() {
    if (!this.perm?.push) return;
    const have = new Set((await this.gh.all(`${this.repoPath}/labels`)).map(l => l.name));
    const want = [
      ...STATUSES.filter(s => s.name).map(s => ({ name: s.name, color: s.hex, description: s.desc })),
      ...TYPES.map(t => ({ name: 'type: ' + t.key, color: t.hex, description: t.label })),
      ...PRIOS.filter(p => p.key).map(p => ({ name: 'prio: ' + p.key, color: p.hex, description: p.label + ' priority' })),
      { name: FILE_LABEL, color: '0e8a16', description: 'Comment thread for a file in the hub' },
    ];
    for (const l of want) if (!have.has(l.name)) await this.gh.post(`${this.repoPath}/labels`, l).catch(() => {});
  }

  /* ---------------- comments ---------------- */
  async loadComments(n, { force = false } = {}) {
    const list = await this.gh.all(`${this.repoPath}/issues/${n}/comments`, { accept: 'application/vnd.github.full+json' });
    const prev = this.comments.get(+n);
    this.comments.set(+n, list);
    list.forEach(c => { this.recent.set(c.id, c); if (c.user && !this.people.has(c.user.login)) this.people.set(c.user.login, c.user); });
    const sig = l => (l || []).map(c => c.id + c.updated_at).join();
    if (force || sig(prev) !== sig(list)) this.emit('comments:' + n, list);
    return list;
  }
  async loadRecent(first) {
    const since = new Date(first ? Date.now() - 30 * 86400000 : Math.min(Date.now() - 86400000, (this.lastSync?.getTime() || Date.now()) - 120000)).toISOString();
    const list = await this.gh.all(`${this.repoPath}/issues/comments?sort=updated&direction=desc&since=${since}`, { accept: 'application/vnd.github.full+json', max: first ? 5 : 1 });
    const touched = new Set();
    for (const c of list) {
      const p = this.recent.get(c.id);
      if (!p || p.updated_at !== c.updated_at) { this.recent.set(c.id, c); touched.add(+c.issue_url.split('/').pop()); }
      if (c.user && !this.people.has(c.user.login)) this.people.set(c.user.login, c.user);
    }
    if (touched.size || first) this.emit('recent', [...touched]);
    // keep open threads fresh
    for (const n of touched) if (this.comments.has(n)) this.loadComments(n).catch(() => {});
  }
  async comment(n, text, meta = {}) {
    const c = await this.gh.post(`${this.repoPath}/issues/${n}/comments`, { body: joinMeta(text, meta) }, { accept: 'application/vnd.github.full+json' });
    const list = [...(this.comments.get(+n) || []), c];
    this.comments.set(+n, list); this.recent.set(c.id, c);
    this.emit('comments:' + n, list); this.emit('recent', [+n]);
    return c;
  }
  async editComment(n, id, fn) {
    const fresh = await this.gh.get(`${this.repoPath}/issues/comments/${id}`, { etag: false });
    const { text, meta } = splitMeta(fresh.body);
    const r = fn({ text, meta: { ...meta } }) || {};
    const c = await this.gh.patch(`${this.repoPath}/issues/comments/${id}`, { body: joinMeta(r.text ?? text, r.meta ?? meta) }, { accept: 'application/vnd.github.full+json' });
    const list = (this.comments.get(+n) || []).map(x => x.id === id ? c : x);
    this.comments.set(+n, list); this.recent.set(c.id, c);
    this.emit('comments:' + n, list);
    return c;
  }
  async deleteComment(n, id) {
    await this.gh.del(`${this.repoPath}/issues/comments/${id}`);
    const list = (this.comments.get(+n) || []).filter(x => x.id !== id);
    this.comments.set(+n, list); this.recent.delete(id);
    this.emit('comments:' + n, list);
  }

  /** Toggle a reaction on an issue (target = {n}) or a comment (target = {n, id}). */
  async toggleReaction(target, content) {
    const base = target.id ? `${this.repoPath}/issues/comments/${target.id}/reactions` : `${this.repoPath}/issues/${target.n}/reactions`;
    const list = await this.gh.get(base + '?per_page=100', { etag: false });
    const mine = list.find(r => r.user?.login === this.me.login && r.content === content);
    if (mine) await this.gh.del(`${base}/${mine.id}`);
    else await this.gh.post(base, { content });
    // exclusive votes on ideas: +1 and -1 cancel each other
    if (!mine && !target.id && (content === '+1' || content === '-1')) {
      const other = list.find(r => r.user?.login === this.me.login && r.content === (content === '+1' ? '-1' : '+1'));
      if (other) await this.gh.del(`${base}/${other.id}`);
    }
    if (target.id) await this.loadComments(target.n, { force: true });
    else {
      const issue = await this.gh.get(`${this.repoPath}/issues/${target.n}`, { accept: 'application/vnd.github.full+json', etag: false });
      this._put(issue);
    }
    return !mine;
  }
  async reactions(n) {
    return this.gh.get(`${this.repoPath}/issues/${n}/reactions?per_page=100`);
  }
  /** Who voted 👍/👎 on which ideas. Cached; re-fetched only when an issue's reaction totals change. */
  async loadVotes(ns) {
    this.votes ??= new Map();
    const jobs = ns.filter(n => {
      const i = this.issues.get(n); const sig = JSON.stringify(i?.reactions || {});
      return this.votes.get(n)?.sig !== sig;
    }).map(async n => {
      const i = this.issues.get(n); const sig = JSON.stringify(i?.reactions || {});
      try {
        const list = await this.reactions(n);
        const up = list.filter(r => r.content === '+1').map(r => r.user.login);
        const down = list.filter(r => r.content === '-1').map(r => r.user.login);
        this.votes.set(n, { sig, up, down, mine: up.includes(this.me.login) ? 'up' : down.includes(this.me.login) ? 'down' : null });
      } catch {}
    });
    if (jobs.length) { await Promise.all(jobs); this.emit('votes'); }
  }

  /** Get (or create) the comment thread for a file. */
  async ensureFileThread(path) {
    let t = this.fileThread(path);
    if (t) return t.n;
    const name = path.split('/').pop();
    const issue = await this.gh.post(`${this.repoPath}/issues`, {
      title: `💬 ${name}`,
      body: joinMeta(`Review thread for \`${path}\`, made by the MatMat Games hub.`, { file: path }),
      labels: [FILE_LABEL],
    }, { accept: 'application/vnd.github.full+json' });
    this._put(issue);
    return issue.number;
  }

  /* ---------------- people / events ---------------- */
  async loadPeople() {
    try {
      const list = await this.gh.all(`${this.repoPath}/collaborators`);
      list.forEach(u => this.people.set(u.login, { ...this.people.get(u.login), ...u }));
      this.collaborators = list.map(u => u.login);
    } catch { this.collaborators = [this.me.login]; }
    this.emit('people');
  }
  person(login) { return this.people.get(login) || { login, avatar_url: `https://github.com/${login}.png?size=64` }; }
  team() { const s = new Set([...(this.collaborators || []), this.me.login]); return [...s].map(l => this.person(l)); }

  async loadEvents() {
    const { data, notModified } = await this.gh.req('GET', `${this.repoPath}/issues/events?per_page=100`);
    if (notModified && this.events.length) return;
    this.events = data;
    this.emit('events');
  }
  async loadCommits() {
    const { data, notModified } = await this.gh.req('GET', `${this.repoPath}/commits?sha=${this.cfg.branch}&per_page=30`);
    if (notModified && this.commits.length) return;
    this.commits = data;
    data.forEach(c => c.author && !this.people.has(c.author.login) && this.people.set(c.author.login, c.author));
    this.emit('commits');
  }

  /* ---------------- tree ---------------- */
  async checkHead() {
    const { data } = await this.gh.req('GET', `${this.repoPath}/git/ref/heads/${encodeURIComponent(this.cfg.branch)}`);
    if (data?.object?.sha && data.object.sha !== this.head) {
      const first = !this.head;
      this.head = data.object.sha;
      if (!first || !this.tree) { await this.loadTree(this.head); await this.loadCommits(); }
    }
  }
  async loadTree(sha) {
    if (!sha) {
      const ref = await this.gh.get(`${this.repoPath}/git/ref/heads/${encodeURIComponent(this.cfg.branch)}`);
      sha = ref.object.sha;
    }
    this.head = sha;
    const commit = await this.gh.get(`${this.repoPath}/git/commits/${sha}`);
    const t = await this.gh.get(`${this.repoPath}/git/trees/${commit.tree.sha}?recursive=1`);
    const entries = new Map();
    for (const e of t.tree) entries.set(e.path, e);
    this.tree = { sha, treeSha: commit.tree.sha, entries, truncated: t.truncated };
    this.emit('tree');
    return this.tree;
  }
}

export function toTask(issue) {
  const names = (issue.labels || []).map(l => l.name || l);
  const { text, meta } = splitMeta(issue.body);
  let status = 'todo';
  if (issue.state === 'closed') status = issue.state_reason === 'not_planned' ? 'parked' : 'done';
  else {
    const s = STATUSES.find(s => s.name && names.includes(s.name));
    if (s) status = s.key;
  }
  if (names.includes('status: parked')) status = 'parked';
  const type = (names.find(n => n.startsWith('type: ')) || '').slice(6);
  const prio = (names.find(n => n.startsWith('prio: ')) || '').slice(6);
  const checklist = parseChecklist(text);
  const r = issue.reactions || {};
  return {
    n: issue.number, issue, title: issue.title, text, meta, html: issue.body_html || '',
    status, type, prio, prioRank: PRIOS.find(p => p.key === prio)?.rank ?? 3,
    labels: names.filter(n => !/^(status|type|prio): /.test(n) && n !== FILE_LABEL),
    isFile: names.includes(FILE_LABEL),
    assignees: (issue.assignees || []).map(a => a.login),
    author: issue.user?.login, state: issue.state,
    created: issue.created_at, updated: issue.updated_at, closed: issue.closed_at,
    comments: issue.comments || 0,
    up: r['+1'] || 0, down: r['-1'] || 0, hearts: r.heart || 0,
    checklist, done: checklist.filter(c => c.done).length,
    order: meta.order ?? -Date.parse(issue.created_at) / 1000,
    due: meta.due || null, files: meta.files || [], reviewer: meta.reviewer || null,
    url: issue.html_url,
  };
}

export const S = new Store();
window.__S = S; // handy for debugging in the console
