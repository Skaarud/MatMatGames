// Comment threads (tasks and files): replies, reactions, resolve, edit, pins, attachments, @mentions.
import { S, splitMeta, STATUSES } from './store.js';
import { esc, icon, ago, fullTime, avatarImg, menu, toastErr, confirmBox, el } from './ui.js';
import { renderMarkdown, enhance, fileMarkdown } from './md.js';
import { commitFiles } from './files.js';

export const REACTIONS = [['+1', '👍'], ['heart', '❤️'], ['hooray', '🎉'], ['laugh', '😄'], ['eyes', '👀'], ['rocket', '🚀'], ['confused', '😕'], ['-1', '👎']];

/* ---------------- editor ---------------- */
export function editor({ value = '', placeholder = 'Write a comment…  (Markdown, paste or drop images)', submitLabel = 'Comment', onSubmit, onCancel, compact = false, extraButtons = '' } = {}) {
  const e = el(`<div class="editor">
    <div class="tabs"><button type="button" class="tab on" data-tab="w">Write</button><button type="button" class="tab" data-tab="p">Preview</button><span class="grow"></span>
      <button type="button" class="btn ghost sm icon" data-attach title="Attach files">${icon('clip')}</button>
      <button type="button" class="btn ghost sm icon" data-check title="Add a checklist item">${icon('checksq')}</button></div>
    <textarea rows="${compact ? 2 : 3}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
    <div class="preview md hidden"></div>
    <div class="foot"><span class="hint">Ctrl+Enter to send · @ to mention</span><span class="grow"></span>${extraButtons}
      ${onCancel ? '<button type="button" class="btn sm" data-cancel>Cancel</button>' : ''}
      ${onSubmit ? `<button type="button" class="btn sm primary" data-send>${esc(submitLabel)}</button>` : ''}</div>
    <input type="file" multiple hidden></div>`);
  const ta = e.querySelector('textarea'), pv = e.querySelector('.preview'), fileIn = e.querySelector('input[type=file]');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(500, ta.scrollHeight + 2) + 'px'; };
  ta.addEventListener('input', grow); setTimeout(grow);
  e.querySelectorAll('[data-tab]').forEach(b => b.onclick = async () => {
    e.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    const p = b.dataset.tab === 'p';
    ta.classList.toggle('hidden', p); pv.classList.toggle('hidden', !p);
    if (p) { pv.innerHTML = '<span class="faint">Rendering…</span>'; pv.innerHTML = await renderMarkdown(ta.value); enhance(pv); }
  });
  const insert = s => { const a = ta.selectionStart, b = ta.selectionEnd; ta.setRangeText(s, a, b, 'end'); ta.focus(); grow(); ta.dispatchEvent(new Event('input')); };
  e.querySelector('[data-check]').onclick = () => insert((ta.value && !ta.value.endsWith('\n') ? '\n' : '') + '- [ ] ');
  const attach = async files => {
    files = [...files]; if (!files.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const ph = files.map(f => `⏳ uploading ${f.name}…`).join('\n');
    insert(ph + '\n');
    try {
      const changes = files.map(f => ({ path: `${S.cfg.hubDir}/attachments/${stamp}/${Date.now().toString(36)}-${f.name.replace(/[^\w.\-]+/g, '_')}`, file: f }));
      await commitFiles(changes, `Attach ${files.map(f => f.name).join(', ')} (hub)`);
      ta.value = ta.value.replace(ph, changes.map(c => fileMarkdown(c.path)).join('\n'));
      e.attached = [...(e.attached || []), ...changes.map(c => c.path)];
    } catch (er) { ta.value = ta.value.replace(ph, ''); toastErr(er, 'Upload failed'); }
    grow();
  };
  e.querySelector('[data-attach]').onclick = () => fileIn.click();
  fileIn.onchange = () => { attach(fileIn.files); fileIn.value = ''; };
  ta.addEventListener('paste', ev => { const fs = [...(ev.clipboardData?.files || [])]; if (fs.length) { ev.preventDefault(); attach(fs); } });
  e.addEventListener('dragover', ev => { if (ev.dataTransfer?.types.includes('Files')) { ev.preventDefault(); ev.stopPropagation(); e.classList.add('drag'); } });
  e.addEventListener('dragleave', () => e.classList.remove('drag'));
  e.addEventListener('drop', ev => { if (!ev.dataTransfer?.files.length) return; ev.preventDefault(); ev.stopPropagation(); e.classList.remove('drag'); attach(ev.dataTransfer.files); });
  // @mention autocomplete
  ta.addEventListener('keyup', ev => {
    if (ev.key.length > 1 && ev.key !== 'Backspace') return;
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/(^|\s)@([\w-]*)$/);
    if (!m) return;
    const people = S.team().filter(p => p.login.toLowerCase().startsWith(m[2].toLowerCase()) && p.login !== S.me.login);
    if (!people.length) return;
    menu(ta, people.map(p => ({ label: p.login, value: p.login, icon: avatarImg(p, 'xs') })), login => {
      const a = ta.selectionStart - m[2].length;
      ta.setRangeText(login + ' ', a, ta.selectionStart, 'end'); ta.focus();
    });
  });
  const send = async () => {
    if (!onSubmit || !ta.value.trim() || e.busy) return;
    e.busy = true; const b = e.querySelector('[data-send]'); if (b) { b.disabled = true; b.textContent = 'Sending…'; }
    try { await onSubmit(ta.value.trim(), e); ta.value = ''; grow(); }
    catch (er) { toastErr(er); }
    e.busy = false; if (b) { b.disabled = false; b.textContent = submitLabel; }
  };
  ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); send(); } });
  e.querySelector('[data-send]')?.addEventListener('click', send);
  e.querySelector('[data-cancel]')?.addEventListener('click', () => onCancel());
  e.value = () => ta.value;
  e.set = v => { ta.value = v; grow(); };
  e.focus = () => ta.focus();
  e.textarea = ta;
  return e;
}

/* ---------------- thread ---------------- */
/**
 * opts.pins: true to show pin badges; opts.onPinClick(comment, meta); opts.onPins(list)
 * opts.composer: element to put the composer in (defaults inside root)
 * opts.draftPin(): returns a pending pin {p,n,view} or {x,y} to attach to the next comment
 */
export function mountThread(root, n, opts = {}) {
  let events = [];
  let collapsedResolved = true;
  let attachedNum = null;
  const wrap = el('<div class="thread"></div>');
  root.appendChild(wrap);
  const composer = editor({
    placeholder: opts.placeholder || 'Write a comment…  (Markdown, paste or drop images)',
    onSubmit: async text => {
      const num = typeof n === 'function' ? await n() : n;
      const meta = {};
      const pin = opts.draftPin?.();
      if (pin) meta.pin = pin;
      await S.comment(num, text, meta);
      if (attachedNum !== +num) await attach(num);
      opts.onSent?.();
    },
  });
  (opts.composer || root).appendChild(composer);

  const draw = (list) => {
    list = list || [];
    const byId = new Map(list.map(c => [c.id, { c, ...splitMeta(c.body) }]));
    const tops = [], replies = new Map();
    for (const x of byId.values()) {
      if (x.meta.reply && byId.has(x.meta.reply)) { if (!replies.has(x.meta.reply)) replies.set(x.meta.reply, []); replies.get(x.meta.reply).push(x); }
      else tops.push(x);
    }
    // pin numbers in creation order
    let k = 0; const pins = [];
    for (const x of tops) if (x.meta.pin) { x.k = ++k; pins.push({ id: x.c.id, k, pin: x.meta.pin, resolved: !!x.meta.resolved, author: x.c.user?.login }); }
    opts.onPins?.(pins);
    const items = [...tops.map(x => ({ t: Date.parse(x.c.created_at), x })), ...events.map(ev => ({ t: Date.parse(ev.created_at), ev }))].sort((a, b) => a.t - b.t);
    const resolvedCount = tops.filter(x => x.meta.resolved).length;
    wrap.innerHTML = (items.length ? '' : `<div class="faint" style="font-size:13px">${esc(opts.emptyText || 'No comments yet.')}</div>`) +
      (resolvedCount ? `<button class="btn ghost sm" data-toggle-res style="justify-self:start">${collapsedResolved ? `Show ${resolvedCount} resolved` : 'Hide resolved'}</button>` : '') +
      items.map(it => it.ev ? eventRow(it.ev) : (it.x.meta.resolved && collapsedResolved ? '' : commentHtml(it.x, replies.get(it.x.c.id) || []))).join('');
    wrap.querySelectorAll('.md').forEach(enhance);
  };
  const commentHtml = (x, reps, isReply = false) => {
    const c = x.c, mine = c.user?.login === S.me.login;
    const r = c.reactions || {};
    return `<div class="cmt ${x.meta.resolved ? 'resolved' : ''}" data-cid="${c.id}" id="c${c.id}">
      ${avatarImg(c.user, isReply ? '' : 'lg')}
      <div class="bubble"><div class="hd"><b>${esc(c.user?.login)}</b>${x.k ? `<span class="pin-badge" data-pin="${c.id}" title="Show pin">${x.k}</span>` : ''}<span title="${esc(fullTime(c.created_at))}">${esc(ago(c.created_at))}</span>${c.updated_at !== c.created_at ? '<span>· edited</span>' : ''}${x.meta.resolved ? '<span class="chip" style="--c:var(--ok)">resolved</span>' : ''}<span class="grow"></span></div>
        <div class="md">${c.body_html || esc(x.text)}</div>
        <div class="acts">
          <div class="reacts">${REACTIONS.filter(([key]) => r[key]).map(([key, e]) => `<button class="react" data-react="${key}">${e} ${r[key]}</button>`).join('')}</div>
          <button class="btn ghost sm icon" data-react-menu title="React">☺</button>
          ${!isReply ? `<button class="btn ghost sm" data-reply>${icon('reply')} Reply</button>` : ''}
          ${!isReply ? `<button class="btn ghost sm" data-resolve>${icon('check')} ${x.meta.resolved ? 'Reopen' : 'Resolve'}</button>` : ''}
          ${mine ? `<button class="btn ghost sm icon" data-edit title="Edit">${icon('edit')}</button><button class="btn ghost sm icon danger" data-del title="Delete">${icon('trash')}</button>` : ''}
        </div>
        ${reps.length ? `<div class="replies">${reps.map(y => commentHtml(y, [], true)).join('')}</div>` : ''}
        <div data-reply-slot></div>
      </div></div>`;
  };
  const eventRow = ev => {
    let txt = '';
    if (ev.event === 'labeled' && ev.label?.name?.startsWith('status: ')) txt = `moved this to <b>${esc(STATUSES.find(s => s.name === ev.label.name)?.label || ev.label.name.slice(8))}</b>`;
    else if (ev.event === 'assigned') txt = ev.assignee?.login === ev.actor?.login ? 'took this' : `assigned <b>${esc(ev.assignee?.login)}</b>`;
    else if (ev.event === 'unassigned') txt = `unassigned <b>${esc(ev.assignee?.login)}</b>`;
    else if (ev.event === 'closed') txt = ev.state_reason === 'not_planned' ? 'parked this' : 'closed this as <b>done</b>';
    else if (ev.event === 'reopened') txt = 'reopened this';
    else if (ev.event === 'renamed') txt = `renamed this from “${esc(ev.rename?.from)}”`;
    else return '';
    return `<div class="event">${avatarImg(ev.actor, 'xs')}<span><b>${esc(ev.actor?.login)}</b> ${txt}</span><span title="${esc(fullTime(ev.created_at))}">· ${esc(ago(ev.created_at))}</span></div>`;
  };

  wrap.addEventListener('click', async e => {
    const num = typeof n === 'function' ? await n(false) : n;
    if (e.target.closest('[data-toggle-res]')) { collapsedResolved = !collapsedResolved; return draw(S.comments.get(+num)); }
    const cEl = e.target.closest('.cmt'); if (!cEl) return;
    const id = +cEl.dataset.cid;
    const c = (S.comments.get(+num) || []).find(x => x.id === id);
    try {
      const pinB = e.target.closest('[data-pin]');
      if (pinB) { opts.onPinClick?.(c, splitMeta(c.body).meta); return; }
      const rb = e.target.closest('[data-react]');
      if (rb) { await S.toggleReaction({ n: num, id }, rb.dataset.react); return; }
      const rm = e.target.closest('[data-react-menu]');
      if (rm) { menu(rm, REACTIONS.map(([k, em]) => ({ label: em + '  ' + k.replace('+1', 'thumbs up').replace('-1', 'thumbs down'), value: k })), k => S.toggleReaction({ n: num, id }, k).catch(toastErr)); return; }
      if (e.target.closest('[data-resolve]')) { await S.editComment(num, id, ({ meta }) => ({ meta: { ...meta, resolved: !meta.resolved } })); return; }
      if (e.target.closest('[data-del]')) { if (await confirmBox('Delete comment?', 'This removes it for both of you.', { ok: 'Delete', danger: true })) await S.deleteComment(num, id); return; }
      if (e.target.closest('[data-reply]')) {
        const slot = cEl.querySelector(':scope > .bubble > [data-reply-slot]');
        if (slot.firstChild) { slot.innerHTML = ''; return; }
        const ed = editor({ compact: true, placeholder: 'Reply…', submitLabel: 'Reply', onCancel: () => slot.innerHTML = '', onSubmit: async t => { await S.comment(num, t, { reply: id }); slot.innerHTML = ''; } });
        slot.appendChild(ed); ed.style.marginTop = '8px'; ed.focus();
        return;
      }
      if (e.target.closest('[data-edit]')) {
        const md = cEl.querySelector(':scope > .bubble > .md');
        const { text } = splitMeta(c.body);
        const ed = editor({ value: text, submitLabel: 'Save', onCancel: () => draw(S.comments.get(+num)), onSubmit: async t => { await S.editComment(num, id, () => ({ text: t })); } });
        md.replaceWith(ed); ed.focus();
      }
    } catch (er) { toastErr(er); }
  });

  let off = () => {};
  const attach = async num => {
    off(); attachedNum = +num;
    off = S.on('comments:' + num, list => draw(list));
    const list = S.comments.get(+num);
    if (list) draw(list); else wrap.innerHTML = '<div class="faint">Loading comments…</div>';
    try { await S.loadComments(num, { force: true }); } catch (er) { toastErr(er); }
    if (opts.events) {
      try { events = (await S.gh.get(`${S.repoPath}/issues/${num}/events?per_page=100`)).filter(ev => ['labeled', 'assigned', 'unassigned', 'closed', 'reopened', 'renamed'].includes(ev.event) && !(ev.event === 'labeled' && !ev.label?.name?.startsWith('status: '))); draw(S.comments.get(+num)); } catch {}
    }
  };
  const init = typeof n === 'function' ? n(false) : n;
  Promise.resolve(init).then(num => num ? attach(num) : draw([]));
  return {
    composer,
    attach,
    flash(id) { const c = wrap.querySelector('#c' + id); if (c) { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.classList.remove('new-flash'); void c.offsetWidth; c.classList.add('new-flash'); } },
    destroy() { off(); },
  };
}
