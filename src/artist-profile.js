/**
 * 档案页的「资料」聚合层。
 *
 * 优先级：内置歌手库（百度百科 + 网易云音乐抓取结果）→ 实时查询百科/网易云。
 * 输出统一带 source 字段，页面据此显示来源标注。
 */
import { fetchBaikeProfile } from './baike.js';
import { config } from './config.js';
import { fetchArtistProfile } from './netease.js';
import { formatSourceLine, getLibraryProfile } from './profile.js';

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function buildLiveFromBaike(baike) {
  if (!baike) return null;
  const facts = [];
  const push = (label, value, source) => {
    const text = String(value || '').trim();
    if (text) facts.push({ label, value: text, source });
  };
  push('出道时间', baike.fields['出道'], 'baike');
  push('所属公司', baike.fields['经纪公司'], 'baike');
  if (baike.fields['成员']) push('成员', baike.fields['成员'], 'baike');
  if (baike.fields['所属组合']) push('所属组合', baike.fields['所属组合'], 'baike');
  push('代表作品', baike.fields['代表作品'], 'baike');

  return {
    name: baike.title,
    nameZh: baike.fields['中文名'] || '',
    type: baike.fields['成员'] ? 'group' : 'solo',
    debut: baike.fields['出道'] || '',
    agency: baike.fields['经纪公司'] || '',
    group: baike.fields['所属组合'] || '',
    members: baike.members,
    works: baike.fields['代表作品'] || '',
    awards: baike.awards,
    songs: [],
    bio: baike.abstract || baike.desc,
    baikeTitle: baike.title,
    baikeUrl: baike.url,
    baikeImage: baike.image,
    cover: '',
    coverSource: '',
    sources: ['baike'],
    facts,
    hasData: facts.length > 0,
  };
}

function profileToPayload(profile) {
  const sources = uniq([
    ...(profile.sources || []),
    ...(profile.facts || []).map((fact) => fact.source),
    ...(profile.songs?.length ? ['netease'] : []),
    ...(profile.awards?.length ? ['baike'] : []),
    'bilibili',
  ]);

  const stage = profile.bvid
    ? {
        title: `${profile.name} 代表舞台`,
        url: `https://www.bilibili.com/video/${profile.bvid}`,
        bvid: profile.bvid,
        source: 'bilibili',
      }
    : null;

  return {
    name: profile.name,
    nameZh: profile.nameZh || '',
    type: profile.type || 'group',
    debut: profile.debut || '',
    agency: profile.agency || '',
    members: profile.members || [],
    works: profile.works || '',
    bio: profile.bio || '',
    awards: profile.awards || [],
    songs: profile.songs || [],
    facts: profile.facts || [],
    stage,
    cover: profile.cover || '',
    coverSource: profile.coverSource || '',
    baikeUrl: profile.baikeUrl || '',
    sources,
    sourceLine: formatSourceLine(sources),
  };
}

/**
 * @param {string} rawName
 * @returns {Promise<ReturnType<typeof profileToPayload>>}
 */
export async function resolveArtistProfile(rawName) {
  const library = getLibraryProfile(rawName);
  if (library?.hasData) return profileToPayload(library);

  // 不在库里或资料为空：实时查百科 + 网易云，任一成功即可
  if (!config.profileLookup && !config.baikeLookup) {
    return profileToPayload(library || { name: String(rawName || '').trim(), facts: [], sources: [] });
  }

  const [baikeResult, neteaseResult] = await Promise.allSettled([
    config.baikeLookup ? fetchBaikeProfile(rawName) : Promise.resolve(null),
    config.profileLookup ? fetchArtistProfile(rawName) : Promise.resolve(null),
  ]);
  const baike = baikeResult.status === 'fulfilled' ? baikeResult.value : null;
  const netease = neteaseResult.status === 'fulfilled' ? neteaseResult.value : null;

  const live = buildLiveFromBaike(baike);
  const base = live || {
    ...(library || {}),
    name: library?.name || baike?.title || String(rawName || '').trim(),
    facts: library?.facts || [],
    sources: library?.sources || [],
    hasData: library?.hasData || false,
  };

  if (netease) {
    if (!base.cover) {
      base.cover = netease.picUrl || '';
      base.coverSource = netease.picUrl ? 'netease' : '';
    }
    if (!base.songs?.length) base.songs = netease.songs || [];
    if (!base.works && netease.songs?.length) {
      base.works = netease.songs.slice(0, 5).join('、');
      base.facts = [...(base.facts || []), { label: '代表作品', value: base.works, source: 'netease' }];
    }
    base.sources = uniq([...(base.sources || []), 'netease']);
  }

  if (baike) {
    if (!base.bio) base.bio = baike.abstract || baike.desc;
    if (!base.cover) {
      base.cover = baike.image || '';
      base.coverSource = baike.image ? 'baike' : '';
    }
    base.baikeUrl = base.baikeUrl || baike.url;
    base.sources = uniq([...(base.sources || []), 'baike']);
  }

  return profileToPayload(base);
}
