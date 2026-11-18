import { api, auth } from '../api.js';
import { h, fmtDate, fmtNum, money, toastOk, toastError, openModal, confirmDialog, emptyState } from '../ui.js';
import { navigate } from '../router.js';
import { site } from '../site.js';

function guard() {
  return h('div', { class: 'container', style: { paddingTop: '40px' } },
    h('div', { class: 'card panel', style: { maxWidth: '460px', margin: '0 auto', textAlign: 'center', padding: '36px 26px' } },
      h('h2', { style: { fontSize: '20px' } }, '需要管理员权限'),
      h('p', { style: { color: 'var(--ink-3)', fontSize: '13.5px', marginTop: '10px' } },
        auth.isLoggedIn ? '当前账号没有后台权限。' : '请使用管理员账号登录后访问。'),
      h('a', { class: 'btn btn-ghost', style: { marginTop: '18px' }, href: '/', 'data-link': '' }, '回到首页')
    )
  );
}

function rejectModal(profile, after) {
  const ta = h('textarea', { class: 'textarea', placeholder: '例如：照片不是本人、简介含联系方式、内容低俗', maxlength: '100' });
  const { close } = openModal({
    title: `驳回：${profile.nickname}`,
    sub: '驳回理由会展示给发布者',
    content: h('div', { class: 'modal-form' },
      ta,
      h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async () => {
          try {
            await api.post(`/api/admin/profiles/${profile.id}/review`, { action: 'reject', reason: ta.value.trim() });
            close();
            toastOk('已驳回');
            after();
          } catch (err) { toastError(err.message); }
        },
      }, '确认驳回')
    ),
  });
}

async function reviewPanel(host) {
  const { items } = await api.get('/api/admin/profiles?status=pending');
  const reload = () => navigate('/admin');
  if (!items.length) {
    host.replaceChildren(emptyState('没有待审核的主页', '新的提交会出现在这里。', null));
    return;
  }
  host.replaceChildren(h('div', { class: 'card', style: { overflow: 'auto' } },
    h('table', { class: 'admin-table' },
      h('thead', null, h('tr', null,
        h('th', null, '主页'), h('th', null, '地区'), h('th', null, '发布者'), h('th', null, '照片'), h('th', null, '时间'), h('th', null, '操作'))),
      h('tbody', null, items.map((p) => h('tr', null,
        h('td', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
          p.cover ? h('img', { class: 'thumb', src: p.cover, alt: '' }) : null,
          h('div', null,
            h('div', { style: { fontWeight: '700' } }, p.nickname),
            h('div', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, `${p.age} 岁 · ${p.gender === 'female' ? '女' : '男'}`)))),
        h('td', null, `${p.provinceName} ${p.city}`),
        h('td', null, p.ownerName || '-'),
        h('td', null, `${p.photoCount} 张`),
        h('td', { style: { color: 'var(--ink-3)', fontSize: '12px' } }, fmtDate(p.createdAt, true)),
        h('td', null, h('div', { class: 'actions' },
          h('a', { class: 'btn btn-ghost btn-sm', href: `/user/${p.id}`, 'data-link': '' }, '查看'),
          h('button', {
            class: 'btn btn-primary btn-sm',
            onclick: async () => {
              try {
                await api.post(`/api/admin/profiles/${p.id}/review`, { action: 'approve' });
                toastOk('已通过审核，主页已上线');
                reload();
              } catch (err) { toastError(err.message); }
            },
          }, '通过'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => rejectModal(p, reload) }, '驳回')
        ))
      )))
    )
  ));
}

async function reportPanel(host) {
  const { items } = await api.get('/api/admin/reports?status=open');
  const reload = () => navigate('/admin');
  if (!items.length) {
    host.replaceChildren(emptyState('没有待处理的举报', '处理完的举报会归档。', null));
    return;
  }
  host.replaceChildren(h('div', { class: 'card', style: { overflow: 'auto' } },
    h('table', { class: 'admin-table' },
      h('thead', null, h('tr', null,
        h('th', null, '被举报主页'), h('th', null, '原因'), h('th', null, '说明'), h('th', null, '举报人'), h('th', null, '时间'), h('th', null, '操作'))),
      h('tbody', null, items.map((r) => h('tr', null,
        h('td', null,
          h('div', { style: { fontWeight: '700' } }, r.nickname || `#${r.profileId}`),
          h('div', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, `${r.provinceName} ${r.city || ''} · ${r.profileStatus || '已删除'}`)),
        h('td', null, h('span', { class: 'badge badge-warn' }, r.reason)),
        h('td', { style: { maxWidth: '220px', fontSize: '12.5px', color: 'var(--ink-2)' } }, r.detail || '—'),
        h('td', null, r.reporter),
        h('td', { style: { color: 'var(--ink-3)', fontSize: '12px' } }, fmtDate(r.createdAt, true)),
        h('td', null, h('div', { class: 'actions' },
          h('button', {
            class: 'btn btn-primary btn-sm',
            onclick: async () => {
              const sure = await confirmDialog({
                title: '核实并下架该主页？',
                message: '举报成立时，主页会立即从列表中隐藏，并记录处理结果。',
                confirmText: '下架主页',
                danger: true,
              });
              if (!sure) return;
              try {
                await api.post(`/api/admin/reports/${r.id}/handle`, { action: 'resolve', hideProfile: true });
                toastOk('已处理并下架');
                reload();
              } catch (err) { toastError(err.message); }
            },
          }, '成立·下架'),
          h('button', {
            class: 'btn btn-ghost btn-sm',
            onclick: async () => {
              try {
                await api.post(`/api/admin/reports/${r.id}/handle`, { action: 'dismiss' });
                toastOk('已忽略该举报');
                reload();
              } catch (err) { toastError(err.message); }
            },
          }, '忽略')
        ))
      )))
    )
  ));
}

async function userPanel(host) {
  const input = h('input', { class: 'input', placeholder: '搜索用户名', style: { maxWidth: '260px' } });
  const listHost = h('div', { style: { marginTop: '16px' } });

  async function load(q = '') {
    const { items } = await api.get(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    listHost.replaceChildren(h('div', { class: 'card', style: { overflow: 'auto' } },
      h('table', { class: 'admin-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'ID'), h('th', null, '用户名'), h('th', null, '角色'), h('th', null, '会员'), h('th', null, '主页'), h('th', null, '注册时间'), h('th', null, '状态'), h('th', null, '操作'))),
        h('tbody', null, items.map((u) => h('tr', null,
          h('td', null, `#${u.id}`),
          h('td', { style: { fontWeight: '700' } }, u.username),
          h('td', null, u.role === 'admin' ? h('span', { class: 'badge' }, '管理员') : '用户'),
          h('td', null, u.vipActive
            ? h('span', { class: 'badge badge-ok' }, `至 ${fmtDate(u.vipExpiresAt)}`)
            : h('span', { style: { color: 'var(--ink-4)' } }, '免费')),
          h('td', null, `${u.profileCount} 个`),
          h('td', { style: { color: 'var(--ink-3)', fontSize: '12px' } }, fmtDate(u.createdAt)),
          h('td', null, u.status === 'banned'
            ? h('span', { class: 'badge' }, '已封禁')
            : h('span', { class: 'badge badge-ok' }, '正常')),
          h('td', null, u.role === 'admin'
            ? '—'
            : h('button', {
                class: 'btn btn-ghost btn-sm',
                onclick: async () => {
                  try {
                    await api.post(`/api/admin/users/${u.id}/status`, { status: u.status === 'banned' ? 'active' : 'banned' });
                    toastOk(u.status === 'banned' ? '已解封' : '已封禁，主页同步下架');
                    load(input.value.trim());
                  } catch (err) { toastError(err.message); }
                },
              }, u.status === 'banned' ? '解封' : '封禁'))
        )))
      )
    ));
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(input.value.trim()); });
  host.replaceChildren(h('div', null,
    h('div', { style: { display: 'flex', gap: '10px' } }, input,
      h('button', { class: 'btn btn-ghost', onclick: () => load(input.value.trim()) }, '搜索')),
    listHost));
  await load();
}

async function codePanel(host) {
  const planSel = h('select', { class: 'select', style: { maxWidth: '180px' } },
    h('option', { value: 'vip_1m' }, '月度会员'), h('option', { value: 'vip_3m' }, '季度会员'), h('option', { value: 'vip_1y' }, '年度会员'));
  const countInput = h('input', { class: 'input', type: 'number', min: '1', max: '100', value: '5', style: { maxWidth: '110px' } });
  const output = h('div', { style: { marginTop: '16px' } });
  const listHost = h('div', { style: { marginTop: '22px' } });

  async function loadList() {
    const { items } = await api.get('/api/admin/redeem-codes');
    listHost.replaceChildren(h('div', { class: 'card', style: { overflow: 'auto' } },
      h('table', { class: 'admin-table' },
        h('thead', null, h('tr', null, h('th', null, '兑换码'), h('th', null, '套餐'), h('th', null, '状态'), h('th', null, '使用时间'), h('th', null, '生成时间'))),
        h('tbody', null, items.map((c) => h('tr', null,
          h('td', { style: { fontFamily: 'ui-monospace, monospace', fontWeight: '700' } }, c.code),
          h('td', null, c.planCode),
          h('td', null, c.used ? h('span', { class: 'badge badge-gray' }, '已使用') : h('span', { class: 'badge badge-ok' }, '可用')),
          h('td', { style: { color: 'var(--ink-3)', fontSize: '12px' } }, c.usedAt ? fmtDate(c.usedAt, true) : '—'),
          h('td', { style: { color: 'var(--ink-3)', fontSize: '12px' } }, fmtDate(c.createdAt, true))
        )))
      )
    ));
  }

  host.replaceChildren(h('div', { class: 'card panel' },
    h('h3', { style: { fontSize: '15px' } }, '批量生成兑换码'),
    h('p', { style: { fontSize: '12.5px', color: 'var(--ink-3)', marginTop: '6px' } }, '用于线下售卖或活动赠送，一码一用。'),
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' } },
      planSel, countInput,
      h('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          try {
            const res = await api.post('/api/admin/redeem-codes', {
              planCode: planSel.value, count: Number(countInput.value),
            });
            output.replaceChildren(h('div', { class: 'tip-box', style: { marginTop: '14px' } },
              h('strong', null, `已生成 ${res.codes.length} 个兑换码：`),
              h('div', { style: { fontFamily: 'ui-monospace, monospace', marginTop: '8px', lineHeight: '1.9' } }, res.codes.join('　')),
              h('button', {
                class: 'btn btn-ghost btn-sm', style: { marginTop: '10px' },
                onclick: async () => {
                  try { await navigator.clipboard.writeText(res.codes.join('\n')); toastOk('已复制'); }
                  catch { prompt('复制兑换码', res.codes.join('\n')); }
                },
              }, '复制全部')
            ));
            loadList();
          } catch (err) { toastError(err.message); }
        },
      }, '生成')
    ),
    output
  ), h('h3', { style: { fontSize: '15px', margin: '24px 0 0' } }, '已生成的兑换码'), listHost);

  await loadList();
}

/* ---------------- 人工收款确认 ---------------- */
const ORDER_TABS = [
  ['claimed', '待确认'],
  ['paid', '已开通'],
  ['pending', '未转账'],
  ['all', '全部'],
];

function rejectOrderModal(order, after) {
  const ta = h('textarea', {
    class: 'textarea',
    placeholder: '例如：没有收到款项、金额不符',
    maxlength: '100',
  });
  const { close } = openModal({
    title: `驳回订单 #${order.id}`,
    sub: `${order.username} · ${order.planName} · ¥${order.amount}`,
    content: h('div', null,
      h('p', { style: { marginTop: '12px', fontSize: '13px', color: 'var(--ink-2)', lineHeight: '1.7' } },
        '驳回后订单会移出待确认列表，用户需要重新下单。理由会附在订单备注里，方便你自己回看。'),
      h('div', { style: { marginTop: '14px' } }, ta),
      h('div', { class: 'modal-actions', style: { marginTop: '20px' } },
        h('button', { class: 'btn btn-ghost btn-block', onclick: close }, '取消'),
        h('button', {
          class: 'btn btn-primary btn-block',
          onclick: async () => {
            try {
              await api.post(`/api/admin/orders/${order.id}/reject`, { reason: ta.value.trim() });
              close();
              toastOk('已驳回');
              after();
            } catch (err) { toastError(err.message); }
          },
        }, '确认驳回')
      )
    ),
  });
}

async function orderPanel(host) {
  let current = 'claimed';

  const listHost = h('div', { style: { marginTop: '18px' } });
  const tabHost = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });

  async function loadList() {
    [...tabHost.children].forEach((b) => b.classList.toggle('btn-dark', b.dataset.key === current));
    [...tabHost.children].forEach((b) => b.classList.toggle('btn-ghost', b.dataset.key !== current));
    listHost.replaceChildren(h('div', { class: 'skeleton', style: { height: '120px' } }));

    let data;
    try {
      data = await api.get(`/api/admin/orders?status=${current}`);
    } catch (err) {
      toastError(err.message);
      listHost.replaceChildren();
      return;
    }

    if (!data.items.length) {
      listHost.replaceChildren(h('div', { class: 'card' },
        emptyState(
          current === 'claimed' ? '没有待确认的转账' : '这个分类下还没有记录',
          current === 'claimed'
            ? '用户在会员页提交「我已完成转账」后，订单会出现在这里。核对微信到账后点「确认到账」即可开通。'
            : '换个分类看看。'
        )
      ));
      return;
    }

    listHost.replaceChildren(h('div', { class: 'card', style: { overflow: 'auto' } },
      h('table', { class: 'admin-table' },
        h('thead', null, h('tr', null,
          h('th', null, '订单'),
          h('th', null, '用户'),
          h('th', null, '套餐'),
          h('th', null, '金额'),
          h('th', null, '用户填写'),
          h('th', null, '状态'),
          h('th', null, '提交时间'),
          h('th', null, '操作')
        )),
        h('tbody', null, data.items.map((o) => h('tr', null,
          h('td', { style: { fontFamily: 'ui-monospace, monospace', fontWeight: '700' } }, `#${o.id}`),
          h('td', null,
            h('div', { style: { fontWeight: '700' } }, o.username),
            o.isVipNow ? h('div', { style: { fontSize: '11px', color: 'var(--ink-3)' } }, `已是会员至 ${fmtDate(o.vipExpiresAt)}`) : null
          ),
          h('td', null, h('div', null, o.planName), h('div', { style: { fontSize: '11px', color: 'var(--ink-3)' } }, `${o.days} 天`)),
          h('td', { style: { fontWeight: '700' } }, money(o.amount)),
          h('td', { style: { fontSize: '12px', color: 'var(--ink-2)', maxWidth: '200px' } }, o.note || '—'),
          h('td', null,
            o.status === 'claimed' ? h('span', { class: 'badge badge-warn' }, '待确认')
              : o.status === 'paid' ? h('span', { class: 'badge badge-ok' }, '已开通')
                : o.status === 'rejected' ? h('span', { class: 'badge badge-err' }, '已驳回')
                  : h('span', { class: 'badge badge-gray' }, '未转账')
          ),
          h('td', { style: { color: 'var(--ink-3)', fontSize: '12px' } }, fmtDate(o.claimedAt || o.createdAt, true)),
          h('td', null, h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            ['pending', 'claimed'].includes(o.status)
              ? h('button', {
                  class: 'btn btn-primary btn-sm',
                  onclick: async (e) => {
                    const btn = e.currentTarget;
                    const ok = await confirmDialog({
                      title: `确认收到 ¥${o.amount}？`,
                      message: `确认为「${o.username}」开通 ${o.planName}（${o.days} 天）。请先在微信里核对这笔到账，确认后立即生效。`,
                      confirmText: '已到账，开通',
                    });
                    if (!ok) return;
                    btn.disabled = true;
                    btn.textContent = '开通中…';
                    try {
                      const res = await api.post(`/api/admin/orders/${o.id}/confirm`);
                      toastOk(`已开通，${res.username} 会员至 ${fmtDate(res.vipExpiresAt)}`);
                      loadList();
                    } catch (err) {
                      toastError(err.message);
                      btn.disabled = false;
                      btn.textContent = '确认到账';
                    }
                  },
                }, '确认到账')
              : null,
            ['pending', 'claimed'].includes(o.status)
              ? h('button', {
                  class: 'btn btn-ghost btn-sm',
                  onclick: () => rejectOrderModal(o, loadList),
                }, '驳回')
              : null
          ))
        )))
      )
    ));
  }

  ORDER_TABS.forEach(([key, label]) => {
    tabHost.appendChild(h('button', {
      class: 'btn btn-sm btn-ghost',
      dataset: { key },
      onclick: () => { current = key; loadList(); },
    }, label));
  });

  host.replaceChildren(h('div', { class: 'card panel' },
    h('h3', { style: { fontSize: '15px' } }, '收款确认'),
    h('p', { style: { fontSize: '12.5px', color: 'var(--ink-3)', marginTop: '6px', lineHeight: '1.75' } },
      '本站不接线上支付：用户微信转账后自己提交，你核对到账后点「确认到账」，会员立即生效。没收到钱就驳回，订单会移出队列。'),
    h('div', { style: { marginTop: '14px' } }, tabHost)
  ), listHost);

  await loadList();
}

export async function render() {
  document.title = '管理控制台 · 遇见';
  if (!auth.isAdmin) return guard();

  const stats = await api.get('/api/admin/stats');

  const panelHost = h('div');
  const tabBar = h('div', { class: 'tabs' });
  // 只保留当前模式真正用得上的标签：不开放投稿就没有待审核，
  // 免费模式没有订单与兑换码
  const PANELS = [
    ['overview', '数据概览'],
    site.userPublishEnabled ? ['review', '待审核'] : null,
    site.memberEnabled && site.payMode === 'manual'
      ? ['orders', `收款确认${stats.ordersClaimed ? `（${stats.ordersClaimed}）` : ''}`]
      : null,
    ['reports', '举报处理'],
    ['users', '用户管理'],
    site.memberEnabled ? ['codes', '兑换码'] : null,
  ].filter(Boolean);
  const renderers = {
    overview: () => h('div', null,
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('b', null, fmtNum(stats.users)), h('span', null, '注册用户')),
        site.memberEnabled
          ? h('div', { class: 'stat' }, h('b', null, fmtNum(stats.vipUsers)), h('span', null, '有效会员'))
          : null,
        h('div', { class: 'stat' }, h('b', null, fmtNum(stats.profilesActive)), h('span', null, '在线主页')),
        site.userPublishEnabled
          ? h('div', { class: 'stat' }, h('b', null, fmtNum(stats.profilesPending)), h('span', null, '待审核'))
          : null,
        h('div', { class: 'stat' }, h('b', null, fmtNum(stats.reportsOpen)), h('span', null, '待处理举报')),
        h('div', { class: 'stat' }, h('b', null, fmtNum(stats.photos)), h('span', null, '照片总数')),
        site.memberEnabled
          ? h('div', { class: 'stat' }, h('b', null, money(stats.revenue)), h('span', null, `累计收入（${stats.ordersPaid} 单）`))
          : null,
        site.memberEnabled && site.payMode === 'manual'
          ? h('div', { class: 'stat' }, h('b', null, fmtNum(stats.ordersClaimed)), h('span', null, '待确认转账'))
          : null
      ),
      h('div', { class: 'tip-box', style: { marginTop: '22px' } },
        h('strong', null, '运营提示'),
        h('ul', null,
          site.userPublishEnabled
            ? h('li', null, `当前有 ${stats.profilesPending} 个主页等待审核，审核通过后才会出现在城市列表。`)
            : h('li', null, '主页由你在后台发布，发布即上线；如要修改或下架，在详情页或用户管理里处理。'),
          h('li', null, `有 ${stats.reportsOpen} 条待处理举报，建议 24 小时内处理完毕。`),
          site.memberEnabled && site.payMode === 'manual' && stats.ordersClaimed > 0
            ? h('li', null, `有 ${stats.ordersClaimed} 笔转账等你确认，去「收款确认」核对到账后开通。`)
            : null,
          h('li', null, '上线前请把演示主页（账号 station）清理掉，避免与真实内容混淆。')
        )
      )
    ),
    review: () => h('div', null, h('div', { class: 'skeleton', style: { height: '120px' } })),
    orders: () => h('div', null, h('div', { class: 'skeleton', style: { height: '120px' } })),
    reports: () => h('div', null, h('div', { class: 'skeleton', style: { height: '120px' } })),
    users: () => h('div', null, h('div', { class: 'skeleton', style: { height: '120px' } })),
    codes: () => h('div', null, h('div', { class: 'skeleton', style: { height: '120px' } })),
  };

  async function switchTab(key) {
    [...tabBar.children].forEach((b) => b.classList.toggle('active', b.dataset.key === key));
    if (key === 'overview') { panelHost.replaceChildren(renderers.overview()); return; }
    panelHost.replaceChildren(h('div', { class: 'skeleton', style: { height: '120px' } }));
    if (key === 'review') await reviewPanel(panelHost);
    else if (key === 'orders') await orderPanel(panelHost);
    else if (key === 'reports') await reportPanel(panelHost);
    else if (key === 'users') await userPanel(panelHost);
    else await codePanel(panelHost);
  }

  PANELS.forEach(([key, label], i) => {
    tabBar.appendChild(h('button', { 'data-key': key, class: i === 0 ? 'active' : '', onclick: () => switchTab(key) }, label));
  });

  panelHost.replaceChildren(renderers.overview());

  return h('div', { class: 'container' },
    h('div', { class: 'page-head', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' } },
      h('div', null,
        h('h1', null, '管理控制台'),
        h('p', { class: 'sub' }, '发布主页、审核内容、处理举报、管理用户')),
      h('a', { class: 'btn btn-primary', href: '/publish', 'data-link': '' }, '＋ 新建主页')),
    h('div', { style: { marginTop: '24px' } }, tabBar, panelHost)
  );
}
