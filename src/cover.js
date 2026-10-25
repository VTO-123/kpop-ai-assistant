/**
 * 封面兜底：当 data/groups.json 没给某个团体配 cover 时，
 * 按团体名去国内可直连的网易云音乐搜索接口取「歌手头像」当封面。
 *
 * 设计要点：
 *   - 独立函数 resolveCover()，内部带内存缓存 + 并发去重，同一团体不会重复请求；
 *   - 命中缓存 6 小时，未命中（查不到 / 超时）只缓存 10 分钟，避免反复打接口；
 *   - 只接受 *.music.126.net 的 https 图片，防止接口返回任意 URL 被当成图片注入；
 *   - 任何异常都降级成「无封面」，由前端用渐变占位兜底。
 */
import { config } from './config.js';
import { findGroup, normalizeName } from './groups.js';
import { fetchQQArtist } from './qqmusic.js';

const HIT_TTL = 6 * 60 * 60 * 1000;
const MISS_TTL = 10 * 60 * 1000;
const MAX_ARTISTS = 6;
const ALLOWED_HOST = 'music.126.net';
const USER_AGENT = 'kpop-ai-assistant/0.1 (cover lookup)';

/** @typedef {{ url: string, source: 'builtin' | 'netease' | 'none', cached?: boolean }} CoverResolution */

const cache = new Map(); // key -> { url, source, expiresAt }
const inflight = new Map(); // key -> Promise<CoverResolution>

/** 内置封面（同步，详情页首屏要用）。 */
export function builtinCover(rawName) {
  const group = findGroup(rawName);
  return group?.cover ? { url: group.cover, source: 'builtin' } : null;
}

export function peekCoverCache(rawName) {
  const key = normalizeName(rawName);
  const hit = cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) return null;
  return { url: hit.url, source: hit.source, cached: true };
}

/**
 * 解析封面：内置 → 自动拉取 → 都没有。
 * @param {string} rawName
 * @returns {Promise<CoverResolution>}
 */
export async function resolveCover(rawName) {
  const builtin = builtinCover(rawName);
  if (builtin) return builtin;

  const key = normalizeName(rawName);
  if (!key || !config.coverEnabled) return { url: '', source: 'none' };

  const hit = peekCoverCache(rawName);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);

  const task = resolveRemoteCover(rawName)
    .then((result) => {
      remember(key, result, result.url ? HIT_TTL : MISS_TTL);
      return result;
    })
    .catch(() => {
      const result = { url: '', source: 'none' };
      remember(key, result, MISS_TTL);
      return result;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

/** 先问网易云，再问 QQ 音乐；两边都没有才返回空。 */
async function resolveRemoteCover(rawName) {
  const netease = await lookupArtistPhoto(rawName).catch(() => '');
  if (netease) return { url: netease, source: 'netease' };

  if (config.coverQqLookup) {
    const qq = await fetchQQArtist(rawName).catch(() => null);
    if (qq?.picUrl) return { url: qq.picUrl, source: 'qqmusic' };
  }

  return { url: '', source: 'none' };
}

function remember(key, result, ttl) {
  cache.set(key, { ...result, expiresAt: Date.now() + ttl });
}

async function lookupArtistPhoto(rawName) {
  const endpoint = new URL('/api/search/get/web', config.coverApiBase);
  endpoint.searchParams.set('s', rawName);
  endpoint.searchParams.set('type', '100'); // 100 = 歌手
  endpoint.searchParams.set('limit', String(MAX_ARTISTS));
  endpoint.searchParams.set('offset', '0');
  endpoint.searchParams.set('total', 'true');

  let origin = 'https://music.163.com';
  try {
    origin = new URL(config.coverApiBase).origin;
  } catch {
    /* 配置不合法时退回默认 Referer */
  }

  const res = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      Referer: `${origin}/`,
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(config.coverTimeoutMs),
  });

  if (!res.ok) return '';

  const data = await res.json();
  const artist = pickArtist(data?.result?.artists, rawName);
  return normalizeImageUrl(artist?.picUrl);
}

/** 优先同名（含别名）的歌手；退而求其次选名字里包含关键词的那位，避免张冠李戴。 */
function pickArtist(artists, rawName) {
  const key = normalizeName(rawName);
  const usable = (Array.isArray(artists) ? artists : []).filter(
    (artist) => artist && typeof artist.picUrl === 'string' && artist.picUrl,
  );
  if (!usable.length) return null;

  const exact = usable.find((artist) => {
    if (normalizeName(artist.name) === key) return true;
    return Array.isArray(artist.alias) && artist.alias.some((alias) => normalizeName(alias) === key);
  });
  if (exact) return exact;

  return (
    usable.find((artist) => {
      const name = normalizeName(artist.name);
      if (name.includes(key) || key.includes(name)) return true;
      return Array.isArray(artist.alias) && artist.alias.some((alias) => {
        const a = normalizeName(alias);
        return a.includes(key) || key.includes(a);
      });
    }) || null
  );
}

/** 只允许 https 的网易云图片域名，并统一加上压缩参数。 */
function normalizeImageUrl(raw) {
  if (!raw) return '';
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  const host = url.hostname.toLowerCase();
  if (host !== ALLOWED_HOST && !host.endsWith(`.${ALLOWED_HOST}`)) return '';
  url.searchParams.set('param', '1000y1000');
  return url.toString();
}
