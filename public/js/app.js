import { startRouter, navigate } from './router.js';
import { auth } from './api.js';
import { h, skeletonGrid } from './ui.js';
import { openAuthModal } from './pages/auth.js';
import * as home from './pages/home.js';
import * as region from './pages/region.js';
import * as profile from './pages/profile.js';
import * as member from './pages/member.js';
import * as publish from './pages/publish.js';
import * as account from './pages/account.js';
import * as admin from './pages/admin.js';
import * as rules from './pages/rules.js';
import { emptyState } from './ui.js';
import { site, loadSite } from './site.js';

const ROUTES = [
  { re: /^\/$/, page: home, name: 'home' },
  { re: /^\/p\/([^/]+)$/, page: region, params: ['code'], name: 'home' },
  { re: /^\/p\/([^/]+)\/([^/]+)$/, page: region, params: ['code', 'city'], name: 'home' },
  { re: /^\/search$/, page: region, fn: 'renderSearch', name: 'home' },
  { re: /^\/user\/(\d+)$/, page: profile, params: ['id'], name: 'home' },
  { re: /^\/member$/, page: member, name: 'member' },
  { re: /^\/publish$/, page: publish, name: 'publish' },
  { re: /^\/me$/, page: account, name: 'me' },
  { re: /^\/admin$/, page: admin, name: 'admin' },
  { re: /^\/rules$/, page: rules, name: '' },
];

const app = document.getElementById('app');

function decodePath(pathname) {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

function resolve(pathname) {
  const path = decodePath(pathname).replace(/\/+$/, '') || '/';
  for (const route of ROUTES) {
    const m = route.re.exec(path);
    if (!m) continue;
    const params = {};
    (route.params || []).forEach((key, i) => { params[key] = m[i + 1]; });
    return { route, params, path };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 顶栏                                                               */
/* ------------------------------------------------------------------ */
/** 按站点模式调整静态模板里的会员相关入口 */
export function applySiteMode() {
  const navMember = document.getElementById('nav-member');
  if (navMember) navMember.hidden = !site.memberEnabled;
  const footerMember = document.getElementById('footer-member');
  if (footerMember) footerMember.hidden = !site.memberEnabled;
  const footerNote = document.getElementById('footer-note');
  if (footerNote) {
    footerNote.textContent = site.memberEnabled
      ? '一个记录真实生活的小社区。所有主页由平台统一整理发布，联系方式仅在会员授权后展示。'
      : '一个记录真实生活的小社区。所有主页由平台统一整理发布，登录后即可查看联系方式。';
  }
}

export function renderHeader() {
  const box = document.getElementById('header-actions');
  const adminLink = document.getElementById('nav-admin');
  if (adminLink) adminLink.hidden = !auth.isAdmin;
  // 主页由平台统一发布：除非站点开放投稿，否则创建入口只对管理员可见
  const publishLink = document.getElementById('nav-publish');
  if (publishLink) publishLink.hidden = !(auth.isAdmin || site.userPublishEnabled);

  if (!auth.user) {
    box.replaceChildren(
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => openAuthModal({ mode: 'login', onSuccess: afterAuth }),
      }, '登录'),
      h('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => openAuthModal({ mode: 'register', onSuccess: afterAuth }),
      }, '免费注册')
    );
    return;
  }

  const initial = auth.user.username.trim().charAt(0).toUpperCase();
  const menu = h('div', { class: 'menu-drop', hidden: true },
    h('a', { href: '/me', 'data-link': '' }, '我的主页'),
    site.memberEnabled
      ? h('a', { href: '/member', 'data-link': '' }, auth.isVip ? '会员权益' : '开通会员')
      : null,
    auth.isAdmin ? h('a', { href: '/publish', 'data-link': '' }, '新建主页') : null,
    auth.isAdmin ? h('a', { href: '/admin', 'data-link': '' }, '管理控制台') : null,
    h('div', { class: 'divider' }),
    h('button', {
      onclick: async () => {
        await auth.logout();
        afterAuth();
      },
    }, '退出登录')
  );

  const btn = h('button', {
    class: 'avatar-btn',
    onclick: (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    },
  },
    h('span', { class: 'ava' }, initial),
    h('span', null, auth.user.username),
    auth.isVip ? h('span', { class: 'badge' }, '会员') : null
  );

  document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
  box.replaceChildren(h('div', { class: 'avatar-menu' }, btn, menu));
}

function afterAuth() {
  renderHeader();
  renderMobileNav();
  render();
}

/* ------------------------------------------------------------------ */
/* 移动端底栏                                                         */
/* ------------------------------------------------------------------ */
function renderMobileNav() {
  let nav = document.querySelector('.mobile-nav');
  if (!nav) {
    nav = h('nav', { class: 'mobile-nav' });
    document.body.appendChild(nav);
  }
  const ICONS = {
    home: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9.5Z"/></svg>',
    member: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 1.5-9 4 4L12 6l2.5 6 4-4L20 17H4Z"/><path d="M6.5 20h11"/></svg>',
    publish: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="6.4"/><path d="m16 16 4 4"/></svg>',
    me: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20c.8-3.6 3.7-5.6 7.2-5.6s6.4 2 7.2 5.6"/></svg>',
  };

  const item = (href, label, key) =>
    h('a', { href, 'data-link': '', 'data-nav-mobile': key },
      h('span', { style: { lineHeight: 0 }, html: ICONS[key] }),
      label);

  nav.replaceChildren(
    ...[
      item('/', '首页', 'home'),
      site.memberEnabled ? item('/member', '会员', 'member') : item('/search', '搜索', 'search'),
      auth.isAdmin ? item('/publish', '新建', 'publish') : null,
      item('/me', '我的', 'me'),
    ].filter(Boolean)
  );
}

function markActive(name) {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === name);
  });
  document.querySelectorAll('[data-nav-mobile]').forEach((el) => {
    el.classList.toggle('active', el.dataset.navMobile === name);
  });
}

/* ------------------------------------------------------------------ */
/* 渲染                                                               */
/* ------------------------------------------------------------------ */
let renderSeq = 0;

export async function render() {
  const seq = ++renderSeq;
  const matched = resolve(location.pathname);

  if (!matched) {
    markActive('');
    document.title = '页面不存在 · 遇见';
    app.replaceChildren(h('div', { class: 'container' },
      emptyState('页面不存在', '你访问的地址可能已经失效。', h('div', { style: { marginTop: '18px' } },
        h('a', { class: 'btn btn-primary', href: '/', 'data-link': '' }, '回到首页')))));
    return;
  }

  markActive(matched.route.name);
  app.replaceChildren(h('div', { class: 'container', style: { paddingTop: '28px' } }, skeletonGrid(6)));

  try {
    const fn = matched.route.fn || 'render';
    const node = await matched.route.page[fn]({ params: matched.params, path: matched.path, query: Object.fromEntries(new URLSearchParams(location.search)) });
    if (seq !== renderSeq) return;
    app.replaceChildren(node);
    renderHeader();
    markActive(matched.route.name);
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    app.replaceChildren(h('div', { class: 'container', style: { paddingTop: '40px' } },
      emptyState('页面加载失败', err?.message || '请稍后重试', h('div', { style: { marginTop: '18px' } },
        h('button', { class: 'btn btn-ghost', onclick: () => render() }, '重新加载')))));
  }
}

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */
async function boot() {
  window.addEventListener('scroll', () => {
    document.getElementById('site-header')?.classList.toggle('scrolled', window.scrollY > 6);
  }, { passive: true });

  window.addEventListener('auth:change', () => {
    renderHeader();
    renderMobileNav();
  });

  await Promise.all([auth.refresh(), loadSite()]);
  applySiteMode();
  renderHeader();
  renderMobileNav();
  startRouter(render);

  window.addEventListener('auth:refresh-request', () => {
    auth.refresh().then(afterAuth);
  });
}

boot();
