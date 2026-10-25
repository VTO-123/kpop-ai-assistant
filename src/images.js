/**
 * 详情页轮播的图片数据（data/kpop_images.json）。
 * 只做读取与挑选，不负责渲染；前端拿到 items 后用 /js/carousel.js 画出来。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';
import { normalizeName } from './groups.js';

const FILE = path.join(ROOT_DIR, 'data', 'kpop_images.json');
const DEFAULT_POOL_SIZE = 12;

let cache = null;

export function loadImageData() {
  if (cache) return cache;

  let raw = { groups: [] };
  try {
    raw = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch (err) {
    console.warn(`[images] 读取 data/kpop_images.json 失败：${err.message}`);
  }

  const groups = (Array.isArray(raw.groups) ? raw.groups : [])
    .map((group) => ({
      key: normalizeName(group.key || group.name),
      name: group.name,
      aliases: (group.aliases || []).map(normalizeName).filter(Boolean),
      images: (group.images || []).filter(
        (image) => image && typeof image.src === 'string' && image.src.startsWith('https://'),
      ),
    }))
    .filter((group) => group.images.length > 0);

  cache = { ...raw, groups };
  return cache;
}

/** 按团体名/别名找该团体的照片（下一步「当前团体优先」会用到）。 */
export function findGroupImages(rawName) {
  const key = normalizeName(rawName);
  if (!key) return null;
  const { groups } = loadImageData();
  return groups.find((group) => group.key === key || group.aliases.includes(key)) || null;
}

/**
 * 默认轮播池：各团体轮流出图，避免整屏都是同一个团。
 * src 一律改写成同源代理地址（WebGL 纹理要求同源），原始地址保留在 sourceUrl 里。
 * @param {number} limit
 */
export function buildDefaultPool(limit = DEFAULT_POOL_SIZE) {
  const { groups } = loadImageData();
  const pool = [];
  let round = 0;

  while (pool.length < limit) {
    let added = 0;
    for (const group of groups) {
      const image = group.images[round];
      if (!image) continue;
      pool.push({
        ...image,
        src: `/api/img?u=${encodeURIComponent(image.src)}`,
        sourceUrl: image.src,
        title: group.name,
        groupKey: group.key,
      });
      added += 1;
      if (pool.length >= limit) break;
    }
    if (!added) break;
    round += 1;
  }

  return pool;
}
