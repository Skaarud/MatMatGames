// Settings: look, motion, repo, token, notifications, cache.
import { S } from './store.js';
import { esc, icon, avatarImg, toast, confirmBox, store as ls } from './ui.js';

export function render(main) {
  const page = document.createElement('div'); page.className = 'page'; page.style.maxWidth = '820px'; main.appendChild(page);
  const draw = () => {
    const theme = document.documentElement.dataset.theme;
    const motion = localStorage.getItem('mmg.motion') || 'normal';
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const rate = S.gh.rate;
    page.innerHTML = `<div class="page-head"><h1>Settings</h1></div>
    <div style="display:grid;gap:16px">
      <section class="panel"><div class="panel-head"><h3>Look</h3></div><div class="panel-body" style="display:grid;gap:14px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${[['matrix', 'Matrix', 'Phosphor green, monospace, digital rain. Hacker hours.'], ['ink', 'Ink', 'Warm paper, black ink, soft edges. Calm and readable.']].map(([k, l, d]) => `
            <button class="panel" data-theme="${k}" style="text-align:left;padding:14px;cursor:pointer;${theme === k ? 'outline:2px solid var(--accent)' : ''}">
              <div style="height:64px;border-radius:8px;margin-bottom:10px;${k === 'matrix' ? 'background:#010603;color:#00ff41;font:12px monospace;padding:8px;text-shadow:0 0 6px #00ff41' : 'background:#efe9dd;color:#16130f;font:600 16px Georgia,serif;padding:10px'}">${k === 'matrix' ? '&gt; wake up_<br>ｱ7ｸ ﾘ0 ｶ' : 'Eira’s Pets'}</div>
              <b>${l}</b><div class="muted" style="font-size:12px">${d}</div></button>`).join('')}
        </div>
        <label class="field">Background motion<div class="seg" style="justify-self:start">${[['calm', 'Still'], ['normal', 'Normal'], ['lively', 'Lively']].map(([k, l]) => `<button data-motion="${k}" class="${motion === k ? 'on' : ''}">${l}</button>`).join('')}</div></label>
      </div></section>
      <section class="panel"><div class="panel-head"><h3>Notices</h3></div><div class="panel-body" style="display:grid;gap:10px">
        <div class="muted" style="font-size:13px">The hub shows a toast and an Inbox badge when your teammate comments, mentions you, assigns you, asks for a review, uploads, or pitches an idea. It checks every 15 seconds while open. GitHub also emails you about comments on things you're part of.</div>
        <div>${perm === 'granted' ? '<span class="chip" style="--c:var(--ok)">Desktop alerts on</span>' : perm === 'denied' ? '<span class="chip" style="--c:var(--danger)">Desktop alerts blocked in this browser</span>' : perm === 'unsupported' ? '' : `<button class="btn" data-perm>${icon('bell')} Turn on desktop alerts</button>`}</div>
      </div></section>
      <section class="panel"><div class="panel-head"><h3>Account & repo</h3></div><div class="panel-body" style="display:grid;gap:12px">
        <div style="display:flex;gap:10px;align-items:center">${avatarImg(S.me, 'lg')}<div><b>${esc(S.me.name || S.me.login)}</b><div class="faint" style="font-size:12px">@${esc(S.me.login)} · ${S.perm?.push ? 'can edit' : 'read only'} ${esc(S.cfg.owner)}/${esc(S.cfg.repo)} · branch ${esc(S.cfg.branch)}</div></div></div>
        <div class="faint" style="font-size:12px">Team: ${S.team().map(p => esc(p.login)).join(', ')}. To add your friend: GitHub → ${esc(S.cfg.repo)} → Settings → Collaborators → Add people. Then they log in here with their own token.</div>
        <div class="faint" style="font-size:12px">Uploads from the hub go to <span class="mono">${esc(S.cfg.hubDir)}/</span> unless you pick another folder. API budget: ${rate.remaining ?? '?'} / ${rate.limit ?? '?'} requests left this hour.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="${esc(S.webRepo)}" target="_blank" rel="noopener">${icon('expand')} Open repo on GitHub</a><button class="btn" data-clear>${icon('trash')} Clear file cache</button><button class="btn danger" data-logout>${icon('logout')} Log out</button></div>
      </div></section>
    </div>`;
  };
  page.addEventListener('click', async e => {
    const t = e.target.closest('[data-theme]'); if (t) { const { action } = await import('./main.js'); if (document.documentElement.dataset.theme !== t.dataset.theme) action('theme'); return setTimeout(draw, 50); }
    const m = e.target.closest('[data-motion]'); if (m) { localStorage.setItem('mmg.motion', m.dataset.motion); const { startFx } = await import('./fx.js'); startFx(document.documentElement.dataset.theme); return draw(); }
    if (e.target.closest('[data-perm]')) { await Notification.requestPermission(); return draw(); }
    if (e.target.closest('[data-clear]')) { await caches.delete('mmg-blobs-v1').catch(() => {}); toast('Cache cleared. Files download fresh next time.', { kind: 'ok' }); }
    if (e.target.closest('[data-logout]') && await confirmBox('Log out?', 'Your token is removed from this browser.', { ok: 'Log out', danger: true })) S.logout();
  });
  draw();
  void ls;
}
