/**
 * DEMO 演示模式：没有 API Key 时也能完整走通「流式输出」体验。
 * 数据结构刻意与 prompt.js 里的 Markdown 契约保持一致。
 */

const GROUPS = {
  blackpink: {
    name: 'BLACKPINK',
    text: `## 一句话
四个人的气场各不相同，凑在一起就是「巨型舞台」本身。

## 团体档案
- 出道时间：2016 年 8 月
- 所属公司：YG Entertainment
- 成员名单：Jisoo、Jennie、Rosé、Lisa（四人四色）
- 音乐风格：girl crush、EDM 副歌、时尚感
- 团体名片：BLACK + PINK，冷脸与甜心各占一半

## 热门歌曲
1. **DDU-DU DDU-DU** — 前奏一响就认得出的招牌曲
2. **How You Like That** — 低谷期的一记重锤
3. **Shut Down** — 采样帕格尼尼，女王叙事收尾
4. **Kill This Love** — 军鼓与铜管堆出的爆发力
5. **BOOMBAYAH** — 出道曲，最野生的能量

## 入坑观看
2019 年 Coachella 的完整舞台，四个人的现场比录音室更凶

## 冷知识
团名里的「BLACK」与「PINK」不是随手取的配色，而是刻意经营的双面人设：酷与甜都做到极致。`,
  },
  bts: {
    name: 'BTS',
    text: `## 一句话
从地下室唱到体育场，把「青春」写成七年连载的七个人。

## 团体档案
- 出道时间：2013 年 6 月
- 所属公司：BIGHIT MUSIC
- 成员名单：RM、Jin、SUGA、j-hope、Jimin、V、Jungkook（七人）
- 音乐风格：嘻哈底色、叙事专辑、大合唱
- 团体名片：ARMY 与「花样年华」

## 热门歌曲
1. **Spring Day** — 很多人心里过不去的那个冬天
2. **DNA** — 打开海外市场的钥匙
3. **Dynamite** — 全英文 Disco，电台循环
4. **Boy With Luv** — 明亮的放克流行，副歌最甜
5. **FAKE LOVE** — 摇滚吉他与暗色叙事

## 入坑观看
2018 年的《Burn the Stage》纪录片，看完会懂他们为什么被叫「舞台上的七个人」

## 冷知识
《Spring Day》在音源榜上异常漫长的在榜时间，一直被粉丝当作团魂的物证。`,
  },
  newjeans: {
    name: 'NewJeans',
    text: `## 一句话
把 Y2K 的松弛感做成制服，五个人像一组会唱歌的胶片。

## 团体档案
- 出道时间：2022 年 7 月
- 所属公司：ADOR
- 成员名单：Minji、Hanni、Danielle、Haerin、Hyein（五人）
- 音乐风格：UK garage、R&B、极简编舞
- 团体名片：兔子符号与不做作的少年感

## 热门歌曲
1. **Hype Boy** — 四条视角的 MV，副歌上瘾
2. **Ditto** — lo-fi 朦胧感的暗恋
3. **Super Shy** — 两分钟里最轻的一次冲刺
4. **Attention** — 出道即定调的清爽
5. **OMG** — 复古舞曲与和声堆叠

## 入坑观看
先看《Ditto》两支 MV 的叙事彩蛋，再补练习室版编舞

## 冷知识
出道时几乎不走传统 K-POP 宣传节奏：不靠长预告堆砌，直接把歌放出来。`,
  },
  twice: {
    name: 'TWICE',
    text: `## 一句话
九个人、一句「One in a million」，把元气做成了国民级。

## 团体档案
- 出道时间：2015 年 10 月
- 所属公司：JYP Entertainment
- 成员名单：Nayeon、Jeongyeon、Momo、Sana、Jihyo、Mina、Dahyun、Chaeyoung、Tzuyu（九人）
- 音乐风格：元气流行、夏日电子、应援式副歌
- 团体名片：ONCE 与「TT 手势」

## 热门歌曲
1. **CHEER UP** — 「shy shy shy」的时代梗
2. **FANCY** — 转型分水岭
3. **Feel Special** — 写给成员也给粉丝
4. **TT** — 万圣节感的经典副歌
5. **Like OOH-AHH** — 出道曲的野生元气

## 入坑观看
出道生存战《SIXTEEN》，能看懂这九个人是怎么被拼到一起的

## 冷知识
TT 手势的灵感来自表情符号「TT」，成员们一度在综艺上被要求随时随地比出来。`,
  },
  aespa: {
    name: 'aespa',
    text: `## 一句话
把「虚拟世界」写进 K-POP 世界观，四个女孩带着各自的分身登场。

## 团体档案
- 出道时间：2020 年 11 月
- 所属公司：SM Entertainment
- 成员名单：Karina、Giselle、Winter、Ningning（四人）
- 音乐风格：电子、hyperpop、赛博叙事
- 团体名片：KWANGYA 与「ae-」分身

## 热门歌曲
1. **Black Mamba** — 出道即定世界观
2. **Next Level** — 变速桥把人声当武器
3. **Savage** — 故障艺术式的结构
4. **Girls** — 赛博朋克的强硬
5. **Spicy** — 明亮流行的反差

## 入坑观看
她们的「ae-」概念短片系列，比 MV 更像一部连续剧

## 冷知识
概念里每位成员都有一个虚拟分身「ae-」，这套世界观后来被公司延伸到其他团体。`,
  },
  ive: {
    name: 'IVE',
    text: `## 一句话
六个人、一种不肯低头的漂亮，把「自爱」唱成流行曲。

## 团体档案
- 出道时间：2021 年 12 月
- 所属公司：Starship Entertainment
- 成员名单：Yujin、Gaeul、Rei、Wonyoung、Liz、Leeseo（六人）
- 音乐风格：复古流行、弦乐副歌、华丽感
- 团体名片：DIVE 与「I HAVE IVE」

## 热门歌曲
1. **ELEVEN** — 弦乐一进就有电影感
2. **LOVE DIVE** — 干净的编曲像刀口
3. **I AM** — 最适合体育场的一首
4. **After LIKE** — 采样经典 Disco 的自信
5. **Kitsch** — 反叛感的 Hip-hop 底色

## 入坑观看
音乐节目的现场直拍，能看清她们对镜头的控制力

## 冷知识
团名 IVE 取自「I HAVE」，意思是「我们拥有的，就是全部」。`,
  },
  seventeen: {
    name: 'SEVENTEEN',
    text: `## 一句话
十三个人自己写歌、自己编舞，把「自给自足」做成了招牌。

## 团体档案
- 出道时间：2015 年 5 月
- 所属公司：Pledis Entertainment
- 成员名单：S.Coups、Jeonghan、Joshua、Jun、Hoshi、Wonwoo、Woozi、DK、Mingyu、The8、Seungkwan、Vernon、Dino（13 人，分 Hip-hop、Vocal、Performance 三个小队）
- 音乐风格：清爽编舞、乐队感流行、刀群舞
- 团体名片：CARAT 与「自产自销」

## 热门歌曲
1. **Very Nice** — 全场合唱开关
2. **Don't Wanna Cry** — 把悲伤跳成整齐的队形
3. **God of Music** — 做音乐很快乐
4. **Left & Right** — 清爽的夏日编舞
5. **HOT** — 拉丁吉他与刀群舞

## 入坑观看
团综《Going Seventeen》，比任何安利都有效

## 冷知识
成员 Woozi 参与了团体绝大多数歌曲的制作，是偶像里出名的「版权富翁」。`,
  },
  straykids: {
    name: 'Stray Kids',
    text: `## 一句话
自己写、自己吼、自己救——把「成长痛」做成高强度的声音。

## 团体档案
- 出道时间：2018 年 3 月
- 所属公司：JYP Entertainment
- 成员名单：Bang Chan、Lee Know、Changbin、Hyunjin、Han、Felix、Seungmin、I.N（八人）
- 音乐风格：噪音流行、EDM 爆发、直给的说唱
- 团体名片：STAY 与制作组「3RACHA」

## 热门歌曲
1. **God's Menu** — 菜单式结构与拟声副歌
2. **Thunderous** — 传统乐器撞重金属
3. **LALALALA** — 就算这样也要快乐
4. **Back Door** — 爵士律动的反转
5. **MIROH** — 出道初期的宣言

## 入坑观看
竞演节目《Kingdom》的舞台，一次看清他们的编曲与舞美野心

## 冷知识
内制制作组 3RACHA（Bang Chan、Changbin、Han）几乎包办了团体全部主打歌的词曲。`,
  },
};

const ALIASES = {
  粉墨: 'blackpink',
  墨: 'blackpink',
  bp: 'blackpink',
  블랙핑크: 'blackpink',
  防弹: 'bts',
  防弹少年团: 'bts',
  弹: 'bts',
  방탄소년단: 'bts',
  newjeans: 'newjeans',
  뉴진스: 'newjeans',
  nj: 'newjeans',
  牛腱子: 'newjeans',
  兔瓦斯: 'twice',
  兔: 'twice',
  트와이스: 'twice',
  吒: 'aespa',
  에스파: 'aespa',
  芙: 'ive',
  아이브: 'ive',
  十七: 'seventeen',
  赛文婷: 'seventeen',
  迷: 'straykids',
  流浪儿童: 'straykids',
};

function normalizeKey(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[\s\-_.·'"“”‘’()（）[\]]/g, '')
    .trim();
}

export function lookupGroup(raw) {
  const key = normalizeKey(raw);
  if (!key) return null;
  if (GROUPS[key]) return GROUPS[key];
  if (ALIASES[key] && GROUPS[ALIASES[key]]) return GROUPS[ALIASES[key]];
  return null;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return reject(err);
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * 按 2 个字符一片模拟 token 流，节奏接近真实模型。
 * 只负责「把给定文本流式吐出去」，来源判定交给 sources.js。
 */
export async function streamDemo({ text, send, signal }) {
  const CHUNK = 2;
  for (let i = 0; i < text.length; i += CHUNK) {
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    send({ type: 'delta', text: text.slice(i, i + CHUNK) });
    await sleep(14, signal);
  }
}
