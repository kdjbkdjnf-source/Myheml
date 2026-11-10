import { api, query as qs } from '../api.js';
import { h, fmtNum, toastError, emptyState } from '../ui.js';
import { navigate } from '../router.js';
import { profileCard, sectionHead, breadcrumb } from '../components.js';

/* ================================================================== */
/* 省份页                                                             */
/* ================================================================== */
async function provincePage(code) {
  const data = await api.get(`/api/provinces/${encodeURIComponent(code)}`);
  document.title = `${data.province.name} · 同城生活照 · 遇见`;

  const total = data.cities.reduce((s, c) => s + c.profileCount, 0);

  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      breadcrumb([{ label: '首页', href: '/' }, { label: data.province.name }]),
      h('h1', null, data.province.name),
      h('p', { class: 'sub' }, `${data.province.region} · ${data.cities.length} 个城市 · ${total} 位在线用户`)
    ),
    h('section', { class: 'section', style: { marginTop: '30px' } },
      sectionHead('选择城市', '点进城市就能看到当地的生活照'),
      h('div', { class: 'city-grid' },
        data.cities.map((c) => h('a', {
          class: 'city-pill',
          href: `/p/${data.province.code}/${encodeURIComponent(c.name)}`,
          'data-link': '',
        },
          c.profileCount > 0 ? h('span', { class: 'dot' }) : null,
          h('span', null, c.name),
          h('small', null, c.profileCount > 0 ? `${c.profileCount} 人` : '暂无')
        ))
      )
    ),
    data.latest.length
      ? h('section', { class: 'section' },
          sectionHead(`${data.province.name}最新加入`, '最近发布生活照的用户'),
          h('div', { class: 'profile-grid' }, data.latest.map(profileCard))
        )
      : h('section', { class: 'section' },
          emptyState(`${data.province.name}还没有主页`,
            '这里的城市都还空着，你可以成为第一个发布生活照的人。',
            h('div', { style: { marginTop: '18px' } },
              h('a', { class: 'btn btn-primary', href: '/publish', 'data-link': '' }, '发布我的生活照')))
        )
  );
}

/* ================================================================== */
/* 列表 + 筛选（城市页 / 搜索页共用）                                 */
/* ================================================================== */
function listingSection({ province, city, keyword, heading, sub }) {
  const state = { gender: '', age: '', sort: 'new', page: 1, hasMore: true, items: [], loading: false };
  const grid = h('div', { class: 'profile-grid' });
  const loadWrap = h('div', { class: 'load-more-wrap' });
  const countLine = h('div', { style: { fontSize: '13px', color: 'var(--ink-3)' } });

  const ageOptions = [
    ['', '不限年龄'], ['18-24', '18-24 岁'], ['25-29', '25-29 岁'], ['30-34', '30-34 岁'], ['35-45', '35 岁以上'],
  ];

  const genderSeg = h('div', { class: 'seg' },
    [['', '全部'], ['female', '女生'], ['male', '男生']].map(([v, label], i) =>
      h('button', { class: i === 0 ? 'active' : '', onclick: (e) => {
        [...genderSeg.children].forEach((c) => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.gender = v;
        reload();
      } }, label))
  );

  const ageSel = h('select', { class: 'select', onchange: (e) => {
    state.age = e.target.value;
    reload();
  } }, ageOptions.map(([v, label]) => h('option', { value: v }, label)));

  const sortSeg = h('div', { class: 'seg' },
    [['new', '最新'], ['hot', '最热']].map(([v, label], i) =>
      h('button', { class: i === 0 ? 'active' : '', onclick: (e) => {
        [...sortSeg.children].forEach((c) => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.sort = v;
        reload();
      } }, label))
  );

  const filterBar = h('div', { class: 'filter-bar' },
    genderSeg, ageSel, h('div', { class: 'spacer' }), countLine, sortSeg
  );

  async function load() {
    if (state.loading || !state.hasMore) return;
    state.loading = true;
    const [minAge, maxAge] = state.age ? state.age.split('-') : ['', ''];
    try {
      const data = await api.get(`/api/profiles${qs({
        province, city, q: keyword,
        gender: state.gender, minAge, maxAge,
        sort: state.sort, page: state.page, pageSize: 12,
      })}`);
      state.items.push(...data.items);
      state.hasMore = data.hasMore;
      state.page += 1;
      countLine.textContent = `共 ${data.total} 位`;
      grid.replaceChildren(...state.items.map(profileCard));
      if (!state.items.length) {
        grid.replaceChildren(emptyState('这里还没有人发布',
          keyword ? '换个关键词试试，或者去首页按省份浏览。' : '这个筛选条件下暂时没有主页，换个城市或用「全部」看看。',
          h('div', { style: { marginTop: '18px' } },
            h('a', { class: 'btn btn-primary', href: '/publish', 'data-link': '' }, '发布我的生活照'))));
      }
      loadWrap.replaceChildren(
        state.hasMore
          ? h('button', { class: 'btn btn-ghost btn-lg', onclick: () => load() }, '加载更多')
          : (state.items.length ? h('span', { style: { fontSize: '13px', color: 'var(--ink-4)' } }, '已经到底啦') : '')
      );
    } catch (err) {
      toastError(err.message);
    } finally {
      state.loading = false;
    }
  }

  function reload() {
    state.page = 1;
    state.hasMore = true;
    state.items = [];
    grid.replaceChildren(...Array.from({ length: 8 }, () => h('div', { class: 'sk-card skeleton' })));
    loadWrap.replaceChildren();
    load();
  }

  reload();

  return h('section', { class: 'section', style: { marginTop: '26px' } },
    h('div', { class: 'section-head', style: { marginBottom: '0' } },
      h('div', null, h('h2', null, heading), sub ? h('p', null, sub) : null)),
    filterBar,
    h('div', { style: { marginTop: '22px' } }, grid),
    loadWrap
  );
}

/* ================================================================== */
/* 城市页                                                             */
/* ================================================================== */
async function cityPage(code, city, query) {
  const data = await api.get(`/api/provinces/${encodeURIComponent(code)}`);
  const provinceName = data.province.name;
  const cityInfo = data.cities.find((c) => c.name === city);
  document.title = `${provinceName}${city} · 同城生活照 · 遇见`;

  const sides = data.cities
    .filter((c) => c.name !== city && c.profileCount > 0)
    .slice(0, 12);

  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      breadcrumb([
        { label: '首页', href: '/' },
        { label: provinceName, href: `/p/${code}` },
        { label: city },
      ]),
      h('h1', null, city),
      h('p', { class: 'sub' }, `${provinceName} · ${cityInfo?.profileCount || 0} 位在线用户${query?.q ? ` · 关键词「${query.q}」` : ''}`)
    ),
    listingSection({
      province: code,
      city,
      keyword: query?.q || '',
      heading: `${city}的生活照`,
      sub: '点开主页可以看到完整照片、简介和联系方式',
    }),
    sides.length
      ? h('section', { class: 'section' },
          sectionHead(`${provinceName}其他城市`, '附近城市的人也在等你'),
          h('div', { class: 'city-grid' },
            sides.map((c) => h('a', {
              class: 'city-pill',
              href: `/p/${code}/${encodeURIComponent(c.name)}`,
              'data-link': '',
            }, h('span', { class: 'dot' }), h('span', null, c.name), h('small', null, `${c.profileCount} 人`)))
          ))
      : null
  );
}

/* ================================================================== */
/* 搜索页                                                             */
/* ================================================================== */
export async function renderSearch({ query }) {
  const keyword = (query?.q || '').trim();
  document.title = keyword ? `搜索「${keyword}」 · 遇见` : '搜索 · 遇见';

  const input = h('input', { class: 'input', value: keyword, placeholder: '搜索昵称、城市或简介', maxlength: '24' });
  const go = () => {
    const kw = input.value.trim();
    navigate(kw ? `/search?q=${encodeURIComponent(kw)}` : '/search');
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      breadcrumb([{ label: '首页', href: '/' }, { label: '搜索' }]),
      h('h1', null, keyword ? `搜索「${keyword}」` : '搜索'),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '16px', maxWidth: '520px' } },
        input,
        h('button', { class: 'btn btn-primary', onclick: go }, '搜索')
      )
    ),
    listingSection({ keyword, heading: keyword ? '搜索结果' : '全部主页', sub: '全国范围内的生活照' })
  );
}

export async function render({ params, query }) {
  if (params.city) return cityPage(params.code, params.city, query);
  return provincePage(params.code);
}
