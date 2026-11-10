let handler = null;

export function setRouteHandler(fn) {
  handler = fn;
}

export function navigate(path, { replace = false, keepScroll = false } = {}) {
  if (path === location.pathname + location.search) {
    handler?.();
    return;
  }
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  if (!keepScroll) window.scrollTo({ top: 0, behavior: 'auto' });
  handler?.();
}

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[data-link]');
  if (!a || a.target === '_blank') return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
}

export function startRouter(renderFn) {
  setRouteHandler(renderFn);
  document.addEventListener('click', onClick);
  window.addEventListener('popstate', () => renderFn());
  renderFn();
}
