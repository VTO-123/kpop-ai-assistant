/**
 * QQ 音乐资料聚合（非官方接口，国内直连）。
 *
 * 两步：
 *   1. smartbox 搜索拿到歌手 mid / 头像；
 *   2. musicu.fcg 的 get_singer_detail_info 拿到简介（singer_brief）、热门歌曲、专辑。
 *
 * 只做「补充」：网易云拿不到的字段用这里补，失败就当没有，不影响页面。
 */
const TIMEOUT_MS = 4500;
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const cache = new Map();
const inflight = new Map();

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '')
    .trim();

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/', Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

function pickSinger(list, name) {
  const key = normalize(name);
  const usable = (list || []).filter((item) => item && item.mid && item.name);
  if (!usable.length) return null;
  return (
    usable.find((item) => normalize(item.name) === key) ||
    usable.find((item) => normalize(item.name).includes(key)) ||
    null
  );
}

function upgradePic(raw, mid) {
  const base = raw || `https://y.gtimg.cn/music/photo_new/T001R500x500M000${mid}.jpg`;
  return String(base)
    .replace(/^http:\/\//, 'https://')
    .replace(/T001R\d+x\d+M000/, 'T001R500x500M000');
}

function remember(key, value) {
  cache.set(key, { value, at: Date.now() });
  if (cache.size <= MAX_ENTRIES) return;
  for (const [entryKey] of cache) {
    cache.delete(entryKey);
    if (cache.size <= MAX_ENTRIES) break;
  }
}

/**
 * @param {string} name
 * @returns {Promise<null | {
 *   mid: string, name: string, picUrl: string, brief: string,
 *   songs: string[], albums: string[], totalAlbum: number, totalSong: number
 * }>}
 */
export async function fetchQQArtist(name) {
  const key = normalize(name);
  if (!key) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const task = lookup(name)
    .then((value) => {
      remember(key, value);
      return value;
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
  const smart = await getJson(
    `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?key=${encodeURIComponent(name)}&format=json`,
  );
  const singer = pickSinger(smart?.data?.singer?.itemlist, name);
  if (!singer) return null;

  const payload = {
    comm: { ct: 24, cv: 0 },
    singer: {
      module: 'music.web_singer_info_svr',
      method: 'get_singer_detail_info',
      param: { singermid: singer.mid, num: 20, page: 0 },
    },
  };

  let data = {};
  try {
    const detail = await getJson(
      `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(
        JSON.stringify(payload),
      )}`,
    );
    data = detail?.singer?.data || {};
  } catch {
    /* 详情拿不到就只用 smartbox 的结果 */
  }

  const songlist = Array.isArray(data.songlist) ? data.songlist : [];
  const songs = songlist
    .map((song) => song?.name)
    .filter(Boolean)
    .slice(0, 10);
  const albums = [
    ...new Set(songlist.map((song) => song?.album?.name).filter(Boolean)),
  ].slice(0, 6);

  return {
    mid: singer.mid,
    name: data?.singer_info?.name || singer.name,
    picUrl: upgradePic(singer.pic, singer.mid),
    brief: String(data.singer_brief || '').trim().slice(0, 700),
    songs,
    albums,
    totalAlbum: Number(data.total_album || 0),
    totalSong: Number(data.total_song || 0),
  };
}

/** 整理成给模型的上下文文本。 */
export function qqToContext(profile) {
  if (!profile) return '';
  const lines = [`名称：${profile.name}`];
  if (profile.brief) lines.push(`简介：${profile.brief}`);
  if (profile.totalAlbum) {
    lines.push(`专辑数：${profile.totalAlbum}；歌曲数：${profile.totalSong || '未知'}`);
  }
  if (profile.albums?.length) lines.push(`专辑：${profile.albums.join('、')}`);
  if (profile.songs?.length) lines.push(`热门歌曲：${profile.songs.join('、')}`);
  return lines.join('\n');
}
