/* 首页：只负责「搜索 → 跳转详情页」。档案内容全部在 /artist/[name] 里生成。 */
import { pushRecent, renderRecent } from './js/store.js';

const form = document.getElementById('askForm');
const input = document.getElementById('groupInput');
const recentWrap = document.getElementById('recentWrap');
const recentList = document.getElementById('recentList');
const modeBadge = document.getElementById('modeBadge');
const modeText = document.getElementById('modeText');

const artistUrl = (name) => `/artist/${encodeURIComponent(name)}`;

function go(rawName) {
  const name = String(rawName || '').trim().slice(0, 40);
  if (!name) {
    input.focus();
    return;
  }
  pushRecent(name);
  window.location.assign(artistUrl(name));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  go(input.value);
});

renderRecent({ wrap: recentWrap, list: recentList }, go);

/* ---------------- 搜索联想 ---------------- */

const suggestPanel = document.getElementById('suggestPanel');
let artists = [];
let suggestItems = [];
let suggestIndex = -1;

const normalizeQuery = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '')
    .trim();

async function loadArtists() {
  try {
    const res = await fetch('/api/artists');
    if (!res.ok) return;
    const data = await res.json();
    artists = Array.isArray(data.artists) ? data.artists : [];
  } catch {
    /* 拿不到索引就不显示联想，不影响搜索 */
  }
}

function filterArtists(query) {
  const q = normalizeQuery(query);
  if (!q) return [];

  const scored = [];
  for (const artist of artists) {
    const fields = [artist.name, artist.nameZh, ...(artist.aliases || [])]
      .map(normalizeQuery)
      .filter(Boolean);

    let score = 0;
    for (const field of fields) {
      if (field.startsWith(q)) {
        score = 2;
        break;
      }
      if (field.includes(q)) score = Math.max(score, 1);
    }
    if (score > 0) scored.push({ artist, score });
  }

  scored.sort((a, b) => b.score - a.score || a.artist.name.localeCompare(b.artist.name));
  return scored.slice(0, 8).map((item) => item.artist);
}

function renderSuggestions(query) {
  suggestItems = filterArtists(query);
  suggestIndex = -1;
  suggestPanel.replaceChildren();

  if (!suggestItems.length) {
    closeSuggestions();
    return;
  }

  suggestItems.forEach((artist, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'suggest-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');

    const name = document.createElement('span');
    name.className = 'suggest-item__name';
    name.textContent = artist.name;

    const zh = document.createElement('span');
    zh.className = 'suggest-item__zh';
    zh.textContent = artist.nameZh && artist.nameZh !== artist.name ? artist.nameZh : '';

    const tag = document.createElement('span');
    tag.className = 'suggest-item__tag';
    tag.textContent = artist.type === 'solo' ? '个人' : '团体';

    item.append(name, zh, tag);
    item.addEventListener('mousedown', (event) => event.preventDefault());
    item.addEventListener('click', () => pickSuggestion(index));
    suggestPanel.append(item);
  });

  suggestPanel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function pickSuggestion(index) {
  const artist = suggestItems[index];
  if (!artist) return;
  input.value = artist.name;
  closeSuggestions();
  input.focus();
}

function closeSuggestions() {
  suggestPanel.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  suggestIndex = -1;
}

function moveSuggestion(step) {
  if (suggestPanel.hidden || !suggestItems.length) return;
  suggestIndex = (suggestIndex + step + suggestItems.length) % suggestItems.length;
  [...suggestPanel.children].forEach((item, index) => {
    item.setAttribute('aria-selected', index === suggestIndex ? 'true' : 'false');
  });
  suggestPanel.children[suggestIndex]?.scrollIntoView({ block: 'nearest' });
}

input.addEventListener('input', () => {
  if (!input.value.trim()) {
    closeSuggestions();
    return;
  }
  renderSuggestions(input.value);
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSuggestion(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSuggestion(-1);
  } else if (event.key === 'Escape') {
    closeSuggestions();
  } else if (event.key === 'Enter' && !suggestPanel.hidden && suggestIndex >= 0) {
    event.preventDefault();
    pickSuggestion(suggestIndex);
  }
});

input.addEventListener('blur', () => window.setTimeout(closeSuggestions, 120));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.input-wrap')) closeSuggestions();
});

loadArtists();
// 兼容旧分享链接：/?g=Bigbang → /artist/Bigbang
const preset = new URLSearchParams(window.location.search).get('g');
if (preset) {
  input.value = preset.slice(0, 40);
  go(preset);
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('config');
    const data = await res.json();
    modeBadge.hidden = false;
    modeBadge.dataset.mode = data.demo ? 'demo' : 'live';

    if (data.demo) {
      modeText.textContent = '演示模式';
    } else {
      modeText.textContent = 'LIVE';
    }
  } catch {
    modeBadge.hidden = true;
  }
}

loadConfig();
loadShowcase();
input.focus();

/* ---------------- 首页热门视频 3D 轮播 ---------------- */

async function loadShowcase() {
  const container = document.getElementById('hotSongsCarousel');
  if (!container) return;

  let items = [];
  try {
    const res = await fetch('/api/songs');
    if (res.ok) {
      const data = await res.json();
      items = Array.isArray(data.items) ? data.items : [];
    }
  } catch {
    /* 拿不到数据就不显示展示区 */
  }

  if (!items.length) {
    container.closest('.home-showcase')?.remove();
    return;
  }

  try {
    const { createFlexCarousel } = await import('./js/flex-carousel.js');
    const instance = createFlexCarousel(container, {
      items: items.map((item) => ({
        id: item.id,
        src: item.src,
        title: item.title,
        subtitle: item.subtitle || item.artist,
        alt: `${item.title} 的 MV 封面`,
      })),
      preset: 'liquid',
      intro: 'rise',
      cardHeight: 0.5,
      gap: 12,
      radius: 0,
      fit: 'natural',
      focusOnClick: false,
      captions: true,
      // 点任意一张卡片 → 进入这首歌的详情页
      onCardClick: (_index, item) => {
        if (item && item.id) window.location.assign(`/song/${encodeURIComponent(item.id)}`);
      },
      onSelect: (_index, item) => {
        if (item && item.id) window.location.assign(`/song/${encodeURIComponent(item.id)}`);
      },
    });

    if (!instance) throw new Error('webgl2 unavailable');
    container.dataset.engine = 'webgl';
  } catch {
    // WebGL2 不可用 / ogl 没装：降级成普通图片墙，不白屏
    renderImageWall(container, items);
  }
}

function renderImageWall(container, items) {
  container.dataset.engine = 'fallback';
  container.classList.add('flex-carousel--fallback');
  container.replaceChildren();

  const grid = document.createElement('div');
  grid.className = 'cover-fallback';

  items.slice(0, 8).forEach((item) => {
    const figure = document.createElement('figure');
    figure.className = 'cover-fallback__item';

    const img = document.createElement('img');
    img.src = item.src;
    img.alt = `${item.title} 照片`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => figure.remove(), { once: true });

    const caption = document.createElement('figcaption');
    caption.textContent = item.title;

    figure.append(img, caption);
    grid.append(figure);
  });

  container.append(grid);
}
