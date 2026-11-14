import { api, auth } from '../api.js';
import { h, fmtDate, money, toastOk, toastError, confirmDialog, emptyState } from '../ui.js';
import { navigate } from '../router.js';
import { ensureLogin } from './auth.js';
import { site } from '../site.js';

const STATUS = {
  active: { label: '已上线', cls: 'badge-ok' },
  pending: { label: '审核中', cls: 'badge-warn' },
  rejected: { label: '未通过', cls: '' },
  hidden: { label: '已下架', cls: 'badge-gray' },
};

export async function render() {
  document.title = '我的账号 · 遇见';
  if (!auth.isLoggedIn) {
    return h('div', { class: 'container', style: { paddingTop: '40px' } },
      h('div', { class: 'card panel', style: { maxWidth: '460px', margin: '0 auto', textAlign: 'center', padding: '36px 26px' } },
        h('h2', { style: { fontSize: '20px' } }, '登录后查看我的账号'),
        h('button', { class: 'btn btn-primary', style: { marginTop: '18px' }, onclick: async () => {
          const ok = await ensureLogin();
          if (ok) navigate('/me');
        } }, '去登录')
      ));
  }

  const [mine, orders] = await Promise.all([
    api.get('/api/my/profiles').catch(() => ({ items: [] })),
    api.get('/api/my/orders').catch(() => ({ items: [] })),
  ]);

  /* ---------------- 我的主页 ---------------- */
  const mineList = mine.items.length
    ? h('div', null, mine.items.map((p) => {
        const st = STATUS[p.status] || STATUS.pending;
        return h('div', { class: 'mine-item' },
          p.cover ? h('img', { src: p.cover, alt: '' }) : h('div', { class: 'skeleton', style: { width: '64px', height: '80px', borderRadius: '10px' } }),
          h('div', { class: 'grow' },
            h('div', { class: 'row' },
              h('strong', null, p.nickname),
              h('span', { class: `badge ${st.cls}` }, st.label),
              h('span', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, `${p.provinceName} ${p.city}`)
            ),
            p.status === 'rejected' && p.rejectReason
              ? h('p', { style: { fontSize: '12.5px', color: '#9c2f2f', marginTop: '5px' } }, `驳回原因：${p.rejectReason}`)
              : null,
            h('div', { style: { fontSize: '12px', color: 'var(--ink-3)', marginTop: '6px' } },
              `${p.photoCount} 张照片 · ${p.viewCount} 次浏览 · ${p.unlockCount} 人解锁联系方式 · 发布于 ${fmtDate(p.createdAt)}`)
          ),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('a', { class: 'btn btn-ghost btn-sm', href: `/user/${p.id}`, 'data-link': '' }, '查看'),
            h('button', {
              class: 'btn btn-ghost btn-sm',
              onclick: async () => {
                const sure = await confirmDialog({
                  title: '删除这个主页？',
                  message: '删除后将从城市列表中移除，且无法恢复。已产生的浏览与解锁记录会保留用于统计。',
                  confirmText: '确认删除',
                  danger: true,
                });
                if (!sure) return;
                try {
                  await api.del(`/api/profiles/${p.id}`);
                  toastOk('已删除');
                  navigate('/me');
                } catch (err) {
                  toastError(err.message);
                }
              },
            }, '删除')
          )
        );
      }))
    : emptyState(
        auth.isAdmin ? '还没有发布过主页' : '暂无主页',
        auth.isAdmin ? '新建后立即上线，会出现在对应城市的列表里。' : '本平台主页由官方统一整理发布。',
        auth.isAdmin
          ? h('div', { style: { marginTop: '18px' } },
              h('a', { class: 'btn btn-primary', href: '/publish', 'data-link': '' }, '新建主页'))
          : h('div', { style: { marginTop: '18px' } },
              h('a', { class: 'btn btn-primary', href: '/', 'data-link': '' }, '去浏览同城主页')));

  /* ---------------- 订单 ---------------- */
  const orderList = orders.items.length
    ? h('table', { class: 'orders-table' },
        h('thead', null, h('tr', null,
          h('th', null, '订单'), h('th', null, '套餐'), h('th', null, '金额'), h('th', null, '状态'), h('th', null, '时间'))),
        h('tbody', null, orders.items.map((o) => h('tr', null,
          h('td', null, `#${o.id}`),
          h('td', null, o.planName),
          h('td', null, money(o.amount)),
          h('td', null, o.status === 'paid' ? h('span', { class: 'badge badge-ok' }, '已支付') : h('span', { class: 'badge badge-gray' }, '待支付')),
          h('td', { style: { color: 'var(--ink-3)' } }, fmtDate(o.paidAt || o.createdAt, true))
        )))
      )
    : h('p', { style: { fontSize: '13px', color: 'var(--ink-3)' } }, '还没有订单记录。');

  /* ---------------- 改密码 ---------------- */
  const oldPwd = h('input', { class: 'input', type: 'password', placeholder: '当前密码', maxlength: '64' });
  const newPwd = h('input', { class: 'input', type: 'password', placeholder: '新密码（至少 8 位，含字母和数字）', maxlength: '64' });
  const pwdForm = h('form', {
    style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '360px' },
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/me/password', { oldPassword: oldPwd.value, newPassword: newPwd.value });
        toastOk('密码已更新');
        oldPwd.value = '';
        newPwd.value = '';
      } catch (err) {
        toastError(err.message);
      }
    },
  }, oldPwd, newPwd, h('button', { class: 'btn btn-dark', type: 'submit' }, '保存新密码'));

  /* ---------------- Tabs ---------------- */
  const panels = {
    profiles: () => h('div', null,
      h('div', { class: 'row', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' } },
        h('span', { style: { fontSize: '13px', color: 'var(--ink-3)' } }, `共 ${mine.items.length} 个主页`),
        auth.isAdmin ? h('a', { class: 'btn btn-soft btn-sm', href: '/publish', 'data-link': '' }, '＋ 新建主页') : null),
      mineList),
    orders: () => h('div', { class: 'card panel' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } },
        h('h3', { style: { fontSize: '15px' } }, '我的订单'),
        site.memberEnabled
          ? h('a', { class: 'btn btn-soft btn-sm', href: '/member', 'data-link': '' }, auth.isVip ? '续费' : '开通会员')
          : null),
      orderList),
    security: () => h('div', { class: 'card panel' },
      h('h3', { style: { fontSize: '15px', marginBottom: '14px' } }, '修改密码'),
      pwdForm),
  };

  const panelHost = h('div');
  const tabBar = h('div', { class: 'tabs' });
  // 我的主页只在开放投稿或管理员账号下才有意义
  const canManageProfiles = site.userPublishEnabled || auth.isAdmin;
  const TAB_META = [
    canManageProfiles ? ['profiles', '我的主页'] : null,
    site.memberEnabled ? ['orders', '会员与订单'] : null,
    ['security', '账号安全'],
  ].filter(Boolean);

  function switchTab(key) {
    [...tabBar.children].forEach((b) => b.classList.toggle('active', b.dataset.key === key));
    panelHost.replaceChildren(panels[key]());
  }
  TAB_META.forEach(([key, label], i) => {
    tabBar.appendChild(h('button', { 'data-key': key, class: i === 0 ? 'active' : '', onclick: () => switchTab(key) }, label));
  });
  switchTab(TAB_META[0][0]);

  const statusCards = h('div', { class: 'stat-grid', style: { marginBottom: '26px' } },
    h('div', { class: 'stat' }, h('b', null, auth.user.username), h('span', null, '账号')),
    h('div', { class: 'stat' },
      h('b', { style: { fontSize: '18px' } }, site.memberEnabled ? (auth.isVip ? '会员' : '免费用户') : '全站免费'),
      h('span', null, site.memberEnabled
        ? (auth.isVip ? `有效期至 ${fmtDate(auth.user.vipExpiresAt)}` : `今日免费查看 ${auth.quota?.freeLeftToday ?? 0} 次`)
        : '联系方式登录即可查看')),
    canManageProfiles
      ? h('div', { class: 'stat' }, h('b', null, String(mine.items.length)), h('span', null, '我的主页'))
      : h('div', { class: 'stat' }, h('b', { style: { fontSize: '18px' } }, '可查看'), h('span', null, '联系方式')),
    site.memberEnabled
      ? h('div', { class: 'stat' }, h('b', null, String(orders.items.filter((o) => o.status === 'paid').length)), h('span', null, '已支付订单'))
      : h('div', { class: 'stat' }, h('b', { style: { fontSize: '18px' } }, '—'), h('span', null, '没有付费项目'))
  );

  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      h('h1', null, '我的账号'),
      h('p', { class: 'sub' }, `注册于 ${fmtDate(auth.user.createdAt)}`)),
    h('div', { style: { marginTop: '24px' } }, statusCards),
    tabBar,
    panelHost
  );
}
