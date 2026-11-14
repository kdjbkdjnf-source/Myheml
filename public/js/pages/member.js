import { api, auth } from '../api.js';
import { h, money, toastOk, toastError, openModal, fmtDate } from '../ui.js';
import { navigate } from '../router.js';
import { ensureLogin } from './auth.js';
import { site } from '../site.js';

/* ---------------- 小工具 ---------------- */
async function copyText(text, tip = '已复制') {
  try {
    await navigator.clipboard.writeText(text);
    toastOk(tip);
  } catch {
    window.prompt('手动复制以下内容', text);
  }
}

const STATUS_LABEL = {
  pending: { text: '待转账', cls: 'badge-gray' },
  claimed: { text: '待确认', cls: 'badge-warn' },
  paid: { text: '已开通', cls: 'badge-ok' },
  rejected: { text: '已驳回', cls: 'badge-err' },
};

const statusBadge = (s) => {
  const item = STATUS_LABEL[s] || { text: s, cls: 'badge-gray' };
  return h('span', { class: `badge ${item.cls}` }, item.text);
};

const isManual = () => site.payMode === 'manual';

/* ---------------- 人工收款：微信转账 → 管理员确认 ---------------- */
async function manualPayFlow(plan) {
  const okLogin = await ensureLogin('登录后才能开通会员');
  if (!okLogin) return;

  let order;
  try {
    order = await api.post('/api/orders', { planCode: plan.code });
  } catch (err) {
    toastError(err.message);
    return;
  }

  const wechat = order.pay?.wechat || site.payWechat || '';
  const nicknameInput = h('input', {
    class: 'input',
    placeholder: '你的微信昵称（方便我核对）',
    maxlength: '30',
    style: { maxWidth: '100%' },
  });

  const alreadyClaimed = order.status === 'claimed';

  const stepHead = (n) => h('span', {
    style: {
      flex: '0 0 20px', height: '20px', borderRadius: '50%', marginTop: '1px',
      background: 'var(--brand)', color: '#fff', fontSize: '11.5px', fontWeight: '700',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  }, String(n));

  const step = (n, title, body) => h('div', { style: { display: 'flex', gap: '10px', marginTop: '18px' } },
    stepHead(n),
    h('div', { style: { flex: '1', minWidth: '0' } },
      h('div', { style: { fontSize: '13px', fontWeight: '700' } }, title),
      h('div', { style: { fontSize: '12.5px', color: 'var(--ink-2)', marginTop: '7px', lineHeight: '1.75' } }, body)
    )
  );

  const wechatRow = h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px',
      padding: '10px 12px', borderRadius: '10px',
      background: 'var(--surface-2)', border: '1px solid var(--line)',
    },
  },
    h('span', { style: { fontFamily: 'ui-monospace, monospace', fontSize: '15px', fontWeight: '700', letterSpacing: '.02em', wordBreak: 'break-all' } }, wechat),
    h('button', {
      class: 'btn btn-ghost btn-sm', style: { marginLeft: 'auto', flexShrink: '0' },
      onclick: () => copyText(wechat, '微信号已复制'),
    }, '复制')
  );

  const submitBtn = h('button', {
    class: 'btn btn-primary btn-block btn-lg', style: { marginTop: '16px' },
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = '提交中…';
      try {
        await api.post(`/api/orders/${order.orderId}/claim`, { note: nicknameInput.value.trim() });
        close();
        toastOk('已提交，我核对到账后会立即为你开通');
        await auth.refresh();
        navigate('/member');
      } catch (err) {
        toastError(err.message);
        btn.disabled = false;
        btn.textContent = '我已完成转账';
      }
    },
  }, alreadyClaimed ? '已提交，等待确认' : '我已完成转账');

  if (alreadyClaimed) submitBtn.disabled = true;

  const { close } = openModal({
    title: alreadyClaimed ? '等待确认开通' : '微信转账开通会员',
    sub: alreadyClaimed
      ? `订单 #${order.orderId} 已提交，我正在核对到账情况，确认后立即开通`
      : '按下面三步转账，提交后由我人工核对开通，通常几分钟内完成',
    content: h('div', null,
      /* 金额条 */
      h('div', {
        style: {
          marginTop: '16px', padding: '14px 16px', borderRadius: '12px',
          background: 'var(--surface-2)', border: '1px solid var(--line)',
        },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' } },
          h('span', { style: { color: 'var(--ink-3)' } }, '订单号'),
          h('span', { style: { fontFamily: 'ui-monospace, monospace', fontWeight: '700' } }, `#${order.orderId}`)),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' } },
          h('span', { style: { color: 'var(--ink-3)' } }, '套餐'),
          h('span', null, `${order.planName} · ${order.days} 天`)),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
          h('span', { style: { color: 'var(--ink-3)', fontSize: '13px' } }, '转账金额'),
          h('strong', { style: { fontSize: '24px', letterSpacing: '-.02em' } }, money(order.amount)))
      ),

      step(1, '加我的微信，转账上面这个金额', h('div', null, wechatRow)),

      step(2, `转账备注里写上订单号 #${order.orderId}`, h('span', null,
        '这样我一眼就能对上是谁付的、买的哪个套餐。忘了写也没关系，填一下下面的昵称即可。')),

      step(3, '提交后等我确认', h('div', null, nicknameInput, submitBtn))
    ),
  });
}

/* ---------------- 演示支付（仅非人工模式） ---------------- */
async function demoPayFlow(plan) {
  const okLogin = await ensureLogin('登录后才能开通会员');
  if (!okLogin) return;

  let order;
  try {
    order = await api.post('/api/orders', { planCode: plan.code });
  } catch (err) {
    toastError(err.message);
    return;
  }

  const { close } = openModal({
    title: '确认订单',
    sub: '演示环境：点击下方按钮即表示支付成功，不会产生真实扣款',
    content: h('div', null,
      h('div', {
        style: {
          marginTop: '18px', padding: '16px', borderRadius: '14px',
          background: 'var(--surface-2)', border: '1px solid var(--line)',
        },
      },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px' } },
          h('span', { style: { color: 'var(--ink-3)' } }, '订单号'),
          h('span', null, `#${order.orderId}`)),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '8px' } },
          h('span', { style: { color: 'var(--ink-3)' } }, '套餐'),
          h('span', null, `${order.planName} · ${plan.days} 天`)),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
          h('span', { style: { color: 'var(--ink-3)', fontSize: '14px' } }, '应付'),
          h('strong', { style: { fontSize: '24px', letterSpacing: '-.02em' } }, money(order.amount)))
      ),
      h('button', {
        class: 'btn btn-primary btn-block btn-lg', style: { marginTop: '18px' },
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = '支付中…';
          try {
            const res = await api.post(`/api/orders/${order.orderId}/pay`);
            close();
            toastOk(`支付成功，会员有效期至 ${fmtDate(res.vipExpiresAt)}`);
            await auth.refresh();
            navigate('/member');
          } catch (err) {
            toastError(err.message);
            btn.disabled = false;
            btn.textContent = '模拟支付成功';
          }
        },
      }, '模拟支付成功'),
      h('p', { style: { fontSize: '11.5px', color: 'var(--ink-4)', textAlign: 'center', marginTop: '12px', lineHeight: '1.6' } },
        '正式上线时，这里会接入微信支付 / 支付宝，并在支付回调验签成功后才开通权益。')
    ),
  });
}

function payFlow(plan) {
  return isManual() ? manualPayFlow(plan) : demoPayFlow(plan);
}

function planCard(plan) {
  const recommended = plan.badge === '最受欢迎';
  return h('div', { class: `plan ${recommended ? 'recommended' : ''}` },
    plan.badge ? h('span', { class: `plan-tag badge ${plan.badge === '超值' ? 'badge-warn' : ''}` }, plan.badge) : null,
    h('div', { class: 'plan-name' }, plan.name),
    h('div', { class: 'plan-price' },
      h('i', null, '¥'), h('b', null, String(plan.price)),
      h('small', null, `/ ${plan.days} 天`)),
    h('div', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, `平均每天 ¥${plan.perDay}`),
    h('ul', null, plan.features.map((f) => h('li', null, f))),
    h('button', {
      class: `btn btn-block ${recommended ? 'btn-primary' : 'btn-ghost'}`,
      onclick: () => payFlow(plan),
    }, auth.isVip ? '续费' : '立即开通')
  );
}

/* ---------------- 人工收款的固定说明卡 ---------------- */
function payMethodCard() {
  const wechat = site.payWechat || '';
  if (!wechat) return null;

  return h('div', { class: 'card panel', style: { marginTop: '22px' } },
    h('div', { style: { display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center' } },
      h('div', { style: { flex: '1 1 260px', minWidth: '0' } },
        h('h3', { style: { fontSize: '15px' } }, '怎么付款'),
        h('p', { style: { fontSize: '13px', color: 'var(--ink-2)', marginTop: '8px', lineHeight: '1.8' } },
          '本站不接线上支付，全部由我人工收款、人工开通。点击任一套餐会显示我的微信号，加我好友后转账，转完点「我已完成转账」，我核对到账后就给你开通。'),
        wechat ? h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px',
            padding: '10px 12px', borderRadius: '10px', background: 'var(--surface-2)',
            border: '1px solid var(--line)', maxWidth: '320px',
          },
        },
          h('span', { style: { fontSize: '12px', color: 'var(--ink-3)', flexShrink: '0' } }, '微信'),
          h('span', { style: { fontFamily: 'ui-monospace, monospace', fontSize: '14px', fontWeight: '700', wordBreak: 'break-all' } }, wechat),
          h('button', {
            class: 'btn btn-ghost btn-sm', style: { marginLeft: 'auto', flexShrink: '0' },
            onclick: () => copyText(wechat, '微信号已复制'),
          }, '复制')
        ) : null,
        h('p', { style: { fontSize: '12px', color: 'var(--ink-4)', marginTop: '12px', lineHeight: '1.7' } },
          '付款前请确认收款人信息，本站不会通过其他任何方式主动向你索要款项。')
      )
    )
  );
}

export async function render() {
  // 全站免费模式：不展示任何价格与购买入口
  if (!site.memberEnabled) return renderFreeMode();

  document.title = '会员权益 · 遇见';
  const planData = await api.get('/api/plans');
  const plans = planData.plans || [];
  let orders = { items: [] };
  if (auth.isLoggedIn) {
    try {
      orders = await api.get('/api/my/orders');
    } catch { /* 忽略 */ }
  }

  const claimed = orders.items.filter((o) => o.status === 'claimed');

  const statusText = auth.isVip
    ? `会员有效期至 ${fmtDate(auth.user?.vipExpiresAt)}`
    : auth.isLoggedIn
      ? `当前为免费用户 · 今日剩余 ${auth.quota?.freeLeftToday ?? 0} 次免费查看`
      : '未登录 · 登录后可开通会员';

  const hero = h('div', { class: 'member-hero' },
    h('h1', null, '开通会员，看真实的联系方式'),
    h('p', null, isManual()
      ? '会员可在有效期内无限查看全站所有主页的微信 / QQ / 手机号。加我微信转账，核对到账后立刻开通。'
      : '会员可在有效期内无限查看全站所有主页的微信 / QQ / 手机号，不再受每日免费次数限制。'),
    h('div', { class: 'member-status' },
      h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: auth.isVip ? '#7ee2b8' : 'rgba(255,255,255,.6)' } }),
      statusText
    )
  );

  /* 有待确认的转账时给一条提醒，避免用户以为白付了 */
  const claimNotice = claimed.length
    ? h('div', {
        class: 'tip-box',
        style: { marginTop: '18px', borderColor: 'var(--warn)', background: '#fdf9f0' },
      },
      h('strong', null, `你有 ${claimed.length} 笔转账正在等待确认`),
      h('p', { style: { marginTop: '6px', fontSize: '12.5px', color: 'var(--ink-2)', lineHeight: '1.75' } },
        `订单 ${claimed.map((o) => `#${o.id}`).join('、')} 已提交。我核对到账后会立即开通，不用重复付款；如超过 1 小时没动静，直接微信找我。`)
    )
    : null;

  const plansSection = h('div', { class: 'plan-grid' }, plans.map(planCard));

  /* 兑换码 */
  const codeInput = h('input', { class: 'input', placeholder: '输入兑换码，例如 YXWELCOME001', maxlength: '32' });
  const redeemBox = h('div', { class: 'card panel', style: { marginTop: '22px' } },
    h('h3', { style: { fontSize: '15px' } }, '兑换码激活'),
    h('p', { style: { fontSize: '13px', color: 'var(--ink-3)', marginTop: '6px' } },
      isManual()
        ? '我也可以直接发你一个兑换码，收到后在下面激活，效果和转账开通一样。'
        : '收到活动赠送或线下购买的兑换码，可以在这里激活会员时长。'),
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' } },
      codeInput,
      h('button', {
        class: 'btn btn-dark',
        onclick: async () => {
          const okLogin = await ensureLogin('登录后才能激活兑换码');
          if (!okLogin) return;
          const code = codeInput.value.trim();
          if (!code) return toastError('请输入兑换码');
          try {
            const res = await api.post('/api/redeem', { code });
            toastOk(`激活成功：${res.planName}，有效期至 ${fmtDate(res.vipExpiresAt)}`);
            await auth.refresh();
            navigate('/member');
          } catch (err) {
            toastError(err.message);
          }
        },
      }, '激活')
    )
  );

  /* 订单 */
  const ordersBox = auth.isLoggedIn
    ? h('div', { class: 'card panel' },
        h('h3', { style: { fontSize: '15px', marginBottom: '12px' } }, '我的订单'),
        orders.items.length
          ? h('table', { class: 'orders-table' },
              h('thead', null, h('tr', null,
                h('th', null, '订单'), h('th', null, '套餐'), h('th', null, '金额'), h('th', null, '状态'), h('th', null, '时间'))),
              h('tbody', null, orders.items.map((o) => h('tr', null,
                h('td', null, `#${o.id}`),
                h('td', null, `${o.planName}`),
                h('td', null, money(o.amount)),
                h('td', null, statusBadge(o.status)),
                h('td', { style: { color: 'var(--ink-3)', fontSize: '12px' } },
                  fmtDate(o.paidAt || o.claimedAt || o.createdAt, true))
              )))
            )
          : h('p', { style: { fontSize: '13px', color: 'var(--ink-3)' } }, '还没有订单记录。')
      )
    : h('div', { class: 'card panel' },
        h('h3', { style: { fontSize: '15px' } }, '登录后查看订单'),
        h('p', { style: { fontSize: '13px', color: 'var(--ink-3)', marginTop: '8px' } }, '登录后可以查看历史订单与会员有效期。'),
        h('button', { class: 'btn btn-ghost', style: { marginTop: '14px' }, onclick: () => ensureLogin() }, '去登录')
      );

  const faq = h('div', { class: 'card panel' },
    h('h3', { style: { fontSize: '15px', marginBottom: '14px' } }, '常见问题'),
    (isManual()
      ? [
          ['付了钱多久能开通？', '我核对到账后手动开通，通常几分钟内完成；半夜转账可能要等到第二天。'],
          ['怎么确认钱收到了？', '转账备注里写上订单号（例如 #12），我在后台就能对上；没写就填一下你的微信昵称。'],
          ['可以退款吗？', '联系方式属于虚拟内容，查看后不支持退款。开通前想确认什么，直接微信问我就行。'],
          ['会重复扣款吗？', '不会。同一套餐未完成的订单会自动复用，你重复点「立即开通」也只有一笔待确认。'],
        ]
      : [
          ['免费用户能看什么？', '可以浏览全部生活照、简介与城市分类，每天有 1 次免费查看联系方式的机会。'],
          ['会员是自动续费吗？', '不是。当前套餐为一次性购买，到期不会自动扣款，需要手动续费。'],
          ['联系方式是错误的怎么办？', '在主页底部点击「举报」选择「联系方式无效」，核实后会下架该主页。'],
          ['可以退款吗？', '联系方式属于虚拟内容，一旦查看不支持退款，请在开通前确认需求。'],
        ]
    ).map(([q, a]) => h('div', { style: { padding: '12px 0', borderTop: '1px solid var(--line)' } },
      h('div', { style: { fontSize: '13.5px', fontWeight: '700' } }, q),
      h('p', { style: { fontSize: '12.5px', color: 'var(--ink-2)', marginTop: '5px', lineHeight: '1.7' } }, a)
    ))
  );

  return h('div', { class: 'container', style: { paddingTop: '22px' } },
    hero,
    claimNotice,
    h('div', { class: 'section-head', style: { marginTop: '34px' } },
      h('div', null, h('h2', null, '选择你的方案'), h('p', null, '随时开通，时长可叠加'))),
    plansSection,
    isManual() ? payMethodCard() : null,
    h('div', { class: 'member-grid' }, ordersBox, h('div', null, faq, redeemBox))
  );
}

/* ---------------- 全站免费模式 ---------------- */
function renderFreeMode() {
  document.title = '全站免费开放 · 遇见';
  const tips = [
    ['不需要付费', '当前站点所有主页的联系方式都免费开放，不存在会员、套餐或充值入口。'],
    ['登录即可查看', '注册一个账号并登录，就能看到完整微信 / QQ / 手机号，方便直接联系。'],
    ['内容人工核实', '站内主页均由平台核实后发布，发现违规内容可随时举报。'],
  ];
  return h('div', { class: 'container', style: { paddingTop: '40px' } },
    h('div', { class: 'card panel', style: { padding: '34px 30px' } },
      h('span', { class: 'badge badge-ok', style: { marginBottom: '14px' } }, '全站免费'),
      h('h1', { style: { fontSize: '26px', letterSpacing: '-.02em' } }, '本站当前完全免费'),
      h('p', { style: { marginTop: '10px', color: 'var(--ink-2)', fontSize: '14.5px', lineHeight: '1.8' } },
        '没有会员、没有套餐、没有隐藏收费。登录后即可查看全站所有生活照的联系方式。'),
      h('div', { style: { marginTop: '24px', display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
        tips.map(([title, desc]) => h('div', { class: 'tip-box', style: { padding: '16px 18px' } },
          h('strong', null, title),
          h('p', { style: { marginTop: '6px', fontSize: '13px', color: 'var(--ink-2)', lineHeight: '1.75' } }, desc)
        ))
      ),
      h('div', { style: { marginTop: '26px', display: 'flex', gap: '12px', flexWrap: 'wrap' } },
        h('a', { class: 'btn btn-primary', href: '/', 'data-link': '' }, '去浏览同城主页'),
        auth.isLoggedIn ? null : h('button', {
          class: 'btn btn-ghost',
          onclick: () => ensureLogin('登录后即可查看联系方式'),
        }, '登录 / 注册')
      )
    )
  );
}
