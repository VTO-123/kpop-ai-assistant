/**
 * 百度百科词条资料层。
 *
 * 百科的词条卡片里有一批结构化字段（组合成员 / 成立时间 / 经纪公司 / 代表作品 /
 * 主要成就），正好可以补上音乐平台没有的「出道年、成员、奖项」。
 *
 * 设计要点：
 *   - 只读词条简介与信息卡，不抓正文，体积小、速度快；
 *   - 5 秒超时，任何异常都返回 null，由调用方降级到其他资料源；
 *   - 带 UA / Referer，命中缓存 6 小时，失败缓存 10 分钟；
 *   - 返回值只包含词条里真实存在的字段，不补默认值，拿不到就是空。
 */
import { config } from './config.js';

const TIMEOUT_MS = 5000;
const HIT_TTL = 6 * 60 * 60 * 1000;
const MISS_TTL = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const cache = new Map();
const inflight = new Map();

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '')
    .trim();

/** 词条末尾的引用角标在接口里会变成裸数字，这里连同 HTML 一起清掉。 */
export function plainText(raw) {
  return String(raw ?? '')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function cardValues(card) {
  const values = [];
  for (const item of Array.isArray(card?.value) ? card.value : []) {
    const text = plainText(item);
    if (text) values.push(text);
  }
  // 有些词条把多个值塞在一个字符串里，用顿号分隔
  return values;
}

function findCard(cards, names) {
  for (const name of names) {
    const hit = cards.find((card) => plainText(card?.name) === name);
    if (hit) return hit;
  }
  return null;
}

function joinValues(cards, names) {
  const card = findCard(cards, names);
  if (!card) return '';
  return cardValues(card).join('、').replace(/、{2,}/g, '、').replace(/^、|、$/g, '');
}

function splitList(raw, limit) {
  const list = String(raw || '')
    .split(/[、，,；;\/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(list)].slice(0, limit);
}

/** 艺人词条判定：简介里出现歌手类描述，且不是天体、篮球运动员之类的同名词条。 */
const ARTIST_HINT = /歌手|组合|团体|男团|女团|偶像|演唱|音乐人|说唱歌手|rapper|singer|dancer|舞者/i;
const NOT_ARTIST = /恒星|行星|天体|篮球|足球|运动员|球队|植物|动物|城市|首都|大学/i;

function looksLikeArtist(desc, abstract, title, query) {
  // 只看简短的词条定性，避免摘要里提到「电影 / 电视剧」就把偶像误杀
  if (NOT_ARTIST.test(desc)) return false;

  const text = `${desc} ${abstract}`;
  if (!ARTIST_HINT.test(text)) return false;

  // 同名不同人（例如 Jisoo → 男演员金志洙 / Rosé → 篮球运动员罗斯）：
  // 标题或摘要里必须能对上查询词
  const titleKey = normalize(title);
  const queryKey = normalize(query);
  if (!titleKey || !queryKey) return false;
  if (titleKey.includes(queryKey) || queryKey.includes(titleKey)) return true;
  return `${title} ${desc} ${abstract}`.toLowerCase().includes(queryKey);
}

/**
 * 解析百科接口返回。
 * @param {object} json
 * @param {string} query
 * @returns {null | {
 *   title: string, desc: string, abstract: string, image: string, url: string,
 *   fields: Record<string, string>, members: string[], works: string[], awards: string[]
 * }}
 */
export function parseBaikePayload(json, query) {
  if (!json || typeof json !== 'object' || !json.title) return null;

  const title = plainText(json.title);
  const desc = plainText(json.desc);
  const abstract = plainText(json.abstract).slice(0, 600);
  if (!looksLikeArtist(desc, abstract, title, query)) return null;

  const cards = Array.isArray(json.card) ? json.card : [];

  const debut = joinValues(cards, ['出道日期', '出道时间', '成立时间', '成立日期']);
  const agency = joinValues(cards, ['经纪公司', '所属公司', '唱片公司', '经纪公司／唱片公司']);
  const membersText = joinValues(cards, ['组合成员', '成员', '团队成员', '现任成员']);
  const worksText = joinValues(cards, ['代表作品', '主要作品', '代表作']);
  const awardsText = joinValues(cards, ['主要成就', '主要奖项', '获奖记录', '主要荣誉']);
  const groupText = joinValues(cards, ['所属组合', '所属团体']);
  const fandom = joinValues(cards, ['粉丝名称', '粉丝名', '歌迷名称', '粉丝名']);
  const nameZh = joinValues(cards, ['中文名']);
  const nameEn = joinValues(cards, ['外文名']);

  const image = /^https:\/\/[^"' ]+$/i.test(String(json.image || '')) ? String(json.image) : '';

  return {
    title,
    desc,
    abstract,
    image,
    url: `https://baike.baidu.com/item/${encodeURIComponent(title)}`,
    fields: {
      ...(nameZh ? { 中文名: nameZh } : {}),
      ...(nameEn ? { 外文名: nameEn } : {}),
      ...(debut ? { 出道: debut } : {}),
      ...(agency ? { 经纪公司: agency } : {}),
      ...(membersText ? { 成员: membersText } : {}),
      ...(worksText ? { 代表作品: worksText } : {}),
      ...(awardsText ? { 主要成就: awardsText } : {}),
      ...(groupText ? { 所属组合: groupText } : {}),
      ...(fandom ? { 粉丝名: fandom } : {}),
    },
    members: splitList(membersText, 16),
    works: splitList(worksText, 12),
    awards: splitList(awardsText, 8),
  };
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
 * 按艺人名抓百科词条。失败 / 同名非艺人 / 关闭资料源时返回 null。
 * @param {string} rawName
 */
export async function fetchBaikeProfile(rawName) {
  const name = String(rawName || '').trim().slice(0, 40);
  if (!name || !config.baikeLookup) return null;

  const key = normalize(name);
  if (!key) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const task = lookup(name)
    .then((value) => {
      remember(key, value, value ? HIT_TTL : MISS_TTL);
      return value;
    })
    .catch(() => {
      remember(key, null, MISS_TTL);
      return null;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

async function lookup(name) {
  const endpoint = new URL('/api/openapi/BaikeLemmaCardApi', config.baikeApiBase);
  endpoint.searchParams.set('scope', '103');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('appid', '379020');
  endpoint.searchParams.set('bk_key', name);
  endpoint.searchParams.set('bk_length', '600');

  const res = await fetch(endpoint, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: `${config.baikeApiBase}/`,
      Accept: 'application/json, text/plain, */*',
    },
    signal: AbortSignal.timeout(config.baikeTimeoutMs || TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);

  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error('not json');

  return parseBaikePayload(await res.json(), name);
}

/** 把「2013年6月13日」这类日期规范成「2013 年 6 月 13 日」。 */
export function formatDebutDate(raw) {
  const text = plainText(raw);
  if (!text) return '';
  const match = /(\d{4})\s*年\s*(?:(\d{1,2})\s*月\s*(?:(\d{1,2})\s*日)?)?/.exec(text);
  if (!match) return text.slice(0, 40);
  const [, year, month, day] = match;
  if (!month) return `${year} 年`;
  if (!day) return `${year} 年 ${Number(month)} 月`;
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

/** 出道年份（数字），拿不到返回 0。 */
export function debutYear(raw) {
  const text = plainText(raw);
  const match = /(\d{4})\s*年/.exec(text) || /^(19|20)\d{2}$/.exec(text);
  if (!match) return 0;
  const year = Number(match[1]);
  return Number.isFinite(year) && year > 1900 && year < 2100 ? year : 0;
}

/** 从简介里找「2013 年…正式出道」这类表述，个人歌手没有「成立时间」字段时兜底。 */
export function findDebutInText(text) {
  const value = plainText(text);
  if (!value) return '';
  const match = /((?:19|20)\d{2})\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?[^。；]{0,60}?出道/.exec(
    value,
  );
  if (!match) return '';
  return formatDebutDate(match[0]);
}
