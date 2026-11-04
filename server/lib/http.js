import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = '请先登录') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = '没有操作权限') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = '内容不存在') => new HttpError(404, 'NOT_FOUND', msg);
export const tooMany = (msg = '操作过于频繁，请稍后再试') => new HttpError(429, 'RATE_LIMITED', msg);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
};

export function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export const ok = (res, data = null, message = 'ok') =>
  sendJson(res, 200, { success: true, data, message, timestamp: Date.now() });

export const created = (res, data = null, message = 'created') =>
  sendJson(res, 201, { success: true, data, message, timestamp: Date.now() });

export function fail(res, err) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, {
      success: false,
      error: { code: err.code, message: err.message, details: err.details || null },
      timestamp: Date.now(),
    });
  }
  console.error('[unhandled]', err);
  const message =
    process.env.NODE_ENV === 'production' ? '服务器内部错误' : `服务器错误：${err.message}`;
  return sendJson(res, 500, {
    success: false,
    error: { code: 'INTERNAL_ERROR', message, details: null },
    timestamp: Date.now(),
  });
}

export function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    if (req.readableEnded || req.complete) {
      resolve(Buffer.alloc(0));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be an object');
    }
    return parsed;
  } catch {
    throw badRequest('请求体不是合法的 JSON');
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setCookie(res, name, value, { maxAge = 0, secure = false, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
  if (maxAge > 0) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

/** 请求是否经由 HTTPS（含反向代理透传）——用于决定 Secure / SameSite 属性 */
export function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  if (proto === 'http') return false;
  const origin = req.headers.origin || req.headers.referer || '';
  return origin.startsWith('https://');
}

/* ---------- 内存限流（单机够用，多机请换 Redis） ---------- */
const buckets = new Map();

export function rateLimit(key, max, windowMs) {
  const ts = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || ts > bucket.reset) {
    bucket = { count: 0, reset: ts + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    const retryAfter = Math.ceil((bucket.reset - ts) / 1000);
    throw new HttpError(429, 'RATE_LIMITED', `操作过于频繁，请 ${retryAfter} 秒后再试`);
  }
  if (buckets.size > 20000) buckets.clear();
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* ---------- 静态文件 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function serveFile(res, filePath, { cache = 'no-cache' } = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

/** 防目录穿越 */
export function safeJoin(baseDir, relative) {
  const target = path.resolve(baseDir, '.' + path.sep + relative);
  const base = path.resolve(baseDir) + path.sep;
  return target.startsWith(base) ? target : null;
}
