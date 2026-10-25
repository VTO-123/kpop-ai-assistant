/**
 * 详情页 /artist/[name] 的服务端渲染。
 * 只做「壳」的注入：标题、封面、团体名。
 * 档案正文仍由浏览器端调用 /api/chat 流式获取，后端 AI 逻辑不变。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { findGroup } from './groups.js';

const TEMPLATE_PATH = path.join(config.publicDir, 'artist.html');

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

let templateCache = null;

function loadTemplate() {
  if (templateCache) return templateCache;
  templateCache = readFileSync(TEMPLATE_PATH, 'utf8');
  return templateCache;
}

/**
 * @param {string} rawName 路径里的团体名（已 decodeURIComponent）
 * @returns {{ html: string, displayName: string, cover: string, group: object | null }}
 */
export function renderArtistPage(rawName) {
  const name = String(rawName || '').trim().slice(0, 40);
  const group = findGroup(name);
  const displayName = group?.name || name;
  const displayNameZh = String(group?.nameZh || '').trim();
  const cover = group?.cover || '';

  const safeName = escapeHtml(displayName);
  const safeCover = escapeHtml(cover);
  const hasZh = Boolean(displayNameZh) && displayNameZh !== displayName;

  // 没有内置封面时，前端会用 /api/cover 自动补一张（网易云歌手头像）
  const coverLookup = !cover && config.coverEnabled;

  const coverBlock = cover
    ? `<img class="banner-img" src="${safeCover}" alt="${safeName} 团体封面" referrerpolicy="no-referrer" decoding="async" fetchpriority="high" data-cover-img />`
    : '';

  const replacements = {
    TITLE: escapeHtml(`${displayName}${hasZh ? ` ${displayNameZh}` : ''} · K-POP 档案室`),
    ARTIST_NAME: safeName,
    BANNER_SUB: escapeHtml(`${hasZh ? `${displayNameZh} · ` : ''}入坑档案`),
    BANNER_CLASS: cover ? 'banner' : 'banner banner--empty',
    COVER_LOOKUP: coverLookup ? ' data-cover-lookup="1"' : '',
    COVER_BLOCK: coverBlock,
    COVER_URL: safeCover,
    OG_META: cover ? `<meta property="og:image" content="${safeCover}" />` : '',
    COVER_CREDIT: escapeHtml(group?.coverCredit ? `封面：${group.coverCredit}` : ''),
  };

  let html = loadTemplate();
  for (const [token, value] of Object.entries(replacements)) {
    // 用函数返回值，避免名字里出现 $& 之类的替换模式
    html = html.replaceAll(`{{${token}}}`, () => value);
  }

  return { html, displayName, cover, group };
}
