/**
 * 详情页 /artist/[name] 的服务端渲染。
 * 注入：标题、封面、资料速览（出道年 / 公司 / 成员 / 代表作）、奖项与来源标注。
 * 档案正文仍由浏览器端调用 /api/chat 流式获取。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { findGroup } from './groups.js';
import { formatSourceLine, getLibraryProfile, sourceLabel } from './profile.js';

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

function renderFact(fact) {
  const label = sourceLabel(fact.source);
  return (
    '<div class="fact">' +
    `<dt class="fact-label">${escapeHtml(fact.label)}</dt>` +
    `<dd class="fact-value">${escapeHtml(fact.value)}` +
    (label ? `<span class="fact-source">${escapeHtml(label)}</span>` : '') +
    '</dd></div>'
  );
}

function renderAward(item, source) {
  const label = sourceLabel(source);
  return (
    '<li class="award-item">' +
    `<span class="award-text">${escapeHtml(item)}</span>` +
    (label ? `<span class="award-source">${escapeHtml(label)}</span>` : '') +
    '</li>'
  );
}

function renderStage(profile) {
  if (!profile.bvid) return '';
  const url = `https://www.bilibili.com/video/${profile.bvid}`;
  return (
    '<li class="award-item award-item--stage">' +
    `<a class="stage-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(profile.name)} 代表舞台</a>` +
    '<span class="award-source">B站</span></li>'
  );
}

/** 资料面板：只渲染真实抓到的字段，缺的显示「暂未收录」。 */
function renderProfilePanel(profile) {
  const facts = profile?.facts || [];
  const awards = profile?.awards || [];
  const sourceLine = formatSourceLine(profile?.sources || []);

  const factHtml = facts.length
    ? `<dl class="fact-list">${facts.map(renderFact).join('')}</dl>`
    : '<p class="fact-empty">暂未收录</p>';

  const awardHtml =
    awards.length || profile?.bvid
      ? [...awards.map((item) => renderAward(item, 'baike')), renderStage(profile)].join('')
      : '<li class="award-empty">暂未收录</li>';

  const baikeLink = profile?.baikeUrl
    ? `<a class="baike-link" href="${escapeHtml(profile.baikeUrl)}" target="_blank" rel="noopener noreferrer">百科词条 ↗</a>`
    : '';

  return `<section class="profile-panel" id="profilePanel" aria-labelledby="profileTitle" data-mode="${profile?.hasData ? 'library' : 'live'}">
          <div class="profile-head">
            <h2 class="profile-panel__title" id="profileTitle">资料速览</h2>
            ${baikeLink}
          </div>
          ${factHtml}
          <div class="awards-panel">
            <h3 class="profile-panel__subtitle">奖项 / 代表舞台</h3>
            <ul class="award-list">${awardHtml}</ul>
          </div>
          <p class="source-line" id="sourceLine">${escapeHtml(sourceLine)}</p>
        </section>`;
}

/**
 * @param {string} rawName 路径里的团体名（已 decodeURIComponent）
 * @returns {{ html: string, displayName: string, cover: string, group: object | null }}
 */
export function renderArtistPage(rawName) {
  const name = String(rawName || '').trim().slice(0, 40);
  const group = findGroup(name);
  const profile = getLibraryProfile(name);
  const displayName = profile?.name || group?.name || name;
  const displayNameZh = String(profile?.nameZh || group?.nameZh || '').trim();
  const cover = profile?.cover || group?.cover || '';

  const safeName = escapeHtml(displayName);
  const safeCover = escapeHtml(cover);
  const hasZh = Boolean(displayNameZh) && displayNameZh !== displayName;

  // 没有内置封面时，前端会用 /api/cover 自动补一张（百科首图 / 网易云歌手头像）
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
    PROFILE_PANEL: renderProfilePanel(profile),
    SOURCE_LINE: escapeHtml(formatSourceLine(profile?.sources || [])),
  };

  let html = loadTemplate();
  for (const [token, value] of Object.entries(replacements)) {
    // 用函数返回值，避免名字里出现 $& 之类的替换模式
    html = html.replaceAll(`{{${token}}}`, () => value);
  }

  return { html, displayName, cover, group, profile };
}
