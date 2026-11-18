import { api, auth } from '../api.js';
import { h, toast, toastOk, toastError, compressImage } from '../ui.js';
import { navigate } from '../router.js';
import { openAuthModal } from './auth.js';
import { site } from '../site.js';

const MAX_PHOTOS = 8;

export async function render({ query }) {
  document.title = '新建主页 · 遇见';

  // 投稿关闭时普通用户看不到入口，直接访问也只会看到说明
  if (!auth.isAdmin && !site.userPublishEnabled) {
    return h('div', { class: 'container', style: { paddingTop: '48px' } },
      h('div', { class: 'card panel', style: { maxWidth: '520px', margin: '0 auto', textAlign: 'center', padding: '42px 30px' } },
        h('span', { class: 'badge' }, '仅运营方'),
        h('h2', { style: { fontSize: '21px', marginTop: '14px' } }, '本平台主页由官方统一发布'),
        h('p', { style: { color: 'var(--ink-2)', fontSize: '14px', marginTop: '12px', lineHeight: '1.85' } },
          '为了保证照片真实、联系方式有效，站内所有主页都由运营方逐一整理发布，暂不开放用户自行注册上传。'),
        h('p', { style: { color: 'var(--ink-3)', fontSize: '13px', marginTop: '8px', lineHeight: '1.75' } },
          '你可以按省份、城市浏览已发布的主页，登录后即可查看完整联系方式。'),
        h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '24px', flexWrap: 'wrap' } },
          h('a', { class: 'btn btn-primary', href: '/', 'data-link': '' }, '去浏览同城主页'),
          auth.isLoggedIn ? null : h('button', { class: 'btn btn-ghost', onclick: () => openAuthModal({ mode: 'login', onSuccess: () => navigate('/') }) }, '登录')
        )
      )
    );
  }

  if (!auth.isLoggedIn) {
    return h('div', { class: 'container', style: { paddingTop: '40px' } },
      h('div', { class: 'card panel', style: { maxWidth: '520px', margin: '0 auto', textAlign: 'center', padding: '40px 28px' } },
        h('h2', { style: { fontSize: '22px' } }, '请先用运营账号登录'),
        h('p', { style: { color: 'var(--ink-2)', fontSize: '14px', marginTop: '10px', lineHeight: '1.8' } },
          '主页发布属于后台操作，需要管理员账号。'),
        h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '22px', flexWrap: 'wrap' } },
          h('button', { class: 'btn btn-primary', onclick: () => openAuthModal({ mode: 'login', onSuccess: () => navigate('/publish') }) }, '登录')
        )
      )
    );
  }

  const [regions] = await Promise.all([api.get('/api/regions')]);
  const allProvinces = regions.groups.flatMap((g) => g.provinces);

  /* ---------------- 表单状态 ---------------- */
  const state = { photos: [] };

  /* 基本信息 */
  const nickname = h('input', { class: 'input', placeholder: '例如：小满', maxlength: '16' });
  const gender = h('select', { class: 'select' },
    h('option', { value: 'female' }, '女生'), h('option', { value: 'male' }, '男生'));
  const age = h('input', { class: 'input', type: 'number', min: '18', max: '80', placeholder: '例如 26' });
  const heightCm = h('input', { class: 'input', type: 'number', min: '130', max: '220', placeholder: '选填，例如 168' });

  /* 地区 */
  const provinceSel = h('select', { class: 'select' },
    h('option', { value: '' }, '请选择省份'),
    regions.groups.map((g) => h('optgroup', { label: g.region },
      g.provinces.map((p) => h('option', { value: p.code }, p.name)))));
  const citySel = h('select', { class: 'select', disabled: true }, h('option', { value: '' }, '请先选择省份'));
  provinceSel.addEventListener('change', () => {
    const p = allProvinces.find((x) => x.code === provinceSel.value);
    citySel.replaceChildren(h('option', { value: '' }, p ? '请选择城市' : '请先选择省份'));
    citySel.disabled = !p;
    if (p) p.cities.forEach((c) => citySel.appendChild(h('option', { value: c }, c)));
  });

  /* 照片 */
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, hidden: true });
  const uploader = h('div', { class: 'uploader' });
  const uploadHint = h('p', { class: 'hint' }, '支持 JPG / PNG / WEBP，单张不超过 4MB，最多 8 张；第一张会作为封面。');

  function paintUploader() {
    const slots = state.photos.map((p, i) => h('div', { class: 'upload-slot' },
      h('img', { src: p.url, alt: '' }),
      i === 0 ? h('span', { class: 'primary-flag' }, '封面') : null,
      h('button', {
        class: 'del', type: 'button', 'aria-label': '删除',
        onclick: (e) => { e.preventDefault(); state.photos.splice(i, 1); paintUploader(); },
      }, '×')
    ));
    if (state.photos.length < MAX_PHOTOS) {
      slots.push(h('button', {
        class: 'upload-slot', type: 'button',
        onclick: () => fileInput.click(),
        style: { cursor: 'pointer' },
      }, h('span', { html: '&#43;<br /><span style="font-size:12px">添加照片</span>' })));
    }
    uploader.replaceChildren(...slots);
  }

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    for (const file of files) {
      if (state.photos.length >= MAX_PHOTOS) {
        toast(`最多上传 ${MAX_PHOTOS} 张照片`);
        break;
      }
      if (file.size > 12 * 1024 * 1024) {
        toastError(`${file.name} 超过 12MB，请压缩后再上传`);
        continue;
      }
      try {
        const dataUrl = await compressImage(file);
        const slot = h('div', { class: 'upload-slot skeleton' });
        uploader.insertBefore(slot, uploader.lastElementChild);
        const res = await api.post('/api/uploads', { data: dataUrl });
        state.photos.push({ url: res.url });
        paintUploader();
      } catch (err) {
        toastError(err.message || '上传失败');
        paintUploader();
      }
    }
  });

  /* 介绍 */
  const bio = h('textarea', { class: 'textarea', maxlength: '600', placeholder: '介绍一下自己：平时的生活、喜欢做的事、想认识什么样的人（10-600 字）' });
  const bioCount = h('span', { class: 'hint' }, '0 / 600');
  bio.addEventListener('input', () => { bioCount.textContent = `${bio.value.length} / 600`; });

  /* 联系方式 */
  const wechat = h('input', { class: 'input', placeholder: '微信号', maxlength: '60' });
  const qq = h('input', { class: 'input', placeholder: 'QQ 号', maxlength: '60' });
  const phone = h('input', { class: 'input', placeholder: '手机号（选填）', maxlength: '60' });
  const contactNote = h('input', { class: 'input', placeholder: '选填，例如「加我请备注来意」', maxlength: '60' });
  const agree = h('input', { type: 'checkbox' });

  const submitBtn = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, '发布上线');

  /* 预览 */
  const previewImg = h('img', { src: '/assets/placeholder.svg', alt: '' });
  const previewName = h('strong', null, '你的昵称');
  const previewMeta = h('div', { class: 'pcard-meta' }, '省份 城市');
  const previewBio = h('p', { class: 'pcard-bio' }, '介绍一下自己，会显示在这里。');
  function syncPreview() {
    previewImg.src = state.photos[0]?.url || '/assets/placeholder.svg';
    previewName.textContent = nickname.value.trim() || '你的昵称';
    const p = allProvinces.find((x) => x.code === provinceSel.value);
    previewMeta.textContent = `${p?.name || '省份'} ${citySel.value || '城市'}`;
    previewBio.textContent = bio.value.trim() || '介绍一下自己，会显示在这里。';
  }
  [nickname, bio, citySel].forEach((el) => el.addEventListener('input', syncPreview));
  citySel.addEventListener('change', syncPreview);
  provinceSel.addEventListener('change', syncPreview);
  paintUploader();

  const form = h('form', {
    class: 'publish-form',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!state.photos.length) return toastError('请至少上传 1 张生活照');
      if (!nickname.value.trim()) return toastError('请填写昵称');
      if (!age.value) return toastError('请填写年龄');
      if (Number(age.value) < 18 || Number(age.value) > 80) return toastError('年龄需在 18-80 岁之间');
      if (!provinceSel.value || !citySel.value) return toastError('请选择省份和城市');
      if (bio.value.trim().length < 10) return toastError('个人介绍至少 10 个字，让人更好地了解你');
      if (!wechat.value.trim() && !qq.value.trim() && !phone.value.trim()) {
        return toastError('请至少填写一种联系方式');
      }
      if (!agree.checked) return toastError('请确认已阅读发布规范');

      submitBtn.disabled = true;
      submitBtn.textContent = '提交中…';
      try {
        const res = await api.post('/api/profiles', {
          nickname: nickname.value.trim(),
          gender: gender.value,
          age: Number(age.value),
          provinceCode: provinceSel.value,
          city: citySel.value,
          heightCm: heightCm.value ? Number(heightCm.value) : null,
          bio: bio.value.trim(),
          photos: state.photos.map((p) => p.url),
          avatar: state.photos[0]?.url,
          wechat: wechat.value.trim(),
          qq: qq.value.trim(),
          phone: phone.value.trim(),
          contactNote: contactNote.value.trim(),
        });
        if (res.status === 'active') {
          toastOk('已发布上线，现在就能在对应城市看到');
          navigate(`/user/${res.id}`);
        } else {
          toastOk('提交成功，审核通过后就会展示在城市列表里');
          navigate('/me');
        }
      } catch (err) {
        toastError(err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = '发布上线';
      }
    },
  },
    h('div', { class: 'card panel' },
      h('div', { class: 'form-section' },
        h('h3', null, h('span', { class: 'step-num' }, '1'), '基本信息'),
        h('div', { class: 'form-grid' },
          h('div', { class: 'field' }, h('label', null, '昵称'), nickname, h('span', { class: 'hint' }, '2-16 个字，建议用真实感的名字')),
          h('div', { class: 'field' }, h('label', null, '性别'), gender),
          h('div', { class: 'field' }, h('label', null, '年龄'), age, h('span', { class: 'hint' }, '18-80 岁')),
          h('div', { class: 'field' }, h('label', null, '身高（cm）'), heightCm)
        )
      ),
      h('div', { class: 'form-section' },
        h('h3', null, h('span', { class: 'step-num' }, '2'), '所在城市'),
        h('div', { class: 'form-grid' },
          h('div', { class: 'field' }, h('label', null, '省份'), provinceSel),
          h('div', { class: 'field' }, h('label', null, '城市'), citySel)
        )
      ),
      h('div', { class: 'form-section' },
        h('h3', null, h('span', { class: 'step-num' }, '3'), '生活照'),
        uploader, uploadHint, fileInput
      ),
      h('div', { class: 'form-section' },
        h('h3', null, h('span', { class: 'step-num' }, '4'), '个人介绍'),
        h('div', { class: 'field' }, bio, bioCount)
      ),
      h('div', { class: 'form-section' },
        h('h3', null, h('span', { class: 'step-num' }, '5'), '联系方式'),
        h('p', { class: 'hint', style: { marginBottom: '12px' } },
          site.memberEnabled
            ? '联系方式只在会员解锁后展示，列表页与未解锁状态均不会出现完整信息。'
            : '未登录访客只能看到打码值，登录用户可查看完整联系方式。'),
        h('div', { class: 'form-grid' },
          h('div', { class: 'field' }, h('label', null, '微信号'), wechat),
          h('div', { class: 'field' }, h('label', null, 'QQ'), qq),
          h('div', { class: 'field' }, h('label', null, '手机号'), phone),
          h('div', { class: 'field' }, h('label', null, '备注'), contactNote)
        )
      ),
      h('div', { class: 'form-section' },
        h('label', { class: 'checkbox' }, agree,
          h('span', null, '我确认照片与信息已获得当事人授权；不包含违法、低俗、虚假内容或他人隐私；同意按平台规则展示。')),
        h('div', { style: { marginTop: '18px' } }, submitBtn)
      )
    )
  );

  const previewCard = h('div', { class: 'card', style: { overflow: 'hidden' } },
    h('div', { class: 'pcard-media', style: { aspectRatio: '4 / 5' } }, previewImg),
    h('div', { class: 'pcard-body' }, h('div', { class: 'pcard-title' }, previewName), previewMeta, previewBio)
  );

  return h('div', { class: 'container' },
    h('div', { class: 'page-head' },
      h('h1', null, '新建主页'),
      h('p', { class: 'sub' }, '后台发布：填写资料、上传照片后立即上线，按省市展示，无需再走审核队列。')
    ),
    h('div', { class: 'publish-layout' },
      form,
      h('aside', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        h('div', { style: { fontSize: '13px', fontWeight: '700', color: 'var(--ink-2)' } }, '卡片预览'),
        previewCard,
        h('div', { class: 'tip-box' },
          h('strong', null, '发布规范'),
          h('ul', null,
            h('li', null, '只发布已获得授权的真人生活照，不使用网图、明星图或盗用他人照片。'),
            h('li', null, '禁止低俗、暴露、血腥、违法内容。'),
            h('li', null, '禁止在简介中写「有偿」「代聊」「刷单」等导流内容。'),
            h('li', null, '管理员发布的内容直接上线；如需修改或下架，在详情页或后台处理。')
          )
        ),
        h('div', { class: 'tip-box', style: { background: '#fff8f2', borderColor: '#f6e3d3' } },
          h('strong', null, '小技巧'),
          h('ul', null,
            h('li', null, '第一张选光线好的全身或半身照，更容易被点开。'),
            h('li', null, '简介写清楚生活习惯和想认识的人，比空着有效率得多。'),
            h('li', null, '上传 3-5 张不同场景的照片，可信度更高。'),
            h('li', null, '城市选到区县一级，同城匹配更准。')
          )
        )
      )
    )
  );
}
