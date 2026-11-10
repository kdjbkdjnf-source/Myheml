import { h, fmtNum, genderChip } from './ui.js';
import { site } from './site.js';

export function profileCard(item) {
  return h('a', { class: 'pcard', href: `/user/${item.id}`, 'data-link': '' },
    h('div', { class: 'pcard-media' },
      h('img', { src: item.cover, alt: `${item.nickname} 的生活照`, loading: 'lazy', decoding: 'async' }),
      h('span', { class: 'lock-flag', html: site.memberEnabled ? '&#128274; 会员可见联系方式' : '&#128274; 登录可见联系方式' }),
      item.photoCount > 1 ? h('span', { class: 'photos-flag' }, `${item.photoCount} 张`) : null
    ),
    h('div', { class: 'pcard-body' },
      h('div', { class: 'pcard-title' },
        h('strong', null, item.nickname),
        genderChip(item.gender)
      ),
      h('div', { class: 'pcard-meta' },
        item.age ? h('span', null, `${item.age} 岁`) : null,
        item.age ? h('span', { class: 'sep', style: { color: 'var(--ink-4)' } }, '·') : null,
        h('span', null, `${item.provinceName} ${item.city}`)
      ),
      item.bio ? h('p', { class: 'pcard-bio' }, item.bio) : null
    )
  );
}

export function sectionHead(title, sub, moreHref, moreText = '查看全部') {
  return h('div', { class: 'section-head' },
    h('div', null, h('h2', null, title), sub ? h('p', null, sub) : null),
    moreHref ? h('a', { class: 'more', href: moreHref, 'data-link': '' }, `${moreText} →`) : null
  );
}

export function breadcrumb(items) {
  const nodes = [];
  items.forEach((it, i) => {
    if (i > 0) nodes.push(h('span', { class: 'sep' }, '/'));
    nodes.push(it.href ? h('a', { href: it.href, 'data-link': '' }, it.label) : h('span', null, it.label));
  });
  return h('div', { class: 'breadcrumb' }, nodes);
}

export function statLine(items) {
  return h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', color: 'var(--ink-3)', fontSize: '12.5px' } },
    items.filter(Boolean).map((t) => h('span', null, t))
  );
}

export function promoBand() {
  // 全站免费模式：不再引导购买会员
  if (!site.memberEnabled) return null;
  return h('div', {
    style: {
      marginTop: '56px', padding: '30px 32px', borderRadius: '24px',
      background: 'linear-gradient(120deg, #2a1f1c, #3d2b28 60%, #4b2b34)',
      color: '#fff', display: 'flex', gap: '24px', alignItems: 'center',
      justifyContent: 'space-between', flexWrap: 'wrap',
    },
  },
    h('div', { style: { maxWidth: '34em' } },
      h('h3', { style: { fontSize: '21px', letterSpacing: '-.01em' } }, '想看更多真实生活照和联系方式？'),
      h('p', { style: { color: 'rgba(255,255,255,.7)', fontSize: '13.5px', marginTop: '8px', lineHeight: '1.7' } },
        '开通会员后可无限制查看全站联系方式，每个主页都经过人工审核，联系方式仅在授权后展示。')
    ),
    h('a', { class: 'btn btn-lg', href: '/member', 'data-link': '', style: { background: '#fff', color: '#1b1613' } }, '查看会员方案')
  );
}
