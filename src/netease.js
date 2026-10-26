/**
 * 网易云音乐歌手资料聚合。
 *
 * 只做「真实资料」的检索与整理：歌手照片、简介(briefDesc)、专辑名、热门歌曲名。
 * 这些字段会作为上下文喂给模型，让档案基于事实而不是模型记忆。
 * 任何一步失败都降级为「没有资料」，不影响页面。
 */
const BASE = 'https://music.163.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const TIMEOUT_MS = 4500;

const cache = new Map();
const inflight = new Map();

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '')
    .trim();

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': UA, Referer: `${BASE}/`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const json = await res.json();
  if (json && json.code && json.code !== 200) throw new Error(`code ${json.code}`);
  return json;
}

function pickArtist(artists, name) {
  const key = normalize(name);
  const usable = (artists || []).filter((artist) => artist && artist.id);
  if (!usable.length) return null;
  return (
    usable.find((artist) => normalize(artist.name) === key) ||
    usable.find((artist) => normalize(artist.name).includes(key)) ||
    usable.find((artist) => key.includes(normalize(artist.name))) ||
    null
  );
}

function remember(key, value) {
  cache.set(key, { value, at: Date.now() });
  if (cache.size <= MAX_ENTRIES) return;
  for (const [entryKey, entry] of cache) {
    cache.delete(entryKey);
    if (cache.size <= MAX_ENTRIES) break;
  }
}

/**
 * @param {string} name
 * @returns {Promise<null | {
 *   id: number, name: string, aliases: string[], picUrl: string, briefDesc: string,
 *   albums: string[], songs: string[], albumSize: number, musicSize: number
 * }>}
 */
export async function fetchArtistProfile(name) {
  const key = normalize(name);
  if (!key) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const task = lookup(name)
    .then((profile) => {
      remember(key, profile);
      return profile;
    })
    .catch(() => {
      remember(key, null);
      return null;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

async function lookup(name) {
  const search = await getJson(
    `/api/search/get?s=${encodeURIComponent(name)}&type=100&limit=6&offset=0`,
  );
  const artist = pickArtist(search?.result?.artists, name);
  if (!artist) return null;
  return buildProfile(artist, artist.name || name);
}

/** 已知网易云歌手 id 时直接取详情，避免同名歌手（KAI / Kai）匹配错人。 */
export async function fetchArtistById(rawId) {
  const id = Number.parseInt(rawId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const key = `id:${id}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const task = buildProfile({ id }, String(id))
    .then((profile) => {
      remember(key, profile);
      return profile;
    })
    .catch(() => {
      remember(key, null);
      return null;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

async function buildProfile(artist, fallbackName) {
  const [detail, albums, songs] = await Promise.allSettled([
    getJson(`/api/artist/${artist.id}`),
    getJson(`/api/artist/albums/${artist.id}?limit=6&offset=0`),
    getJson(`/api/artist/top/song?id=${artist.id}&limit=10`),
  ]);

  const info = detail.status === 'fulfilled' ? detail.value?.artist || {} : {};
  const albumNames =
    albums.status === 'fulfilled'
      ? (albums.value?.hotAlbums || []).map((album) => album?.name).filter(Boolean)
      : [];
  const songNames =
    songs.status === 'fulfilled'
      ? (songs.value?.songs || [])
          .map((song) => song?.name)
          .filter(Boolean)
          .slice(0, 10)
      : [];

  return {
    id: artist.id,
    name: info.name || artist.name || fallbackName,
    aliases: info.alias || artist.alias || [],
    picUrl: info.picUrl || artist.picUrl || '',
    briefDesc: String(info.briefDesc || '').trim().slice(0, 600),
    albums: albumNames,
    songs: songNames,
    albumSize: Number(info.albumSize || artist.albumSize || 0),
    musicSize: Number(info.musicSize || artist.musicSize || 0),
  };
}

/** 把资料整理成给模型看的上下文文本；没有资料时返回空字符串。 */
export function profileToContext(profile) {
  if (!profile) return '';
  const lines = [`名称：${profile.name}${profile.aliases?.length ? `（别名：${profile.aliases.join('、')}）` : ''}`];
  if (profile.albumSize) lines.push(`专辑数：${profile.albumSize}；歌曲数：${profile.musicSize || '未知'}`);
  if (profile.briefDesc) lines.push(`简介：${profile.briefDesc}`);
  if (profile.albums?.length) lines.push(`专辑：${profile.albums.join('、')}`);
  if (profile.songs?.length) lines.push(`热门歌曲：${profile.songs.join('、')}`);
  return lines.join('\n');
}
