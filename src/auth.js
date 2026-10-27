/**
 * 账号体系：注册 / 登录 / token 鉴权。
 *
 * 数据落盘在 data/users/（已加入 .gitignore，绝不入库）：
 *   accounts.json  -> 用户名 → { hash, salt }（scrypt 哈希，不存明文密码）
 *   tokens.json    -> token → 用户名
 *   <用户名>.json   -> 该用户的收藏 / 最近看过 / 搜索历史（见 userstore.js）
 *
 * 只依赖 node:crypto，无第三方库。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_DIR = path.join(ROOT, 'data', 'users');
const ACCOUNTS_FILE = path.join(USER_DIR, 'accounts.json');
const TOKENS_FILE = path.join(USER_DIR, 'tokens.json');

function ensureDir() {
  if (!existsSync(USER_DIR)) mkdirSync(USER_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/** 用户名规则：2-20 位，字母/数字/下划线/中文。校验通过即天然防目录穿越。 */
export function validUsername(name) {
  if (typeof name !== 'string') return false;
  return /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/.test(name);
}

export function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 6 && pw.length <= 64;
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

/** 注册：用户名可用则建号并签发 token。 */
export function register(username, password) {
  const name = String(username || '').trim();
  if (!validUsername(name)) {
    return { ok: false, message: '用户名需 2-20 位，仅限字母、数字、下划线或中文' };
  }
  if (!validPassword(password)) {
    return { ok: false, message: '密码至少 6 位，最长 64 位' };
  }

  const accounts = readJson(ACCOUNTS_FILE, { users: {} });
  if (accounts.users[name]) return { ok: false, message: '用户名已被注册' };

  const salt = randomBytes(16).toString('hex');
  accounts.users[name] = { hash: hashPassword(password, salt), salt, createdAt: Date.now() };
  writeJson(ACCOUNTS_FILE, accounts);

  const token = issueToken(name);
  return { ok: true, token, username: name };
}

/** 登录：校验密码，签发新 token。 */
export function login(username, password) {
  const name = String(username || '').trim();
  const accounts = readJson(ACCOUNTS_FILE, { users: {} });
  const record = accounts.users[name];
  if (!record || typeof password !== 'string') return { ok: false, message: '用户名或密码不正确' };

  const hash = Buffer.from(record.hash, 'hex');
  const expect = scryptSync(password, record.salt, 64);
  if (hash.length !== expect.length || !timingSafeEqual(hash, expect)) {
    return { ok: false, message: '用户名或密码不正确' };
  }

  return { ok: true, token: issueToken(name), username: name };
}

function issueToken(username) {
  const tokens = readJson(TOKENS_FILE, { tokens: {} });
  // 清理过期 token（30 天）
  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  for (const [tk, entry] of Object.entries(tokens.tokens)) {
    if (entry.createdAt < cutoff) delete tokens.tokens[tk];
  }
  const token = randomBytes(32).toString('hex');
  tokens.tokens[token] = { user: username, createdAt: now };
  writeJson(TOKENS_FILE, tokens);
  return token;
}

/** 从请求头解析 token，返回用户名；无效返回 null。 */
export function authenticate(req) {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1].trim();
  const tokens = readJson(TOKENS_FILE, { tokens: {} });
  const entry = tokens.tokens[token];
  if (!entry) return null;
  // 过期校验
  if (Date.now() - entry.createdAt > 30 * 24 * 60 * 60 * 1000) {
    delete tokens.tokens[token];
    writeJson(TOKENS_FILE, tokens);
    return null;
  }
  return entry.user;
}
