import { api } from './api.js';

/**
 * 站点运行参数（由 GET /api/config 下发）。
 * 关键字段 memberEnabled：false 时站点处于「全站免费」模式，
 * 前端不再出现任何会员/购买入口，联系方式对登录用户直接可见。
 */
export const site = {
  memberMode: 'free',
  memberEnabled: false,
  // 收款方式：free = 不收费，manual = 人工转账后由管理员开通，online = 线上支付
  payMode: 'free',
  payWechat: null,
  payQr: null,
  payPayee: null,
  freeDailyUnlock: 1,
  // 发布权限：admin = 只有管理员能在后台建主页，user = 开放用户投稿
  publishMode: 'admin',
  userPublishEnabled: false,
  loaded: false,
};

export async function loadSite() {
  try {
    const cfg = await api.get('/api/config');
    Object.assign(site, cfg, { loaded: true });
  } catch {
    // 取不到就按付费模式渲染，不影响主流程
    site.loaded = true;
  }
  return site;
}
