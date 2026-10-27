/**
 * 用户云端数据：收藏 / 最近看过 / 搜索历史。
 * 每个用户一份 data/users/<用户名>.json，按用户名隔离，
 * 登录后读写本人数据，其他人不可见。
 *
 * 收藏、最近看过按歌手名去重；最近/搜索各保留最近 20 条。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validUsername } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_DIR = path.join(ROOT, 'data', 'users');

const MAX_RECENT = 20;
const MAX_SEARCHES = 20;

function userFile(username) {
  return path.join(USER_DIR, `${username}.json`);
}

function emptyData() {
  return { favorites: [], recent: [], searches: [] };
}

function load(username) {
  if (!validUsername(username)) return emptyData();
  try {
    if (!existsSync(userFile(username))) return emptyData();
    const parsed = JSON.parse(readFileSync(userFile(username), 'utf8'));
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
      searches: Array.isArray(parsed.searches) ? parsed.searches : [],
    };
  } catch {
    return emptyData();
  }
}

function save(username, data) {
  writeFileSync(userFile(username), JSON.stringify(data, null, 2), 'utf8');
}

/** 收藏一个歌手（含名字/中文名/封面，若传了）；已收藏则不变。返回最新收藏列表。 */
export function addFavorite(username, item) {
  const data = load(username);
  const name = String(item.name || '').trim().slice(0, 40);
  if (!name) return data.favorites;
  const exists = data.favorites.some((f) => f.name === name);
  if (!exists) {
    data.favorites.unshift({
      name,
      nameZh: String(item.nameZh || '').trim().slice(0, 40),
      cover: String(item.cover || '').trim(),
      time: Date.now(),
    });
  }
  save(username, data);
  return data.favorites;
}

/** 取消收藏。返回最新收藏列表。 */
export function removeFavorite(username, name) {
  const data = load(username);
  const key = String(name || '').trim();
  data.favorites = data.favorites.filter((f) => f.name !== key);
  save(username, data);
  return data.favorites;
}

/** 记录最近看过（按名字去重，置顶，最多 20 条）。 */
export function pushRecent(username, name) {
  const data = load(username);
  const key = String(name || '').trim().slice(0, 40);
  if (key) {
    data.recent = data.recent.filter((r) => r !== key);
    data.recent.unshift(key);
    if (data.recent.length > MAX_RECENT) data.recent = data.recent.slice(0, MAX_RECENT);
  }
  save(username, data);
  return data.recent;
}

/** 记录搜索历史（去重置顶，最多 20 条）。 */
export function pushSearch(username, keyword) {
  const data = load(username);
  const key = String(keyword || '').trim().slice(0, 40);
  if (key) {
    data.searches = data.searches.filter((s) => s !== key);
    data.searches.unshift(key);
    if (data.searches.length > MAX_SEARCHES) data.searches = data.searches.slice(0, MAX_SEARCHES);
  }
  save(username, data);
  return data.searches;
}

/** 清空搜索历史。 */
export function clearSearches(username) {
  const data = load(username);
  data.searches = [];
  save(username, data);
  return data.searches;
}

export function getUserData(username) {
  return load(username);
}
