/**
 * 歌手库资料补全脚本（一次性 / 可重复执行）。
 *
 * 数据全部来自实时接口，不手写任何艺人资料：
 *   - 百度百科词条卡片：成立时间、组合成员、经纪公司、代表作品、主要成就、首图
 *   - 网易云音乐：歌手头像、热门歌曲
 *
 * 用法：
 *   node scripts/fetch-artists.mjs           # 写入 data/groups.json
 *   node scripts/fetch-artists.mjs --dry     # 只打印抓取结果，不写文件
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatDebutDate, debutYear, fetchBaikeProfile, findDebutInText } from '../src/baike.js';
import { ROOT_DIR } from '../src/config.js';
import { fetchArtistProfile, fetchArtistById } from '../src/netease.js';

const FILE = path.join(ROOT_DIR, 'data', 'groups.json');

const TARGETS = [
  // ---------- 团体 ----------
  { name: 'BTS', nameZh: '防弹少年团', type: 'group', baike: '防弹少年团', netease: 'BTS', aliases: ['防弹少年团', '防弹', '방탄소년단', 'Bangtan Boys'] },
  { name: 'EXO', nameZh: '茶蛋', type: 'group', baike: 'EXO', netease: 'EXO', aliases: ['엑소', '茶蛋'] },
  { name: 'SEVENTEEN', nameZh: '赛文婷', type: 'group', baike: 'SEVENTEEN', netease: 'SEVENTEEN', aliases: ['十七', '세븐틴'] },
  { name: 'NCT 127', nameZh: 'NCT127', type: 'group', baike: 'NCT 127', netease: 'NCT 127', aliases: ['NCT127', '엔시티 127', '127'] },
  { name: 'Stray Kids', nameZh: '流浪儿童', type: 'group', baike: 'Stray Kids', netease: 'Stray Kids', aliases: ['迷', '스트레이 키즈', 'SKZ'] },
  { name: 'ENHYPEN', nameZh: '符', type: 'group', baike: 'ENHYPEN', netease: 'ENHYPEN', aliases: ['엔하이픈'] },
  { name: 'ITZY', nameZh: '一击', type: 'group', baike: 'ITZY', netease: 'ITZY', aliases: ['있지'] },
  { name: 'aespa', nameZh: '爱斯帕', type: 'group', baike: 'aespa', netease: 'aespa', aliases: ['吒', '에스파'] },
  { name: 'IVE', nameZh: '芙', type: 'group', baike: 'IVE', netease: 'IVE', aliases: ['아이브'] },
  { name: 'LE SSERAFIM', nameZh: '炽', type: 'group', baike: 'LE SSERAFIM', netease: 'LE SSERAFIM', aliases: ['르세라핌'] },
  { name: 'Red Velvet', nameZh: '红毛', type: 'group', baike: 'Red Velvet', netease: 'Red Velvet', aliases: ['레드벨벳', 'RV'] },
  { name: 'SHINee', nameZh: '闪', type: 'group', baike: 'SHINee', netease: 'SHINee', aliases: ['샤이니'] },
  { name: 'Super Junior', nameZh: '老少年', type: 'group', baike: 'Super Junior', netease: 'Super Junior', aliases: ['슈퍼주니어', 'SJ'] },
  { name: '2NE1', nameZh: '2NE1', type: 'group', baike: '2NE1', netease: '2NE1', aliases: ['투애니원'] },
  { name: 'Girls\u2019 Generation', nameZh: '少女时代', type: 'group', baike: '少女时代', netease: '少女时代', aliases: ['少女时代', 'SNSD', '소녀시대', 'Girls Generation'] },
  { name: 'Apink', nameZh: '阿粉', type: 'group', baike: 'Apink', netease: 'Apink', aliases: ['A Pink', '에이핑크'] },
  { name: 'MAMAMOO', nameZh: '妈妈木', type: 'group', baike: 'MAMAMOO', netease: 'MAMAMOO', aliases: ['마마무'] },
  { name: 'TOMORROW X TOGETHER', nameZh: '明日之子', type: 'group', baike: 'TOMORROW X TOGETHER', netease: 'TOMORROW X TOGETHER', aliases: ['TXT', '투모로우바이투게더'] },
  { name: 'ATEEZ', nameZh: '梯', type: 'group', baike: 'ATEEZ', netease: 'ATEEZ', aliases: ['에이티즈'] },
  { name: 'NMIXX', nameZh: '恩米克斯', type: 'group', baike: 'NMIXX', netease: 'NMIXX', aliases: ['엔믹스'] },
  { name: 'STAYC', nameZh: '思黛西', type: 'group', baike: 'STAYC', netease: 'STAYC', aliases: ['스테이씨'] },
  { name: 'OH MY GIRL', nameZh: '噜妹', type: 'group', baike: 'OH MY GIRL', netease: 'OH MY GIRL', aliases: ['Oh My Girl', '오마이걸', 'OMG'] },
  { name: '(G)I-DLE', nameZh: '女娃', type: 'group', baike: '(G)I-DLE', netease: 'i-dle', aliases: ['GIDLE', 'i-dle', '여자아이들', '(여자)아이들'] },
  { name: 'Kep1er', nameZh: '葡', type: 'group', baike: 'Kep1er', netease: 'Kep1er', aliases: ['케플러'] },

  // ---------- 扩充：经典/热门团体 ----------
  { name: 'TVXQ', nameZh: '东方神起', type: 'group', baike: '东方神起', netease: '东方神起', aliases: ['东方神起', '동방신기', 'DBSK', 'Tohoshinki'] },
  { name: 'KARA', nameZh: 'KARA', type: 'group', baike: 'KARA', netease: 'KARA', aliases: ['카라'] },
  { name: 'Wonder Girls', nameZh: 'Wonder Girls', type: 'group', baike: 'Wonder Girls', netease: 'Wonder Girls', aliases: ['원더걸스'] },
  { name: 'f(x)', nameZh: '函数', type: 'group', baike: 'f(x)', netease: 'f(x)', aliases: ['函数', '함수', 'FX'] },
  { name: 'SISTAR', nameZh: 'SISTAR', type: 'group', baike: 'SISTAR', netease: 'SISTAR', aliases: ['씨스타'] },
  { name: '2PM', nameZh: '2PM', type: 'group', baike: '2PM', netease: '2PM', aliases: ['투피엠'] },
  { name: 'BTOB', nameZh: '兔比', type: 'group', baike: 'BTOB', netease: 'BTOB', aliases: ['비투비', 'BtoB'] },
  { name: 'INFINITE', nameZh: '无限', type: 'group', baike: 'INFINITE', netease: 'INFINITE', aliases: ['인피니트'] },
  { name: 'VIXX', nameZh: 'VIXX', type: 'group', baike: 'VIXX', netease: 'VIXX', aliases: ['빅스'] },
  { name: 'EXID', nameZh: 'EXID', type: 'group', baike: 'EXID', netease: 'EXID', aliases: ['이엑스아이디'] },
  { name: 'T-ara', nameZh: '皇冠', type: 'group', baike: 'T-ara', netease: 'T-ara', aliases: ['TARA', 'T-ARA', '티아라'] },
  { name: 'XG', nameZh: 'XG', type: 'group', baike: 'XG', netease: 'XG', aliases: ['엑스지'] },
  { name: 'tripleS', nameZh: 'tripleS', type: 'group', baike: 'tripleS', netease: 'tripleS', aliases: ['트리플에스', 'SIGNAL'] },
  { name: 'PLAVE', nameZh: 'PLAVE', type: 'group', baike: 'PLAVE', netease: 'PLAVE', aliases: ['플레이브'] },

  // ---------- 个人 ----------
  { name: 'IU', nameZh: '李知恩', type: 'solo', baike: 'IU', netease: 'IU', aliases: ['李知恩', '아이유'] },
  { name: 'HyunA', nameZh: '金泫雅', type: 'solo', baike: '泫雅', netease: '金泫雅', aliases: ['泫雅', '현아', 'Kim HyunA'] },
  { name: 'Taeyeon', nameZh: '金泰妍', type: 'solo', baike: '金泰妍', netease: '太妍', aliases: ['金泰妍', '泰妍', '태연'] },
  { name: 'Baekhyun', nameZh: '边伯贤', type: 'solo', baike: '伯贤', netease: '伯贤', aliases: ['伯贤', '边伯贤', '백현'] },
  { name: 'G-Dragon', nameZh: '权志龙', type: 'solo', baike: 'G-DRAGON', netease: 'G-DRAGON', aliases: ['GD', '权志龙', '지드래곤'] },
  { name: 'TAEYANG', nameZh: '太阳', type: 'solo', baike: 'TAEYANG', netease: 'TAEYANG', aliases: ['太阳', '태양', '东永裴', 'Taeyang'] },
  { name: 'Lisa', nameZh: '拉莉莎', type: 'solo', baike: 'Lisa', netease: 'Lisa', aliases: ['리사', 'Lalisa'] },
  { name: 'Jennie', nameZh: '金珍妮', type: 'solo', baike: 'Jennie', netease: 'Jennie', aliases: ['金珍妮', '제니'] },
  { name: 'Rosé', nameZh: '朴彩英', type: 'solo', baike: '朴彩英', netease: 'Rosé', aliases: ['Rose', '朴彩英', '로제', 'Rosie'] },
  { name: 'Jisoo', nameZh: '金智秀', type: 'solo', baike: '金智秀', netease: 'Jisoo', aliases: ['金智秀', '지수'] },
  { name: 'Sunmi', nameZh: '宣美', type: 'solo', baike: '宣美', netease: '宣美', aliases: ['李宣美', '선미'] },
  { name: 'CHUNG HA', nameZh: '请夏', type: 'solo', baike: '请夏', netease: '청하', aliases: ['Chungha', '请夏', '金请夏', '청하'] },
  { name: 'Taemin', nameZh: '李泰民', type: 'solo', baike: '泰民', netease: '泰民', aliases: ['泰民', '李泰民', '태민'] },
  { name: 'KAI', nameZh: '金钟仁', type: 'solo', baike: 'KAI', netease: '金钟仁', neteaseId: 990210, aliases: ['金钟仁', '카이', 'Kai'] },
  { name: 'Jung Kook', nameZh: '田柾国', type: 'solo', baike: '田柾国', netease: 'Jung Kook', aliases: ['Jungkook', '田柾国', '정국', 'JK'] },

  // ---------- 扩充：核心成员 / 热门个人 ----------
  { name: 'RM', nameZh: '金南俊', type: 'solo', baike: '金南俊', netease: 'RM', aliases: ['金南俊', 'Rap Monster', '래몬'] },
  { name: 'Jin', nameZh: '金硕珍', type: 'solo', baike: '金硕珍', netease: 'Jin', aliases: ['金硕珍', '진'] },
  { name: 'SUGA', nameZh: '闵玧其', type: 'solo', baike: '闵玧其', netease: 'SUGA', aliases: ['闵玧其', '슈가', 'Agust D'] },
  { name: 'j-hope', nameZh: '郑号锡', type: 'solo', baike: '郑号锡', netease: 'j-hope', aliases: ['郑号锡', '제이홉', 'J-Hope'] },
  { name: 'Jimin', nameZh: '朴智旻', type: 'solo', baike: '朴智旻', netease: 'Jimin', aliases: ['朴智旻', '지민', 'Park Jimin'] },
  { name: 'V', nameZh: '金泰亨', type: 'solo', baike: '金泰亨', netease: 'V', aliases: ['金泰亨', '뷔', 'Kim Taehyung'] },
  { name: 'Nayeon', nameZh: '林娜琏', type: 'solo', baike: '林娜琏', netease: 'Nayeon', aliases: ['林娜琏', '나연'] },
  { name: 'Irene', nameZh: '裴珠泫', type: 'solo', baike: '裴珠泫', netease: 'Irene', aliases: ['裴珠泫', '아이린'] },
  { name: 'Seulgi', nameZh: '姜涩琪', type: 'solo', baike: '姜涩琪', netease: 'Seulgi', aliases: ['姜涩琪', '슬기'] },
  { name: 'Sakura', nameZh: '宫脇咲良', type: 'solo', baike: '宫脇咲良', netease: '宫脇咲良', aliases: ['宫脇咲良', '사쿠라', 'Miyawaki Sakura'] },
  { name: 'Chaewon', nameZh: '金采源', type: 'solo', baike: '金采源', netease: '金采源', aliases: ['金采源', '채원', 'Kim Chaewon'] },
  { name: 'Yuqi', nameZh: '宋雨琦', type: 'solo', baike: '宋雨琦', netease: '宋雨琦', aliases: ['宋雨琦', '우기'] },
  { name: 'Tzuyu', nameZh: '周子瑜', type: 'solo', baike: '周子瑜', netease: '周子瑜', aliases: ['周子瑜', '쯔위'] },
];

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '')
    .trim();

/**
 * 库里已有、但不在上面精选清单里的艺人：同样补全真实资料，
 * 身份字段（名称 / 中文名 / 别名）保持原样，只补出道年、成员、代表作、奖项。
 * 格式：[库内名称, 百科词条, 网易云搜索名]
 */
const EXTRA = [
  ['BLACKPINK', 'BLACKPINK', 'BLACKPINK'],
  ['TWICE', 'TWICE', 'TWICE'],
  ['NewJeans', 'NewJeans', 'NewJeans'],
  ['BIGBANG', 'BIGBANG', 'BIGBANG'],
  ['NCT', 'NCT', 'NCT'],
  ['MONSTA X', 'MONSTA X', 'MONSTA X'],
  ['GOT7', 'GOT7', 'GOT7'],
  ['WINNER', 'WINNER', 'WINNER'],
  ['iKON', 'iKON', 'iKON'],
  ['EVERGLOW', 'EVERGLOW', 'EVERGLOW'],
  ['BABYMONSTER', 'BABYMONSTER', 'BABYMONSTER'],
  ['ILLIT', 'ILLIT', 'ILLIT'],
  ['RIIZE', 'RIIZE', 'RIIZE'],
  ['ZEROBASEONE', 'ZEROBASEONE', 'ZEROBASEONE'],
  ['BOYNEXTDOOR', 'BOYNEXTDOOR', 'BOYNEXTDOOR'],
  ['TWS', 'TWS', 'TWS'],
  ['KISS OF LIFE', 'KISS OF LIFE', 'KISS OF LIFE'],
  ['J.Y. Park', '朴振英', 'J.Y. Park'],
  ['Hwasa', '华莎', '华莎'],
  ['Zico', '禹智皓', 'ZICO'],
  ['Somi', '全昭弥', 'SOMI'],
  ['Hanni', 'Hanni', 'Hanni'],
  ['Karina', '刘知珉', 'Karina'],
  ['Minji', 'Minji', 'Minji'],
  ['Winter', '金玟庭', 'Winter'],
  ['Wonyoung', '张元英', '张元英'],
];

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchNetease(target) {
  if (target.neteaseId) {
    const byId = await fetchArtistById(target.neteaseId).catch(() => null);
    if (byId) return byId;
  }
  const candidates = [target.netease, target.name, target.nameZh, ...(target.aliases || [])]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  for (const name of [...new Set(candidates)]) {
    const profile = await fetchArtistProfile(name).catch(() => null);
    if (profile) return profile;
  }
  return null;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const value = clean(item);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function findExisting(groups, target) {
  const keys = new Set(
    [target.name, target.nameZh, ...(target.aliases || [])].map(normalize).filter(Boolean),
  );
  return (
    groups.find((group) => keys.has(normalize(group.name))) ||
    groups.find((group) => keys.has(normalize(group.key))) ||
    groups.find((group) => keys.has(normalize(group.nameZh))) ||
    groups.find((group) => (group.aliases || []).some((alias) => keys.has(normalize(alias)))) ||
    null
  );
}

async function buildEntry(target, existing) {
  const [baike, netease] = await Promise.all([
    (async () => {
      const first = await fetchBaikeProfile(target.baike || target.name).catch(() => null);
      if (first) return first;
      await sleep(700);
      return fetchBaikeProfile(target.baike || target.name).catch(() => null);
    })(),
    fetchNetease(target),
  ]);

  const sources = [];
  if (baike) sources.push('baike');
  if (netease) sources.push('netease');

  const debutRaw = baike?.fields?.['出道'] || '';
  const debut = formatDebutDate(debutRaw) || findDebutInText(baike?.abstract || '') || '';
  const works =
    baike?.fields?.['代表作品'] ||
    (netease?.songs || []).slice(0, 5).join('、');
  const members =
    target.type === 'solo'
      ? []
      : existing?.members?.length
        ? existing.members
        : dedupe(baike?.members || []).slice(0, 16);

  const cover = existing?.cover || netease?.picUrl || baike?.image || '';
  const coverCredit = existing?.coverCredit || (netease?.picUrl ? 'NetEase Cloud Music artist photo' : baike?.image ? 'Baidu Baike' : '');

  const entry = {
    ...(existing || {}),
    key: existing?.key || normalize(target.name),
    name: target.onlyFill ? existing?.name || target.name : existing?.name || target.name,
    nameZh: target.onlyFill ? existing?.nameZh || '' : target.nameZh || existing?.nameZh || '',
    type: target.onlyFill ? existing?.type || target.type : target.type,
    aliases: target.onlyFill
      ? existing?.aliases || []
      : dedupe([...(existing?.aliases || []), ...(target.aliases || []), target.nameZh]),
    members,
    cover,
    coverSource: coverCredit,
    coverCredit,
    ...(existing?.bvid ? { bvid: existing.bvid } : {}),
    debut,
    debutYear: debutYear(debut) || 0,
    agency: baike?.fields?.['经纪公司'] || existing?.agency || '',
    group: target.type === 'solo' ? baike?.fields?.['所属组合'] || existing?.group || '' : '',
    fandom: baike?.fields?.['粉丝名'] || existing?.fandom || '',
    works,
    awards: dedupe(baike?.awards || []).slice(0, 8),
    songs: dedupe(netease?.songs || []).slice(0, 10),
    bio: clean(baike?.abstract || '').slice(0, 220),
    baikeTitle: baike?.title || '',
    baikeUrl: baike?.url || '',
    baikeImage: baike?.image || '',
    sources,
    dataUpdatedAt: new Date().toISOString().slice(0, 10),
  };

  // 空字段不写，保持文件干净；UI 会显示「暂未收录」
  for (const key of ['debut', 'agency', 'bio', 'baikeTitle', 'baikeUrl', 'baikeImage', 'coverSource', 'coverCredit', 'cover', 'works', 'group', 'fandom']) {
    if (!entry[key]) delete entry[key];
  }
  for (const key of ['members', 'awards', 'songs', 'aliases']) {
    if (!Array.isArray(entry[key]) || entry[key].length === 0) delete entry[key];
  }
  if (!entry.debutYear) delete entry.debutYear;
  if (!entry.bvid || !/^BV[0-9A-Za-z]{6,}$/.test(entry.bvid)) delete entry.bvid;

  return entry;
}

async function applyTarget(target, existing, groups, problems) {
  let entry;
  try {
    entry = await buildEntry(target, existing);
  } catch (err) {
    problems.push(`${target.name}: ${err.message}`);
    return;
  }

  const index = existing ? groups.indexOf(existing) : -1;
  if (index >= 0) groups[index] = entry;
  else groups.push(entry);

  const flags = [
    entry.debut ? '出道' : '缺出道',
    entry.members?.length ? '成员' : entry.type === 'solo' ? '个人' : '缺成员',
    entry.works ? '代表作' : '缺代表作',
    entry.awards?.length ? `奖项${entry.awards.length}` : '缺奖项',
    entry.cover ? '封面' : '缺封面',
    entry.songs?.length ? `热歌${entry.songs.length}` : '缺热歌',
  ];
  console.log(
    `${existing ? '更新' : '新增'} ${target.name.padEnd(22)} → ${(entry.baikeTitle || '—').padEnd(18)} ${flags.join(' · ')}  [${entry.sources.join('+')}]`,
  );

  // 顺序请求，避免触发百科的频率限制
  await sleep(350);
}

async function main() {
  const dry = process.argv.includes('--dry');
  const doc = JSON.parse(readFileSync(FILE, 'utf8'));
  const groups = Array.isArray(doc.groups) ? doc.groups : [];
  const problems = [];

  for (const target of TARGETS) {
    const existing = findExisting(groups, target);
    await applyTarget(target, existing, groups, problems);
  }

  // 库里其余歌手：只补资料，不改身份字段
  for (const [name, baike, netease] of EXTRA) {
    const existing = groups.find((group) => normalize(group.name) === normalize(name));
    if (!existing) {
      problems.push(`${name}: 库里没有这条记录，跳过`);
      continue;
    }
    const target = {
      name: existing.name,
      nameZh: existing.nameZh,
      type: existing.type,
      baike,
      netease,
      aliases: existing.aliases || [],
      onlyFill: true,
    };
    await applyTarget(target, existing, groups, problems);
  }

  // 按类型分组、名字排序，保证文件稳定，方便 review
  groups.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'group' ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });

  const next = {
    ...doc,
    version: 3,
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '歌手库：name 英文名 / nameZh 中文名，二者都参与搜索；debut / members / works / awards / bio 来自百度百科词条与网易云音乐实时抓取，baikeUrl 为词条地址；拿不到的字段留空，页面显示「暂未收录」。',
    groups,
  };

  console.log(`\n共 ${groups.length} 位歌手/团体（团体 ${groups.filter((g) => g.type === 'group').length}，个人 ${groups.filter((g) => g.type === 'solo').length}）`);
  if (problems.length) console.log(`失败 ${problems.length} 条：\n${problems.join('\n')}`);

  if (dry) {
    console.log('\n--dry：未写入文件');
    return;
  }
  writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`\n已写入 ${path.relative(ROOT_DIR, FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
