import { routes as authRoutes } from './auth.routes.js';
import { routes as catalogRoutes } from './catalog.routes.js';
import { routes as publishRoutes } from './publish.routes.js';
import { routes as memberRoutes } from './member.routes.js';
import { routes as adminRoutes } from './admin.routes.js';
import {
  FREE_MODE, MEMBER_ENABLED, MEMBER_MODE, MANUAL_PAY,
  PAY_WECHAT_ID, PAY_QR_IMAGE, PAY_PAYEE_NAME,
  ADMIN_ONLY_PUBLISH, PUBLISH_MODE_LABEL,
} from '../lib/config.js';

/** 站点运行参数：前端据此决定是否展示会员入口、用哪种收款方式 */
const configRoutes = [
  {
    method: 'GET',
    path: '/api/config',
    handler: async () => ({
      memberMode: MEMBER_MODE,          // free | manual | paid
      memberEnabled: MEMBER_ENABLED,
      payMode: MANUAL_PAY ? 'manual' : FREE_MODE ? 'free' : 'online',
      payWechat: MEMBER_ENABLED ? PAY_WECHAT_ID : null,
      payQr: MEMBER_ENABLED && PAY_QR_IMAGE ? PAY_QR_IMAGE : null,
      payPayee: MEMBER_ENABLED ? PAY_PAYEE_NAME : null,
      freeDailyUnlock: FREE_MODE ? null : 1,
      publishMode: PUBLISH_MODE_LABEL,
      userPublishEnabled: !ADMIN_ONLY_PUBLISH,
    }),
  },
];

const ALL = [...configRoutes, ...authRoutes, ...catalogRoutes, ...publishRoutes, ...memberRoutes, ...adminRoutes];

const compiled = ALL.map((r) => {
  const names = [];
  const pattern = r.path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { ...r, regex: new RegExp(`^${pattern}/?$`), names };
});

/** 返回 { route, params } 或 { methodMismatch:true } 或 null */
export function matchRoute(method, pathname) {
  let methodMismatch = false;
  for (const item of compiled) {
    const m = item.regex.exec(pathname);
    if (!m) continue;
    if (item.method !== method) {
      methodMismatch = true;
      continue;
    }
    const params = {};
    item.names.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1]);
    });
    return { route: item, params };
  }
  if (methodMismatch) return { methodMismatch: true };
  return null;
}

export const ROUTE_COUNT = ALL.length;
