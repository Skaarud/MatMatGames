// Files in the repo: kinds, cached blob downloads, multi-file commits, history.
import { S } from './store.js';
import { b64FromBuffer } from './gh.js';

export const KINDS = {
  model: ['glb', 'gltf', 'fbx', 'obj'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'],
  audio: ['wav', 'ogg', 'mp3', 'flac', 'm4a'],
  video: ['mp4', 'webm', 'mov'],
  text: ['md', 'txt', 'json', 'py', 'sh', 'cpp', 'h', 'cs', 'gd', 'ini', 'cfg', 'yml', 'yaml', 'csv', 'js', 'css', 'html', 'xml', 'uproject', 'tscn'],
};
const EXT2KIND = {};
for (const [k, l] of Object.entries(KINDS)) l.forEach(e => EXT2KIND[e] = k);
export const ext = p => (p.split('/').pop().match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
export const kindOf = p => EXT2KIND[ext(p)] || 'other';
export const baseName = p => p.split('/').pop();
export const dirName = p => p.split('/').slice(0, -1).join('/');
export const KIND_ICON = { model: 'cube', image: 'image', audio: 'audio', video: 'video', text: 'doc', other: 'file' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', wav: 'audio/wav', ogg: 'audio/ogg', mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', glb: 'model/gltf-binary', gltf: 'model/gltf+json' };
export const mimeOf = p => MIME[ext(p)] || 'application/octet-stream';

/** Hidden by default in the browser: engine internals nobody can preview. */
export const HIDE_DIRS = ['.git', 'Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', '.godot', 'node_modules'];

/* ---------- blob cache (Cache Storage, keyed by git sha = immutable) ---------- */
const mem = new Map();
let cachePromise = null;
const cache = () => (cachePromise ??= (self.caches ? caches.open('mmg-blobs-v1').catch(() => null) : Promise.resolve(null)));

export async function getBlob(sha, { onProgress } = {}) {
  if (mem.has(sha)) return mem.get(sha);
  const p = (async () => {
    const c = await cache();
    const key = new Request(location.origin + '/__blob/' + sha);
    if (c) { const hit = await c.match(key); if (hit) return hit.arrayBuffer(); }
    onProgress?.(0.05);
    const buf = await S.gh.blob(S.cfg.owner, S.cfg.repo, sha);
    onProgress?.(1);
    if (c && buf.byteLength < 120e6) c.put(key, new Response(buf.slice(0))).catch(() => {});
    return buf;
  })();
  mem.set(sha, p);
  p.catch(() => mem.delete(sha));
  // keep the in-memory map small
  if (mem.size > 40) mem.delete(mem.keys().next().value);
  return p;
}
export async function getFile(path, ref) {
  if (!ref) {
    const e = S.tree?.entries.get(path);
    if (!e) throw new Error('File not found: ' + path);
    return { buf: await getBlob(e.sha), sha: e.sha, size: e.size };
  }
  const meta = await S.gh.get(`${S.repoPath}/contents/${encPath(path)}?ref=${ref}`, { etag: false });
  return { buf: await getBlob(meta.sha), sha: meta.sha, size: meta.size };
}
export async function blobUrl(path, ref) {
  const { buf } = await getFile(path, ref);
  return URL.createObjectURL(new Blob([buf], { type: mimeOf(path) }));
}
export const encPath = p => p.split('/').map(encodeURIComponent).join('/');

/* thumbnails we render ourselves are cached too */
export async function getThumb(sha) {
  const c = await cache(); if (!c) return null;
  const hit = await c.match(location.origin + '/__thumb/' + sha);
  return hit ? hit.blob() : null;
}
export async function putThumb(sha, blob) {
  const c = await cache(); if (c) await c.put(location.origin + '/__thumb/' + sha, new Response(blob)).catch(() => {});
}

/* ---------- writing: one commit for many files ---------- */
/**
 * changes: [{ path, file?: File|Blob|ArrayBuffer, delete?: true, from?: oldPath }]
 * onFile(i, phase, frac)
 */
export async function commitFiles(changes, message, { onFile } = {}) {
  const gh = S.gh, R = S.repoPath;
  const items = [];
  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i];
    if (ch.delete) { items.push({ path: ch.path, mode: '100644', type: 'blob', sha: null }); continue; }
    if (ch.from) { // move/rename: reuse the existing blob
      const e = S.tree.entries.get(ch.from);
      items.push({ path: ch.path, mode: '100644', type: 'blob', sha: e.sha });
      items.push({ path: ch.from, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    onFile?.(i, 'read', 0.05);
    const buf = ch.file instanceof ArrayBuffer ? ch.file : await ch.file.arrayBuffer();
    if (buf.byteLength > 100 * 1024 * 1024) throw new Error(`${ch.path} is ${(buf.byteLength / 1048576).toFixed(0)} MB. GitHub refuses files over 100 MB.`);
    onFile?.(i, 'upload', 0.2);
    const blob = await gh.post(`${R}/git/blobs`, { content: b64FromBuffer(buf), encoding: 'base64' });
    onFile?.(i, 'done', 1);
    items.push({ path: ch.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  // build the commit, retrying if the branch moved under us
  for (let attempt = 0; attempt < 4; attempt++) {
    const ref = await gh.get(`${R}/git/ref/heads/${encodeURIComponent(S.cfg.branch)}`, { etag: false });
    const head = ref.object.sha;
    const parent = await gh.get(`${R}/git/commits/${head}`);
    const tree = await gh.post(`${R}/git/trees`, { base_tree: parent.tree.sha, tree: items });
    const commit = await gh.post(`${R}/git/commits`, { message, tree: tree.sha, parents: [head] });
    try {
      await gh.patch(`${R}/git/refs/heads/${encodeURIComponent(S.cfg.branch)}`, { sha: commit.sha, force: false });
      await S.loadTree(commit.sha);
      S.loadCommits().catch(() => {});
      return commit;
    } catch (e) {
      if (e.status === 422 && attempt < 3) continue;
      throw e;
    }
  }
}

/** Commits that touched a path, newest first. */
export async function history(path) {
  return S.gh.get(`${S.repoPath}/commits?sha=${S.cfg.branch}&path=${encodeURIComponent(path)}&per_page=50`);
}
export async function commitFilesList(sha) {
  return (await S.gh.get(`${S.repoPath}/commits/${sha}`)).files || [];
}

/** Files under a folder (direct children), and folders with counts. */
export function listDir(dir, { showAll = false, kinds = null, q = '' } = {}) {
  const pre = dir ? dir + '/' : '';
  const files = [], folders = new Map();
  const ql = q.toLowerCase();
  for (const e of S.tree.entries.values()) {
    if (e.type !== 'blob' || !e.path.startsWith(pre)) continue;
    const rest = e.path.slice(pre.length);
    const top = rest.split('/')[0];
    if (HIDE_DIRS.includes(top) && !showAll) continue;
    const k = kindOf(e.path);
    if (!showAll && k === 'other') continue;
    if (kinds && !kinds.includes(k)) continue;
    if (ql) { if (e.path.toLowerCase().includes(ql)) files.push(e); continue; }
    if (rest.includes('/')) {
      const f = folders.get(top) || { name: top, path: pre + top, count: 0, models: 0, images: 0, sample: null };
      f.count++; if (k === 'model') f.models++; if (k === 'image') { f.images++; if (!f.sample) f.sample = e; }
      folders.set(top, f);
    } else files.push(e);
  }
  return { files, folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
