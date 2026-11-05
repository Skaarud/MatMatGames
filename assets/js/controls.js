// Viewer toolbars shared by the file page and the Models page: view modes, helpers, lighting,
// screenshots, fullscreen, animation bar and keyboard shortcuts.
import { MODES, LIGHT_PRESETS } from './viewer.js';
import { esc, icon, el, menu, toast, download } from './ui.js';

const MODE_ICON = { lit: 'sun', clay: 'cube', matcap: 'sparkle', normals: 'layers', uv: 'grid' };

/**
 * pane: element holding the viewer canvas.
 * opts.viewer: ModelViewer; opts.others(): extra viewers kept in sync (compare mode)
 * opts.pin: optional () => void to toggle comment-pin mode (adds the pin button + P key)
 * opts.fullscreenEl: element to make fullscreen; opts.name(): base name for screenshots
 * opts.extraKeys(e): return true if the page handled a key itself
 */
export function mountControls(pane, { viewer, others = () => [], pin = null, fullscreenEl, name = () => 'model', extraKeys } = {}) {
  const all = () => [viewer, ...others()];
  const left = el(`<div class="vtools left">${MODES.map((m, i) => `<button class="btn icon ${viewer.mode === m.key ? 'on' : ''}" data-mode="${m.key}" title="${m.label}: ${m.hint} (${i + 1})">${icon(MODE_ICON[m.key])}</button>`).join('')}
    <div class="sep"></div><button class="btn icon ${viewer.wire ? 'on' : ''}" data-t="wire" title="Wireframe overlay (W)">${icon('wire')}</button>
    <button class="btn icon ${viewer.showSkel ? 'on' : ''}" data-t="skel" title="Show skeleton (B)">${icon('bone')}</button>
    <button class="btn icon ${viewer.showBounds ? 'on' : ''}" data-t="bounds" title="Bounding box">${icon('box')}</button>
    <button class="btn icon ${viewer.showGrid ? 'on' : ''}" data-t="grid" title="Grid">${icon('grid')}</button></div>`);
  const tr = el(`<div class="vtools tr">${pin ? `<button class="btn icon" data-t="pin" title="Drop a comment pin (P)">${icon('pin')}</button>` : ''}
    <button class="btn icon ${viewer.controls.autoRotate ? 'on' : ''}" data-t="rotate" title="Turntable (R)">${icon('rotate')}</button>
    <button class="btn icon" data-t="frame" title="Frame model (F)">${icon('focus')}</button>
    <button class="btn icon" data-t="light" title="Lighting & background (L)">${icon('sun')}</button>
    <button class="btn icon" data-t="shot" title="Screenshot">${icon('camera')}</button>
    <button class="btn icon" data-t="full" title="Fullscreen">${icon('expand')}</button></div>`);
  pane.append(left, tr);
  let ab = null;
  const syncFns = new Set();

  const refreshAnim = () => {
    ab?.remove(); ab = null;
    syncFns.forEach(f => viewer.onFrame.delete(f)); syncFns.clear();
    if (!viewer.clips.length) return;
    ab = el(`<div class="vtools bottom anim-bar"><button class="btn icon" data-t="play" title="Play / pause (Space)">${icon('play')}</button>
      <select class="select" data-clip style="height:30px;width:auto;max-width:180px">${viewer.clips.map((c, i) => `<option value="${i}">${esc(c.name || 'Clip ' + (i + 1))}</option>`).join('')}</select>
      <input type="range" min="0" max="1000" value="0" data-scrub><span class="t" data-time>0.00s</span>
      <select class="select" data-speed style="height:30px;width:70px"><option value=".25">¼×</option><option value=".5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`);
    pane.appendChild(ab);
    const scrub = ab.querySelector('[data-scrub]'), tl = ab.querySelector('[data-time]'), pb = ab.querySelector('[data-t="play"]');
    let wasPlaying = viewer.playing;
    const sync = () => {
      const d = viewer.duration;
      if (d) { scrub.value = (viewer.time % d) / d * 1000; tl.textContent = `${(viewer.time % d).toFixed(2)} / ${d.toFixed(2)}s`; }
      if (viewer.playing !== wasPlaying || !pb.firstChild) { pb.innerHTML = icon(viewer.playing ? 'pause' : 'play'); wasPlaying = viewer.playing; }
    };
    syncFns.add(sync); viewer.onFrame.add(sync);
    ab.querySelector('[data-clip]').value = String(viewer.clipIndex || 0);
    ab.querySelector('[data-clip]').onchange = e => { viewer.play(+e.target.value, true); sync(); };
    ab.querySelector('[data-speed]').value = String(viewer.speed);
    ab.querySelector('[data-speed]').onchange = e => viewer.speed = +e.target.value;
    scrub.oninput = () => { if (viewer.playing) viewer.togglePlay(); viewer.setTime(scrub.value / 1000 * viewer.duration); sync(); };
    pb.onclick = () => { viewer.togglePlay(); sync(); };
    if (!viewer.playing) viewer.play(viewer.clipIndex || 0, true);
    pb.innerHTML = icon('pause'); sync();
  };

  const toggle = (k, btn) => {
    btn ??= pane.querySelector(`[data-t="${k}"]`);
    if (k === 'wire') { const v = viewer.toggleWire(); others().forEach(o => o.toggleWire(v)); btn?.classList.toggle('on', v); }
    if (k === 'skel') { const want = !viewer.showSkel; const v = viewer.toggleSkeleton(want); others().forEach(o => o.toggleSkeleton(v)); btn?.classList.toggle('on', v); if (want && !v) toast('This model has no skeleton', { ms: 1600 }); }
    if (k === 'bounds') { const v = viewer.toggleBounds(); others().forEach(o => o.toggleBounds(v)); btn?.classList.toggle('on', v); }
    if (k === 'grid') { const v = viewer.toggleGrid(); others().forEach(o => o.toggleGrid(v)); btn?.classList.toggle('on', v); }
    if (k === 'rotate') { const v = !viewer.controls.autoRotate; viewer.setAutoRotate(v); others().forEach(o => o.setAutoRotate(false)); btn?.classList.toggle('on', v); }
    if (k === 'frame') viewer.frame();
    if (k === 'pin') pin?.();
    if (k === 'full') { const fs = fullscreenEl || pane; document.fullscreenElement ? document.exitFullscreen() : fs.requestFullscreen?.(); }
    if (k === 'shot') viewer.screenshot().then(b => download(b, name().replace(/\.\w+$/, '') + '-' + viewer.mode + '.png'));
    if (k === 'light') menu(btn, [
      ...LIGHT_PRESETS.map(l => ({ label: l.label, value: 'l:' + l.key, icon: 'sun', checked: viewer.light === l.key })), 'sep',
      ...[['theme', 'Theme background'], ['dark', 'Dark'], ['light', 'Light'], ['transparent', 'Transparent (for screenshots)']].map(([k2, l]) => ({ label: l, value: 'b:' + k2, checked: viewer.bg === k2 })), 'sep',
      { label: 'Brighter', value: 'e:+', icon: 'plus' }, { label: 'Darker', value: 'e:-', icon: 'down' },
    ], v => {
      const [t, x] = v.split(':');
      if (t === 'l') all().forEach(o => o.setLight(x));
      if (t === 'b') all().forEach(o => o.setBackground(x));
      if (t === 'e') { const e2 = Math.max(.3, Math.min(3, (viewer.exposure ?? 1) * (x === '+' ? 1.2 : 1 / 1.2))); all().forEach(o => o.setExposure(e2)); }
    });
  };
  const setMode = m => { all().forEach(o => o.setMode(m)); left.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); };

  const onClick = e => {
    const m = e.target.closest('.vtools [data-mode]');
    if (m) return setMode(m.dataset.mode);
    const t = e.target.closest('.vtools [data-t]'); if (t && t.dataset.t !== 'play') toggle(t.dataset.t, t);
  };
  pane.addEventListener('click', onClick);

  const keys = e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal, .drawer')) return;
    if (extraKeys?.(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'f') toggle('frame');
    else if (k === 'w') toggle('wire');
    else if (k === 'r') toggle('rotate');
    else if (k === 'b') toggle('skel');
    else if (k === 'l') toggle('light');
    else if (k === 'p' && pin) toggle('pin');
    else if (e.key === ' ') { e.preventDefault(); pane.querySelector('[data-t="play"]')?.click(); }
    else if ('12345'.includes(k) && k) setMode(MODES[+k - 1].key);
  };
  document.addEventListener('keydown', keys);
  const onTheme = () => all().forEach(o => o.applyTheme());
  window.addEventListener('themechange', onTheme);
  refreshAnim();

  return {
    refreshAnim, toggle, setMode,
    setPinOn(v) { tr.querySelector('[data-t="pin"]')?.classList.toggle('on', v); },
    destroy() {
      document.removeEventListener('keydown', keys); window.removeEventListener('themechange', onTheme);
      pane.removeEventListener('click', onClick);
      syncFns.forEach(f => viewer.onFrame.delete(f));
      left.remove(); tr.remove(); ab?.remove();
    },
  };
}
