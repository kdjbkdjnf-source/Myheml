import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchRoute } from './routes/index.js';
import { db, ROOT, UPLOAD_DIR, now } from './lib/db.js';
import {
  applySecurityHeaders, ok, created, fail, readJson, HttpError,
  parseCookies, serveFile, safeJoin, sendJson,
} from './lib/http.js';
import { getSessionUser } from './lib/auth.js';
import { ensureSeed } from './seed.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '0.0.0.0';

ensureSeed();

const BODY_LIMIT = 1_000_000;

/** 允许的额外来源（如 https://example.com），逗号分隔；用于反代后 Host 与浏览器 Origin 不一致的场景 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase().replace(/\/$/, ''))
  .filter(Boolean);

/** 收集本次请求可能被访问到的所有主机名（直连 Host / 反代透传的原始 Host） */
function requestHosts(req) {
  const hosts = new Set();
  const add = (raw) => {
    if (!raw) return;
    String(raw).split(',').forEach((part) => {
      const h = part.trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/:\d+$/, '');
      if (h) hosts.add(h);
    });
  };
  add(req.headers['x-forwarded-host']);
  add(req.headers['x-original-host']);
  add(req.headers.host);
  return hosts;
}

function checkCsrf(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  // 浏览器自动写入、脚本无法伪造；same-origin/same-site 即证明请求来自本站页面
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const origin = req.headers.origin;
  if (origin) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, 'CSRF_BLOCKED', '请求来源不合法');
    }
    // 反代场景下 req.headers.host 可能是内网地址，因此三条通路任一成立即放行：
    // 1) 浏览器标记为同站请求  2) Origin 命中本次请求的 Host  3) 命中白名单环境变量
    const sameSiteFlag = site === 'same-origin' || site === 'same-site';
    const sameHost = requestHosts(req).has(parsed.hostname.toLowerCase());
    const listed = ALLOWED_ORIGINS.includes(parsed.origin.toLowerCase());
    if (!sameSiteFlag && !sameHost && !listed) {
      throw new HttpError(403, 'CSRF_BLOCKED', '跨站请求已被拦截');
    }
  }
  if (req.headers['x-requested-with'] !== 'fetch') {
    throw new HttpError(403, 'CSRF_BLOCKED', '缺少请求标记');
  }
}

async function handleApi(req, res, url) {
  const cookies = parseCookies(req.headers.cookie || '');
  const matched = matchRoute(req.method, url.pathname);
  if (!matched) throw new HttpError(404, 'NOT_FOUND', '接口不存在');
  if (matched.methodMismatch) throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方法不被支持');

  checkCsrf(req);
  const user = getSessionUser(req, cookies);
  const ctx = {
    req, res, url, cookies, user,
    params: matched.params,
    query: Object.fromEntries(url.searchParams.entries()),
    body: {},
  };

  const needsBody = ['POST', 'PATCH', 'PUT'].includes(req.method);
  if (needsBody && !matched.route.noPreParse) {
    ctx.body = await readJson(req, matched.route.bodyLimit || BODY_LIMIT);
  }

  const result = await matched.route.handler(ctx);
  const status = matched.route.status || 200;
  if (status === 201) return created(res, result);
  return ok(res, result);
}

function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  // 用户上传的图片
  if (url.pathname.startsWith('/uploads/')) {
    const rel = url.pathname.slice('/uploads/'.length);
    const file = safeJoin(UPLOAD_DIR, rel);
    if (file && serveFile(res, file, { cache: 'public, max-age=31536000, immutable' })) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  // 前端静态资源：不使用强缓存，避免部署后浏览器仍加载旧版本
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = safeJoin(PUBLIC_DIR, rel);
  if (file && serveFile(res, file, { cache: 'no-cache' })) return;

  // SPA 路由回退
  if (!path.extname(url.pathname)) {
    if (serveFile(res, path.join(PUBLIC_DIR, 'index.html'), { cache: 'no-cache' })) return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (process.env.LOG === '1') console.log(`[req] ${req.method} ${url.pathname}${url.search}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      handleStatic(req, res, url);
    }
  } catch (err) {
    if (res.headersSent) {
      res.end();
      return;
    }
    fail(res, err);
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;

server.listen(PORT, HOST, () => {
  const stats = db.prepare("SELECT COUNT(*) AS c FROM profiles WHERE status = 'active'").get();
  console.log('');
  console.log('  遇见 · 同城生活照平台已启动');
  console.log(`  本地访问  http://localhost:${PORT}`);
  console.log(`  在线主页  ${stats.c} 个 | 数据文件 data/app.db`);
  console.log(`  启动时间  ${now()}`);
  console.log('');
});

function shutdown(signal) {
  console.log(`\n[${signal}] 正在关闭服务…`);
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
