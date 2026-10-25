/**
 * 歌曲详情页 /song/[id] 的服务端渲染。
 * 只注入「这是哪首歌」的信息（歌名 / 歌手 / 封面 / 简介 / 两个入口），页面本身是静态壳。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { escapeHtml } from './artist-page.js';
import { config } from './config.js';
import { findSong, hasBvid, songBilibiliUrl } from './songs.js';

const TEMPLATE_PATH = path.join(config.publicDir, 'song.html');
let templateCache = null;

function loadTemplate() {
  if (templateCache) return templateCache;
  templateCache = readFileSync(TEMPLATE_PATH, 'utf8');
  return templateCache;
}

/**
 * @param {string} rawId
 * @returns {null | { html: string, song: object }}
 */
export function renderSongPage(rawId) {
  const song = findSong(rawId);
  if (!song) return null;

  const title = escapeHtml(song.title);
  const artist = escapeHtml(song.artist);
  const cover = escapeHtml(song.cover || '');
  const intro = escapeHtml(song.intro || '');

  const replacements = {
    TITLE: escapeHtml(`${song.title} · ${song.artist} · K-POP 档案室`),
    SONG_TITLE: title,
    ARTIST_NAME: artist,
    YEAR: escapeHtml(song.year ? String(song.year) : ''),
    INTRO: intro,
    COVER_URL: cover,
    COVER_ALT: escapeHtml(`${song.title} 封面`),
    COVER_CREDIT: escapeHtml(song.coverSource ? `封面：${song.coverSource}` : ''),
    ARTIST_URL: `/artist/${encodeURIComponent(song.artist)}`,
    BILI_URL: escapeHtml(songBilibiliUrl(song)),
    BILI_FALLBACK: hasBvid(song) ? '' : ' data-fallback="1"',
    OG_META: cover
      ? `<meta property="og:image" content="${cover}" />` +
        `<meta property="og:title" content="${escapeHtml(`${song.title} · ${song.artist}`)}" />`
      : '',
  };

  let html = loadTemplate();
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll(`{{${token}}}`, () => value);
  }

  return { html, song };
}
