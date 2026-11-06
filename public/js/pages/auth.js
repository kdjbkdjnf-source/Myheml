import { h, openModal, toastOk, toastError } from '../ui.js';
import { api, auth } from '../api.js';

function errorLine() {
  const node = h('p', {
    style: { display: 'none', color: 'var(--danger)', fontSize: '13px', marginTop: '-4px' },
    role: 'alert',
  });
  return {
    node,
    show(msg) {
      node.textContent = msg;
      node.style.display = 'block';
    },
    hide() {
      node.style.display = 'none';
    },
  };
}

export function openAuthModal({ mode = 'login', onSuccess, title } = {}) {
  let current = mode;
  const err = errorLine();
  const body = h('div');

  const modalApi = openModal({
    title: title || (current === 'login' ? '欢迎回来' : '创建一个账号'),
    sub: '注册并登录后即可查看完整联系方式',
    content: body,
  });

  function finish(data) {
    auth.apply(data);
    toastOk(current === 'login' ? '登录成功' : '注册成功，欢迎加入');
    modalApi.close();
    onSuccess?.(auth.user);
  }

  function renderForm() {
    const isLogin = current === 'login';
    const usernameInput = h('input', {
      class: 'input', name: 'username', autocomplete: 'username',
      placeholder: isLogin ? '用户名' : '3-20 位字母、数字或中文', maxlength: '20', required: true,
    });
    const passwordInput = h('input', {
      class: 'input', type: 'password', name: 'password',
      autocomplete: isLogin ? 'current-password' : 'new-password',
      placeholder: isLogin ? '密码' : '至少 8 位，含字母和数字', maxlength: '64', required: true,
    });
    const confirmInput = h('input', {
      class: 'input', type: 'password', placeholder: '再次输入密码', maxlength: '64',
    });
    const agree = h('input', { type: 'checkbox' });
    const submit = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' },
      isLogin ? '登录' : '注册并开始浏览');
    let busy = false;

    const form = h('form', {
      class: 'modal-form',
      onsubmit: async (e) => {
        e.preventDefault();
        if (busy) return;
        err.hide();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) return err.show('请填写用户名和密码');
        if (!isLogin) {
          if (password !== confirmInput.value) return err.show('两次输入的密码不一致');
          if (!agree.checked) return err.show('请先阅读并同意社区公约');
          if (password.length < 8) return err.show('密码至少 8 位');
        }
        busy = true;
        submit.disabled = true;
        submit.textContent = '处理中…';
        try {
          const data = await api.post(isLogin ? '/api/auth/login' : '/api/auth/register', {
            username, password, agree: agree.checked,
          });
          finish(data);
        } catch (e2) {
          err.show(e2.message);
          busy = false;
          submit.disabled = false;
          submit.textContent = isLogin ? '登录' : '注册并开始浏览';
        }
      },
    },
      err.node,
      h('div', { class: 'field' }, h('label', null, '用户名'), usernameInput),
      h('div', { class: 'field' }, h('label', null, '密码'), passwordInput),
      isLogin ? null : h('div', { class: 'field' }, h('label', null, '确认密码'), confirmInput),
      isLogin
        ? null
        : h('label', { class: 'checkbox' }, agree,
            h('span', null, '我已阅读并同意《社区公约》：不发布违法、低俗、虚假信息，尊重他人隐私。')),
      submit,
      h('div', { class: 'auth-switch' },
        isLogin ? '还没有账号？' : '已有账号？',
        h('button', {
          type: 'button',
          onclick: () => { current = isLogin ? 'register' : 'login'; renderForm(); },
        }, isLogin ? '立即注册' : '去登录')
      ),
      h('p', { class: 'auth-legal' }, '演示环境默认账号：demo / Demo@123456')
    );

    body.replaceChildren(form);
    setTimeout(() => usernameInput.focus(), 60);
  }

  renderForm();
  return modalApi;
}

/** 需要登录的动作统一入口：未登录则弹窗，返回 Promise<boolean> */
export function ensureLogin(message = '登录后才能继续操作') {
  if (auth.isLoggedIn) return Promise.resolve(true);
  if (message) toastError(message);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openAuthModal({
      onSuccess: () => done(true),
      onClose: () => done(false),
    });
  });
}
