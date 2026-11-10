import { api, auth } from '../api.js';
import { h, toastOk, toastError, openModal, fmtDate, fmtNum, genderLabel } from '../ui.js';
import { navigate } from '../router.js';
import { breadcrumb } from '../components.js';
import { ensureLogin } from './auth.js';
import { site } from '../site.js';

const REASONS = ['虚假信息', '内容不当', '涉嫌诈骗', '联系方式无效', '侵权盗图', '其他'];

function gallery(photos, nickname) {
  const main = h('img', { src: photos[0]?.url, alt: `${nickname} 的生活照` });
  const counter = h('span', { class: 'gcount' }, `1 / ${photos.length}`);
  const thumbs = h('div', { class: 'gallery-thumbs' });

  let index = 0;
  const buttons = photos.map((p, i) => h('button', {
    class: i === 0 ? 'active' : '',
    'aria-label': `第 ${i + 1} 张`,
    onclick: () => {
      index = i;
      main.src = p.url;
      counter.textContent = `${i + 1} / ${photos.length}`;
      buttons.forEach((b, j) => b.classList.toggle('active', j === i));
    },
  }, h('img', { src: p.url, alt: '', loading: 'lazy' })));
  buttons.forEach((b) => thumbs.appendChild(b));

  return h('div', { class: 'gallery' },
    h('div', { class: 'gallery-main' }, main, counter),
    photos.length > 1 ? thumbs : null
  );
}

function contactSection(profile, onUnlock) {
  const box = h('div', { class: 'contact-box' });

  function paint() {
    const head = h('div', { class: 'contact-head' },
      h('span', null, '联系方式'),
      profile.contactAllowed
        ? h('span', { class: 'badge badge-ok' }, profile.isOwner ? '本人主页' : site.memberEnabled ? '已解锁' : '登录可见')
        : h('span', { class: 'badge' }, site.memberEnabled ? '会员可见' : '登录可见')
    );

    let body;
    if (profile.contactAllowed) {
      const c = profile.contact;
      const rows = [];
      if (c.wechat) rows.push(['微信', c.wechat]);
      if (c.qq) rows.push(['QQ', c.qq]);
      if (c.phone) rows.push(['手机', c.phone]);
      body = h('div', { class: 'contact-body' },
        h('div', { class: 'contact-real' },
          rows.map(([k, val]) => h('div', { class: 'contact-row' },
            h('span', { class: 'k' }, k),
            h('span', { class: 'v' }, val),
            h('button', {
              class: 'copy',
              onclick: async () => {
                try {
                  await navigator.clipboard.writeText(val);
                  toastOk(`已复制${k}`);
                } catch {
                  prompt(`复制${k}`, val);
                }
              },
            }, '复制')
          ))
        ),
        c.note ? h('p', { class: 'contact-note' }, c.note) : null,
        h('p', { class: 'safety-tip' }, '加好友时请说明来意与来源。请勿向对方转账、代付或提供验证码，谨防诈骗。')
      );
    } else {
      const hint = profile.contactHint || {};
      const rows = [
        ['微信', hint.wechat || '未填写'],
        ['QQ', hint.qq || '未填写'],
        ['手机', hint.phone || '未填写'],
      ].filter(([, v]) => v && v !== '未填写');

      const isVip = auth.isVip;
      const left = auth.quota?.freeLeftToday;
      const loggedIn = auth.isLoggedIn;
      const desc = !site.memberEnabled
        ? '本站全站免费，登录后即可查看完整联系方式。'
        : !loggedIn
          ? '登录后每天可免费查看 1 次联系方式，开通会员可无限查看。'
          : isVip
            ? '你已是会员，点击即可查看完整联系方式。'
            : left > 0
              ? `你还有 ${left} 次今日免费查看机会，也可以开通会员无限查看。`
              : '今日免费查看次数已用完，开通会员可无限查看全站联系方式。';
      const btnLabel = !loggedIn
        ? '登录后查看'
        : !site.memberEnabled
          ? '查看联系方式'
          : isVip
            ? '查看完整联系方式'
            : left > 0
              ? '免费查看（今日剩余 1 次）'
              : '开通会员查看';

      body = h('div', { class: 'contact-body' },
        h('div', { class: 'contact-locked' },
          h('div', { class: 'blur-rows' },
            rows.map(([k, v]) => h('div', { class: 'blur-row' },
              h('span', null, k), h('span', null, v)
            ))
          ),
          h('div', { class: 'cta-title' }, '联系方式已隐藏'),
          h('div', { class: 'cta-desc' }, desc),
          h('button', {
            class: 'btn btn-primary btn-block',
            onclick: async () => {
              const okLogin = await ensureLogin('登录后才能查看联系方式');
              if (!okLogin) return;
              try {
                const res = await api.post(`/api/profiles/${profile.id}/unlock`);
                profile.contact = res.contact;
                profile.contactAllowed = true;
                if (res.quota) auth.quota = res.quota;
                toastOk(
                  res.method === 'free-mode'
                    ? '已显示完整联系方式'
                    : res.method === 'free'
                      ? '已使用 1 次免费查看机会'
                      : '联系方式已解锁'
                );
                paint();
              } catch (err) {
                if (err.code === 'NEED_MEMBERSHIP') {
                  membershipPrompt();
                } else {
                  toastError(err.message);
                }
              }
            },
          }, btnLabel)
        )
      );
    }

    box.replaceChildren(head, body);
  }

  paint();
  return box;
}

function membershipPrompt() {
  const { close } = openModal({
    title: '今日免费次数已用完',
    sub: site.memberEnabled ? '开通会员后，可无限查看全站所有生活照的联系方式' : '登录后即可查看全站所有生活照的联系方式',
    content: h('div', null,
      h('div', { style: { marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '10px' } },
        [['月度会员 ¥39', '30 天，适合先试试'], ['季度会员 ¥99', '90 天，最受欢迎'], ['年度会员 ¥299', '365 天，最划算']]
          .map(([t, d]) => h('div', {
            class: 'contact-row', style: { cursor: 'pointer' },
            onclick: () => { close(); navigate('/member'); },
          },
            h('div', { style: { flex: '1' } },
              h('div', { style: { fontWeight: '700', fontSize: '14px' } }, t),
              h('div', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, d)),
            h('span', { style: { color: 'var(--brand-deep)', fontWeight: '700', fontSize: '13px' } }, '去开通 →')
          ))
      ),
      h('button', { class: 'btn btn-ghost btn-block', style: { marginTop: '16px' }, onclick: close }, '先看看别的')
    ),
  });
}

function reportModal(profile) {
  const reasonSel = h('select', { class: 'select' }, REASONS.map((r) => h('option', { value: r }, r)));
  const detail = h('textarea', { class: 'textarea', placeholder: '补充说明（选填），例如具体问题出现在第几张照片', maxlength: '300' });
  const { close } = openModal({
    title: '举报这个主页',
    sub: '我们会在 24 小时内核实处理，感谢你的反馈',
    content: h('div', { class: 'modal-form' },
      h('div', { class: 'field' }, h('label', null, '举报原因'), reasonSel),
      h('div', { class: 'field' }, h('label', null, '补充说明'), detail),
      h('button', {
        class: 'btn btn-primary btn-block',
        onclick: async () => {
          try {
            await api.post('/api/reports', {
              profileId: profile.id, reason: reasonSel.value, detail: detail.value.trim(),
            });
            close();
            toastOk('举报已提交，我们会尽快处理');
          } catch (err) {
            toastError(err.message);
          }
        },
      }, '提交举报')
    ),
  });
}

export async function render({ params }) {
  const profile = await api.get(`/api/profiles/${params.id}`);
  document.title = `${profile.nickname} · ${profile.provinceName}${profile.city} · 遇见`;

  const isOwnerBanner = profile.isOwner && profile.status !== 'active'
    ? h('div', {
        style: {
          marginBottom: '18px', padding: '14px 18px', borderRadius: '14px',
          background: profile.status === 'rejected' ? '#fdf1f1' : '#fdf8ec',
          border: `1px solid ${profile.status === 'rejected' ? '#f6d8d8' : '#f5e6c8'}`,
          color: profile.status === 'rejected' ? '#9c2f2f' : '#8a6a24', fontSize: '13px',
        },
      },
        h('strong', null, profile.status === 'rejected' ? '审核未通过：' : '正在审核中：'),
        profile.status === 'rejected'
          ? '该主页未通过审核，修改后可重新提交。'
          : '主页已提交，审核通过后就会出现在对应城市列表里。'
      )
    : null;

  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      breadcrumb([
        { label: '首页', href: '/' },
        { label: profile.provinceName, href: `/p/${profile.provinceCode}` },
        { label: profile.city, href: `/p/${profile.provinceCode}/${encodeURIComponent(profile.city)}` },
        { label: profile.nickname },
      ]),
      isOwnerBanner
    ),
    h('div', { class: 'detail-layout' },
      profile.photos.length ? gallery(profile.photos, profile.nickname) : h('div', { class: 'gallery-main' }),
      h('div', { class: 'card info-card' },
        h('div', { class: 'info-top' },
          h('img', { class: 'info-avatar', src: profile.avatar, alt: '' }),
          h('div', null,
            h('div', { class: 'info-name' },
              profile.nickname,
              h('span', { class: `chip ${profile.gender === 'female' ? 'gender-f' : 'gender-m'}` }, genderLabel(profile.gender))
            ),
            h('div', { class: 'info-sub' },
              h('span', null, `${profile.provinceName} ${profile.city}`)
            )
          )
        ),
        h('dl', { class: 'info-facts' },
          h('div', null, h('dt', null, '年龄'), h('dd', null, profile.age ? `${profile.age} 岁` : '未填')),
          profile.heightCm ? h('div', null, h('dt', null, '身高'), h('dd', null, `${profile.heightCm} cm`)) : null,
          h('div', null, h('dt', null, '照片'), h('dd', null, `${profile.photoCount} 张`)),
          h('div', null, h('dt', null, '浏览'), h('dd', null, fmtNum(profile.viewCount)))
        ),
        profile.bio ? h('p', { class: 'info-bio' }, profile.bio) : null,
        contactSection(profile),
        h('div', { style: { marginTop: '14px', fontSize: '12px', color: 'var(--ink-4)', textAlign: 'center' } },
          `发布于 ${fmtDate(profile.createdAt)}`),
        h('div', { class: 'report-link' },
          h('button', { onclick: () => reportModal(profile) }, '内容有问题？举报'))
      )
    )
  );
}
