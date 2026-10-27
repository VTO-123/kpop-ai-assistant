/* ===== K-POP 档案室 · 移动端 App 逻辑 =====
   多视图（hash 路由）+ 底部导航 + AI 流式档案。
   账号体系：登录后收藏 / 最近看过 / 搜索历史云端同步，每用户独立。
   复用后端 /api/* 与 js/stream.js、js/md.js。 */
import { postChat, consumeStream } from './js/stream.js';
import { renderMarkdown, escapeHtml } from './js/md.js';

/* ---------- 工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const TOKEN_KEY = 'kpopfan:token';
const USER_KEY = 'kpopfan:user';

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 1800);
}

const proxy = (url) => (url ? `/api/img?u=${encodeURIComponent(url)}` : '');

/* ---------- 会话 ---------- */
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function getMe() {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    return raw && raw.username ? raw : null;
  } catch { return null; }
}
function setSession(token, username) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify({ username }));
}
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** 统一 API 请求：自动带 Bearer token；401 自动清会话。 */
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearSession();
    throw Object.assign(new Error(data.error || '登录已失效，请重新登录'), { status: 401 });
  }
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

/* ---------- 云端收藏 / 最近 / 搜索 ---------- */
let cloudFavs = new Set();
async function loadCloudFavs() {
  cloudFavs = new Set();
  if (!getMe()) return;
  try {
    const d = await api('/api/me/favorites');
    cloudFavs = new Set((d.favorites || []).map((f) => f.name));
  } catch { /* 会话失效已清除 */ }
}
function isFav(name) { return cloudFavs.has(name); }

async function toggleFav(artist) {
  if (!getMe()) {
    toast('登录后才能收藏');
    location.hash = '#/mine';
    return false;
  }
  const remove = isFav(artist.name);
  try {
    const url = remove
      ? `/api/me/favorites?name=${encodeURIComponent(artist.name)}`
      : '/api/me/favorites';
    const d = await api(url, {
      method: remove ? 'DELETE' : 'POST',
      body: remove ? undefined : { name: artist.name, nameZh: artist.nameZh || '', cover: artist.cover || '' },
    });
    cloudFavs = new Set((d.favorites || []).map((f) => f.name));
    toast(remove ? `已取消收藏 ${artist.name}` : `已收藏 ${artist.name}`);
    return isFav(artist.name);
  } catch (err) {
    toast(err.message || '操作失败');
    return isFav(artist.name);
  }
}

async function trackRecent(name) {
  if (!getMe()) return;
  try { await api('/api/me/recent', { method: 'POST', body: { name } }); } catch { /* 静默 */ }
}
async function trackSearch(keyword) {
  if (!getMe()) return;
  try { await api('/api/me/searches', { method: 'POST', body: { keyword } }); } catch { /* 静默 */ }
}

/* ---------- 加载配置（LIVE/DEMO 徽章） ---------- */
async function loadConfig() {
  const badge = $('#modeBadge');
  const text = $('#modeText');
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error();
    const data = await res.json();
    badge.hidden = false;
    badge.dataset.mode = data.demo ? 'demo' : 'live';
    text.textContent = data.demo ? '演示模式' : 'LIVE';
  } catch {
    badge.hidden = true;
  }
}

/* ================= 视图：首页 / 发现 ================= */
async function renderHome() {
  let artists = [];
  try {
    const res = await fetch('/api/artists');
    if (res.ok) artists = (await res.json()).artists || [];
  } catch { /* 静默 */ }

  const picks = artists.slice(0, 10);
  const rest = artists.slice(10);

  view.innerHTML = `
    <div class="section">
      <h1 class="section__title">今天想翻谁的牌子？<small>搜索或点击团体</small></h1>
    </div>
    <div class="search-box">
      <div class="search-field">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16 16l4 4"/></svg>
        <input id="q" type="text" maxlength="40" placeholder="例如 BLACKPINK、NewJeans…" autocomplete="off" enterkeyhint="search" />
      </div>
      <button class="search-btn" id="go" type="button">搜索</button>
    </div>
    <div class="suggest" id="suggest" hidden></div>

    <div class="section">
      <h2 class="section__title">本命推荐</h2>
      <div class="artist-grid" id="pickGrid"></div>
    </div>

    ${rest.length ? `
    <div class="section">
      <h2 class="section__title">更多团体</h2>
      <div class="chip-list" id="moreChips"></div>
    </div>` : ''}
  `;

  // 搜索
  const input = $('#q');
  const suggest = $('#suggest');
  const goBtn = $('#go');

  const doSearch = () => {
    const name = input.value.trim().slice(0, 40);
    if (!name) { input.focus(); return; }
    trackSearch(name);
    location.hash = `#/artist/${encodeURIComponent(name)}`;
  };
  goBtn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  // 联想
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '');
  input.addEventListener('input', () => {
    const q = norm(input.value);
    if (!q) { suggest.hidden = true; return; }
    const hit = artists
      .filter((a) => [a.name, a.nameZh, ...(a.aliases || [])].map(norm).some((f) => f.startsWith(q) || f.includes(q)))
      .slice(0, 6);
    if (!hit.length) { suggest.hidden = true; return; }
    suggest.innerHTML = hit.map((a) => `
      <button class="suggest-item" type="button" data-name="${escapeHtml(a.name)}">
        <span class="suggest-item__zh">${escapeHtml(a.name)}</span>
        <span class="suggest-item__tag">${a.type === 'solo' ? '个人' : '团体'}</span>
      </button>`).join('');
    suggest.hidden = false;
  });
  suggest.addEventListener('click', (e) => {
    const item = e.target.closest('.suggest-item');
    if (!item) return;
    input.value = item.dataset.name;
    suggest.hidden = true;
    doSearch();
  });

  // 推荐卡片（懒加载封面）
  const grid = $('#pickGrid');
  grid.innerHTML = picks.map((a) => cardHtml(a)).join('');
  grid.querySelectorAll('.artist-card__cover img').forEach((img) => {
    img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    loadCover(img);
  });

  // 更多 chips
  const chips = $('#moreChips');
  if (chips) {
    chips.innerHTML = rest.map((a) => `<button class="chip" data-name="${escapeHtml(a.name)}">${escapeHtml(a.name)}</button>`).join('');
    chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) { trackRecent(chip.dataset.name); location.hash = `#/artist/${encodeURIComponent(chip.dataset.name)}`; }
    });
  }
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.artist-card');
    if (card) { trackRecent(card.dataset.name); location.hash = `#/artist/${encodeURIComponent(card.dataset.name)}`; }
  });
}

function cardHtml(a) {
  return `
    <button class="artist-card" type="button" data-name="${escapeHtml(a.name)}">
      <div class="artist-card__cover">
        <img alt="" loading="lazy" referrerpolicy="no-referrer" />
        <span class="artist-card__type">${a.type === 'solo' ? '个人' : '团体'}</span>
      </div>
      <div class="artist-card__body">
        <div class="artist-card__name">${escapeHtml(a.name)}</div>
        <div class="artist-card__zh">${escapeHtml(a.nameZh && a.nameZh !== a.name ? a.nameZh : '')}</div>
      </div>
    </button>`;
}

async function loadCover(img) {
  const name = img.closest('.artist-card').dataset.name;
  try {
    const res = await fetch(`/api/cover?name=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data && data.url) img.src = proxy(data.url);
  } catch {
    img.style.display = 'none';
  }
}

/* ================= 视图：热门 ================= */
async function renderHot() {
  let songs = [];
  try {
    const res = await fetch('/api/songs');
    if (res.ok) songs = (await res.json()).items || [];
  } catch { /* 静默 */ }

  if (!songs.length) {
    view.innerHTML = `<div class="error-box">热门加载失败，下拉刷新试试</div>`;
    return;
  }

  view.innerHTML = `
    <div class="section">
      <h1 class="section__title">热门 MV</h1>
      <p style="color:var(--text-dim);font-size:13px;margin:-8px 0 4px;">点击歌曲跳转 B 站看视频</p>
    </div>
    <div class="song-list" id="songList"></div>
  `;
  const list = $('#songList');
  list.innerHTML = songs.map((s) => `
    <a class="song-row" href="/song/${encodeURIComponent(s.id)}">
      <span class="song-row__cover"><img src="${escapeHtml(s.src)}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>
      <span class="song-row__info">
        <span class="song-row__title">${escapeHtml(s.title)}</span>
        <span class="song-row__artist">${escapeHtml(s.subtitle || s.artist || '')}</span>
      </span>
      <span class="song-row__arrow">›</span>
    </a>`).join('');
}

/* ================= 视图：我的 ================= */
function authFormHtml() {
  return `
    <div class="section">
      <h1 class="section__title">登录后云端同步<small>收藏 / 最近看过 / 搜索历史只属于你</small></h1>
    </div>
    <div class="auth-card">
      <div class="auth-tabs">
        <button class="auth-tab is-active" data-mode="login" type="button">登录</button>
        <button class="auth-tab" data-mode="register" type="button">注册</button>
      </div>
      <div class="auth-body">
        <input id="authUser" type="text" maxlength="20" placeholder="用户名（2-20 位，字母/数字/中文）" autocomplete="username" />
        <input id="authPass" type="password" maxlength="64" placeholder="密码（至少 6 位）" autocomplete="current-password" />
        <button class="btn-primary" id="authSubmit" type="button">登录</button>
        <p class="auth-tip" id="authTip" hidden></p>
      </div>
    </div>
  `;
}

async function renderMine() {
  const me = getMe();
  if (!me) {
    view.innerHTML = authFormHtml();
    let mode = 'login';
    const userInput = $('#authUser');
    const passInput = $('#authPass');
    const submitBtn = $('#authSubmit');
    const tip = $('#authTip');

    const setMode = (m) => {
      mode = m;
      document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.mode === m));
      submitBtn.textContent = m === 'login' ? '登录' : '注册';
      passInput.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    };
    document.querySelectorAll('.auth-tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

    submitBtn.addEventListener('click', async () => {
      const username = userInput.value.trim();
      const password = passInput.value;
      tip.hidden = true;
      if (!username || !password) {
        tip.textContent = '请填写用户名和密码';
        tip.hidden = false;
        return;
      }
      submitBtn.disabled = true;
      try {
        const res = await fetch(`/api/${mode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '操作失败');
        setSession(data.token, data.username);
        toast(`欢迎回来，${data.username}`);
        await renderMine();
      } catch (err) {
        tip.textContent = err.message || '操作失败';
        tip.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    });
    return;
  }

  let data = { favorites: [], recent: [], searches: [] };
  try {
    data = await api('/api/me');
  } catch {
    if (!getMe()) return renderMine();
  }

  const favList = data.favorites || [];
  const recent = data.recent || [];
  const searches = data.searches || [];

  view.innerHTML = `
    <div class="section">
      <div class="mine-head">
        <div class="mine-user">
          <span class="mine-avatar">${escapeHtml(String(me.username).slice(0, 1).toUpperCase())}</span>
          <div>
            <div class="mine-name">${escapeHtml(me.username)}</div>
            <div class="mine-sub">已登录 · 数据云端同步</div>
          </div>
        </div>
        <button class="btn-ghost" id="logoutBtn" type="button">退出登录</button>
      </div>
    </div>

    <div class="section">
      <h2 class="section__title">我的收藏</h2>
      ${favList.length
        ? `<div class="artist-grid">${favList.map((f) => favCard(f)).join('')}</div>`
        : `<div class="empty">
             <svg viewBox="0 0 24 24"><path d="M12 21s-7-4.3-9.5-8.2C.5 9.8 2 6 5.5 6c2 0 3.4 1 4.5 2.4C11 7 12.5 6 14.5 6 18 6 19.5 9.8 17.5 12.8 15 16.7 12 21 12 21z"/></svg>
             <p>还没有收藏，去「发现」点几个喜欢的团体吧</p>
           </div>`}
    </div>

    <div class="section">
      <h2 class="section__title">最近看过</h2>
      ${recent.length
        ? `<div class="chip-list">${recent.map((n) => `<button class="chip" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}</div>`
        : `<p style="color:var(--text-faint);font-size:13px;">暂无浏览记录</p>`}
    </div>

    <div class="section">
      <h2 class="section__title">搜索历史${searches.length ? ` <button class="link-btn" id="clearSearches" type="button">清空</button>` : ''}</h2>
      ${searches.length
        ? `<div class="chip-list">${searches.map((s) => `<button class="chip" data-name="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`
        : `<p style="color:var(--text-faint);font-size:13px;">暂无搜索记录</p>`}
    </div>
  `;

  $('#logoutBtn').addEventListener('click', () => {
    clearSession();
    toast('已退出登录');
    renderMine();
  });
  $('#clearSearches')?.addEventListener('click', async () => {
    try { await api('/api/me/searches', { method: 'DELETE' }); renderMine(); } catch { /* 静默 */ }
  });
  view.querySelectorAll('.chip[data-name]').forEach((chip) => {
    chip.addEventListener('click', () => { trackRecent(chip.dataset.name); location.hash = `#/artist/${encodeURIComponent(chip.dataset.name)}`; });
  });
  view.querySelectorAll('.artist-card[data-name]').forEach((card) => {
    card.addEventListener('click', () => { location.hash = `#/artist/${encodeURIComponent(card.dataset.name)}`; });
  });
}

function favCard(f) {
  return `
    <button class="artist-card" type="button" data-name="${escapeHtml(f.name)}">
      <div class="artist-card__cover">
        ${f.cover ? `<img src="${escapeHtml(proxy(f.cover))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'" />` : ''}
        <span class="artist-card__type">收藏</span>
      </div>
      <div class="artist-card__body">
        <div class="artist-card__name">${escapeHtml(f.name)}</div>
        <div class="artist-card__zh">${escapeHtml(f.nameZh || '')}</div>
      </div>
    </button>`;
}

/* ================= 视图：歌手详情 ================= */
const normKey = (s) => String(s || '').toLowerCase().replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '');

async function loadMemberLinks() {
  try {
    const res = await fetch('/api/members');
    if (res.ok) return new Set((await res.json()).members.map((m) => normKey(m.name)));
  } catch { /* 静默 */ }
  return new Set();
}

async function loadSongLinks() {
  try {
    const res = await fetch('/api/song-links');
    if (res.ok) return (await res.json()).links || {};
  } catch { /* 静默 */ }
  return {};
}

async function renderArtist(name) {
  trackRecent(name);
  view.innerHTML = `<div class="spinner"></div>`;
  const [profile, members, songLinks] = await Promise.all([
    fetch(`/api/artist-profile?name=${encodeURIComponent(name)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    loadMemberLinks(),
    loadSongLinks(),
  ]);
  await loadCloudFavs();

  const cover = await resolveCover(name, profile);
  const facts = (profile && Array.isArray(profile.facts)) ? profile.facts : [];
  const awards = (profile && Array.isArray(profile.awards)) ? profile.awards : [];
  const songs = (profile && Array.isArray(profile.songs)) ? profile.songs : [];

  view.innerHTML = `
    <div class="detail">
      <div class="detail__hero">
        ${cover ? `<img class="detail__cover" src="${escapeHtml(proxy(cover))}" alt="" referrerpolicy="no-referrer" />` : ''}
        <div class="detail__shade"></div>
      </div>
      <div class="detail__head">
        <div class="detail__name">${escapeHtml(name)}</div>
        <div class="detail__sub">
          ${profile ? escapeHtml(profile.type === 'solo' ? '个人歌手' : '团体') : ''}
          ${awards.length ? `<span>· ${awards.length} 项荣誉</span>` : ''}
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button class="btn-ghost" id="favBtn" type="button">${isFav(name) ? '♥ 已收藏' : '♡ 收藏'}</button>
          <button class="btn-ghost" id="regenBtn" type="button">↻ 重新生成</button>
        </div>
      </div>

      ${facts.length ? `
      <div class="detail__body">
        <div class="detail__facts">
          ${facts.map((f) => `
            <div class="fact-row">
              <span class="fact-row__label">${escapeHtml(f.label)}</span>
              <span class="fact-row__value">${escapeHtml(f.value)}${f.source ? ` <span class="fact-row__src">· ${escapeHtml(f.source)}</span>` : ''}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="detail__body detail__ai">
        <div class="detail__ai" id="aiBox">
          <div class="spinner"></div>
        </div>
        <div class="source-line" id="sourceLine" hidden></div>
      </div>
    </div>
  `;

  $('#favBtn').addEventListener('click', async (e) => {
    const on = await toggleFav({ name, nameZh: profile?.nameZh || '' });
    e.currentTarget.textContent = on ? '♥ 已收藏' : '♡ 收藏';
    e.currentTarget.classList.toggle('is-on', on);
  });

  let latestProfile = profile;
  const run = async () => {
    const box = $('#aiBox');
    const sourceLine = $('#sourceLine');
    box.innerHTML = `<div class="spinner"></div>`;
    sourceLine.hidden = true;

    let text = '';
    let sources = [];
    try {
      const body = await postChat(name);
      await consumeStream(body, (ev) => {
        if (ev.type === 'meta') {
          sources = Array.isArray(ev.sources) ? ev.sources : [];
        } else if (ev.type === 'delta') {
          text += ev.text || '';
          box.innerHTML = renderMarkdown(text, {
            songLinks,
            members,
            artist: name,
            linkPrefix: '#/artist/',
          }) + `<span class="cursor"></span>`;
        } else if (ev.type === 'done') {
          if (text) box.innerHTML = renderMarkdown(text, { songLinks, members, artist: name, linkPrefix: '#/artist/' });
        } else if (ev.type === 'error') {
          box.innerHTML = `<div class="error-box">${escapeHtml(ev.message || '生成失败')}</div>`;
        }
      });
      if (sources.length) {
        sourceLine.textContent = `资料参考：${sources.join(' · ')}`;
        sourceLine.hidden = false;
      }
    } catch (err) {
      box.innerHTML = `<div class="error-box">${escapeHtml(err.message || '加载失败')}<br><button class="btn-ghost retry-btn" id="retry">重试</button></div>`;
      $('#retry')?.addEventListener('click', run);
    }
  };
  $('#regenBtn').addEventListener('click', run);
  run();
}

async function resolveCover(name, profile) {
  // 优先内置/百科首图，其次 cover 接口兜底
  if (profile && profile.imageUrl) return profile.imageUrl;
  try {
    const res = await fetch(`/api/cover?name=${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.url) return data.url;
    }
  } catch { /* 静默 */ }
  return '';
}

/* ================= 路由 ================= */
const routes = {
  home: renderHome,
  hot: renderHot,
  mine: renderMine,
};

async function navigate() {
  const hash = location.hash || '#/home';
  const match = /^#\/artist\/(.+)$/.exec(hash);
  if (match) {
    setActiveTab('');
    view.scrollTop = 0;
    await renderArtist(decodeURIComponent(match[1]));
    return;
  }
  const tab = hash.replace(/^#\//, '').split('/')[0];
  const name = routes[tab] ? tab : 'home';
  setActiveTab(name);
  view.scrollTop = 0;
  await routes[name]();
}

function setActiveTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.view === name);
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (location.hash !== `#/${tab.dataset.view}`) {
      location.hash = `#/${tab.dataset.view}`;
    } else {
      navigate();
    }
  });
});
window.addEventListener('hashchange', navigate);
window.addEventListener('pageshow', navigate);

loadConfig();
navigate();
