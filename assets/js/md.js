// Markdown: GitHub renders it (same output as on github.com); we fix up private images and links.
import { S } from './store.js';
import { blobUrl, kindOf } from './files.js';
import { esc } from './ui.js';

export async function renderMarkdown(text) {
  if (!text?.trim()) return '<p class="faint">Nothing written yet.</p>';
  const res = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + S.gh.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode: 'gfm', context: `${S.cfg.owner}/${S.cfg.repo}` }),
  });
  if (!res.ok) return `<pre>${esc(text)}</pre>`;
  return res.text();
}

/** Repo file path from a GitHub URL pointing into our repo, or null. */
export function repoPathFromUrl(u) {
  if (!u) return null;
  const { owner, repo } = S.cfg;
  const re = new RegExp(`github(?:usercontent)?\\.com/${owner}/${repo}/(?:blob|raw)/[^/]+/(.+?)(?:\\?.*)?$`, 'i');
  const m = u.match(re);
  if (m) return decodeURIComponent(m[1]);
  const m2 = u.match(new RegExp(`raw\\.githubusercontent\\.com/${owner}/${repo}/[^/]+/(.+?)(?:\\?.*)?$`, 'i'));
  return m2 ? decodeURIComponent(m2[1]) : null;
}
export function repoFileUrl(path) {
  return `${S.webRepo}/blob/${S.cfg.branch}/${path.split('/').map(encodeURIComponent).join('/')}?raw=true`;
}

/** After inserting GitHub HTML: load private repo images via the API, route repo links into the hub. */
export function enhance(root) {
  root.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('data-canonical-src') || img.getAttribute('src');
    const path = repoPathFromUrl(src) || repoPathFromUrl(img.closest('a')?.getAttribute('href'));
    if (!path) return;
    img.removeAttribute('src');
    img.style.minHeight = '40px';
    blobUrl(path).then(u => { img.src = u; img.style.minHeight = ''; }).catch(() => { img.alt = '⚠ ' + path; });
    const a = img.closest('a'); if (a) a.href = '#/file/' + encodeURIComponent(path);
  });
  root.querySelectorAll('a[href]').forEach(a => {
    const p = repoPathFromUrl(a.getAttribute('href'));
    if (p && S.tree?.entries.has(p)) { a.href = '#/file/' + encodeURIComponent(p); a.removeAttribute('target'); return; }
    const m = a.getAttribute('href').match(new RegExp(`github\\.com/${S.cfg.owner}/${S.cfg.repo}/issues/(\\d+)`, 'i'));
    if (m) { a.href = '#/task/' + m[1]; a.removeAttribute('target'); return; }
    if (/^https?:/.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; }
  });
  root.querySelectorAll('input[type=checkbox]').forEach(c => c.disabled = true);
}

/** Markdown snippet that links to a repo file (image files show inline). */
export function fileMarkdown(path) {
  const name = path.split('/').pop();
  return kindOf(path) === 'image' ? `![${name}](${repoFileUrl(path)})` : `[📎 ${name}](${repoFileUrl(path)})`;
}

/** Plain-text snippet for notices. */
export function snippet(body, n = 140) {
  return (body || '').replace(/<!--[\s\S]*?-->/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
}
