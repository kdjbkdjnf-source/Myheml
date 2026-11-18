import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, now, tx } from './lib/db.js';
import { hashPassword } from './lib/auth.js';
import { isValidCity } from './data/regions.js';

/* ------------------------------------------------------------------ */
/* 确定性随机，保证每次生成的演示数据一致                              */
/* ------------------------------------------------------------------ */
function mulberry32(a) {
  return function rnd() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* 演示主页数据                                                        */
/* ------------------------------------------------------------------ */
const SPOTS = [
  ['11', '朝阳区'], ['11', '海淀区'], ['31', '徐汇区'], ['31', '浦东新区'], ['44', '广州'], ['44', '深圳'],
  ['44', '东莞'], ['33', '杭州'], ['33', '宁波'], ['32', '南京'], ['32', '苏州'], ['51', '成都'],
  ['50', '渝中区'], ['50', '渝北区'], ['42', '武汉'], ['43', '长沙'], ['41', '郑州'], ['37', '青岛'],
  ['37', '济南'], ['35', '厦门'], ['35', '福州'], ['34', '合肥'], ['36', '南昌'], ['61', '西安'],
  ['53', '昆明'], ['52', '贵阳'], ['45', '南宁'], ['46', '三亚'], ['23', '哈尔滨'], ['22', '长春'],
  ['21', '沈阳'], ['21', '大连'], ['13', '石家庄'], ['14', '太原'], ['15', '呼和浩特'], ['62', '兰州'],
  ['65', '乌鲁木齐'], ['64', '银川'], ['63', '西宁'], ['81', '油尖旺'], ['71', '台北'], ['82', '大堂区'],
  ['54', '拉萨'], ['32', '无锡'], ['33', '温州'], ['44', '佛山'], ['42', '宜昌'], ['43', '株洲'],
];

const NAMES_F = [
  '小满', '柚子', '林间', '眠眠', '晴子', '南栀', '小鹿', '晚风', '橘子', '阿梓',
  '木子', '清和', '拾一', '安可', '婉婉', '可可', '阿蜜', '夏至', '阿檀', '疏影',
  '一一', '鹿鸣', '白桃', '云舒', '小雏菊', '茉茉', '阿棠', '星野',
];
const NAMES_M = [
  '陈默', '阿哲', '江屿', '老白', '山川', '小马', '陆离', '阿岩', '周末', '木森',
  '子昂', '大熊', '程野', '阿岚', '叶南', '三石', '小满哥', '林深', '路远', '阿沐',
];

const OCCUPATIONS = [
  '咖啡师', '品牌策划', '插画师', '小学老师', '护士', '产品经理', '摄影师', '自由撰稿人',
  '健身教练', '室内设计', '烘焙师', '跨境电商', '会计', '程序员', '花艺师', '在读研究生',
  '空乘', '兽医', '咖啡店主理人', '舞蹈老师',
];

const BIO_PARTS = [
  '喜欢在周末骑车去城市边缘，找一家没什么人的咖啡馆坐到天黑。',
  '养了一只三岁的橘猫，它比我更懂得享受生活。',
  '正在慢慢收集全国的日落，已经拍了两百多张。',
  '工作日在写字楼里，休息日只想进山或者下海。',
  '喜欢做饭，会做一桌还不错的家常菜，最拿手的是番茄牛腩。',
  '刚搬到这座城市一年，还在努力认识新朋友。',
  '相信生活里的好事情都发生在计划之外。',
  '每年给自己安排两次旅行，一次远的，一次近的。',
  '喜欢拍照但不太懂构图，好看全靠天气。',
  '最近在学潜水，第一次看到海底的时候有点想哭。',
  '喜欢安静的下午和一整面墙的书。',
  '不太会说话，但很会听人说话。',
  '周末在家烤面包，失败了三次终于成功。',
  '喜欢看老电影，最爱《海街日记》。',
  '喜欢逛菜市场，觉得那里最有烟火气。',
  '跑过两次半马，目标是明年跑全马。',
];

const TAGS = [
  '旅行', '咖啡', '健身', '摄影', '美食', '读书', '音乐', '宠物', '露营', '骑行',
  '电影', '烘焙', '桌游', '滑雪', '潜水', '手作', '跑步', '瑜伽',
];

const PER_CITY = 6;

/* 演示照片：public/assets/seed 下 8 张，按顺序循环使用 */
const PHOTOS = Array.from({ length: 8 }, (_, i) => `/assets/seed/p${i + 1}.jpg`);

const PLANS = [
  {
    code: 'vip_1m', name: '月度会员', days: 30, price_cents: 3900, badge: '',
    features: ['无限查看全站所有联系方式', '按城市浏览全部生活照与简介', '随时联系感兴趣的人'],
  },
  {
    code: 'vip_3m', name: '季度会员', days: 90, price_cents: 9900, badge: '最受欢迎',
    features: ['无限查看全站所有联系方式', '按城市浏览全部生活照与简介', '随时联系感兴趣的人', '比按月付省 ¥18'],
  },
  {
    code: 'vip_1y', name: '年度会员', days: 365, price_cents: 29900, badge: '超值',
    features: ['无限查看全站所有联系方式', '按城市浏览全部生活照与简介', '随时联系感兴趣的人', '比按月付省 ¥169', '新功能优先体验'],
  },
];

function seedPlans() {
  const stmt = db.prepare(
    `INSERT INTO plans (code, name, days, price_cents, badge, features, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name, days=excluded.days,
       price_cents=excluded.price_cents, badge=excluded.badge, features=excluded.features, sort=excluded.sort`
  );
  PLANS.forEach((p, i) => stmt.run(p.code, p.name, p.days, p.price_cents, p.badge, JSON.stringify(p.features), i));
}

function seedAccounts() {
  const find = db.prepare('SELECT id FROM users WHERE username = ?');
  const insert = db.prepare(
    `INSERT INTO users (username, password_hash, role, tier, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`
  );
  if (!find.get('admin')) {
    insert.run('admin', hashPassword('Admin@123456'), 'admin', 'free', now());
    console.log('[seed] 已创建管理员 admin / Admin@123456');
  }
  if (!find.get('demo')) {
    insert.run('demo', hashPassword('Demo@123456'), 'user', 'free', now());
    console.log('[seed] 已创建体验账号 demo / Demo@123456');
  }
  // 演示主页的归属账号：密码随机生成且不可登录，仅用于承载演示数据
  if (!find.get('station')) {
    insert.run('station', hashPassword(crypto.randomUUID() + 'Aa1'), 'user', 'free', now());
  }
}

function seedRedeemCodes() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM redeem_codes').get().c;
  if (count > 0) return;
  const stmt = db.prepare('INSERT INTO redeem_codes (code, plan_code, created_at) VALUES (?, ?, ?)');
  ['YXWELCOME001', 'YXWELCOME002', 'YXWELCOME003'].forEach((code) => stmt.run(code, 'vip_1m', now()));
}

/* 演示用的微信号 / QQ 号：确定性生成，看起来像真的 */
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
function wxid(id) {
  let s = '';
  let n = id * 7919 + 13;
  for (let i = 0; i < 7; i += 1) {
    n = (n * 31 + 17) % 100000;
    s += LETTERS[n % LETTERS.length];
  }
  return 'wxid_' + s + String(10 + (id % 89));
}
function qqNumber(id) {
  return String(102000000 + ((id * 48271) % 7900000));
}

function seedProfiles() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c;
  if (existing > 0) return;

  const station = db.prepare('SELECT id FROM users WHERE username = ?').get('station');
  const rnd = mulberry32(20261123);
  let seq = 0;

  const insertProfile = db.prepare(
    `INSERT INTO profiles (user_id, nickname, gender, birth_year, province_code, city, height_cm,
       occupation, bio, tags, contact_wechat, contact_qq, contact_phone, contact_note,
       avatar_url, status, view_count, unlock_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 'active', ?, ?, ?, ?)`
  );
  const insertPhoto = db.prepare('INSERT INTO photos (profile_id, url, sort, created_at) VALUES (?, ?, ?, ?)');

  tx(() => {
    SPOTS.forEach(([provinceCode, city]) => {
      if (!isValidCity(provinceCode, city)) return;
      for (let n = 0; n < PER_CITY; n += 1) {
        const id = seq;
        seq += 1;

        const isFemale = rnd() > 0.32;
        const pool = isFemale ? NAMES_F : NAMES_M;
        const base = pool[id % pool.length];
        // 同一批城市里昵称会重复，重复的加个数字后缀区分
        const nick = id < pool.length ? base : `${base}${10 + Math.floor(rnd() * 89)}`;
        const birthYear = 1990 + Math.floor(rnd() * 12);
        const photoCount = 3 + Math.floor(rnd() * 3);
        const b1 = BIO_PARTS[Math.floor(rnd() * BIO_PARTS.length)];
        const b2 = BIO_PARTS[Math.floor(rnd() * BIO_PARTS.length)];
        const bio = `${b1}${b2}`;
        const tags = [...new Set(Array.from({ length: 3 }, () => TAGS[Math.floor(rnd() * TAGS.length)]))];
        const cover = PHOTOS[id % PHOTOS.length];
        const createdAt = new Date(Date.now() - Math.floor(rnd() * 60) * 86400000 - id * 1800000).toISOString();

        const info = insertProfile.run(
          station.id, nick, isFemale ? 'female' : 'male', birthYear, provinceCode, city,
          155 + Math.floor(rnd() * 25), OCCUPATIONS[Math.floor(rnd() * OCCUPATIONS.length)], bio,
          JSON.stringify(tags),
          wxid(id), qqNumber(id),
          '演示联系方式',
          cover,
          Math.floor(rnd() * 900) + 30,
          Math.floor(rnd() * 60),
          createdAt, createdAt
        );

        const pid = Number(info.lastInsertRowid);
        for (let k = 0; k < photoCount; k += 1) {
          insertPhoto.run(pid, PHOTOS[(id + k * 3) % PHOTOS.length], k, createdAt);
        }
      }
    });
  });
  console.log(`[seed] 已生成 ${seq} 个演示主页`);
}

/* 演示订单与会员：让后台的「有效会员 / 累计收入」有数可看 */
function seedOrders() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  if (existing > 0) return;

  const plans = db.prepare('SELECT * FROM plans ORDER BY sort').all();
  if (!plans.length) return;

  const rnd = mulberry32(90210);
  const findUser = db.prepare('SELECT id FROM users WHERE username = ?');
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, tier, vip_expires_at, created_at)
     VALUES (?, ?, 'user', ?, ?, ?)`
  );
  const insertOrder = db.prepare(
    `INSERT INTO orders (user_id, plan_code, plan_name, days, amount_cents, status, channel, created_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, 'demo', ?, ?)`
  );

  tx(() => {
    for (let i = 1; i <= 9; i += 1) {
      const username = `visitor${String(i).padStart(2, '0')}`;
      if (findUser.get(username)) continue;

      const plan = plans[Math.floor(rnd() * plans.length)];
      const createdAt = new Date(Date.now() - Math.floor(rnd() * 40 + 1) * 86400000).toISOString();
      const paid = i <= 6;
      const expiresAt = new Date(Date.now() + Math.floor(rnd() * 260 + 20) * 86400000).toISOString();

      const info = insertUser.run(
        username,
        hashPassword(crypto.randomUUID() + 'Aa1'),
        paid ? 'vip' : 'free',
        paid ? expiresAt : null,
        createdAt
      );
      insertOrder.run(
        Number(info.lastInsertRowid),
        plan.code, plan.name, plan.days, plan.price_cents,
        paid ? 'paid' : 'pending',
        createdAt,
        paid ? createdAt : null
      );
    }
  });
}

export function ensureSeed() {
  const hasPlans = db.prepare('SELECT COUNT(*) AS c FROM plans').get().c > 0;
  if (!hasPlans) seedPlans();
  seedAccounts();
  seedRedeemCodes();
  seedOrders();
  if (process.env.SEED_DEMO !== '0') seedProfiles();
}

/* ---------------- CLI：npm run seed / npm run reset ---------------- */
const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  if (process.argv.includes('--reset')) {
    console.log('[reset] 清空演示数据…');
    for (const table of ['photos', 'unlock_logs', 'reports', 'orders', 'profiles', 'users', 'redeem_codes', 'plans']) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('photos','profiles','users','orders','reports','unlock_logs')");
  }
  ensureSeed();
  const c = db.prepare("SELECT COUNT(*) AS c FROM profiles WHERE status='active'").get().c;
  console.log(`[seed] 完成，当前在线主页 ${c} 个`);
}
