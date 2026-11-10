import { db, now, isVip } from '../lib/db.js';
import { ok, HttpError, rateLimit, badRequest } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { PROVINCES, REGIONS, getProvince, isValidCity } from '../data/regions.js';
import * as v from '../lib/validate.js';
import { FREE_MODE } from '../lib/config.js';
import { FREE_DAILY_UNLOCK } from './auth.routes.js';

const MASK = '••••';

/** 联系方式打码：保留极少量字符作为“确实有联系方式”的视觉提示 */
export function maskContact(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 2) return MASK;
  return s.slice(0, 2) + MASK;
}

export function thumb(url) {
  return url || '/assets/placeholder.svg';
}

function cardOf(row) {
  return {
    id: row.id,
    nickname: row.nickname,
    gender: row.gender,
    age: row.birth_year ? new Date().getFullYear() - row.birth_year : null,
    provinceCode: row.province_code,
    provinceName: getProvince(row.province_code)?.name || '',
    city: row.city,
    bio: (row.bio || '').slice(0, 60),
    cover: thumb(row.cover),
    photoCount: row.photo_count || 0,
    viewCount: row.view_count || 0,
    unlockCount: row.unlock_count || 0,
    createdAt: row.created_at,
  };
}

const CARD_SQL = `
  SELECT p.*,
    (SELECT url FROM photos WHERE profile_id = p.id ORDER BY sort ASC, id ASC LIMIT 1) AS cover,
    (SELECT COUNT(*) FROM photos WHERE profile_id = p.id) AS photo_count
  FROM profiles p
`;

function hasUnlocked(userId, profileId) {
  if (!userId) return false;
  return !!db
    .prepare('SELECT 1 FROM unlock_logs WHERE user_id = ? AND profile_id = ? LIMIT 1')
    .get(userId, profileId);
}

export const routes = [
  /* ---------------- 地区 ---------------- */
  {
    method: 'GET',
    path: '/api/regions',
    handler: async () => ({ groups: REGIONS }),
  },
  {
    method: 'GET',
    path: '/api/provinces',
    handler: async () => {
      const counts = db
        .prepare("SELECT province_code, COUNT(*) AS c FROM profiles WHERE status = 'active' GROUP BY province_code")
        .all();
      const map = Object.fromEntries(counts.map((r) => [r.province_code, r.c]));
      const cityRows = db
        .prepare(
          `SELECT province_code, city, COUNT(*) AS c FROM profiles
           WHERE status = 'active' GROUP BY province_code, city ORDER BY c DESC LIMIT 14`
        )
        .all();
      return {
        groups: REGIONS.map((g) => ({
          region: g.region,
          provinces: g.provinces.map((p) => ({
            code: p.code,
            name: p.name,
            cityCount: p.cities.length,
            profileCount: map[p.code] || 0,
          })),
        })),
        hotCities: cityRows.map((r) => ({
          provinceCode: r.province_code,
          provinceName: getProvince(r.province_code)?.name || '',
          city: r.city,
          profileCount: r.c,
        })),
        totalProfiles: counts.reduce((sum, r) => sum + r.c, 0),
        totalProvinces: PROVINCES.length,
        totalCities: PROVINCES.reduce((sum, p) => sum + p.cities.length, 0),
      };
    },
  },
  {
    method: 'GET',
    path: '/api/provinces/:code',
    handler: async (ctx) => {
      const province = getProvince(ctx.params.code);
      if (!province) throw new HttpError(404, 'NOT_FOUND', '省份不存在');
      const rows = db
        .prepare(
          `SELECT city, COUNT(*) AS c FROM profiles
           WHERE province_code = ? AND status = 'active' GROUP BY city`
        )
        .all(province.code);
      const cityMap = Object.fromEntries(rows.map((r) => [r.city, r.c]));
      const latest = db
        .prepare(`${CARD_SQL} WHERE p.province_code = ? AND p.status = 'active' ORDER BY p.created_at DESC LIMIT 8`)
        .all(province.code)
        .map(cardOf);
      return {
        province: { code: province.code, name: province.name, region: province.region },
        cities: province.cities.map((name) => ({ name, profileCount: cityMap[name] || 0 })),
        latest,
      };
    },
  },

  /* ---------------- 列表 ---------------- */
  {
    method: 'GET',
    path: '/api/profiles',
    handler: async (ctx) => {
      const q = ctx.query;
      const page = Math.max(1, Number(q.page) || 1);
      const pageSize = Math.min(48, Math.max(6, Number(q.pageSize) || 12));
      const where = ["p.status = 'active'"];
      const params = [];

      if (q.province) {
        const p = getProvince(q.province);
        if (!p) throw badRequest('省份参数不正确');
        where.push('p.province_code = ?');
        params.push(p.code);
        if (q.city) {
          if (!isValidCity(p.code, q.city)) throw badRequest('城市参数不正确');
          where.push('p.city = ?');
          params.push(q.city);
        }
      }
      if (q.gender === 'female' || q.gender === 'male') {
        where.push('p.gender = ?');
        params.push(q.gender);
      }
      const currentYear = new Date().getFullYear();
      if (q.minAge) {
        where.push('p.birth_year <= ?');
        params.push(currentYear - Number(q.minAge));
      }
      if (q.maxAge) {
        where.push('p.birth_year >= ?');
        params.push(currentYear - Number(q.maxAge));
      }
      if (q.q) {
        const kw = `%${String(q.q).slice(0, 30).replace(/[%_]/g, '')}%`;
        where.push('(p.nickname LIKE ? OR p.bio LIKE ? OR p.city LIKE ?)');
        params.push(kw, kw, kw);
      }

      const orderBy =
        q.sort === 'hot'
          ? 'p.unlock_count DESC, p.view_count DESC'
          : q.sort === 'active'
            ? 'p.updated_at DESC'
            : 'p.created_at DESC';
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const total = db.prepare(`SELECT COUNT(*) AS c FROM profiles p ${whereSql}`).get(...params).c;
      const rows = db
        .prepare(`${CARD_SQL} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize);

      return {
        items: rows.map(cardOf),
        page,
        pageSize,
        total,
        hasMore: page * pageSize < total,
      };
    },
  },
  {
    method: 'GET',
    path: '/api/profiles/:id',
    handler: async (ctx) => {
      const id = Number(ctx.params.id);
      if (!Number.isInteger(id)) throw new HttpError(404, 'NOT_FOUND', '主页不存在');
      const row = db.prepare(`${CARD_SQL} WHERE p.id = ?`).get(id);
      if (!row) throw new HttpError(404, 'NOT_FOUND', '主页不存在');

      const isOwner = ctx.user?.id === row.user_id;
      const isAdmin = ctx.user?.role === 'admin';
      if (row.status !== 'active' && !isOwner && !isAdmin) {
        throw new HttpError(404, 'NOT_FOUND', '主页不存在或正在审核中');
      }

      if (!isOwner) {
        db.prepare('UPDATE profiles SET view_count = view_count + 1 WHERE id = ?').run(id);
      }

      const photos = db
        .prepare('SELECT id, url, sort FROM photos WHERE profile_id = ? ORDER BY sort ASC, id ASC')
        .all(id);

      const unlocked = hasUnlocked(ctx.user?.id, id);
      // 免费模式：只要登录即可看到完整联系方式（登录门槛仍在，但不再有付费墙）
      const contactAllowed = isOwner || isAdmin || unlocked || isVip(ctx.user) || (FREE_MODE && !!ctx.user);

      const fullContact = {
        wechat: row.contact_wechat || '',
        qq: row.contact_qq || '',
        phone: row.contact_phone || '',
        note: row.contact_note || '',
      };

      return {
        id: row.id,
        nickname: row.nickname,
        gender: row.gender,
        age: row.birth_year ? new Date().getFullYear() - row.birth_year : null,
        provinceCode: row.province_code,
        provinceName: getProvince(row.province_code)?.name || '',
        city: row.city,
        heightCm: row.height_cm,
        bio: row.bio || '',
        avatar: thumb(row.avatar_url || row.cover),
        photos: photos.map((p) => ({ id: p.id, url: p.url })),
        photoCount: photos.length,
        viewCount: row.view_count + (isOwner ? 0 : 1),
        unlockCount: row.unlock_count,
        createdAt: row.created_at,
        status: row.status,
        isOwner,
        contactAllowed,
        contact: contactAllowed ? fullContact : null,
        contactHint: contactAllowed
          ? null
          : {
              wechat: maskContact(fullContact.wechat),
              qq: maskContact(fullContact.qq),
              phone: maskContact(fullContact.phone),
            },
      };
    },
  },

  /* ---------------- 解锁联系方式 ---------------- */
  {
    method: 'POST',
    path: '/api/profiles/:id/unlock',
    handler: async (ctx) => {
      const user = requireAuth(ctx);
      const id = Number(ctx.params.id);
      const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
      if (!row || (row.status !== 'active' && row.user_id !== user.id)) {
        throw new HttpError(404, 'NOT_FOUND', '主页不存在');
      }

      const contact = {
        wechat: row.contact_wechat || '',
        qq: row.contact_qq || '',
        phone: row.contact_phone || '',
        note: row.contact_note || '',
      };
      if (row.user_id === user.id) return { contact, method: 'owner' };

      // 免费模式：不计数、不建订单，登录即取
      if (FREE_MODE) {
        db.prepare('UPDATE profiles SET unlock_count = unlock_count + 1 WHERE id = ?').run(id);
        return { contact, method: 'free-mode', quota: { vipActive: false, freeLeftToday: null } };
      }

      if (isVip(user)) {
        db.prepare('INSERT INTO unlock_logs (user_id, profile_id, method, created_at) VALUES (?, ?, ?, ?)')
          .run(user.id, id, 'vip', now());
        db.prepare('UPDATE profiles SET unlock_count = unlock_count + 1 WHERE id = ?').run(id);
        return { contact, method: 'vip', quota: { vipActive: true, freeLeftToday: null } };
      }

      const today = now().slice(0, 10);
      const usedToday = user.free_unlock_date === today ? user.free_unlock_used : 0;

      if (hasUnlocked(user.id, id)) {
        return { contact, method: 'cached', quota: { vipActive: false, freeLeftToday: Math.max(0, FREE_DAILY_UNLOCK - usedToday) } };
      }

      if (usedToday >= FREE_DAILY_UNLOCK) {
        throw new HttpError(402, 'NEED_MEMBERSHIP', '今日免费查看次数已用完，开通会员可无限查看');
      }

      db.prepare('INSERT INTO unlock_logs (user_id, profile_id, method, created_at) VALUES (?, ?, ?, ?)')
        .run(user.id, id, 'free', now());
      db.prepare(
        'UPDATE users SET free_unlock_date = ?, free_unlock_used = ? WHERE id = ?'
      ).run(today, usedToday + 1, user.id);
      db.prepare('UPDATE profiles SET unlock_count = unlock_count + 1 WHERE id = ?').run(id);

      return { contact, method: 'free', quota: { vipActive: false, freeLeftToday: FREE_DAILY_UNLOCK - usedToday - 1 } };
    },
  },

  /* ---------------- 举报 ---------------- */
  {
    method: 'POST',
    path: '/api/reports',
    handler: async (ctx) => {
      rateLimit(`report:${ctx.user?.id || ctx.req.socket.remoteAddress}`, 10, 60 * 60 * 1000);
      const profileId = v.int(ctx.body.profileId, '主页', { min: 1 });
      const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
      if (!profile) throw new HttpError(404, 'NOT_FOUND', '主页不存在');
      const reason = v.oneOf(ctx.body.reason, '举报原因', [
        '虚假信息', '内容不当', '涉嫌诈骗', '联系方式无效', '侵权盗图', '其他',
      ]);
      const detail = v.optionalStr(ctx.body.detail, '补充说明', { max: 300 });
      // 同一用户对同一主页 24 小时内只记一次，避免刷单
      const dup = db
        .prepare("SELECT id FROM reports WHERE profile_id = ? AND reporter_id IS ? AND created_at > ?")
        .get(profileId, ctx.user?.id ?? null, new Date(Date.now() - 86400000).toISOString());
      if (dup) return { ok: true, duplicate: true };
      db.prepare(
        'INSERT INTO reports (profile_id, reporter_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(profileId, ctx.user?.id ?? null, reason, detail, 'open', now());
      return { ok: true, duplicate: false };
    },
  },
];
