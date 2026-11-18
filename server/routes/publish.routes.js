import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, now, UPLOAD_DIR, parseJson } from '../lib/db.js';
import { ok, created, HttpError, rateLimit, readJson } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { getProvince, isValidCity } from '../data/regions.js';
import { ADMIN_ONLY_PUBLISH } from '../lib/config.js';
import * as v from '../lib/validate.js';

const MAX_PHOTOS = 8;

function ensureUploadDir() {
  const d = new Date();
  const dir = path.join(UPLOAD_DIR, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
  fs.mkdirSync(dir, { recursive: true });
  return { dir, rel: `/uploads/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}` };
}

function validateProfileInput(body) {
  const nickname = v.cleanText(body.nickname, '昵称', { min: 2, max: 16 });
  const gender = v.oneOf(body.gender, '性别', ['female', 'male']);
  const currentYear = new Date().getFullYear();
  // 表单只填年龄；库里仍存出生年份，方便以后按年龄筛选排序
  const age = v.int(body.age, '年龄', { min: 18, max: 80 });
  const birthYear = currentYear - age;
  const province = getProvince(body.provinceCode);
  if (!province) throw new HttpError(400, 'BAD_REQUEST', '省份不正确');
  const city = v.str(body.city, '城市', { min: 1, max: 20 });
  if (!isValidCity(province.code, city)) throw new HttpError(400, 'BAD_REQUEST', '城市不在所选省份下');
  const heightCm = body.heightCm ? v.int(body.heightCm, '身高', { min: 130, max: 220 }) : null;
  const bio = v.cleanText(body.bio, '个人介绍', { min: 10, max: 600 });
  const contacts = {
    wechat: v.contactValue(body.wechat, '微信号'),
    qq: v.contactValue(body.qq, 'QQ'),
    phone: v.contactValue(body.phone, '手机号'),
    note: v.optionalStr(body.contactNote, '联系方式备注', { max: 60 }),
  };
  if (!contacts.wechat && !contacts.qq && !contacts.phone) {
    throw new HttpError(400, 'BAD_REQUEST', '请至少填写一种联系方式（微信 / QQ / 手机号）');
  }
  return { nickname, gender, birthYear, age, province, city, heightCm, bio, contacts };
}

function ownedProfile(user, id) {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', '主页不存在');
  if (row.user_id !== user.id && user.role !== 'admin') {
    throw new HttpError(403, 'FORBIDDEN', '只能管理自己的主页');
  }
  return row;
}

export const routes = [
  /* 图片上传：前端已压缩，这里只做校验与落盘 */
  {
    method: 'POST',
    path: '/api/uploads',
    // 该接口自行读取较大的请求体，交由路由处理，避免全局预读后重复消费流
    noPreParse: true,
    bodyLimit: 8 * 1024 * 1024,
    handler: async (ctx) => {
      const user = requireAuth(ctx);
      rateLimit(`upload:${user.id}`, 60, 60 * 60 * 1000);
      const body = await readJson(ctx.req, 8 * 1024 * 1024);
      const { buffer, ext } = v.parseImageDataUrl(body.data, { maxBytes: 4 * 1024 * 1024 });
      const { dir, rel } = ensureUploadDir();
      const name = `${crypto.randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buffer);
      return { url: `${rel}/${name}`, size: buffer.length };
    },
  },

  /* 发布生活照 */
  {
    method: 'POST',
    path: '/api/profiles',
    handler: async (ctx) => {
      const user = requireAuth(ctx);
      if (ADMIN_ONLY_PUBLISH && user.role !== 'admin') {
        throw new HttpError(403, 'PUBLISH_DISABLED', '本站主页由平台统一整理发布，暂不开放用户投稿');
      }
      rateLimit(`publish:${user.id}`, 200, 24 * 60 * 60 * 1000);
      const input = validateProfileInput(ctx.body);

      const photos = Array.isArray(ctx.body.photos) ? ctx.body.photos : [];
      if (!photos.length) throw new HttpError(400, 'BAD_REQUEST', '请至少上传 1 张生活照');
      if (photos.length > MAX_PHOTOS) throw new HttpError(400, 'BAD_REQUEST', `最多上传 ${MAX_PHOTOS} 张照片`);
      for (const url of photos) {
        if (typeof url !== 'string' || !/^\/uploads\/\d{4}\/\d{1,2}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(url)) {
          throw new HttpError(400, 'BAD_REQUEST', '照片地址不合法，请重新上传');
        }
      }
      const avatar = typeof ctx.body.avatar === 'string' && photos.includes(ctx.body.avatar)
        ? ctx.body.avatar
        : photos[0];

      // 管理员是内容运营方，不受投稿数量限制
      if (user.role !== 'admin') {
        const activeCount = db
          .prepare("SELECT COUNT(*) AS c FROM profiles WHERE user_id = ? AND status IN ('active','pending')")
          .get(user.id).c;
        if (activeCount >= 3) throw new HttpError(400, 'LIMIT_REACHED', '每个账号最多发布 3 个主页');
      }

      // 管理员发布即上线，不经过审核队列
      const status = user.role === 'admin' ? 'active' : 'pending';

      const ts = now();
      const info = db
        .prepare(
          `INSERT INTO profiles
            (user_id, nickname, gender, birth_year, province_code, city, height_cm, bio,
             contact_wechat, contact_qq, contact_phone, contact_note, avatar_url, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          user.id, input.nickname, input.gender, input.birthYear, input.province.code, input.city,
          input.heightCm, input.bio,
          input.contacts.wechat, input.contacts.qq, input.contacts.phone, input.contacts.note,
          avatar, status, ts, ts
        );

      const profileId = Number(info.lastInsertRowid);
      const stmt = db.prepare('INSERT INTO photos (profile_id, url, sort, created_at) VALUES (?, ?, ?, ?)');
      photos.forEach((url, i) => stmt.run(profileId, url, i, ts));

      return { id: profileId, status };
    },
  },

  {
    method: 'GET',
    path: '/api/my/profiles',
    handler: async (ctx) => {
      const user = requireAuth(ctx);
      const rows = db
        .prepare(
          `SELECT p.*, (SELECT url FROM photos WHERE profile_id = p.id ORDER BY sort LIMIT 1) AS cover,
                  (SELECT COUNT(*) FROM photos WHERE profile_id = p.id) AS photo_count
           FROM profiles p WHERE p.user_id = ? AND p.status != 'deleted' ORDER BY p.created_at DESC`
        )
        .all(user.id);
      return {
        items: rows.map((r) => ({
          id: r.id,
          nickname: r.nickname,
          city: r.city,
          provinceName: getProvince(r.province_code)?.name || '',
          cover: r.cover,
          photoCount: r.photo_count,
          status: r.status,
          rejectReason: r.reject_reason,
          viewCount: r.view_count,
          unlockCount: r.unlock_count,
          createdAt: r.created_at,
        })),
      };
    },
  },

  {
    method: 'PATCH',
    path: '/api/profiles/:id',
    handler: async (ctx) => {
      const user = requireAuth(ctx);
      const row = ownedProfile(user, ctx.params.id);
      const input = validateProfileInput(ctx.body);

      const photos = Array.isArray(ctx.body.photos) ? ctx.body.photos : [];
      if (!photos.length) throw new HttpError(400, 'BAD_REQUEST', '请至少保留 1 张生活照');
      if (photos.length > MAX_PHOTOS) throw new HttpError(400, 'BAD_REQUEST', `最多上传 ${MAX_PHOTOS} 张照片`);
      for (const url of photos) {
        if (typeof url !== 'string' || !/^\/uploads\/\d{4}\/\d{1,2}\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(url)) {
          throw new HttpError(400, 'BAD_REQUEST', '照片地址不合法');
        }
      }

      db.prepare(
        `UPDATE profiles SET nickname=?, gender=?, birth_year=?, province_code=?, city=?, height_cm=?,
           bio=?, contact_wechat=?, contact_qq=?, contact_phone=?, contact_note=?,
           avatar_url=?, status=?, reject_reason=NULL, updated_at=?
         WHERE id=?`
      ).run(
        input.nickname, input.gender, input.birthYear, input.province.code, input.city, input.heightCm,
        input.bio, input.contacts.wechat, input.contacts.qq,
        input.contacts.phone, input.contacts.note, photos[0],
        user.role === 'admin' ? 'active' : 'pending', now(), row.id
      );
      db.prepare('DELETE FROM photos WHERE profile_id = ?').run(row.id);
      const stmt = db.prepare('INSERT INTO photos (profile_id, url, sort, created_at) VALUES (?, ?, ?, ?)');
      photos.forEach((url, i) => stmt.run(row.id, url, i, now()));
      return { id: row.id, status: user.role === 'admin' ? 'active' : 'pending' };
    },
  },

  {
    method: 'DELETE',
    path: '/api/profiles/:id',
    handler: async (ctx) => {
      const user = requireAuth(ctx);
      const row = ownedProfile(user, ctx.params.id);
      db.prepare("UPDATE profiles SET status = 'deleted', updated_at = ? WHERE id = ?").run(now(), row.id);
      return { ok: true };
    },
  },

  {
    method: 'GET',
    path: '/api/meta/tags',
    handler: async () => ({ tags: ALLOWED_TAGS }),
  },
];
