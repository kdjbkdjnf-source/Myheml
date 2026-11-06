import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, ROOT, now } from './db.js';
import { HttpError } from './http.js';

const SECRET_FILE = path.join(ROOT, 'data', '.secret');

function loadSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) return process.env.JWT_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  console.log('[auth] 已生成新的会话密钥 data/.secret（生产环境请改用 JWT_SECRET 环境变量）');
  return secret;
}

const SECRET = loadSecret();
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
export const SESSION_COOKIE = 'sid';

/* ---------------- 密码哈希（scrypt，cost 由 N 控制） ---------------- */
const SCRYPT_N = 16384; // 2^14 ≈ bcrypt cost 12 的强度量级
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${salt}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, nStr, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const n = Number(nStr) || SCRYPT_N;
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: n, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ---------------- 无依赖 JWT（HS256） ---------------- */
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, ttlSeconds = TOKEN_TTL_SECONDS) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  );
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const TOKEN_MAX_AGE = TOKEN_TTL_SECONDS;

/* ---------------- 用户查询 ---------------- */
export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

export function findUserByName(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

/**
 * 从请求中解析当前用户。
 * Cookie 优先；也兼容 Authorization: Bearer（方便移动端/脚本调用）。
 */
export function getSessionUser(req, cookies) {
  let token = cookies?.[SESSION_COOKIE];
  if (!token) {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) token = auth.slice(7);
  }
  const payload = verifyToken(token);
  if (!payload?.uid) return null;
  const user = findUserById(payload.uid);
  if (!user || user.status !== 'active') return null;
  return user;
}

export function touchLogin(userId) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
}

export function requireAuth(ctx) {
  if (!ctx.user) throw new HttpError(401, 'UNAUTHORIZED', '请先登录');
  return ctx.user;
}

export function requireAdmin(ctx) {
  const user = requireAuth(ctx);
  if (user.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '需要管理员权限');
  return user;
}
