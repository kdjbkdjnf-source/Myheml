import crypto from 'node:crypto';
import { db, now, isVip, extendVip, publicUser, parseJson } from '../lib/db.js';
import { HttpError } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { getProvince } from '../data/regions.js';
import { MANUAL_PAY } from '../lib/config.js';
import * as v from '../lib/validate.js';

function adminProfileRow(r) {
  return {
    id: r.id,
    nickname: r.nickname,
    gender: r.gender,
    age: r.birth_year ? new Date().getFullYear() - r.birth_year : null,
    provinceName: getProvince(r.province_code)?.name || '',
    city: r.city,
    cover: r.cover,
    photoCount: r.photo_count,
    status: r.status,
    rejectReason: r.reject_reason,
    ownerId: r.user_id,
    ownerName: r.owner_name,
    reportCount: r.report_count || 0,
    createdAt: r.created_at,
  };
}

const ADMIN_PROFILE_SQL = `
  SELECT p.*,
    (SELECT url FROM photos WHERE profile_id = p.id ORDER BY sort LIMIT 1) AS cover,
    (SELECT COUNT(*) FROM photos WHERE profile_id = p.id) AS photo_count,
    (SELECT username FROM users WHERE id = p.user_id) AS owner_name,
    (SELECT COUNT(*) FROM reports WHERE profile_id = p.id AND status = 'open') AS report_count
  FROM profiles p
`;

export const routes = [
  {
    method: 'GET',
    path: '/api/admin/stats',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const one = (sql, ...a) => db.prepare(sql).get(...a);
      const revenue = one("SELECT COALESCE(SUM(amount_cents),0) AS v FROM orders WHERE status = 'paid'").v;
      return {
        users: one('SELECT COUNT(*) AS c FROM users').c,
        vipUsers: one("SELECT COUNT(*) AS c FROM users WHERE tier = 'vip' AND vip_expires_at > ?", now()).c,
        profilesActive: one("SELECT COUNT(*) AS c FROM profiles WHERE status = 'active'").c,
        profilesPending: one("SELECT COUNT(*) AS c FROM profiles WHERE status = 'pending'").c,
        reportsOpen: one("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'").c,
        ordersPaid: one("SELECT COUNT(*) AS c FROM orders WHERE status = 'paid'").c,
        ordersClaimed: one("SELECT COUNT(*) AS c FROM orders WHERE status = 'claimed'").c,
        revenue: revenue / 100,
        photos: one('SELECT COUNT(*) AS c FROM photos').c,
      };
    },
  },

  {
    method: 'GET',
    path: '/api/admin/profiles',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const status = ['pending', 'active', 'rejected', 'hidden'].includes(ctx.query.status)
        ? ctx.query.status
        : 'pending';
      const rows = db
        .prepare(`${ADMIN_PROFILE_SQL} WHERE p.status = ? ORDER BY p.created_at DESC LIMIT 100`)
        .all(status);
      return { items: rows.map(adminProfileRow), status };
    },
  },

  {
    method: 'GET',
    path: '/api/admin/profiles/:id',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const row = db.prepare(`${ADMIN_PROFILE_SQL} WHERE p.id = ?`).get(Number(ctx.params.id));
      if (!row) throw new HttpError(404, 'NOT_FOUND', '主页不存在');
      const photos = db.prepare('SELECT id, url FROM photos WHERE profile_id = ? ORDER BY sort').all(row.id);
      return {
        ...adminProfileRow(row),
        bio: row.bio,
        tags: parseJson(row.tags, []),
        photos,
        contact: {
          wechat: row.contact_wechat,
          qq: row.contact_qq,
          phone: row.contact_phone,
          note: row.contact_note,
        },
      };
    },
  },

  {
    method: 'POST',
    path: '/api/admin/profiles/:id/review',
    handler: async (ctx) => {
      const admin = requireAdmin(ctx);
      const id = Number(ctx.params.id);
      const action = v.oneOf(ctx.body.action, '审核动作', ['approve', 'reject']);
      const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
      if (!row) throw new HttpError(404, 'NOT_FOUND', '主页不存在');
      if (action === 'approve') {
        db.prepare("UPDATE profiles SET status = 'active', reject_reason = NULL, updated_at = ? WHERE id = ?")
          .run(now(), id);
      } else {
        const reason = v.optionalStr(ctx.body.reason, '驳回理由', { max: 100 }) || '内容不符合社区规范';
        db.prepare("UPDATE profiles SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?")
          .run(reason, now(), id);
      }
      return { id, status: action === 'approve' ? 'active' : 'rejected', by: admin.username };
    },
  },

  {
    method: 'POST',
    path: '/api/admin/profiles/:id/visibility',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const id = Number(ctx.params.id);
      const status = v.oneOf(ctx.body.status, '状态', ['active', 'hidden']);
      const row = db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
      if (!row) throw new HttpError(404, 'NOT_FOUND', '主页不存在');
      db.prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
      return { id, status };
    },
  },

  {
    method: 'GET',
    path: '/api/admin/reports',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const status = ['open', 'resolved', 'dismissed'].includes(ctx.query.status) ? ctx.query.status : 'open';
      const rows = db
        .prepare(
          `SELECT r.*, p.nickname, p.city, p.province_code, p.status AS profile_status,
                  u.username AS reporter_name
           FROM reports r
           LEFT JOIN profiles p ON p.id = r.profile_id
           LEFT JOIN users u ON u.id = r.reporter_id
           WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100`
        )
        .all(status);
      return {
        items: rows.map((r) => ({
          id: r.id,
          profileId: r.profile_id,
          nickname: r.nickname,
          city: r.city,
          provinceName: getProvince(r.province_code)?.name || '',
          profileStatus: r.profile_status,
          reason: r.reason,
          detail: r.detail,
          reporter: r.reporter_name || '游客',
          status: r.status,
          createdAt: r.created_at,
        })),
      };
    },
  },

  {
    method: 'POST',
    path: '/api/admin/reports/:id/handle',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const id = Number(ctx.params.id);
      const action = v.oneOf(ctx.body.action, '处理动作', ['resolve', 'dismiss']);
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
      if (!report) throw new HttpError(404, 'NOT_FOUND', '举报不存在');
      db.prepare('UPDATE reports SET status = ?, handled_at = ? WHERE id = ?')
        .run(action === 'resolve' ? 'resolved' : 'dismissed', now(), id);
      if (action === 'resolve' && ctx.body.hideProfile === true) {
        db.prepare("UPDATE profiles SET status = 'hidden', updated_at = ? WHERE id = ?").run(now(), report.profile_id);
      }
      return { id, status: action === 'resolve' ? 'resolved' : 'dismissed' };
    },
  },

  {
    method: 'GET',
    path: '/api/admin/users',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const q = (ctx.query.q || '').toString().trim().slice(0, 30);
      const rows = q
        ? db.prepare('SELECT * FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 100').all(`%${q}%`)
        : db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 100').all();
      const counts = db.prepare('SELECT user_id, COUNT(*) AS c FROM profiles GROUP BY user_id').all();
      const map = Object.fromEntries(counts.map((r) => [r.user_id, r.c]));
      return {
        items: rows.map((u) => ({
          ...publicUser(u),
          status: u.status,
          profileCount: map[u.id] || 0,
          lastLoginAt: u.last_login_at,
        })),
      };
    },
  },

  {
    method: 'POST',
    path: '/api/admin/users/:id/status',
    handler: async (ctx) => {
      const admin = requireAdmin(ctx);
      const id = Number(ctx.params.id);
      const status = v.oneOf(ctx.body.status, '状态', ['active', 'banned']);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!user) throw new HttpError(404, 'NOT_FOUND', '用户不存在');
      if (user.role === 'admin') throw new HttpError(400, 'BAD_REQUEST', '不能停用管理员账号');
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
      if (status === 'banned') {
        db.prepare("UPDATE profiles SET status = 'hidden' WHERE user_id = ? AND status = 'active'").run(id);
      }
      return { id, status, by: admin.username };
    },
  },

  {
    method: 'GET',
    path: '/api/admin/redeem-codes',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const rows = db.prepare('SELECT * FROM redeem_codes ORDER BY created_at DESC LIMIT 200').all();
      return {
        items: rows.map((r) => ({
          code: r.code,
          planCode: r.plan_code,
          used: !!r.used_by,
          usedAt: r.used_at,
          createdAt: r.created_at,
        })),
      };
    },
  },

  {
    method: 'POST',
    path: '/api/admin/redeem-codes',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const planCode = v.oneOf(ctx.body.planCode, '套餐', ['vip_1m', 'vip_3m', 'vip_1y']);
      const count = v.int(ctx.body.count, '数量', { min: 1, max: 100 });
      const codes = [];
      const stmt = db.prepare('INSERT INTO redeem_codes (code, plan_code, created_at) VALUES (?, ?, ?)');
      for (let i = 0; i < count; i += 1) {
        const code = `YX${planCode.replace('vip_', '').toUpperCase()}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        try {
          stmt.run(code, planCode, now());
          codes.push(code);
        } catch {
          i -= 1; // 撞码重试
        }
      }
      return { codes };
    },
  },

  {
    method: 'POST',
    path: '/api/admin/grant-vip',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const username = v.str(ctx.body.username, '用户名', { max: 20 });
      const days = v.int(ctx.body.days, '天数', { min: 1, max: 3650 });
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user) throw new HttpError(404, 'NOT_FOUND', '用户不存在');
      const base = isVip(user) ? new Date(user.vip_expires_at) : new Date();
      const next = new Date(base.getTime() + days * 86400000).toISOString();
      db.prepare("UPDATE users SET tier = 'vip', vip_expires_at = ? WHERE id = ?").run(next, user.id);
      return { username, vipExpiresAt: next };
    },
  },

  /* ---------------- 人工收款：待确认订单 ---------------- */
  {
    method: 'GET',
    path: '/api/admin/orders',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const allowed = ['claimed', 'pending', 'paid', 'rejected', 'all'];
      const status = allowed.includes(ctx.query.status) ? ctx.query.status : 'claimed';
      const where = status === 'all' ? '' : 'WHERE o.status = ?';
      const rows = db
        .prepare(
          `SELECT o.*, u.username, u.tier, u.vip_expires_at,
                  (SELECT COUNT(*) FROM orders WHERE user_id = o.user_id AND status = 'paid') AS paid_count
           FROM orders o JOIN users u ON u.id = o.user_id
           ${where}
           ORDER BY COALESCE(o.claimed_at, o.created_at) DESC LIMIT 200`
        )
        .all(...(status === 'all' ? [] : [status]));
      return {
        status,
        manualPay: MANUAL_PAY,
        items: rows.map((o) => ({
          id: o.id,
          username: o.username,
          planName: o.plan_name,
          days: o.days,
          amount: o.amount_cents / 100,
          status: o.status,
          channel: o.channel,
          note: o.note || '',
          isVipNow: o.tier === 'vip' && o.vip_expires_at > now(),
          vipExpiresAt: o.vip_expires_at,
          paidCount: o.paid_count,
          createdAt: o.created_at,
          claimedAt: o.claimed_at,
          paidAt: o.paid_at,
        })),
      };
    },
  },

  /* 确认收款：只有这一步会真正开通会员 */
  {
    method: 'POST',
    path: '/api/admin/orders/:id/confirm',
    handler: async (ctx) => {
      const admin = requireAdmin(ctx);
      const id = Number(ctx.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!order) throw new HttpError(404, 'NOT_FOUND', '订单不存在');
      if (order.status === 'paid') throw new HttpError(400, 'ALREADY_PAID', '该订单已经开通过');
      if (!['pending', 'claimed'].includes(order.status)) {
        throw new HttpError(400, 'BAD_STATE', '该订单已关闭，无法确认');
      }
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
      if (!user) throw new HttpError(404, 'NOT_FOUND', '下单用户已不存在');

      const expiresAt = extendVip(user, order.days);
      db.prepare("UPDATE orders SET status = 'paid', paid_at = ?, confirmed_by = ? WHERE id = ?")
        .run(now(), admin.id, id);
      return {
        orderId: id,
        username: user.username,
        days: order.days,
        vipExpiresAt: expiresAt,
        confirmedBy: admin.username,
      };
    },
  },

  /* 驳回：没收到钱、金额不符或凭证对不上时使用，订单不再占用待确认队列 */
  {
    method: 'POST',
    path: '/api/admin/orders/:id/reject',
    handler: async (ctx) => {
      requireAdmin(ctx);
      const id = Number(ctx.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!order) throw new HttpError(404, 'NOT_FOUND', '订单不存在');
      if (order.status === 'paid') throw new HttpError(400, 'ALREADY_PAID', '已开通的订单不能驳回');
      const reason = v.optionalStr(ctx.body.reason, '驳回理由', { max: 100 }) || '未收到对应款项';
      db.prepare("UPDATE orders SET status = 'rejected', note = COALESCE(note, '') || ? WHERE id = ?")
        .run(`\n[驳回] ${reason}`, id);
      return { orderId: id, status: 'rejected', reason };
    },
  },
];
