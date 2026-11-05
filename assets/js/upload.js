// Upload dialog: drop files or whole folders, pick a destination, one commit, optional link to a task.
import { S } from './store.js';
import { esc, icon, bytes, modal, el, toast, toastErr, menu } from './ui.js';
import { commitFiles, baseName, dirName } from './files.js';
import { fileMarkdown } from './md.js';

export async function filesFromDrop(dt) {
  const out = [];
  const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return [...dt.files].map(f => ({ file: f, rel: f.name }));
  const walk = async (entry, prefix) => {
    if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file: f, rel: prefix + f.name }); }
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const e of batch) await walk(e, prefix + entry.name + '/'); } while (batch.length);
    }
  };
  for (const e of items) await walk(e, '');
  return out.filter(x => !/(^|\/)\.(DS_Store|git)/.test(x.rel) && !/Thumbs\.db$/.test(x.rel));
}

/**
 * opts.dir: default destination folder; opts.task: issue number to attach to;
 * opts.replace: exact path to overwrite (new version); opts.files: pre-dropped [{file, rel}]
 */
export function uploadModal({ dir, task, replace, files = [] } = {}) {
  let list = [...files];
  let dest = replace ? replace.split('/').slice(0, -1).join('/') : (dir || `${S.cfg.hubDir}/inbox`);
  const tTask = task ? S.task(task) : null;
  const body = el(`<div style="display:grid;gap:12px">
    ${replace ? `<div class="muted">Upload a new version of <b class="mono">${esc(replace)}</b>. The old one stays in the history, so you can compare.</div>` : ''}
    <div class="dropzone" data-dz>${icon('upload')}<div style="margin-top:6px"><b>Drop files or folders here</b> or click to choose</div><div class="faint" style="font-size:12px;margin-top:4px">Models (.glb .fbx .obj), images, audio, anything up to 100 MB each</div></div>
    <input type="file" ${replace ? '' : 'multiple'} hidden data-in>
    <div class="upl-list" data-list></div>
    ${replace ? '' : `<label class="field">Put them in<div style="display:flex;gap:6px"><input class="input mono" data-dest value="${esc(dest)}"><button class="btn" data-browse type="button">${icon('folder')} Browse</button></div></label>`}
    <label class="field">What is this? (commit message)<input class="input" data-msg placeholder="${replace ? 'e.g. Troll: fixed the arm weights' : 'e.g. Goblin v2 with LODs'}"></label>
    ${tTask ? `<div class="chip" style="--c:var(--s-doing);justify-self:start">${icon('link')} Will be attached to #${tTask.n} ${esc(tTask.title)}</div>` : ''}
    ${tTask && tTask.status === 'doing' ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" data-toreview checked> Move the task to Review when done</label>` : ''}
  </div>`);
  const foot = el(`<div style="display:flex;gap:8px;align-items:center;width:100%"><span class="faint" data-sum style="flex:1;font-size:12px"></span><button class="btn" data-c>Cancel</button><button class="btn primary" data-go disabled>${icon('upload')} Upload</button></div>`);
  const m = modal({ title: replace ? 'New version' : 'Upload files', body, foot, wide: true });
  void dest;
  const dz = body.querySelector('[data-dz]'), inp = body.querySelector('[data-in]'), L = body.querySelector('[data-list]');
  const destIn = body.querySelector('[data-dest]');
  const target = x => replace || ((destIn?.value.trim().replace(/^\/+|\/+$/g, '') || '') + '/' + x.rel).replace(/^\//, '');
  const draw = () => {
    L.innerHTML = list.map((x, i) => {
      const p = target(x); const exists = S.tree?.entries.has(p);
      const big = x.file.size > 100 * 1048576, warn = x.file.size > 50 * 1048576;
      return `<div class="upl ${big ? 'err' : ''}" data-i="${i}"><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p)}</span>
        <span class="faint">${bytes(x.file.size)} ${exists ? '<span style="color:var(--warn)">· replaces existing</span>' : ''}${big ? ' <span style="color:var(--danger)">· too big</span>' : warn ? ' · large' : ''} ${x.state ? '· ' + esc(x.state) : `<button class="btn ghost sm icon" data-rm="${i}">${icon('x')}</button>`}</span>
        ${x.prog != null ? `<div class="progress"><i style="width:${x.prog * 100}%"></i></div>` : ''}</div>`;
    }).join('');
    const total = list.reduce((a, x) => a + x.file.size, 0);
    foot.querySelector('[data-sum]').textContent = list.length ? `${list.length} file${list.length > 1 ? 's' : ''}, ${bytes(total)}` : '';
    foot.querySelector('[data-go]').disabled = !list.length || list.some(x => x.file.size > 100 * 1048576);
  };
  const add = xs => { list = replace ? xs.slice(0, 1) : [...list, ...xs]; draw(); };
  dz.onclick = () => inp.click();
  inp.onchange = () => { add([...inp.files].map(f => ({ file: f, rel: f.name }))); inp.value = ''; };
  dz.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); dz.classList.add('on'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('on'));
  dz.addEventListener('drop', async e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('on'); add(await filesFromDrop(e.dataTransfer)); });
  L.addEventListener('click', e => { const r = e.target.closest('[data-rm]'); if (r) { list.splice(+r.dataset.rm, 1); draw(); } });
  destIn?.addEventListener('input', draw);
  body.querySelector('[data-browse]')?.addEventListener('click', e => {
    const dirs = new Set();
    for (const p of S.tree.entries.keys()) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
    const top = [...dirs].filter(d => !/^(Content|Source|Intermediate|Binaries|Saved|\.git)/.test(d)).sort();
    menu(e.currentTarget, [`${S.cfg.hubDir}/inbox`, ...top].map(d => ({ label: d, value: d, icon: 'folder' })), v => { destIn.value = v; draw(); }, { search: true, width: 360 });
  });
  foot.querySelector('[data-c]').onclick = () => m.close();
  foot.querySelector('[data-go]').onclick = async () => {
    const go = foot.querySelector('[data-go]'); go.disabled = true; go.textContent = 'Uploading…';
    const msgIn = body.querySelector('[data-msg]').value.trim();
    const changes = list.map(x => ({ path: target(x), file: x.file }));
    const msg = (msgIn || (replace ? `New version of ${baseName(replace)}` : `Upload ${changes.length === 1 ? baseName(changes[0].path) : changes.length + ' files'}`)) + (tTask ? ` (#${tTask.n})` : '') + '\n\nUploaded from the MatMat Games hub by @' + S.me.login;
    try {
      await commitFiles(changes, msg, { onFile: (i, phase, frac) => { list[i].state = phase === 'done' ? 'sent' : phase === 'upload' ? 'uploading' : 'reading'; list[i].prog = frac; draw(); } });
      list.forEach(x => { x.state = 'committed'; x.prog = 1; }); draw();
      if (tTask) {
        const paths = changes.map(c => c.path);
        await S.patchBody(tTask.n, ({ meta }) => ({ meta: { ...meta, files: [...new Set([...(meta.files || []), ...paths])] } }));
        await S.comment(tTask.n, `📦 Uploaded ${paths.length} file${paths.length > 1 ? 's' : ''}${msgIn ? ': ' + msgIn : ''}\n\n${paths.map(fileMarkdown).join('\n')}`, { files: paths });
        if (body.querySelector('[data-toreview]')?.checked) await S.updateTask(tTask.n, { status: 'review' });
      }
      toast(`Uploaded ${changes.length} file${changes.length > 1 ? 's' : ''}`, { kind: 'ok', sub: changes.length === 1 ? 'Click to open it' : dirName(changes[0].path), onClick: () => { location.hash = changes.length === 1 ? '#/file/' + encodeURIComponent(changes[0].path) : '#/files/' + encodeURIComponent(dirName(changes[0].path)); } });
      m.close();
      if (replace) window.dispatchEvent(new CustomEvent('mmg:replaced', { detail: replace }));
    } catch (e) { toastErr(e, 'Upload failed'); go.disabled = false; go.textContent = 'Try again'; }
  };
  draw();
  return m;
}
