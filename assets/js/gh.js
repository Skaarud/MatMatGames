// Thin GitHub REST client: auth, ETag caching (304s are free), pagination, raw blobs.

export class GHError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

export class GH {
  constructor(token, { base = 'https://api.github.com' } = {}) {
    this.token = token;
    this.base = base;
    this.etags = new Map();   // url -> { etag, data }
    this.rate = { remaining: null, limit: null, reset: null };
    this.listeners = new Set();
    this.inflight = 0;
  }
  onActivity(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const f of this.listeners) f(this.inflight, this.rate); }

  url(path) { return path.startsWith('http') ? path : this.base + path; }

  async req(method, path, { body, accept, etag = method === 'GET', raw = false, signal, headers = {} } = {}) {
    const url = this.url(path);
    const h = {
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    };
    if (this.token) h.Authorization = 'Bearer ' + this.token;
    const cached = etag ? this.etags.get(url + '|' + h.Accept) : null;
    if (cached) h['If-None-Match'] = cached.etag;
    if (body !== undefined && !(body instanceof Blob)) h['Content-Type'] = 'application/json';
    this.inflight++; this._emit();
    let res;
    try {
      res = await fetch(url, {
        method, headers: h, signal, cache: 'no-store',
        body: body === undefined ? undefined : (body instanceof Blob ? body : JSON.stringify(body)),
      });
    } catch (e) {
      throw new GHError(0, 'Network error: ' + (e.message || e));
    } finally {
      this.inflight--; this._emit();
    }
    const rl = res.headers.get('x-ratelimit-remaining');
    if (rl != null) {
      this.rate = { remaining: +rl, limit: +res.headers.get('x-ratelimit-limit'), reset: +res.headers.get('x-ratelimit-reset') * 1000 };
      this._emit();
    }
    if (res.status === 304 && cached) return { data: cached.data, notModified: true, res };
    if (!res.ok) {
      let data = null; try { data = await res.json(); } catch {}
      let msg = data?.message || res.statusText || 'HTTP ' + res.status;
      if (res.status === 401) msg = 'Your GitHub token was not accepted (401). It may be expired.';
      if (res.status === 403 && this.rate.remaining === 0) msg = 'GitHub rate limit reached. It resets ' + new Date(this.rate.reset).toLocaleTimeString() + '.';
      if (res.status === 404) msg = 'Not found (404): ' + path.replace(this.base, '') + '. Check that your token can see this repo.';
      if (data?.errors?.length) msg += ' — ' + data.errors.map(e => e.message || e.code).join(', ');
      throw new GHError(res.status, msg, data);
    }
    if (raw) return { data: await res.arrayBuffer(), res };
    if (res.status === 204) return { data: null, res };
    const data = await res.json();
    const tag = res.headers.get('etag');
    if (etag && tag) this.etags.set(url + '|' + h.Accept, { etag: tag, data });
    return { data, res };
  }

  async get(path, opts) { return (await this.req('GET', path, opts)).data; }
  async post(path, body, opts) { return (await this.req('POST', path, { ...opts, body, etag: false })).data; }
  async patch(path, body, opts) { return (await this.req('PATCH', path, { ...opts, body, etag: false })).data; }
  async put(path, body, opts) { return (await this.req('PUT', path, { ...opts, body, etag: false })).data; }
  async del(path, opts) { return (await this.req('DELETE', path, { ...opts, etag: false })).data; }

  /** Follow Link headers. `max` caps the number of pages. */
  async all(path, { max = 50, accept } = {}) {
    let url = this.url(path) + (path.includes('?') ? '&' : '?') + 'per_page=100';
    const out = [];
    for (let i = 0; i < max && url; i++) {
      const { data, res } = await this.req('GET', url, { accept });
      out.push(...data);
      const link = res?.headers?.get('link') || '';
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      if (!res && !m) break;
    }
    return out;
  }

  async blob(owner, repo, sha) {
    return (await this.req('GET', `/repos/${owner}/${repo}/git/blobs/${sha}`, { accept: 'application/vnd.github.raw', raw: true, etag: false })).data;
  }
}

export function b64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}
