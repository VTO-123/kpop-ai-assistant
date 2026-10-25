/** 极简 Markdown 渲染：只支持本项目输出契约用到的那几种语法。 */

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function inline(text) {
  let html = escapeHtml(text);
  // [[成员名]] 是 AI 输出成员名单时用的标记，不在成员名单行时按普通文字渲染
  html = html.replace(/\[\[([^\]]+)\]\]/g, '$1');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return html;
}

/**
 * 极简 Markdown 渲染：只支持本项目输出契约用到的那几种语法。
 * 传了 songLinks 时，把「十首必听」里的 **歌名** 渲染成 B 站链接。
 */
export function renderMarkdown(text, options = {}) {
  const lines = String(text || '').split('\n');
  const songLinks = options.songLinks || {};
  const members = options.members instanceof Set ? options.members : new Set(options.members || []);
  const artist = options.artist || '';
  const out = [];
  let list = null;
  let section = '';

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const value = line.trim();
    if (!value) {
      closeList();
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(value)) {
      closeList();
      out.push('<hr />');
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(value);
    if (heading) {
      closeList();
      section = heading[2].replace(/[*_`]/g, '').trim();
      out.push(`<h3>${inline(heading[2])}</h3>`);
      continue;
    }

    const bullet = /^[-*·•]\s+(.*)$/.exec(value);
    if (bullet) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${renderBullet(bullet[1], members)}</li>`);
      continue;
    }

    const ordered = /^\d+[.)、]\s+(.*)$/.exec(value);
    if (ordered) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${renderSongItem(ordered[1], section, songLinks, artist)}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(value)}</p>`);
  }

  closeList();
  return out.join('');
}

/** 只在「热门歌曲 / 必听」小节里把歌名做成链接：有 BV 走视频页，没有回退 B 站搜索页。 */
function renderSongItem(item, section, songLinks, artist) {
  if (!/必听|热门歌曲/.test(section)) return inline(item);

  const match = /^\*\*(.+?)\*\*/.exec(item);
  if (!match) return inline(item);

  const title = match[1].trim();
  const hit = songLinks[normalizeTitle(title)];
  const bvid = hit && /^BV[0-9A-Za-z]{6,}$/.test(hit.bvid || '') ? hit.bvid : '';
  // 已知歌曲用曲库里的歌手名，未知歌曲用当前页面的歌手名，提高搜索命中率
  const keyword = `${title} ${hit?.artist || artist}`.trim();
  const href = bvid
    ? `https://www.bilibili.com/video/${bvid}`
    : `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;

  const rest = inline(item.slice(match[0].length));

  return (
    `<a class="song-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"` +
    ` title="${bvid ? '在 B 站看这首歌' : '在 B 站搜索这首歌'}">` +
    `<strong>${escapeHtml(title)}</strong></a>${rest}`
  );
}

/** 「成员名单」这一行：AI 用 [[名字]] 标记的直接成链，内置数据按已知成员名匹配。 */
function renderBullet(text, members) {
  const match = /^(成员名单|成员)[:：]\s*(.+)$/.exec(text);
  if (!match) return inline(text);

  const label = `${escapeHtml(match[1])}：`;
  const body = match[2];

  if (body.includes('[[')) return `${label}${renderMarkedMembers(body)}`;
  if (members.size === 0) return inline(text);

  const parts = body.split(/([、，,；;\/])/);

  const rendered = parts
    .map((part) => {
      if (/^[、，,；;\/]$/.test(part)) return escapeHtml(part);
      const core = part.trim();
      if (!core) return '';

      const parenIndex = core.search(/[（(]/);
      const name = (parenIndex >= 0 ? core.slice(0, parenIndex) : core).trim();
      const rest = parenIndex >= 0 ? core.slice(parenIndex) : '';
      const key = normalizeTitle(name);

      if (name && members.has(key)) {
        return (
          `<a class="member-link" href="/artist/${encodeURIComponent(name)}">` +
          `${escapeHtml(name)}</a>${escapeHtml(rest)}`
        );
      }
      return inline(core);
    })
    .join('');

  return `${label}${rendered}`;
}

/** 把 AI 输出里的 [[成员名]] 标记渲染成个人页链接。 */
function renderMarkedMembers(body) {
  return body
    .split(/(\[\[[^\]]+\]\])/)
    .map((part) => {
      const marked = /^\[\[([^\]]+)\]\]$/.exec(part);
      if (!marked) return inline(part);
      const name = marked[1].trim();
      if (!name) return '';
      return (
        `<a class="member-link" href="/artist/${encodeURIComponent(name)}">` +
        `${escapeHtml(name)}</a>`
      );
    })
    .join('');
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）\[\]]/g, '')
    .trim();
}
