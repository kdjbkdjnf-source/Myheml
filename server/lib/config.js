/**
 * 运营模式开关。
 *
 * MEMBER_MODE 支持三种取值：
 *   free   全站免费（默认）：联系方式对登录用户直接可见，无套餐、无订单、无收款入口
 *   manual 人工收款：会员体系开启，但站上不接支付接口。
 *          用户看到套餐 → 页面展示你的收款微信/收款码 → 私下转账
 *          → 用户点「我已完成转账」提交 → 你在后台「收款确认」里核对后一键开通
 *   paid   线上支付：预留位，需接入微信支付/支付宝，要求经营性资质
 *
 * 默认取 free，因为「会员收费」属于经营性互联网信息服务，
 * 误开会有合规风险；要收费必须显式声明，属于不可省略的动作。
 */
const MODES = ['free', 'manual', 'paid'];
const rawMode = (process.env.MEMBER_MODE || 'free').trim().toLowerCase();

/** 兼容旧开关：ENABLE_PAYMENT=0 强制回到免费模式 */
const forcedFree = (process.env.ENABLE_PAYMENT || '').trim() === '0';

export const MEMBER_MODE = forcedFree ? 'free' : MODES.includes(rawMode) ? rawMode : 'free';
export const FREE_MODE = MEMBER_MODE === 'free';
export const MEMBER_ENABLED = !FREE_MODE;
/** 人工收款：站上不发起任何支付请求，只有「转账指引 + 后台确认」 */
export const MANUAL_PAY = MEMBER_MODE === 'manual';

/** 收款微信号（manual 模式下展示给用户），部署时在 .env 里配自己的 */
export const PAY_WECHAT_ID = (process.env.PAY_WECHAT_ID || '').trim() || 'your_wechat_id';
/**
 * 收款码图片（public 下的相对路径）。
 * 默认留空 = 页面上只给微信号，不放收款码：
 * 收款码公开后任何陌生人都能直接扫码转账（小额试探、洗钱、退款诈骗都常见），
 * 先加好友再收款，等于多一道人工确认。要恢复展示就把 PAY_QR 指到图片路径。
 */
export const PAY_QR_IMAGE = (process.env.PAY_QR || '').trim();
/** 收款人显示名，用于页面上说明「转账给谁」 */
export const PAY_PAYEE_NAME = (process.env.PAY_PAYEE_NAME || '').trim() || '站长的微信';

/**
 * 发布权限开关。
 *
 * 默认 admin：主页只能由管理员在后台创建，普通用户纯浏览，投稿接口直接 403。
 * 设为 user 则开放用户投稿，投稿进入 pending 等待审核。
 * 两种模式下管理员发布的记录都直接 active，不进审核队列。
 */
const publish = (process.env.PUBLISH_MODE || 'admin').trim().toLowerCase();

export const ADMIN_ONLY_PUBLISH = publish !== 'user';
export const PUBLISH_MODE_LABEL = ADMIN_ONLY_PUBLISH ? 'admin' : 'user';
