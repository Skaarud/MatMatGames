// Task drawer (everything about one task) and the New task / New idea dialog.
import { S, STATUSES, TYPES, PRIOS, parseChecklist } from './store.js';
import { esc, icon, ago, fullTime, avatarImg, menu, toast, toastErr, modal, el, dueLabel, isOverdue, parseDue, confirmBox, promptBox, act } from './ui.js';
import { mountThread, editor } from './comments.js';
import { enhance } from './md.js';
import { kindOf, baseName, KIND_ICON } from './files.js';
import { observe } from './thumbs.js';
import { parseQuick } from './board.js';

const st = k => STATUSES.find(s => s.key === k);
const ty = k => TYPES.find(t => t.key === k);

export function openTask(n, onClose) {
  const root = document.getElementById('drawer-root');
  root.innerHTML = '';
  const scrim = el('<div class="scrim"></div>');
  const d = el(`<aside class="drawer" role="dialog" aria-label="Task"><div class="drawer-head"></div><div class="drawer-body"></div></aside>`);
  root.append(scrim, d);
  scrim.onclick = () => onClose();
  const head = d.querySelector('.drawer-head'), body = d.querySelector('.drawer-body');
  let thread = null, editingDesc = false;

  const t0 = S.task(n);
  if (!t0) {
    body.innerHTML = '<div class="faint">Loading…</div>';
    S.gh.get(`${S.repoPath}/issues/${n}`, { accept: 'application/vnd.github.full+json' }).then(i => { S._put(i); }).catch(e => { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  if (t0?.isFile) { onClose(); location.hash = '#/file/' + encodeURIComponent(t0.meta.file); return () => {}; }

  const draw = () => {
    const t = S.task(n); if (!t) return;
    const s = st(t.status);
    head.innerHTML = `<button class="pick" data-p="status"><span class="dot" style="--c:${s.color}"></span><b>${s.label}</b>${icon('down')}</button>
      <span class="faint mono">#${t.n}</span><span class="grow"></span>
      <button class="btn ghost sm icon" data-copy title="Copy link">${icon('link')}</button>
      <a class="btn ghost sm icon" href="${esc(t.url)}" target="_blank" rel="noopener" title="Open on GitHub">${icon('expand')}</a>
      <button class="btn ghost sm icon" data-more title="More">${icon('more')}</button>
      <button class="btn ghost icon" data-close title="Close (Esc)">${icon('x')}</button>`;
    const people = t.assignees.map(a => S.person(a));
    const rev = t.reviewer ? S.person(t.reviewer) : null;
    const fileTiles = t.files.map(p => { const e = S.tree?.entries.get(p); const k = kindOf(p); return `<div class="tile" data-file="${esc(p)}"><div class="thumb ${k === 'image' ? 'checker' : ''}">${e && (k === 'image' || k === 'model') ? `<img class="hidden" data-sha="${e.sha}" data-path="${esc(p)}" data-size="${e.size}" alt="">` : ''}<svg class="ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icon(KIND_ICON[k]).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></div><div class="info"><div class="name">${esc(baseName(p))}</div><div class="sub">${e ? '' : '<span style="color:var(--danger)">missing</span>'}</div></div></div>`; }).join('');
    const keepDesc = editingDesc ? body.querySelector('[data-desc-slot]')?.firstElementChild : null;
    const keepComposer = thread?.composer;
    const keepThread = body.querySelector('[data-thread]');
    body.innerHTML = `
      <div class="t-title" contenteditable="plaintext-only" spellcheck="true" data-title>${esc(t.title)}</div>
      ${reviewBox(t)}
      <div class="props">
        <span>Assignee</span><div class="val"><button class="pick" data-p="who">${people.length ? people.map(p => avatarImg(p) + ' ' + esc(p.login)).join(', ') : '<span class="faint">Nobody, click to take it</span>'}</button></div>
        <span>Type</span><div class="val"><button class="pick" data-p="type">${t.type ? `<span class="dot" style="--c:${ty(t.type).color}"></span>${esc(ty(t.type).label)}` : '<span class="faint">None</span>'}</button></div>
        <span>Priority</span><div class="val"><button class="pick" data-p="prio">${t.prio ? `<span class="prio p${PRIOS.find(p => p.key === t.prio).rank}"><i></i><i></i><i></i></span> ${esc(PRIOS.find(p => p.key === t.prio).label)}` : '<span class="faint">Normal</span>'}</button></div>
        <span>Due</span><div class="val"><button class="pick" data-p="due" style="${isOverdue(t.due) && t.status !== 'done' ? 'color:var(--danger)' : ''}">${t.due ? icon('calendar') + ' ' + esc(dueLabel(t.due)) + ` <span class="faint">${esc(t.due)}</span>` : '<span class="faint">No date</span>'}</button></div>
        <span>Reviewer</span><div class="val"><button class="pick" data-p="reviewer">${rev ? avatarImg(rev) + ' ' + esc(rev.login) : '<span class="faint">Whoever is free</span>'}</button></div>
        <span>Labels</span><div class="val">${t.labels.map(l => `<span class="chip click" data-unlabel="${esc(l)}" title="Remove">${esc(l)} ×</span>`).join('')}<button class="btn ghost sm" data-p="label">${icon('plus')}</button></div>
        <span>Created</span><div class="val faint" style="font-size:12px">${avatarImg(S.person(t.author), 'xs')} ${esc(t.author)} · <span title="${esc(fullTime(t.created))}">${esc(ago(t.created))}</span> · updated ${esc(ago(t.updated))}</div>
      </div>
      <div><div class="section-title">Description<span class="grow"></span>${editingDesc ? '' : `<button class="btn ghost sm" data-edit-desc>${icon('edit')} Edit</button>`}</div>
        <div data-desc-slot style="margin-top:8px">${editingDesc ? '' : `<div class="md" data-desc>${descHtml(t)}</div>`}</div></div>
      <div><div class="section-title">Checklist ${t.checklist.length ? `<span class="faint">${t.done}/${t.checklist.length}</span>` : ''}<span class="grow"></span></div>
        ${t.checklist.length ? `<div class="bar" style="height:4px;border-radius:4px;background:var(--line);margin:8px 0;overflow:hidden"><i style="display:block;height:100%;width:${Math.round(t.done / t.checklist.length * 100)}%;background:var(--ok)"></i></div>` : ''}
        <div class="checklist">${t.checklist.map(c => `<label class="check ${c.done ? 'done' : ''}"><input type="checkbox" data-line="${c.line}" ${c.done ? 'checked' : ''}><span>${esc(c.text)}</span><button class="btn ghost sm icon x" data-delcheck="${c.line}" title="Remove">${icon('x')}</button></label>`).join('')}</div>
        <input class="input" data-addcheck placeholder="+ Add a step and press Enter" style="margin-top:6px"></div>
      <div><div class="section-title">Files & deliverables <span class="faint">${t.files.length || ''}</span><span class="grow"></span>
        <button class="btn sm" data-linkfile>${icon('link')} Link a file</button><button class="btn sm primary" data-deliver>${icon('upload')} Upload</button></div>
        <div class="files-grid" style="margin-top:10px">${fileTiles || '<div class="faint" style="font-size:13px;grid-column:1/-1">Upload the finished model, image or sound here when the job is done. It goes into the repo and shows up for review.</div>'}</div></div>
      <div><div class="section-title">Discussion <span class="faint">${t.comments || ''}</span></div><div data-thread style="margin-top:12px"></div><div data-composer style="margin-top:12px"></div></div>`;
    body.querySelectorAll('[data-desc]').forEach(enhance);
    body.querySelectorAll('img[data-sha]').forEach(observe);
    if (keepDesc) body.querySelector('[data-desc-slot]').appendChild(keepDesc);
    if (keepThread && thread) { body.querySelector('[data-thread]').replaceWith(keepThread); body.querySelector('[data-composer]').appendChild(keepComposer); }
    else thread = mountThread(body.querySelector('[data-thread]'), n, { events: true, composer: body.querySelector('[data-composer]') });
  };

  const descHtml = t => {
    // GitHub's html, minus the checklist (shown separately)
    if (!t.text.trim()) return '<p class="faint">No description. Click Edit to add one.</p>';
    if (!t.checklist.length) return t.html;
    const tmp = document.createElement('div'); tmp.innerHTML = t.html;
    tmp.querySelectorAll('li.task-list-item').forEach(li => li.remove());
    tmp.querySelectorAll('ul.contains-task-list').forEach(ul => { if (!ul.children.length) ul.remove(); });
    return tmp.innerHTML.trim() || '<p class="faint">Only a checklist so far.</p>';
  };

  const save = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, { kind: 'ok', ms: 1600 }); } catch (e) { toastErr(e); } };

  head.addEventListener('click', e => {
    const t = S.task(n);
    if (e.target.closest('[data-close]')) return onClose();
    if (e.target.closest('[data-copy]')) { navigator.clipboard?.writeText(location.href); return toast('Link copied', { ms: 1400 }); }
    const p = e.target.closest('[data-p="status"]');
    if (p) return menu(p, STATUSES.map(s => ({ label: s.label, value: s.key, color: s.color, checked: s.key === t.status, sub: s.desc })), v => save(() => S.updateTask(n, { status: v })));
    const m = e.target.closest('[data-more]');
    if (m) return menu(m, [
      { label: 'Park it (not now)', value: 'park', icon: 'archive' },
      { label: 'Mark done & close', value: 'done', icon: 'check' },
      { label: 'Duplicate', value: 'dup', icon: 'plus' },
      { label: 'Turn into idea', value: 'idea', icon: 'bulb' },
    ], async v => {
      if (v === 'park') return save(() => S.updateTask(n, { status: 'parked' }));
      if (v === 'done') return save(() => S.updateTask(n, { status: 'done' }));
      if (v === 'idea') return save(() => S.updateTask(n, { status: 'idea' }));
      if (v === 'dup') { try { const i = await S.createTask({ title: t.title + ' (copy)', text: t.text, status: t.status === 'done' ? 'todo' : t.status, type: t.type, prio: t.prio, labels: t.labels }); location.hash = '#/task/' + i.number; } catch (er) { toastErr(er); } }
    });
  });

  body.addEventListener('click', async e => {
    const t = S.task(n);
    const p = e.target.closest('[data-p]');
    if (p) {
      const k = p.dataset.p;
      if (k === 'who') return menu(p, S.team().map(u => ({ label: u.login, value: u.login, icon: avatarImg(u, 'xs'), checked: t.assignees.includes(u.login) })), v => {
        const set = new Set(S.task(n).assignees); set.has(v) ? set.delete(v) : set.add(v);
        save(() => S.updateTask(n, { assignees: [...set] }));
      }, { multi: true });
      if (k === 'type') return menu(p, [{ label: 'None', value: '' }, ...TYPES.map(x => ({ label: x.label, value: x.key, color: x.color }))].map(i => ({ ...i, checked: i.value === t.type })), v => save(() => S.updateTask(n, { type: v })));
      if (k === 'prio') return menu(p, PRIOS.map(x => ({ label: x.label, value: x.key, checked: x.key === t.prio })), v => save(() => S.updateTask(n, { prio: v })));
      if (k === 'reviewer') return menu(p, [{ label: 'Whoever is free', value: '' }, ...S.team().map(u => ({ label: u.login, value: u.login, icon: avatarImg(u, 'xs') }))].map(i => ({ ...i, checked: (t.reviewer || '') === i.value })), v => save(() => S.setMeta(n, { reviewer: v || undefined })));
      if (k === 'due') {
        const v = await promptBox('Due date', { value: t.due || '', placeholder: 'fri, tomorrow, 3d, 2w or 2026-11-20 (empty = none)', ok: 'Set' });
        if (v === null) return;
        const d = v.trim() ? parseDue(v) : null;
        if (v.trim() && !d) return toast('Could not read that date', { kind: 'err' });
        return save(() => S.setMeta(n, { due: d || undefined }));
      }
      if (k === 'label') {
        const v = await promptBox('Add label', { placeholder: 'e.g. troll, siege, ui' });
        if (v?.trim()) return save(() => S.updateTask(n, { labels: [...t.labels, v.trim().toLowerCase()] }));
        return;
      }
    }
    const ul = e.target.closest('[data-unlabel]'); if (ul) return save(() => S.updateTask(n, { labels: t.labels.filter(l => l !== ul.dataset.unlabel) }));
    if (e.target.closest('[data-edit-desc]')) {
      editingDesc = true;
      const slot = body.querySelector('[data-desc-slot]');
      const ed = editor({ value: t.text, placeholder: 'Describe the task. Markdown, images, checklists (- [ ] step) all work.', submitLabel: 'Save', onCancel: () => { editingDesc = false; draw(); },
        onSubmit: async v => { await S.patchBody(n, () => ({ text: v })); editingDesc = false; draw(); } });
      slot.innerHTML = ''; slot.appendChild(ed); ed.focus();
      body.querySelector('[data-edit-desc]')?.remove();
      return;
    }
    const dc = e.target.closest('[data-delcheck]');
    if (dc) { e.preventDefault(); const line = +dc.dataset.delcheck; return save(() => S.patchBody(n, ({ text }) => ({ text: text.split('\n').filter((_, i) => i !== line).join('\n') }))); }
    const f = e.target.closest('[data-file]'); if (f) { location.hash = '#/file/' + encodeURIComponent(f.dataset.file); return; }
    if (e.target.closest('[data-deliver]')) return act('upload', { dir: `${S.cfg.hubDir}/tasks/${n}-${slug(t.title)}`, task: n });
    if (e.target.closest('[data-linkfile]')) return linkFile(n);
    const rv = e.target.closest('[data-review]');
    if (rv) return reviewAction(n, rv.dataset.review);
  });
  body.addEventListener('change', e => {
    const c = e.target.closest('[data-line]'); if (!c) return;
    const line = +c.dataset.line, on = c.checked;
    c.closest('.check').classList.toggle('done', on);
    save(() => S.patchBody(n, ({ text }) => ({ text: text.split('\n').map((l, i) => i === line ? l.replace(/\[( |x|X)\]/, on ? '[x]' : '[ ]') : l).join('\n') })));
  });
  body.addEventListener('keydown', e => {
    if (e.target.matches('[data-addcheck]') && e.key === 'Enter' && e.target.value.trim()) {
      const v = e.target.value.trim(); e.target.value = '';
      save(() => S.patchBody(n, ({ text }) => ({ text: appendCheck(text, v) }))).then(() => body.querySelector('[data-addcheck]')?.focus());
    }
    if (e.target.matches('[data-title]') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  body.addEventListener('focusout', e => {
    if (!e.target.matches('[data-title]')) return;
    const v = e.target.textContent.trim(); const t = S.task(n);
    if (v && v !== t.title) save(() => S.updateTask(n, { title: v }));
    else if (!v) e.target.textContent = t.title;
  });

  draw();
  const off = S.on('issue:' + n, () => { if (!d.contains(document.activeElement) || !document.activeElement.matches('[data-title], textarea, input')) draw(); });
  const offTree = S.on('tree', draw);
  return () => { off(); offTree(); thread?.destroy(); root.innerHTML = ''; };
}

function appendCheck(text, item) {
  const lines = text.replace(/\s+$/, '').split('\n');
  const lastCheck = lines.map((l, i) => /^\s*[-*]\s+\[( |x|X)\]/.test(l) ? i : -1).filter(i => i >= 0).pop();
  if (lastCheck != null) { lines.splice(lastCheck + 1, 0, `- [ ] ${item}`); return lines.join('\n'); }
  return (text.trim() ? text.replace(/\s+$/, '') + '\n\n' : '') + `- [ ] ${item}`;
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';

function reviewBox(t) {
  const me = S.me.login;
  if (t.status === 'review') {
    const author = t.assignees[0] || t.author;
    const canApprove = author !== me || S.team().length < 2;
    return `<div class="review-box">${icon('eye')}<div class="grow"><b>Waiting for review.</b> <span class="muted">${esc(author)} says this is done${t.reviewer ? `; ${esc(t.reviewer)} is reviewing` : ''}.</span></div>
      ${canApprove ? `<button class="btn" data-review="changes">Request changes</button><button class="btn primary" data-review="approve">${icon('check')} Approve</button>` : '<span class="faint" style="font-size:12px">Your teammate gets a notice.</span>'}</div>`;
  }
  if (t.status === 'doing' && t.assignees.includes(me)) {
    return `<div class="review-box" style="border-color:var(--s-doing);background:color-mix(in srgb,var(--s-doing) 8%,transparent)">${icon('upload')}<div class="grow"><b>Finished?</b> <span class="muted">Upload the result, then hand it over.</span></div><button class="btn primary" data-review="submit">Ready for review</button></div>`;
  }
  if (t.status === 'todo' && !t.assignees.length) {
    return `<div class="review-box" style="border-color:var(--line2);background:transparent">${icon('user')}<div class="grow"><span class="muted">Nobody has this yet.</span></div><button class="btn primary" data-review="take">I'll take it</button></div>`;
  }
  return '';
}
async function reviewAction(n, kind) {
  const t = S.task(n);
  try {
    if (kind === 'take') { await S.updateTask(n, { assignees: [S.me.login], status: 'doing' }); return toast('It\'s yours', { kind: 'ok' }); }
    if (kind === 'submit') {
      const note = await promptBox('Ready for review', { placeholder: 'Anything to look at in particular? (optional)', multiline: true, ok: 'Send for review' });
      if (note === null) return;
      await S.updateTask(n, { status: 'review' });
      await S.comment(n, `🔍 **Ready for review.**${note.trim() ? '\n\n' + note.trim() : ''}${t.files.length ? '\n\nFiles: ' + t.files.map(f => '`' + f.split('/').pop() + '`').join(', ') : ''}`);
      return toast('Sent for review', { kind: 'ok' });
    }
    if (kind === 'approve') {
      const note = await promptBox('Approve', { placeholder: 'Nice! (optional note)', multiline: true, ok: 'Approve & close' });
      if (note === null) return;
      await S.comment(n, `✅ **Approved.**${note.trim() ? '\n\n' + note.trim() : ''}`);
      await S.updateTask(n, { status: 'done' });
      return toast('Approved and closed', { kind: 'ok' });
    }
    if (kind === 'changes') {
      const note = await promptBox('Request changes', { placeholder: 'What needs to change?', multiline: true, ok: 'Send back' });
      if (!note?.trim()) return;
      await S.comment(n, `🔁 **Changes requested.**\n\n${note.trim()}`);
      await S.updateTask(n, { status: 'doing' });
      return toast('Sent back to Doing', { kind: 'ok' });
    }
  } catch (e) { toastErr(e); }
}

async function linkFile(n) {
  const { pickFile } = await import('./palette.js');
  const path = await pickFile('Link a file to this task');
  if (!path) return;
  try {
    await S.patchBody(n, ({ meta }) => ({ meta: { ...meta, files: [...new Set([...(meta.files || []), path])] } }));
    toast('Linked ' + baseName(path), { kind: 'ok' });
  } catch (e) { toastErr(e); }
}

/* ---------------- New task / idea ---------------- */
export function newTaskModal({ status = 'todo', title = '', files = [] } = {}) {
  const isIdea = status === 'idea';
  const v = { status, type: '', prio: '', assignees: [], due: null };
  const body = el(`<div style="display:grid;gap:12px">
    <input class="input" data-title placeholder="${isIdea ? 'The idea in one line' : 'What needs doing?  (try: Rig the troll #art !high @me due:fri)'}" value="${esc(title)}" autofocus style="height:42px;font-size:15px">
    <div data-ed></div>
    <div class="toolbar" data-props></div>
    <label style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--fg2)"><input type="checkbox" data-more> Create another after this</label>
  </div>`);
  const ed = editor({ placeholder: isIdea ? 'Why is it fun? Sketches, references, links… (optional)' : 'Details, steps (- [ ] step), references… (optional)' });
  body.querySelector('[data-ed]').appendChild(ed);
  const props = body.querySelector('[data-props]');
  const drawProps = () => {
    props.innerHTML = `
      <button class="btn sm" data-k="status"><span class="dot" style="--c:${st(v.status).color}"></span>${st(v.status).label}</button>
      <button class="btn sm" data-k="type">${v.type ? `<span class="dot" style="--c:${ty(v.type).color}"></span>${ty(v.type).label}` : icon('tag') + ' Type'}</button>
      <button class="btn sm" data-k="prio">${icon('flag')} ${PRIOS.find(p => p.key === v.prio).label}</button>
      <button class="btn sm" data-k="who">${v.assignees.length ? v.assignees.map(a => avatarImg(S.person(a), 'xs')).join('') + ' ' + v.assignees.join(', ') : icon('user') + ' Assignee'}</button>
      <button class="btn sm" data-k="due">${icon('calendar')} ${v.due ? esc(dueLabel(v.due)) : 'Due'}</button>`;
  };
  drawProps();
  props.addEventListener('click', async e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k;
    if (k === 'status') menu(b, STATUSES.filter(s => s.key !== 'done').map(s => ({ label: s.label, value: s.key, color: s.color, checked: s.key === v.status })), x => { v.status = x; drawProps(); });
    if (k === 'type') menu(b, [{ label: 'None', value: '' }, ...TYPES.map(x => ({ label: x.label, value: x.key, color: x.color }))], x => { v.type = x; drawProps(); });
    if (k === 'prio') menu(b, PRIOS.map(x => ({ label: x.label, value: x.key, checked: x.key === v.prio })), x => { v.prio = x; drawProps(); });
    if (k === 'who') menu(b, S.team().map(u => ({ label: u.login, value: u.login, icon: avatarImg(u, 'xs'), checked: v.assignees.includes(u.login) })), x => { v.assignees = v.assignees.includes(x) ? v.assignees.filter(a => a !== x) : [...v.assignees, x]; drawProps(); }, { multi: true });
    if (k === 'due') { const s = await promptBox('Due date', { value: v.due || '', placeholder: 'fri, tomorrow, 3d, 2026-11-20', ok: 'Set' }); if (s !== null) { v.due = parseDue(s); drawProps(); } }
  });
  const foot = el(`<div style="display:flex;gap:8px;align-items:center;width:100%"><span class="faint" style="font-size:12px;flex:1">Ctrl+Enter to create</span><button class="btn" data-c>Cancel</button><button class="btn primary" data-ok>${isIdea ? 'Pitch idea' : 'Create task'}</button></div>`);
  const m = modal({ title: isIdea ? 'New idea' : 'New task', body, foot, wide: true });
  const titleIn = body.querySelector('[data-title]');
  const go = async () => {
    const q = parseQuick(titleIn.value);
    if (!q.title) { titleIn.focus(); return; }
    const okB = foot.querySelector('[data-ok]'); okB.disabled = true; okB.textContent = 'Creating…';
    try {
      const issue = await S.createTask({
        title: q.title, text: ed.value(), status: v.status, type: q.type || v.type, prio: q.prio || v.prio,
        assignees: [...new Set([...v.assignees, ...q.assignees])], meta: { due: q.due || v.due, files: files.length ? files : undefined },
      });
      toast(isIdea ? 'Idea pitched' : 'Task created', { sub: `#${issue.number} ${q.title}`, kind: 'ok', onClick: () => location.hash = '#/task/' + issue.number });
      if (body.querySelector('[data-more]').checked) { titleIn.value = ''; ed.set(''); titleIn.focus(); okB.disabled = false; okB.textContent = isIdea ? 'Pitch idea' : 'Create task'; }
      else m.close();
    } catch (e) { toastErr(e); okB.disabled = false; okB.textContent = 'Try again'; }
  };
  foot.querySelector('[data-c]').onclick = () => m.close();
  foot.querySelector('[data-ok]').onclick = go;
  m.el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } if (e.key === 'Enter' && e.target === titleIn) { e.preventDefault(); ed.focus(); } });
  return m;
}

export { confirmBox, parseChecklist };
