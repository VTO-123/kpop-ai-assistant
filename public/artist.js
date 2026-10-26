/* 详情页 /artist/[name]：当前团体的歌手照片 + 流式档案 */
import { renderMarkdown } from './js/md.js';
import { postChat, consumeStream } from './js/stream.js';
import { pushRecent } from './js/store.js';

const artist = String(document.body.dataset.artist || '').trim();
const banner = document.getElementById('banner');

const els = {
  card: document.querySelector('.detail-card'),
  output: document.getElementById('output'),
  status: document.getElementById('status'),
  sourceChip: document.getElementById('sourceChip'),
  stop: document.getElementById('stopBtn'),
  copy: document.getElementById('copyBtn'),
  download: document.getElementById('downloadBtn'),
  errorBox: document.getElementById('errorBox'),
  errorText: document.getElementById('errorText'),
  retry: document.getElementById('retryBtn'),
  notFound: document.getElementById('notFound'),
  notFoundMessage: document.getElementById('notFoundMessage'),
  notFoundSimilar: document.getElementById('notFoundSimilar'),
};

const state = {
  raw: '',
  busy: false,
  controller: null,
  startedAt: 0,
  ticker: null,
  frame: 0,
  stick: true,
  notFound: false,
};

let songLinks = {};
let memberNames = new Set();

init();

function init() {
  pushRecent(artist);
  guardCover();
  hydrateCover();
  hydrateProfile();
  loadSongLinks();
  loadMembers();

  els.stop.addEventListener('click', () => state.controller?.abort());
  els.copy.addEventListener('click', copyAll);
  els.download.addEventListener('click', downloadAll);
  els.retry.addEventListener('click', () => {
    hideError();
    start();
  });

  initSongLinkClicks();

  window.addEventListener(
    'scroll',
    () => {
      const doc = document.documentElement;
      state.stick = window.innerHeight + window.scrollY >= doc.scrollHeight - 180;
    },
    { passive: true },
  );

  start();
}

/** 十首必听的 B 站链接映射（歌名 → bvid），渲染时用来把歌名变成链接。 */
async function loadSongLinks() {
  try {
    const res = await fetch('/api/song-links');
    if (!res.ok) return;
    const data = await res.json();
    songLinks = data.links || {};
    if (state.raw) paint();
  } catch {
    /* 拿不到就全部退化为 B 站搜索链接 */
  }
}

/** 成员名单映射：已知成员名渲染成 /artist/{成员名} 链接。 */
async function loadMembers() {
  try {
    const res = await fetch('/api/members');
    if (!res.ok) return;
    const data = await res.json();
    memberNames = new Set(
      (data.members || []).map((member) =>
        String(member.name || '')
          .toLowerCase()
          .replace(/[\s\-_.·'"“”‘’()（）\[\]]/g, '')
          .trim(),
      ),
    );
    if (state.raw) paint();
  } catch {
    /* 拿不到就只渲染纯文本，不影响其他内容 */
  }
}

/* ---------------- 顶部封面（当前搜索团体的歌手照片） ---------------- */

/** 封面加载失败（外链挂了 / 被墙）时，退回渐变占位，不出现破图。 */
function guardCover() {
  const img = document.querySelector('[data-cover-img]');
  if (!img) return;

  const fallback = () => {
    banner?.classList.add('banner--empty');
    img.remove();
  };

  img.addEventListener('error', fallback, { once: true });
  if (img.complete && img.naturalWidth === 0) fallback();
}

/**
 * 内置 data/groups.json 没有 cover 时，找后端补一张「当前这个团体」的歌手照片。
 * 后端会缓存结果，同一个团体不会重复打接口。
 */
async function hydrateCover() {
  if (!banner || banner.dataset.coverLookup !== '1') return;

  try {
    const res = await fetch(`/api/cover?name=${encodeURIComponent(artist)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.url) return;
    applyCover(data.url, data.source);
  } catch {
    /* 拿不到封面就继续用占位，不影响正文 */
  }
}

function applyCover(url, source) {
  const img = document.createElement('img');
  img.className = 'banner-img';
  img.src = url;
  img.alt = `${artist} 团体封面`;
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.addEventListener(
    'error',
    () => {
      img.remove();
      banner.classList.add('banner--empty');
    },
    { once: true },
  );

  banner.prepend(img);
  banner.classList.remove('banner--empty');

  const credit = document.querySelector('.banner-credit');
  if (credit) {
    const labels = { qqmusic: 'QQ 音乐', baike: '百度百科', netease: '网易云音乐' };
    credit.textContent = `封面：${labels[source] || '网易云音乐'} · 自动匹配`;
  }
}


/* ---------------- 资料速览 / 奖项 / 来源标注 ---------------- */

/**
 * 库里没有该歌手时，服务端只输出空面板；这里实时查百科 + 网易云补上。
 * 库里已有资料时直接使用服务端渲染结果，不再请求。
 */
async function hydrateProfile() {
  const panel = document.getElementById('profilePanel');
  if (!panel || panel.dataset.mode === 'library') return;

  try {
    const res = await fetch(`/api/artist-profile?name=${encodeURIComponent(artist)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data) return;
    applyProfile(data);
  } catch {
    /* 拿不到资料就保留「暂未收录」 */
  }
}

const SOURCE_LABELS = { baike: '百度百科', netease: '网易云音乐', qqmusic: 'QQ音乐', bilibili: 'B站' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function applyProfile(data) {
  const old = document.getElementById('profilePanel');
  if (!old) return;

  const section = el('section', 'profile-panel');
  section.id = 'profilePanel';
  section.dataset.mode = data.facts?.length ? 'library' : 'live';
  section.setAttribute('aria-labelledby', 'profileTitle');

  const head = el('div', 'profile-head');
  const title = el('h2', 'profile-panel__title', '资料速览');
  title.id = 'profileTitle';
  head.append(title);
  if (data.baikeUrl) {
    const link = el('a', 'baike-link', '百科词条 ↗');
    link.href = data.baikeUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    head.append(link);
  }
  section.append(head);

  if (data.facts?.length) {
    const dl = el('dl', 'fact-list');
    for (const fact of data.facts) {
      const row = el('div', 'fact');
      row.append(el('dt', 'fact-label', fact.label));
      const value = el('dd', 'fact-value', fact.value);
      const label = SOURCE_LABELS[fact.source];
      if (label) value.append(el('span', 'fact-source', label));
      row.append(value);
      dl.append(row);
    }
    section.append(dl);
  } else {
    section.append(el('p', 'fact-empty', '暂未收录'));
  }

  const awards = el('div', 'awards-panel');
  awards.append(el('h3', 'profile-panel__subtitle', '奖项 / 代表舞台'));
  const list = el('ul', 'award-list');

  for (const award of data.awards || []) {
    const item = el('li', 'award-item');
    item.append(el('span', 'award-text', award));
    item.append(el('span', 'award-source', '百度百科'));
    list.append(item);
  }
  if (data.stage?.url) {
    const item = el('li', 'award-item award-item--stage');
    const link = el('a', 'stage-link', data.stage.title || '代表舞台');
    link.href = data.stage.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link, el('span', 'award-source', 'B站'));
    list.append(item);
  }
  if (!list.children.length) list.append(el('li', 'award-empty', '暂未收录'));
  awards.append(list);
  section.append(awards);

  section.append(el('p', 'source-line', data.sourceLine || '资料参考：B站'));

  old.replaceWith(section);
}


/* ---------------- 歌名 → B 站（有 bvid 直链，没有交给服务端解析） ---------------- */

const biliCache = new Map();

async function resolveBiliUrl(title, artistName) {
  const key = `${title}|${artistName}`.toLowerCase();
  if (biliCache.has(key)) return biliCache.get(key);

  const query = new URLSearchParams({ title: title || '', artist: artistName || '' });
  const promise = fetch(`/api/bilibili?${query.toString()}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data && data.url) || '')
    .catch(() => '');
  biliCache.set(key, promise);
  return promise;
}

function initSongLinkClicks() {
  els.output.addEventListener('click', async (event) => {
    const link = event.target.closest?.('a.song-link');
    if (!link) return;
    // 有 bvid 的链接本身已是视频页，交给浏览器直接打开
    if (link.dataset.bvid) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    // 先同步开窗，避免 await 之后被浏览器当成弹窗拦截
    const win = window.open('', '_blank');
    const url = (await resolveBiliUrl(link.dataset.songTitle, link.dataset.songArtist)) || link.href;

    if (win) {
      try {
        win.opener = null;
      } catch {
        /* 跨域时拿不到 opener，忽略 */
      }
      win.location.replace(url);
    } else {
      window.location.href = url;
    }
  });

  // 悬停时预取，点击几乎无等待
  els.output.addEventListener('mouseover', (event) => {
    const link = event.target.closest?.('a.song-link');
    if (link && !link.dataset.bvid) {
      resolveBiliUrl(link.dataset.songTitle, link.dataset.songArtist);
    }
  });
}

/* ---------------- 档案正文（流式） ---------------- */

async function start() {
  if (state.busy || !artist) return;

  state.busy = true;
  state.raw = '';
  state.stick = true;
  state.notFound = false;
  state.startedAt = performance.now();
  state.controller = new AbortController();

  els.notFound.hidden = true;
  els.output.hidden = false;
  els.output.innerHTML =
    '<div class="thinking"><i></i><i></i><i></i><em>正在写档案，请稍等…</em></div>';
  els.copy.disabled = true;
  els.download.disabled = true;
  els.stop.hidden = false;
  els.sourceChip.hidden = true;
  setCardState('live');
  setStatus('连接中…');

  state.ticker = window.setInterval(refreshStatus, 200);

  try {
    const body = await postChat(artist, { signal: state.controller.signal });
    await consumeStream(body, handleEvent);

    const missing = parseNotFound(state.raw);
    if (missing) {
      state.notFound = true;
      showNotFound(missing);
      finish('未收录');
    } else {
      finish('完成');
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      finish('已停止');
    } else {
      els.sourceChip.hidden = true;
      finish('出错');
      showError(err?.message || '网络异常，请稍后重试');
    }
  } finally {
    window.clearInterval(state.ticker);
    state.ticker = null;
    state.busy = false;
    state.controller = null;
    els.stop.hidden = true;
    els.copy.disabled = state.notFound || !state.raw;
    els.download.disabled = state.notFound || !state.raw;
  }
}

function handleEvent(event) {
  if (!event || typeof event !== 'object') return;

  if (event.type === 'meta') {
    // 来源徽标不在界面展示，meta 只用于后续状态判断
    els.sourceChip.hidden = true;
    return;
  }

  if (event.type === 'context') return;

  if (event.type === 'delta' && typeof event.text === 'string') {
    if (!state.raw) els.output.innerHTML = '';
    state.raw += event.text;
    scheduleRender();
    return;
  }

  if (event.type === 'error') {
    throw new Error(event.message || '生成失败，请重试');
  }
}

function scheduleRender() {
  if (state.frame) return;
  state.frame = window.requestAnimationFrame(() => {
    state.frame = 0;
    paint();
  });
}

function paint() {
  const caret = state.busy ? '<span class="caret" aria-hidden="true"></span>' : '';
  els.output.innerHTML =
    renderMarkdown(state.raw, { songLinks, members: memberNames, artist }) + caret;
  if (state.busy && state.stick) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
  }
}

function setCardState(mode) {
  els.card.classList.remove('is-live', 'is-done', 'is-error');
  if (mode) els.card.classList.add(`is-${mode}`);
}

function setStatus(text) {
  els.status.textContent = text;
}

function refreshStatus() {
  if (!state.busy) return;
  const seconds = ((performance.now() - state.startedAt) / 1000).toFixed(1);
  const chars = countChars(state.raw);
  setStatus(chars ? `生成中 · ${chars} 字 · ${seconds}s` : `思考中 · ${seconds}s`);
}

function countChars(text) {
  return String(text || '').replace(/\s/g, '').length;
}

function finish(label) {
  state.busy = false;

  const seconds = ((performance.now() - state.startedAt) / 1000).toFixed(1);
  const chars = countChars(state.raw);

  if (state.notFound) {
    els.output.hidden = true;
    els.output.innerHTML = '';
  } else if (state.raw) {
    paint();
  } else {
    els.output.innerHTML = '';
  }

  setStatus(state.notFound ? '未收录' : chars ? `${label} · ${chars} 字 · ${seconds}s` : label);
  setCardState(state.notFound ? 'done' : label === '出错' ? 'error' : 'done');
  els.copy.disabled = state.notFound || !state.raw;
  els.download.disabled = state.notFound || !state.raw;
}

/** 资料判定「不是真实存在的歌手」时，渲染一个信息页，而不是空白/假档案。 */
function parseNotFound(raw) {
  const text = String(raw || '').trim();
  if (!text.startsWith('## 未收录')) return null;

  const body = text.replace(/^## 未收录\s*/, '').trim();
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  const messageLine = lines.find((line) => line.startsWith('说明')) || lines[0] || '';
  const similarLine = lines.find((line) => line.includes('相近')) || '';
  const similar = [...similarLine.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  return {
    message: messageLine.replace(/^说明[:：]\s*/, '') || '目前无法确认这是真实存在的歌手/团体。',
    similar,
  };
}

function showNotFound({ message, similar }) {
  els.notFound.hidden = false;
  els.notFoundMessage.textContent = message;
  els.notFoundSimilar.replaceChildren();

  // 偶尔会把「男团 / 组合」这类通用词也标成相近艺人，过滤掉
  const blocked = /^(男团|女团|组合|团体|歌手|艺人|偶像|solo|unknown)$/i;
  similar
    .filter((name) => name && !blocked.test(name))
    .slice(0, 2)
    .forEach((name) => {
      const link = document.createElement('a');
      link.className = 'not-found__chip';
      link.href = `/artist/${encodeURIComponent(name)}`;
      link.textContent = name;
      els.notFoundSimilar.append(link);
    });
}

function showError(message) {
  els.errorText.textContent = message;
  els.errorBox.hidden = false;
}

function hideError() {
  els.errorBox.hidden = true;
  els.errorText.textContent = '';
}

async function copyAll() {
  if (!state.raw) return;
  const label = els.copy.textContent;
  try {
    await navigator.clipboard.writeText(state.raw);
  } catch {
    const area = document.createElement('textarea');
    area.value = state.raw;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  }
  els.copy.textContent = '已复制';
  window.setTimeout(() => {
    els.copy.textContent = label;
  }, 1400);
}

function downloadAll() {
  if (!state.raw) return;
  const safe = artist.replace(/[\\/:*?"<>|\s]+/g, '_') || 'kpop';
  const blob = new Blob([state.raw], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safe}-入坑档案.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
