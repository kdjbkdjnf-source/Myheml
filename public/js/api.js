export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError('NETWORK', '网络连接失败，请检查网络后重试');
  }
  if (raw) return res;
  const json = await res.json().catch(() => null);
  if (!json) throw new ApiError('BAD_RESPONSE', '服务器响应异常', res.status);
  if (!json.success) {
    throw new ApiError(json.error?.code || 'UNKNOWN', json.error?.message || '请求失败', res.status);
  }
  return json.data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
};

/* ---------------- 会话状态 ---------------- */
export const auth = {
  user: null,
  quota: { vipActive: false, freeLeftToday: 0 },

  apply(data) {
    this.user = data?.user ?? null;
    this.quota = data?.quota ?? { vipActive: false, freeLeftToday: 0 };
    window.dispatchEvent(new CustomEvent('auth:change'));
    return this.user;
  },

  async refresh() {
    try {
      const data = await api.get('/api/me');
      return this.apply(data);
    } catch {
      return this.apply(null);
    }
  },

  get isLoggedIn() {
    return !!this.user;
  },
  get isAdmin() {
    return this.user?.role === 'admin';
  },
  get isVip() {
    return !!this.quota?.vipActive;
  },

  async logout() {
    try {
      await api.post('/api/auth/logout');
    } catch { /* 忽略 */ }
    this.apply(null);
  },
};

export const query = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};
