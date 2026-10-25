import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * 解析 .env 文本：支持 KEY=VALUE、# 注释、成对引号。
 * 会先去掉 Windows 记事本保存 UTF-8 时写入的 BOM，否则第一行 key 会变成 "\uFEFFAI_API_KEY" 而读不到。
 */
export function parseEnv(text) {
  const env = {};
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  let text = '';
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

// .env.local 覆盖 .env 的直觉：先读 .env.local，再读 .env（先到先得）
loadEnvFile(path.join(ROOT_DIR, '.env.local'));
loadEnvFile(path.join(ROOT_DIR, '.env'));

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

const apiKey =
  process.env.AI_API_KEY ||
  process.env.DEEPSEEK_API_KEY ||
  process.env.OPENAI_API_KEY ||
  '';

const baseUrl = trimTrailingSlash(process.env.AI_BASE_URL || 'https://api.deepseek.com/v1');

let providerLabel = 'custom';
try {
  providerLabel = new URL(baseUrl).hostname;
} catch {
  /* 用户填了奇形怪状的地址也不该崩 */
}

export const config = {
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  host: process.env.HOST || '127.0.0.1',
  port: Number.parseInt(process.env.PORT || '4321', 10),
  apiKey,
  baseUrl,
  model: process.env.AI_MODEL || 'deepseek-chat',
  providerLabel,
  timeoutMs: Number.parseInt(process.env.AI_TIMEOUT_MS || '60000', 10),
  demo: !apiKey || process.env.DEMO_MODE === '1',

  // 封面兜底：内置 groups.json 没有 cover 时，按团体名去音乐接口找歌手头像
  coverEnabled: process.env.COVER_LOOKUP !== '0',
  coverApiBase: trimTrailingSlash(process.env.COVER_API_BASE || 'https://music.163.com'),
  coverTimeoutMs: Number.parseInt(process.env.COVER_TIMEOUT_MS || '2500', 10),
  coverQqLookup: process.env.COVER_QQ_LOOKUP !== '0',

  // AI 生成前是否先抓网易云真实资料作为上下文（测试时可关掉）
  profileLookup: process.env.PROFILE_LOOKUP !== '0',
};

export default config;
