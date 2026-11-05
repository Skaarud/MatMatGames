// Lazy thumbnails for gallery tiles. Models are rendered once and cached by git sha.
import { getBlob, getThumb, putThumb, kindOf, imageUrl } from './files.js';

const queue = [];
let busy = 0, busyModels = 0;
const MAX_MODEL_BYTES = 40 * 1024 * 1024;
const urls = new Map(); // sha -> object URL (images + model thumbs)
// forget the oldest thumbnails once we hold a lot of them (they reload from the browser cache)
function trimUrls() { while (urls.size > 600) { const [k, u] = urls.entries().next().value; URL.revokeObjectURL(u); urls.delete(k); } }

// The <img> starts hidden (display:none never intersects), so we watch its visible parent.
const io = new IntersectionObserver(ents => {
  for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); if (e.target.__img) enqueue(e.target.__img); }
}, { rootMargin: '300px' });

/** `img` element with data-sha and data-path. */
export function observe(img) {
  const sha = img.dataset.sha;
  if (urls.has(sha)) { show(img, urls.get(sha)); return; }
  const host = img.parentElement || img;
  host.__img = img;
  io.observe(host);
}
function show(img, u) { img.src = u; img.closest('.thumb')?.querySelector('.spin')?.remove(); img.classList.remove('hidden'); img.closest('.thumb')?.querySelector('.ph')?.remove(); }

function enqueue(img) {
  const kind = kindOf(img.dataset.path);
  // images jump the queue: they're cheap
  if (kind === 'image') queue.unshift(img); else queue.push(img);
  pump();
}
async function pump() {
  if (busy >= 4 || !queue.length) return;
  // models render one at a time (parsing + WebGL), images can go in parallel
  const i = queue.findIndex(x => kindOf(x.dataset.path) === 'image' || busyModels === 0);
  if (i < 0) return;
  const [img] = queue.splice(i, 1);
  if (!img.isConnected) { pump(); return; }
  const isModel = kindOf(img.dataset.path) === 'model';
  busy++; if (isModel) busyModels++;
  pump();
  try { await make(img); } catch (e) { console.warn('thumb', img.dataset.path, e); img.closest('.thumb')?.querySelector('.spin')?.remove(); }
  busy--; if (isModel) busyModels--;
  // give the page a breath between heavy renders
  await new Promise(r => setTimeout(r, isModel ? 30 : 0));
  pump();
}
async function make(img) {
  const { sha, path } = img.dataset;
  const size = +img.dataset.size || 0;
  if (urls.has(sha)) return show(img, urls.get(sha));
  const kind = kindOf(path);
  img.closest('.thumb')?.insertAdjacentHTML('beforeend', '<span class="spin"></span>');
  if (kind === 'image') {
    const buf = await getBlob(sha);
    const u = await imageUrl(buf, path);
    urls.set(sha, u); trimUrls(); return show(img, u);
  }
  if (kind === 'model') {
    const cached = await getThumb(sha);
    if (cached) { const u = URL.createObjectURL(cached); urls.set(sha, u); return show(img, u); }
    if (size > MAX_MODEL_BYTES) { img.closest('.thumb')?.querySelector('.spin')?.remove(); return; }
    const buf = await getBlob(sha);
    const { renderThumb } = await import('./viewer.js');
    const { blob } = await renderThumb(buf, path);
    await putThumb(sha, blob);
    const u = URL.createObjectURL(blob); urls.set(sha, u); return show(img, u);
  }
}
export function thumbUrl(sha) { return urls.get(sha); }
