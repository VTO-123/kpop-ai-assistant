/** 最近搜索记录（localStorage，最多 6 条），首页与详情页共用。 */

const RECENT_KEY = 'kpop-assistant.recent.v1';
const MAX_RECENT = 6;

export function readRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecent(name) {
  const list = readRecent().filter((item) => item.toLowerCase() !== name.toLowerCase());
  list.unshift(name);
  const next = list.slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式下忽略 */
  }
  return next;
}

/** 清空最近查询；隐私模式下静默失败。 */
export function clearRecent() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
}

/**
 * 把最近记录渲染成 chips。
 * @param {{ wrap: HTMLElement, list: HTMLElement }} els
 * @param {(name: string) => void} onPick
 */
export function renderRecent(els, onPick) {
  const recent = readRecent();
  els.list.innerHTML = '';
  els.wrap.hidden = recent.length === 0;

  const clear = els.clear || null;
  if (clear) clear.hidden = recent.length === 0;

  for (const name of recent) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = name;
    chip.title = name;
    chip.addEventListener('click', () => onPick(name));
    els.list.appendChild(chip);
  }
}
