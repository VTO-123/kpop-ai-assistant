/**
 * 歌曲页：点「播放 MV」后在页内嵌 B 站播放器。
 * 只有 bvid 合法时才挂载；没有 bvid 时保留「去 B 站看视频」入口。
 */
const BVID_PATTERN = /^BV[0-9A-Za-z]{6,}$/;

const bvid = String(document.body.dataset.bvid || '').trim();
const playBtn = document.getElementById('playBtn');
const player = document.getElementById('songPlayer');
const frame = document.getElementById('playerFrame');
const hint = document.getElementById('playerHint');

function embedPlayer() {
  if (!BVID_PATTERN.test(bvid) || !frame) return;

  const iframe = document.createElement('iframe');
  iframe.src =
    'https://player.bilibili.com/player.html?bvid=' +
    encodeURIComponent(bvid) +
    '&autoplay=1&high_quality=1&danmaku=0';
  iframe.title = 'B 站播放器';
  iframe.loading = 'lazy';
  iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('referrerpolicy', 'no-referrer');

  frame.replaceChildren(iframe);
  if (player) {
    player.hidden = false;
    player.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (playBtn) {
    playBtn.textContent = '重新载入播放器';
    playBtn.dataset.loaded = '1';
  }
}

if (!BVID_PATTERN.test(bvid)) {
  playBtn?.remove();
  if (hint) hint.hidden = false;
} else {
  playBtn?.addEventListener('click', embedPlayer);
}
