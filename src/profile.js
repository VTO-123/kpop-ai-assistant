/**
 * 资料档案：把歌手库里的结构化资料（百度百科 + 网易云音乐）整理成
 * 「字段 + 来源」的形式，供档案页渲染。
 *
 * 原则：只展示真实抓到的字段；抓不到就留空，页面统一显示「暂未收录」。
 */
import { findGroup, normalizeName } from './groups.js';

/** 来源标识 → 页面上显示的名字。 */
export const SOURCE_LABELS = {
  baike: '百度百科',
  netease: '网易云音乐',
  qqmusic: 'QQ音乐',
  bilibili: 'B站',
};

/** 固定的展示顺序，保证来源行稳定。 */
const SOURCE_ORDER = ['baike', 'netease', 'qqmusic', 'bilibili'];

export function sourceLabel(key) {
  return SOURCE_LABELS[key] || '';
}

/** 把来源集合整理成「百度百科 · 网易云音乐 · B站」这种文案。 */
export function formatSourceLine(sources) {
  const list = [...new Set((sources || []).filter((key) => SOURCE_LABELS[key]))].sort(
    (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
  );
  // 至少显示一个来源：歌曲跳转本身指向 B 站
  if (!list.length) list.push('bilibili');
  return `资料参考：${list.map(sourceLabel).join(' · ')}`;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

/**
 * 读内置歌手库，整理成统一的资料对象；库里没有返回 null。
 * @param {string} rawName
 */
export function getLibraryProfile(rawName) {
  const group = findGroup(rawName);
  if (!group) return null;

  const members = asArray(group.members);
  const sources = [];
  if (group.baikeUrl || group.debut || group.agency || group.awards?.length) sources.push('baike');
  if (group.cover || group.songs?.length) sources.push('netease');
  // 档案里的「热门歌曲」都跳 B 站，来源标注里固定带上
  sources.push('bilibili');

  const facts = [];
  const push = (label, value, source) => {
    const text = String(value || '').trim();
    if (text) facts.push({ label, value: text, source });
  };

  push('出道时间', group.debut, 'baike');
  push('所属公司', group.agency, 'baike');
  if (group.type === 'group' && members.length) {
    push('成员', members.join('、'), 'baike');
  }
  if (group.fandom) push('粉丝名', group.fandom, 'baike');
  if (group.type === 'solo' && group.group) {
    push('所属组合', group.group, 'baike');
  }
  push('代表作品', group.works, group.baikeUrl ? 'baike' : 'netease');

  return {
    name: group.name,
    nameZh: group.nameZh || '',
    type: group.type || 'group',
    key: group.key,
    aliases: group.aliases || [],
    debut: group.debut || '',
    debutYear: Number(group.debutYear) || 0,
    agency: group.agency || '',
    group: group.group || '',
    fandom: group.fandom || '',
    members,
    works: group.works || '',
    awards: asArray(group.awards),
    songs: asArray(group.songs),
    bio: group.bio || '',
    baikeTitle: group.baikeTitle || '',
    baikeUrl: group.baikeUrl || '',
    baikeImage: group.baikeImage || '',
    cover: group.cover || '',
    coverSource: group.coverSource || '',
    coverCredit: group.coverCredit || '',
    bvid: group.bvid || '',
    sources,
    facts,
    hasData: facts.length > 0 || asArray(group.songs).length > 0 || asArray(group.awards).length > 0,
  };
}

/** 一句话定性：优先用百科的词条定性，其次用简介首句，都没有就留空。 */
function oneLiner(profile) {
  if (profile.bio) {
    const first = profile.bio.split(/[。；]/)[0].trim();
    if (first) return `${first}。`;
  }
  return '';
}

/**
 * 用真实资料拼出档案正文（Markdown，与页面渲染契约一致）。
 * 只写抓到的内容，缺的章节明确写「暂未收录」。
 * @param {ReturnType<typeof getLibraryProfile>} profile
 */
export function buildProfileArchive(profile) {
  if (!profile) return '';

  const lines = [];
  const one = oneLiner(profile);
  lines.push('## 一句话');
  lines.push(one || '暂未收录');
  lines.push('');

  lines.push(profile.type === 'solo' ? '## 个人档案' : '## 团体档案');
  if (profile.debut) lines.push(`- 出道时间：${profile.debut}`);
  if (profile.agency) lines.push(`- 所属公司：${profile.agency}`);
  if (profile.type === 'solo' && profile.group) lines.push(`- 所属组合：${profile.group}`);
  if (profile.type === 'group' && profile.members.length) {
    lines.push(`- 成员名单：${profile.members.join('、')}`);
  }
  if (profile.fandom) lines.push(`- 粉丝名：${profile.fandom}`);
  if (profile.works) lines.push(`- 代表作品：${profile.works}`);
  if (!profile.debut && !profile.agency && !profile.members.length && !profile.works) {
    lines.push('- 暂未收录');
  }
  lines.push('');

  lines.push('## 热门歌曲');
  if (profile.songs.length) {
    profile.songs.slice(0, 6).forEach((song, index) => {
      lines.push(`${index + 1}. **${song}**`);
    });
  } else {
    lines.push('暂未收录');
  }
  lines.push('');

  lines.push('## 入坑观看');
  lines.push('暂未收录');
  lines.push('');

  lines.push('## 冷知识');
  lines.push('暂未收录');

  return lines.join('\n');
}

/** 判断一个名字是否已经在歌手库里（含别名、中文名）。 */
export function isKnownArtist(rawName) {
  return Boolean(findGroup(rawName));
}

export { normalizeName };
