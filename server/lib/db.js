import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  tier          TEXT NOT NULL DEFAULT 'free',
  vip_expires_at TEXT,
  free_unlock_date TEXT,
  free_unlock_used INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      TEXT NOT NULL,
  gender        TEXT NOT NULL,
  birth_year    INTEGER NOT NULL,
  province_code TEXT NOT NULL,
  city          TEXT NOT NULL,
  height_cm     INTEGER,
  occupation    TEXT,
  bio           TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  contact_wechat TEXT,
  contact_qq     TEXT,
  contact_phone  TEXT,
  contact_note   TEXT,
  avatar_url    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  view_count    INTEGER NOT NULL DEFAULT 0,
  unlock_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unlock_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  profile_id INTEGER NOT NULL,
  method     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  days        INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  badge       TEXT,
  features    TEXT NOT NULL DEFAULT '[]',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code    TEXT NOT NULL,
  plan_name    TEXT NOT NULL,
  days         INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  channel      TEXT NOT NULL DEFAULT 'demo',
  note         TEXT,
  created_at   TEXT NOT NULL,
  paid_at      TEXT,
  claimed_at   TEXT,
  confirmed_by INTEGER
);

CREATE TABLE IF NOT EXISTS redeem_codes (
  code       TEXT PRIMARY KEY,
  plan_code  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_by    INTEGER,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  reporter_id INTEGER,
  reason     TEXT NOT NULL,
  detail     TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  handled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_profiles_region ON profiles(province_code, city, status);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_profile ON photos(profile_id, sort);
CREATE INDEX IF NOT EXISTS idx_unlock_user ON unlock_logs(user_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
`);

export const now = () => new Date().toISOString();

/**
 * 轻量迁移：老库补列。CREATE TABLE IF NOT EXISTS 不会改动已存在的表，
 * 所以新增字段必须在这里显式补上，否则老库会缺列报错。
 */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('orders', 'note', 'note TEXT');
ensureColumn('orders', 'claimed_at', 'claimed_at TEXT');
ensureColumn('orders', 'confirmed_by', 'confirmed_by INTEGER');

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** 会员是否在有效期内 */
export function isVip(user) {
  if (!user) return false;
  return user.tier === 'vip' && !!user.vip_expires_at && new Date(user.vip_expires_at) > new Date();
}

/**
 * 给指定用户延长会员天数（未到期则在原到期时间上叠加，已过期从此刻算起）。
 * 返回新的到期时间 ISO 字符串。
 */
export function extendVip(user, days) {
  const base = isVip(user) ? new Date(user.vip_expires_at) : new Date();
  const next = new Date(base.getTime() + days * 86400000);
  db.prepare("UPDATE users SET tier = 'vip', vip_expires_at = ? WHERE id = ?")
    .run(next.toISOString(), user.id);
  return next.toISOString();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    tier: user.tier,
    vipActive: isVip(user),
    vipExpiresAt: user.vip_expires_at,
    createdAt: user.created_at,
  };
}
