import { db, now, extendVip, parseJson, publicUser } from '../lib/db.js';
import { HttpError, rateLimit } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import * as v from '../lib/validate.js';
import { FREE_MODE, MANUAL_PAY, PAY_WECHAT_ID, PAY_QR_IMAGE, PAY_PAYEE_NAME } from '../lib/config.js';

function assertMemberEnabled() {
  if (FREE_MODE) {
    throw new HttpError(403, 'MEMBER_DISABLED', '当前站点全站免费开放，无需开通会员');
  }
}

/** 人工收款模式下前端需要展示的收款信息（qr 为空字符串时前端只显示微信号） */
function payInfo() {
  if (!MANUAL_PAY) return null;
  return { mode: 'manual', wechat: PAY_WECHAT_ID, qr: PAY_QR_IMAGE || null, payee: PAY_PAYEE_NAME };
}

export const routes = [
  {
    method: 'GET',
    path: '/api/plans',
    handler: async () => {
      if (FREE_MODE) return { plans: [], memberEnabled: false, mode: 'free' };
      const rows = db.prepare('SELECT * FROM plans ORDER BY sort ASC').all();
      return {
        memberEnabled: true,
        mode: MANUAL_PAY ? 'manual' : 'paid',
        pay: payInfo(),
        plans: rows.map((p) => ({
          code: p.code,
          name: p.name,
          days: p.days,
          price: p.price_cents / 100,
          priceCents: p.price_cents,
          badge: p.badge,
          features: parseJson(p.features, []),
          perDay: Math.round((p.price_cents / 100 / p.days) * 100) / 100,
        })),
      };
    },
  },

  /* 创建订单。人工收款模式下订单只是「转账凭证的载体」，不会触发任何支付请求 */
  {
    method: 'POST',
    path: '/api/orders',
    handler: async (ctx) => {
      assertMemberEnabled();
      const user = requireAuth(ctx);
      rateLimit(`order:${user.id}`, 20, 60 * 60 * 1000);
      const planCode = v.str(ctx.body.planCode, '套餐', { max: 20 });
      const plan = db.prepare('SELECT * FROM plans WHERE code = ?').get(planCode);
      if (!plan) throw new HttpError(400, 'BAD_REQUEST', '套餐不存在');

      const payload = (orderId) => ({
        orderId,
        planCode: plan.code,
        planName: plan.name,
        days: plan.days,
        amount: plan.price_cents / 100,
        paymentMode: MANUAL_PAY ? 'manual' : 'demo',
        pay: payInfo(),
      });

      /* 复用未完成的订单：用户反复点「立即开通」不该产生一堆待确认订单 */
      if (MANUAL_PAY) {
        const open = db
          .prepare(
            `SELECT * FROM orders
             WHERE user_id = ? AND plan_code = ? AND status IN ('pending', 'claimed')
             ORDER BY id DESC LIMIT 1`
          )
          .get(user.id, plan.code);
        if (open) return { ...payload(open.id), status: open.status, reused: true };
      }

      const info = db
        .prepare(
          `INSERT INTO orders (user_id, plan_code, plan_name, days, amount_cents, status, channel, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
        )
        .run(user.id, plan.code, plan.name, plan.days, plan.price_cents, MANUAL_PAY ? 'manual' : 'demo', now());
      return { ...payload(Number(info.lastInsertRowid)), status: 'pending', reused: false };
    },
  },

  /* 人工收款：用户转账后自己点「我已完成转账」，订单进入待确认队列 */
  {
    method: 'POST',
    path: '/api/orders/:id/claim',
    handler: async (ctx) => {
      assertMemberEnabled();
      if (!MANUAL_PAY) throw new HttpError(400, 'NOT_MANUAL', '当前不是人工收款模式');
      const user = requireAuth(ctx);
      rateLimit(`claim:${user.id}`, 10, 60 * 60 * 1000);
      const id = Number(ctx.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, user.id);
      if (!order) throw new HttpError(404, 'NOT_FOUND', '订单不存在');
      if (order.status === 'paid') throw new HttpError(400, 'ALREADY_PAID', '该订单已开通，无需重复提交');
      if (order.status === 'claimed') return { orderId: id, status: 'claimed', already: true };
      if (order.status !== 'pending') {
        throw new HttpError(400, 'BAD_STATE', '该订单已关闭，请重新下单');
      }

      const note = v.optionalStr(ctx.body.note, '转账备注', { max: 80 });
      db.prepare("UPDATE orders SET status = 'claimed', note = ?, claimed_at = ? WHERE id = ?")
        .run(note || null, now(), id);
      return { orderId: id, status: 'claimed', already: false };
    },
  },

  /*
   * 演示支付：仅用于流程演示。
   * 人工收款模式下必须关闭——否则用户能在前端自己把订单点成已支付，绕过收款确认。
   */
  {
    method: 'POST',
    path: '/api/orders/:id/pay',
    handler: async (ctx) => {
      assertMemberEnabled();
      if (MANUAL_PAY) {
        throw new HttpError(403, 'PAY_MANUAL', '当前为人工收款模式，请转账后等待管理员确认开通');
      }
      const user = requireAuth(ctx);
      const id = Number(ctx.params.id);
      const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, user.id);
      if (!order) throw new HttpError(404, 'NOT_FOUND', '订单不存在');
      if (order.status === 'paid') throw new HttpError(400, 'ALREADY_PAID', '该订单已支付');
      if (order.status !== 'pending') throw new HttpError(400, 'BAD_STATE', '订单状态异常');

      db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").run(now(), id);
      const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      const expiresAt = extendVip(fresh, order.days);
      return {
        orderId: id,
        vipExpiresAt: expiresAt,
        user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)),
      };
    },
  },

  {
    method: 'GET',
    path: '/api/my/orders',
    handler: async (ctx) => {
      const user = requireAuth(ctx);
      const rows = db
        .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
        .all(user.id);
      return {
        items: rows.map((o) => ({
          id: o.id,
          planName: o.plan_name,
          days: o.days,
          amount: o.amount_cents / 100,
          status: o.status,
          channel: o.channel,
          note: o.note || '',
          createdAt: o.created_at,
          claimedAt: o.claimed_at,
          paidAt: o.paid_at,
        })),
      };
    },
  },

  {
    method: 'POST',
    path: '/api/redeem',
    handler: async (ctx) => {
      assertMemberEnabled();
      const user = requireAuth(ctx);
      rateLimit(`redeem:${user.id}`, 5, 30 * 60 * 1000);
      const code = v.str(ctx.body.code, '兑换码', { min: 6, max: 32 }).toUpperCase();
      const row = db.prepare('SELECT * FROM redeem_codes WHERE code = ?').get(code);
      if (!row) throw new HttpError(404, 'CODE_NOT_FOUND', '兑换码无效');
      if (row.used_by) throw new HttpError(400, 'CODE_USED', '该兑换码已被使用');
      const plan = db.prepare('SELECT * FROM plans WHERE code = ?').get(row.plan_code);
      if (!plan) throw new HttpError(400, 'BAD_STATE', '套餐配置缺失');

      db.prepare('UPDATE redeem_codes SET used_by = ?, used_at = ? WHERE code = ?').run(user.id, now(), code);
      const expiresAt = extendVip(user, plan.days);
      return { planName: plan.name, days: plan.days, vipExpiresAt: expiresAt };
    },
  },
];
