/**
 * data/songs.json —— 首页「热门视频」的数据。
 * 每首歌：{ id, title, artist, year, intro, cover, bvid }
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const FILE = path.join(ROOT_DIR, 'data', 'songs.json');
const BVID_PATTERN = /^BV[0-9A-Za-z]{6,}$/;

let cache = null;

export function loadSongs() {
  if (cache) return cache;

  let raw = { songs: [] };
  try {
    raw = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.warn(`[songs] 读取 data/songs.json 失败：${err.message}`);
  }

  const songs = (Array.isArray(raw.songs) ? raw.songs : []).filter(
    (song) => song && typeof song.id === 'string' && song.title && song.artist,
  );

  cache = { ...raw, songs };
  return cache;
}

export function listSongs() {
  return loadSongs().songs;
}

/** 首页轮播只挑有封面的（即精选的 10 首）。 */
export function listFeaturedSongs() {
  return listSongs().filter((song) => song.cover);
}

/** 档案页「十首必听」用：歌名 → { title, artist, bvid } */
export function songLinkMap() {
  const map = {};
  for (const song of listSongs()) {
    const key = normalizeTitle(song.title);
    if (!key || map[key]) continue;
    map[key] = { title: song.title, artist: song.artist, bvid: song.bvid || '' };
  }
  return map;
}

export function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）\[\]]/g, '')
    .trim();
}

export function findSong(rawId) {
  const key = String(rawId || '').trim().toLowerCase();
  if (!key) return null;
  return listSongs().find((song) => song.id === key) || null;
}

export function hasBvid(song) {
  return BVID_PATTERN.test(String(song?.bvid || '').trim());
}

/** 有 BV 号跳官方播放页；没有就退化为 B 站搜索页，避免死链。 */
export function songBilibiliUrl(song) {
  if (hasBvid(song)) return `https://www.bilibili.com/video/${String(song.bvid).trim()}`;
  const keyword = `${song?.title || ''} ${song?.artist || ''} MV`.trim();
  return `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;
}

/** 轮播用的卡片数据；封面走同源代理，WebGL 才能取到纹理。 */
export function toCarouselItem(song) {
  return {
    id: song.id,
    src: `/api/img?u=${encodeURIComponent(song.cover || '')}`,
    sourceUrl: song.cover || '',
    title: song.title,
    subtitle: [song.artist, song.year].filter(Boolean).join(' · '),
    artist: song.artist,
  };
}
