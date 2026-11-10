import { api } from '../api.js';
import { h } from '../ui.js';
import { profileCard, sectionHead, promoBand } from '../components.js';
import { site } from '../site.js';
import { navigate } from '../router.js';

export async function render() {
  document.title = '遇见 · 同城生活照平台';
  const [regions, summary, latest] = await Promise.all([
    api.get('/api/regions'),
    api.get('/api/provinces'),
    api.get('/api/profiles?pageSize=8&sort=new'),
  ]);

  /* ---------------- 首屏 ---------------- */
  const provinces = summary.groups.flatMap((g) => g.provinces);
  const provinceSelect = h('select', { class: 'select', 'aria-label': '按地区筛选' },
    h('option', { value: '' }, '全部地区'),
    provinces.map((p) => h('option', { value: p.code }, p.name))
  );
  const searchInput = h('input', {
    class: 'input', placeholder: '搜昵称、城市或简介', maxlength: '24', 'aria-label': '搜索关键词',
  });
  const searchBtn = h('button', { class: 'btn btn-primary' }, '搜索');
  const doSearch = () => {
    const kw = searchInput.value.trim();
    if (kw) { navigate(`/search?q=${encodeURIComponent(kw)}`); return; }
    if (provinceSelect.value) { navigate(`/p/${provinceSelect.value}`); return; }
    navigate('/search');
  };
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  searchBtn.addEventListener('click', doSearch);

  const hero = h('section', { class: 'container' },
    h('div', { class: 'hero' },
      h('span', { class: 'hero-eyebrow' }, '真实生活记录 · 每周更新'),
      h('h1', null, '在同一个城市，', h('br'), '看看', h('em', null, '别人的日常')),
      h('p', { class: 'hero-sub' },
        '按省市浏览真实生活照与简介。联系方式默认打码，登录后可以先免费查看一次，开通会员则不限制次数。'),
      h('div', { class: 'searchbar', style: { gridTemplateColumns: '170px minmax(0, 1fr) auto' } },
        provinceSelect, searchInput, searchBtn),
      h('div', { class: 'hero-art' },
        latest.items.slice(0, 3).map((it, i) => h('img', {
          src: it.cover, alt: '', class: 'hero-pic',
          style: { transform: 'rotate(' + [-5, 3, -3][i] + 'deg)' },
        }))
      ),
      h('div', { class: 'hero-stats' },
        h('div', null, h('b', null, String(summary.totalProfiles)), h('span', null, '在线主页')),
        h('div', null, h('b', null, String(summary.totalCities)), h('span', null, '覆盖城市')),
        h('div', null, h('b', null, String(summary.totalProvinces)), h('span', null, '省级地区'))
      )
    )
  );

  /* ---------------- 省份导航（首页第一屏） ---------------- */
  const allProvinces = summary.groups.flatMap((g) => g.provinces.map((p) => ({ ...p, region: g.region })));
  const grid = h('div', { class: 'province-grid' });
  const tabs = h('div', { class: 'region-tabs' });

  function paintProvince(region) {
    const list = region === '全部' ? allProvinces : allProvinces.filter((p) => p.region === region);
    grid.replaceChildren(...list.map((p) => h('a', {
      class: `province-card ${p.profileCount > 0 ? 'hot' : ''}`,
      href: `/p/${p.code}`,
      'data-link': '',
    },
      h('div', { class: 'pname' }, p.name),
      h('div', { class: 'pmeta' }, `${p.cityCount} 个城市`),
      h('div', { class: 'pcount' }, p.profileCount > 0 ? `${p.profileCount} 位用户` : '暂无主页')
    )));
  }

  ['全部', ...regions.groups.map((g) => g.region)].forEach((name, i) => {
    const btn = h('button', { class: `region-tab ${i === 0 ? 'active' : ''}`, onclick: () => {
      [...tabs.children].forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      paintProvince(name);
    } }, name);
    tabs.appendChild(btn);
  });
  paintProvince('全部');

  const provinceSection = h('section', { class: 'container section section-first' },
    sectionHead('按省份找同城', `共 ${summary.totalProvinces} 个省级地区 · ${summary.totalCities} 个城市 · ${summary.totalProfiles} 位用户`),
    tabs,
    grid
  );

  /* ---------------- 热门城市 ---------------- */
  const hotCities = h('section', { class: 'container section' },
    sectionHead('热门城市', '这些城市的主页更新最活跃'),
    h('div', { class: 'city-grid' },
      summary.hotCities.map((c) => h('a', {
        class: 'city-pill',
        href: `/p/${c.provinceCode}/${encodeURIComponent(c.city)}`,
        'data-link': '',
      },
        h('span', null, c.city),
        h('small', null, `${c.provinceName}${c.profileCount > 0 ? ` · ${c.profileCount} 人` : ''}`)
      ))
    )
  );

  /* ---------------- 最新加入 ---------------- */
  const latestSection = h('section', { class: 'container section' },
    sectionHead('最新加入', '近期新增的生活照主页', '/search'),
    latest.items.length
      ? h('div', { class: 'profile-grid' }, latest.items.map(profileCard))
      : h('div', { class: 'empty' }, h('strong', null, '还没有主页'), h('p', null, '新主页正在整理中，敬请期待'))
  );

  /* ---------------- 说明 ---------------- */
  const howItWorks = h('section', { class: 'container section' },
    sectionHead('这里怎么玩', '三步就知道怎么用'),
    h('div', { class: 'facets', style: {
      display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    } },
      [
        ['01', '按省市找到同城', '34 个省级地区、300 多个城市，点进去就是当地的生活照。'],
        ['02', '先看生活，再决定', '每张照片都是日常记录，简介里写着生活习惯和想认识的人。'],
        site.memberEnabled
          ? ['03', '解锁联系方式', '觉得合适再解锁微信/QQ，避免被打扰，也让交流更有诚意。']
          : ['03', '登录查看联系方式', '注册登录后即可看到对方微信/QQ，直接沟通，全站不收费。'],
      ].map(([num, title, desc]) => h('div', { class: 'card panel' },
        h('span', { class: 'step-num' }, num),
        h('h3', { style: { fontSize: '16px', marginTop: '12px' } }, title),
        h('p', { style: { fontSize: '13px', color: 'var(--ink-2)', marginTop: '8px', lineHeight: '1.75' } }, desc)
      ))
    )
  );

  const safety = h('section', { class: 'container section' },
    h('div', { class: 'tip-box', style: { padding: '22px 24px' } },
      h('strong', null, '安全提示'),
      h('ul', { style: { marginTop: '8px' } },
        h('li', null, '平台仅提供信息展示，不参与任何线下交易；请勿向陌生人转账、代付或提供验证码。'),
        h('li', null, '禁止发布违法、低俗、虚假或侵犯他人权益的内容，一经核实立即下架并封禁账号。'),
        h('li', null, '如遇骚扰或诈骗，请在主页底部点击「举报」，我们会在 24 小时内处理。')
      )
    )
  );

  /* ---------------- 顶部公告 ---------------- */
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const openNow = minutes >= 9 * 60 && minutes < 21 * 60 + 30;

  const notice = h('div', { class: 'container' },
    h('div', { class: 'site-notice' },
      h('span', { class: 'site-notice-tag' }, '公告'),
      h('p', { class: 'site-notice-text' },
        '演示站点：站内主页与联系方式均为自动生成的测试数据，会员支付走模拟通道，不会真实扣款。客服时间 ',
        h('strong', null, '9:00 – 21:30'), '。'),
      h('span', { class: `site-notice-state ${openNow ? 'open' : ''}` },
        openNow ? '现在营业中' : '现在已休息')
    )
  );

  return h('div', null, notice, hero, provinceSection, hotCities, latestSection, howItWorks, h('div', { class: 'container' }, promoBand()), safety);
}
