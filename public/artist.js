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
  footerMeta: document.getElementById('footerMeta'),
  archiveNote: document.getElementById('archiveNote'),
};

const state = {
  raw: '',
  busy: false,
  controller: null,
  startedAt: 0,
  ticker: null,
  frame: 0,
  stick: true,
};

let songLinks = {};
let memberNames = new Set();

init();

function init() {
  pushRecent(artist);
  guardCover();
  hydrateCover();
  loadSongLinks();
  loadMembers();

  els.stop.addEventListener('click', () => state.controller?.abort());
  els.copy.addEventListener('click', copyAll);
  els.download.addEventListener('click', downloadAll);
  els.retry.addEventListener('click', () => {
    hideError();
    start();
  });

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
    applyCover(data.url);
  } catch {
    /* 拿不到封面就继续用占位，不影响正文 */
  }
}

function applyCover(url) {
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
  if (credit) credit.textContent = '封面：网易云音乐 · 自动匹配';
}


/* ---------------- 档案正文（流式） ---------------- */

async function start() {
  if (state.busy || !artist) return;

  state.busy = true;
  state.raw = '';
  state.stick = true;
  state.startedAt = performance.now();
  state.controller = new AbortController();

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
    finish('完成');
  } catch (err) {
    if (err?.name === 'AbortError') {
      finish('已停止');
    } else {
      els.sourceChip.hidden = true;
      if (els.archiveNote) els.archiveNote.hidden = true;
      finish('出错');
      showError(err?.message || '网络异常，请稍后重试');
    }
  } finally {
    window.clearInterval(state.ticker);
    state.ticker = null;
    state.busy = false;
    state.controller = null;
    els.stop.hidden = true;
    els.copy.disabled = !state.raw;
    els.download.disabled = !state.raw;
  }
}

function handleEvent(event) {
  if (!event || typeof event !== 'object') return;

  if (event.type === 'meta') {
    const builtin = event.source === 'builtin';
    els.sourceChip.hidden = false;
    els.sourceChip.dataset.source = builtin ? 'builtin' : 'ai';
    els.sourceChip.textContent = builtin ? '内置档案' : 'AI 检索生成';
    if (els.archiveNote) els.archiveNote.hidden = builtin;
    if (event.model) els.footerMeta.textContent = `模型 ${event.model}`;
    return;
  }

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

  if (state.raw) {
    paint();
  } else {
    els.output.innerHTML = '';
  }

  setStatus(chars ? `${label} · ${chars} 字 · ${seconds}s` : label);
  setCardState(label === '出错' ? 'error' : 'done');
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
