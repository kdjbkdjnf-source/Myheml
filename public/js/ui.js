/* 轻量 DOM / UI 工具：全部基于 createElement，天然免疫 XSS */

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v; // 仅用于静态图标
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------- Toast ---------------- */
export function toast(message, type = '') {
  const stack = document.getElementById('toast-stack');
  const node = h('div', { class: `toast ${type}` }, message);
  stack.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 220);
  }, 2600);
}

export const toastError = (msg) => toast(msg, 'err');
export const toastOk = (msg) => toast(msg, 'ok');

/* ---------------- Modal ---------------- */
export function openModal({ title, sub, content, wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  const modal = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', style: { position: 'relative' } },
    h('button', { class: 'modal-close', 'aria-label': '关闭', onclick: close, html: '&times;' }),
    title ? h('h3', null, title) : null,
    sub ? h('p', { class: 'modal-sub' }, sub) : null,
    content
  );
  const backdrop = h('div', {
    class: 'modal-backdrop',
    onclick: (e) => { if (e.target === backdrop) close(); },
  }, modal);
  root.appendChild(backdrop);
  document.addEventListener('keydown', onKey);
  return { close, modal };
}

export function confirmDialog({ title, message, confirmText = '确认', danger = false }) {
  return new Promise((resolve) => {
    /* close() 会同步触发 onClose，若先 resolve 再 close，
       Promise 会被 onClose 抢先 settle 成 false，导致「确认」永远无效。
       这里用 settled 标记保证第一次结果生效。 */
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const { close } = openModal({
      title,
      content: h('div', null,
        h('p', { style: { marginTop: '12px', color: 'var(--ink-2)', fontSize: '14px', lineHeight: '1.7' } }, message),
        h('div', { class: 'modal-actions', style: { marginTop: '22px' } },
          h('button', { class: 'btn btn-ghost btn-block', onclick: () => { done(false); close(); } }, '取消'),
          h('button', {
            class: `btn btn-block ${danger ? 'btn-primary' : 'btn-dark'}`,
            onclick: () => { done(true); close(); },
          }, confirmText)
        )
      ),
      onClose: () => done(false),
    });
  });
}

/* ---------------- 格式化 ---------------- */
export const fmtNum = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n ?? 0));

export function fmtDate(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return fmtDate(iso);
}

export const money = (n) => `¥${(Math.round(n * 100) / 100).toFixed(n % 1 === 0 ? 0 : 2)}`;

export const genderLabel = (g) => (g === 'female' ? '女生' : '男生');
export const genderChip = (g) => h('span', { class: `chip ${g === 'female' ? 'gender-f' : 'gender-m'}` }, genderLabel(g));

export function initialOf(name) {
  return (name || '遇').trim().charAt(0);
}

export function skeletonGrid(count = 8) {
  return h('div', { class: 'profile-grid' },
    Array.from({ length: count }, () => h('div', { class: 'sk-card skeleton' }))
  );
}

export function emptyState(title, desc, action) {
  return h('div', { class: 'empty' }, h('strong', null, title), h('p', null, desc), action);
}

/* ---------------- 图片压缩上传 ---------------- */
export function compressImage(file, { maxSize = 1440, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      reject(new Error('仅支持 JPG / PNG / WEBP 图片'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const hgt = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hgt;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, hgt);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function debounce(fn, wait = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
