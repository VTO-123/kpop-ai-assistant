/**
 * B 站跳转解析。
 *
 * 三级策略：
 *   1. 曲库里有 bvid → 直接 https://www.bilibili.com/video/{bvid}；
 *   2. 没有 bvid → 服务端调 B 站搜索接口（带 UA + 指纹 Cookie，5 秒超时），
 *      取第一条命中的视频；
 *   3. 搜索失败 / 无结果 → 退到 https://search.bilibili.com/all?keyword=…，
 *      保证每首歌都能跳，不会出现死链。
 *
 * 所有远程失败都静默降级，不影响页面。
 */
import { config } from './config.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BVID_PATTERN = /^BV[0-9A-Za-z]{6,}$/;
const COOKIE_TTL = 12 * 60 * 60 * 1000;
const HIT_TTL = 6 * 60 * 60 * 1000;
const MISS_TTL = 10 * 60 * 1000;
const MAX_ENTRIES = 300;

const cache = new Map();
const inflight = new Map();
let fingerprint = { value: '', at: 0 };

/** 明显不是歌曲视频的结果，优先跳过。 */
const NOISE = /(reaction|翻唱|cover|吉他|钢琴|教学|教程|谱|混剪|合集|直播|reaction)/i;

export function isBvid(value) {
  return BVID_PATTERN.test(String(value || '').trim());
}

/** 去掉括号里的版本说明与 remix / live 之类后缀，只留主标题。 */
export function normalizeSongTitle(raw) {
  let value = String(raw || '').trim();
  value = value.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ');
  value = value.replace(
    /\s*[-–—~]\s*(remix|inst|instrumental|live|acoustic|ver\.?|version|mr|伴奏|纯音乐).*$/i,
    ' ',
  );
  return value.replace(/\s+/g, ' ').trim();
}

export function isAsciiOnly(value) {
  return /^[\x20-\x7e]+$/.test(String(value || ''));
}

/**
 * 搜索关键词：歌名 + 歌手名；纯英文歌补 MV 后缀。
 * 例：Dynamite + BTS → "Dynamite BTS MV"；好日子 + IU → "好日子 IU"
 */
export function buildSearchKeyword(title, artist) {
  const main = normalizeSongTitle(title) || String(title || '').trim();
  const artistName = String(artist || '').trim();
  const keyword = [main, artistName].filter(Boolean).join(' ');
  if (!keyword) return '';
  return isAsciiOnly(main) ? `${keyword} MV` : keyword;
}

export function videoUrl(bvid) {
  return `https://www.bilibili.com/video/${String(bvid).trim()}`;
}

export function searchUrl(keyword) {
  return `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;
}

async function fetchFingerprint() {
  if (fingerprint.value && Date.now() - fingerprint.at < COOKIE_TTL) return fingerprint.value;

  const res = await fetch(`${config.biliApiBase}/x/frontend/finger/spi`, {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Accept: 'application/json' },
    signal: AbortSignal.timeout(config.biliTimeoutMs),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const json = await res.json();
  const b3 = json?.data?.b_3;
  const b4 = json?.data?.b_4;
  if (!b3) throw new Error('no buvid');
  fingerprint = {
    value: `buvid3=${b3}; buvid4=${encodeURIComponent(b4 || '')}`,
    at: Date.now(),
  };
  return fingerprint.value;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .trim();
}

/** 调 B 站搜索接口取第一条视频；失败返回 null（调用方负责降级）。 */
export async function searchFirstVideo(keyword) {
  if (!keyword || !config.biliLookup) return null;

  let cookie = '';
  try {
    cookie = await fetchFingerprint();
  } catch {
    /* 没有指纹也试一次，接口有时不校验 */
  }

  const endpoint = new URL('/x/web-interface/search/type', config.biliApiBase);
  endpoint.searchParams.set('search_type', 'video');
  endpoint.searchParams.set('keyword', keyword);
  endpoint.searchParams.set('page', '1');

  const res = await fetch(endpoint, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://search.bilibili.com/',
      Accept: 'application/json, text/plain, */*',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(config.biliTimeoutMs),
  });
  if (!res.ok) return null;

  const json = await res.json();
  if (json?.code !== 0) return null;

  const list = (json.data?.result || []).filter((item) => isBvid(item?.bvid));
  if (!list.length) return null;

  const hit = list.find((item) => !NOISE.test(String(item.title || ''))) || list[0];
  return { bvid: hit.bvid, title: stripHtml(hit.title), author: String(hit.author || '') };
}

function remember(key, value, ttl) {
  cache.set(key, { value, at: Date.now(), ttl });
  if (cache.size <= MAX_ENTRIES) return;
  for (const [entryKey] of cache) {
    cache.delete(entryKey);
    if (cache.size <= MAX_ENTRIES) break;
  }
}

/**
 * @param {{ artist?: string, title?: string, bvid?: string }} input
 * @returns {Promise<{ url: string, bvid: string, mode: 'mapped' | 'search' | 'search-page',
 *   keyword: string, videoTitle?: string }>}
 */
export async function resolveBilibiliTarget({ artist = '', title = '', bvid = '' } = {}) {
  const keyword = buildSearchKeyword(title, artist);
  const mapped = String(bvid || '').trim();

  if (isBvid(mapped)) {
    return { url: videoUrl(mapped), bvid: mapped, mode: 'mapped', keyword };
  }

  if (!config.biliLookup) {
    return { url: searchUrl(keyword), bvid: '', mode: 'search-page', keyword };
  }

  const key = `${artist}|${title}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const task = searchFirstVideo(keyword)
    .then((video) => {
      const value = video
        ? { url: videoUrl(video.bvid), bvid: video.bvid, mode: 'search', keyword, videoTitle: video.title }
        : { url: searchUrl(keyword), bvid: '', mode: 'search-page', keyword };
      remember(key, value, video ? HIT_TTL : MISS_TTL);
      return value;
    })
    .catch(() => {
      const value = { url: searchUrl(keyword), bvid: '', mode: 'search-page', keyword };
      remember(key, value, MISS_TTL);
      return value;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}
