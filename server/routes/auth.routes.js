import { db, now, publicUser, isVip } from '../lib/db.js';
import { ok, created, HttpError, clientIp, rateLimit, setCookie, isHttps } from '../lib/http.js';
import {
  hashPassword, verifyPassword, signToken, touchLogin, SESSION_COOKIE, TOKEN_MAX_AGE,
  findUserByName, findUserById,
} from '../lib/auth.js';
import * as v from '../lib/validate.js';

export const FREE_DAILY_UNLOCK = 1;

export function unlockQuota(user) {
  if (!user) return { vipActive: false, freeLeftToday: 0 };
  if (isVip(user)) return { vipActive: true, freeLeftToday: null };
  const today = now().slice(0, 10);
  const used = user.free_unlock_date === today ? user.free_unlock_used : 0;
  return { vipActive: false, freeLeftToday: Math.max(0, FREE_DAILY_UNLOCK - used) };
}

/**
 * 下发会话 Cookie。
 * HTTPS 下用 Secure + SameSite=None：这样即使页面被别的站点（如预览面板）内嵌成 iframe，
 * 会话也能带上；跨站防护由服务端 Origin 校验 + X-Requested-With 承担。
 * HTTP（本地开发）下保持 Lax。
 */
function issueSession(ctx, userId) {
  const secure = process.env.FORCE_HTTPS === '1' || isHttps(ctx.req);
  setCookie(ctx.res, SESSION_COOKIE, signToken({ uid: userId }), {
    maxAge: TOKEN_MAX_AGE,
    secure,
    sameSite: secure ? 'None' : 'Lax',
  });
}

export const routes = [
  {
    method: 'POST',
    path: '/api/auth/register',
    handler: async (ctx) => {
      rateLimit(`reg:${clientIp(ctx.req)}`, 8, 60 * 60 * 1000);
      const username = v.username(ctx.body.username);
      const password = v.password(ctx.body.password);
      if (ctx.body.agree !== true) throw new HttpError(400, 'BAD_REQUEST', '请先阅读并同意社区公约');

      if (findUserByName(username)) throw new HttpError(409, 'USERNAME_TAKEN', '该用户名已被占用');

      const info = db
        .prepare(
          `INSERT INTO users (username, password_hash, role, tier, status, created_at)
           VALUES (?, ?, 'user', 'free', 'active', ?)`
        )
        .run(username, hashPassword(password), now());
      const user = findUserById(info.lastInsertRowid);
      issueSession(ctx, user.id);
      return { user: publicUser(user), quota: unlockQuota(user) };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    handler: async (ctx) => {
      const ip = clientIp(ctx.req);
      rateLimit(`login:${ip}`, 20, 10 * 60 * 1000);
      const username = v.str(ctx.body.username, '用户名', { max: 40 });
      const password = v.str(ctx.body.password, '密码', { max: 64 });

      const user = findUserByName(username);
      // 用户不存在时也做一次哈希比较，避免通过响应时间枚举账号
      const hashed = user?.password_hash || 'scrypt$16384$00000000000000000000000000000000$' + '0'.repeat(128);
      const valid = verifyPassword(password, hashed) && !!user;
      if (!valid) throw new HttpError(401, 'BAD_CREDENTIALS', '用户名或密码错误');
      if (user.status !== 'active') throw new HttpError(403, 'ACCOUNT_BANNED', '该账号已被停用，如有疑问请联系客服');

      touchLogin(user.id);
      issueSession(ctx, user.id);
      return { user: publicUser(user), quota: unlockQuota(user) };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    handler: async (ctx) => {
      setCookie(ctx.res, SESSION_COOKIE, '', { maxAge: 0 });
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    handler: async (ctx) => {
      if (!ctx.user) return { user: null, quota: unlockQuota(null) };
      return { user: publicUser(ctx.user), quota: unlockQuota(ctx.user) };
    },
  },
  {
    method: 'POST',
    path: '/api/me/password',
    handler: async (ctx) => {
      const user = ctx.user;
      if (!user) throw new HttpError(401, 'UNAUTHORIZED', '请先登录');
      rateLimit(`pwd:${user.id}`, 5, 60 * 60 * 1000);
      const oldPwd = v.str(ctx.body.oldPassword, '原密码', { max: 64 });
      const newPwd = v.password(ctx.body.newPassword);
      if (!verifyPassword(oldPwd, user.password_hash)) {
        throw new HttpError(400, 'BAD_CREDENTIALS', '原密码不正确');
      }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPwd), user.id);
      return { ok: true };
    },
  },
];
