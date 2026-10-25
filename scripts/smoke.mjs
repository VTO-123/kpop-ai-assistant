/**
 * 冒烟测试：真的把服务拉起来，走一遍关键路径。
 * 用法：npm run smoke
 * 只用 Node 内置能力，不依赖任何测试框架。
 *
 * 覆盖：
 *   1. DEMO 模式：静态资源、SSE 流式、五个小节、中文别名、参数校验、路径穿越、404
 *   2. LIVE 模式：用假上游验证 SSE 转发、Bearer 鉴权、[DONE]、401 错误映射
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '../src/config.js';
import { SYSTEM_PROMPT } from '../src/prompt.js';
import { renderMarkdown } from '../public/js/md.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const results = [];
let failed = 0;
let serverLog = '';

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
}

const randomPort = (min) => min + Math.floor(Math.random() * 400);

/* ---------------- 工具 ---------------- */

async function startApp(extraEnv) {
  const port = randomPort(4700);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    serverLog += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/api/config`);
      if (res.ok) return { child, base, up: true };
    } catch {
      /* 还没起来 */
    }
    await delay(100);
  }
  return { child, base, up: false };
}

/** 读完一条 SSE 响应，拼出正文并统计分片数。 */
async function collectStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let deltas = 0;
  let done = false;
  let error = '';
  let meta = null;
  let context = null;

  const consumeLine = (line) => {
    if (!line.startsWith('data: ')) return;
    try {
      const event = JSON.parse(line.slice(6));
      if (event.type === 'meta') meta = event;
      if (event.type === 'context') context = event;
      if (event.type === 'delta') {
        deltas += 1;
        text += event.text;
      }
      if (event.type === 'done') done = true;
      if (event.type === 'error') error = event.message || 'error';
    } catch {
      /* 半行，跳过 */
    }
  };

  while (true) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      consumeLine(buffer.slice(0, index).trim());
      buffer = buffer.slice(index + 1);
    }
  }
  consumeLine(buffer.trim());

  return { text, deltas, done, error, meta, context };
}

const postChat = (base, group) =>
  fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ group }),
  });

/* ---------------- 假上游（OpenAI 兼容） ---------------- */

const FAKE_PARTS = ['## 一句话\n', '假上游返回的流式内容。\n', '## 三首必听\n', '1. **Fake Song** — 测试用\n'];
let fakeAuth = '';
let fakeModel = '';
let fakeCalls = 0;

function startFakeUpstream() {
  const port = randomPort(4600);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      fakeCalls += 1;
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        /* ignore */
      }
      fakeAuth = req.headers.authorization || '';
      fakeModel = payload.model || '';
      const userText = payload.messages?.[1]?.content || '';

      if (userText.includes('401')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":{"message":"invalid api key"}}');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const part of FAKE_PARTS) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

/* ---------------- 假封面接口（模拟网易云歌手搜索） ---------------- */

let coverCalls = 0;

function startFakeCoverApi() {
  const port = randomPort(4800);
  const server = http.createServer((req, res) => {
    coverCalls += 1;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const keyword = url.searchParams.get('s') || '';

    if (keyword === 'FAIL') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"boom"}');
      return;
    }

    const picUrl =
      keyword === 'NOIMAGE' ? '' : 'https://p2.music.126.net/fake/109951000000000000.jpg';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: { artists: [{ id: 42, name: keyword, picUrl }] } }));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

/* ---------------- 用例 ---------------- */

function envSuite() {
  const parsed = parseEnv('\uFEFFAI_API_KEY=sk-test\r\n# 注释\r\nPORT=1234\r\nAI_MODEL="deepseek-chat"\r\n');
  check('.env 解析：去掉 BOM', parsed.AI_API_KEY === 'sk-test', parsed.AI_API_KEY);
  check('.env 解析：注释被忽略', Object.keys(parsed).length === 3, Object.keys(parsed).join(','));
  check('.env 解析：成对引号被去掉', parsed.AI_MODEL === 'deepseek-chat', parsed.AI_MODEL);
  check('提示词：未收录使用固定标记', SYSTEM_PROMPT.includes('## 未收录'));
  check('提示词：要求标注相近真实艺人', SYSTEM_PROMPT.includes('相近的真实艺人'));
}

async function demoSuite() {
  const coverApi = await startFakeCoverApi();
  const app = await startApp({
    DEMO_MODE: '1',
    AI_API_KEY: '',
    COVER_API_BASE: `http://127.0.0.1:${coverApi.port}`,
    COVER_QQ_LOOKUP: '0',
  });
  try {
    check('DEMO 服务启动', app.up, app.up ? '' : serverLog.slice(0, 300));
    if (!app.up) return;

    const configRes = await fetch(`${app.base}/api/config`);
    const config = await configRes.json();
    check('GET /api/config', configRes.status === 200 && config.demo === true, JSON.stringify(config));

    const html = await fetch(`${app.base}/`);
    const htmlText = await html.text();
    check(
      'GET / 返回页面',
      html.status === 200 && htmlText.includes('K-POP 档案室') && htmlText.includes('/app.js'),
    );

    const css = await fetch(`${app.base}/styles.css`);
    check(
      'GET /styles.css',
      css.status === 200 && /text\/css/.test(css.headers.get('content-type') || ''),
    );

    const jsModule = await fetch(`${app.base}/js/md.js`);
    check(
      'GET /js/md.js（ES module）',
      jsModule.status === 200 && /javascript/.test(jsModule.headers.get('content-type') || ''),
    );

    // 首页：搜索入口 + 热门视频 3D 轮播（已移除「试试这些」与说明文字）
    check('首页是搜索页', htmlText.includes('id="searchBtn"') && !htmlText.includes('id="output"'));
    check('首页有热门视频轮播', htmlText.includes('id="hotSongsCarousel"'));
    check('首页板块标题是「热门视频」', htmlText.includes('热门视频') && !htmlText.includes('热门团体'));
    check('首页引用 FlexCarousel 样式', htmlText.includes('/flex-carousel.css'));
    check('首页不再有「试试这些」', !htmlText.includes('试试这些') && !htmlText.includes('data-group='));
    check('首页不再有内置资料说明', !htmlText.includes('会由 AI 实时生成'));
    check('首页有 VTO 版权标识', htmlText.includes('class="vto-mark"'));
    check('首页不再有页脚文案', !htmlText.includes('作品仅供学习与交流'));
    check('首页有搜索联想容器', htmlText.includes('id="suggestPanel"'));

    const artistsRes = await fetch(`${app.base}/api/artists`);
    const artistsJson = await artistsRes.json();
    const artistList = Array.isArray(artistsJson.artists) ? artistsJson.artists : [];
    check('歌手索引接口可用', artistsRes.status === 200 && artistList.length >= 50, `artists=${artistList.length}`);
    check(
      '歌手索引含中英文名',
      artistList.every((item) => item.name && item.nameZh) &&
        artistList.some((item) => item.name === 'BTS' && item.nameZh === '防弹少年团'),
    );

    // 详情页：顶部是该团体自己的歌手照片，不再放轮播
    const artistHtml = await fetch(`${app.base}/artist/BLACKPINK`);
    const artistText = await artistHtml.text();
    check('GET /artist/BLACKPINK 200', artistHtml.status === 200);
    check('详情页注入团体名', artistText.includes('<title>BLACKPINK'));
    check(
      '详情页顶部是歌手照片',
      artistText.includes('data-cover-img') && artistText.includes('banner-meta'),
    );
    check('歌手页有 VTO 标识', artistText.includes('class="vto-mark"'));
    check('歌手页不再有页脚与来源提示', !artistText.includes('作品仅供学习与交流') && !artistText.includes('archive-note'));
    check('详情页不再有轮播', !artistText.includes('coverCarousel'));
    check('详情页不引用轮播脚本', !artistText.includes('/flex-carousel.css'));
    check(
      '歌手页不再有旧的两个入口',
      !artistText.includes('id="viewArchive"') && !artistText.includes('id="bilibiliLink"'),
    );

    // 别名跳到同一个封面
    const aliasPage = await fetch(`${app.base}/artist/${encodeURIComponent('粉墨')}`);
    const aliasPageText = await aliasPage.text();
    check('别名详情页用规范名', aliasPageText.includes('<title>BLACKPINK'));

    // 中文名搜索：/artist/防弹少年团 与 /artist/BTS 等价
    const zhPage = await fetch(`${app.base}/artist/${encodeURIComponent('防弹少年团')}`);
    const zhText = await zhPage.text();
    check('中文名也能搜到', zhPage.status === 200 && zhText.includes('<title>BTS 防弹少年团'));
    check(
      '中英文指向同一档案',
      zhText.includes('data-cover-img') && artistText.includes('data-cover-img'),
    );
    const zhSolo = await fetch(`${app.base}/artist/${encodeURIComponent('金泰妍')}`);
    const zhSoloText = await zhSolo.text();
    check('中文名命中个人歌手', zhSoloText.includes('<title>Taeyeon 金泰妍'));

    // 冷门（库里完全没有）歌手：没有内置封面 → 渐变占位 + 标记待补照片
    const coldPage = await fetch(`${app.base}/artist/${encodeURIComponent('ZZZ 未知歌手')}`);
    const coldText = await coldPage.text();
    check('冷门歌手 200', coldPage.status === 200);
    check('冷门歌手用占位封面', coldText.includes('banner banner--empty'));
    check('冷门歌手标记待补照片', coldText.includes('data-cover-lookup="1"'));

    // 扩充后的歌手库：原本没有的团体也要有封面
    const knownPage = await fetch(`${app.base}/artist/BIGBANG`);
    const knownText = await knownPage.text();
    check('扩充后的团体有封面', knownText.includes('data-cover-img'));

    // 没有名字 / 非法路径 → 回首页
    const noName = await fetch(`${app.base}/artist`, { redirect: 'manual' });
    check('/artist 跳到首页', noName.status === 302 && noName.headers.get('location') === '/');
    const badPath = await fetch(`${app.base}/artist/%2Fetc%2Fpasswd`, { redirect: 'manual' });
    check('非法详情路径被拦住', badPath.status === 302, `status=${badPath.status}`);

    // 自动封面接口仍然可用（详情页 og:image 与外部调用）

    const builtinCoverRes = await fetch(`${app.base}/api/cover?name=BLACKPINK`);
    const builtinCoverJson = await builtinCoverRes.json();
    check(
      '封面：内置优先',
      builtinCoverRes.status === 200 &&
        builtinCoverJson.source === 'builtin' &&
        builtinCoverJson.url.includes('p2.music.126.net'),
      JSON.stringify(builtinCoverJson),
    );
    check('封面：内置命中不请求图源', coverCalls === 0, `calls=${coverCalls}`);

    const auto1 = await (
      await fetch(`${app.base}/api/cover?name=${encodeURIComponent('Some Rookie')}`)
    ).json();
    check(
      '封面：未收录自动拉取',
      auto1.source === 'netease' && auto1.url.includes('p2.music.126.net/fake'),
      JSON.stringify(auto1),
    );
    check('封面：确实调用了图源', coverCalls === 1, `calls=${coverCalls}`);

    const auto2 = await (
      await fetch(`${app.base}/api/cover?name=${encodeURIComponent('some  rookie')}`)
    ).json();
    check(
      '封面：同名（含大小写/空格）命中缓存',
      auto2.source === 'netease' && coverCalls === 1,
      `calls=${coverCalls}`,
    );

    const failCover = await (await fetch(`${app.base}/api/cover?name=FAIL`)).json();
    check('封面：图源 500 降级为无封面', failCover.source === 'none' && failCover.url === '');

    const noImage = await (await fetch(`${app.base}/api/cover?name=NOIMAGE`)).json();
    check('封面：接口无头像时降级', noImage.source === 'none' && noImage.url === '');

    const noNameParam = await fetch(`${app.base}/api/cover`);
    check('封面：缺少 name 返回 400', noNameParam.status === 400);

    // 轮播图数据
    const imagesRes = await fetch(`${app.base}/api/images`);
    const imagesJson = await imagesRes.json();
    const imageItems = Array.isArray(imagesJson.items) ? imagesJson.items : [];
    check('轮播：接口可用', imagesRes.status === 200 && imageItems.length >= 10, `items=${imageItems.length}`);
    check(
      '轮播：图片走同源代理',
      imageItems.every((item) => typeof item.src === 'string' && item.src.startsWith('/api/img?u=')),
    );
    check(
      '轮播：原始地址是国内 https 图源',
      imageItems.every(
        (item) =>
          typeof item.sourceUrl === 'string' &&
          item.sourceUrl.startsWith('https://') &&
          (item.sourceUrl.includes('hdslb.com') || item.sourceUrl.includes('music.126.net')),
      ),
    );
    check(
      '轮播：每条都有团体名 caption',
      imageItems.every((item) => typeof item.title === 'string' && item.title.length > 0),
    );
    check('轮播：不再有默认示例图', !JSON.stringify(imagesJson).includes('Liquid Metal'));

    // FlexCarousel 依赖：ogl 的 ESM 源码 + 组件样式
    const oglJs = await fetch(`${app.base}/vendor/ogl/index.js`);
    check(
      'GET /vendor/ogl/index.js',
      oglJs.status === 200 && /javascript/.test(oglJs.headers.get('content-type') || ''),
    );
    const flexCss = await fetch(`${app.base}/flex-carousel.css`);
    check('GET /flex-carousel.css', flexCss.status === 200);

    const badProxy = await fetch(
      `${app.base}/api/img?u=${encodeURIComponent('https://evil.example.com/a.jpg')}`,
    );
    check('图片代理拒绝非白名单域名', badProxy.status === 403, `status=${badProxy.status}`);

    // 热门视频数据
    const songsRes = await fetch(`${app.base}/api/songs`);
    const songsJson = await songsRes.json();
    const songItems = Array.isArray(songsJson.items) ? songsJson.items : [];
    check('热门视频：接口可用', songsRes.status === 200 && songItems.length >= 8, `items=${songItems.length}`);
    check(
      '热门视频：字段齐全',
      songItems.every((song) => song.id && song.title && song.artist && typeof song.src === 'string'),
    );
    check(
      '热门视频：封面走同源代理',
      songItems.every((song) => song.src.startsWith('/api/img?u=https%3A%2F%2F')),
    );
    check('热门视频：只返回精选项', songsJson.total === 10 && songItems.length === 10);

    const linksRes = await fetch(`${app.base}/api/song-links`);
    const linksJson = await linksRes.json();
    check('歌曲链接映射可用', linksRes.status === 200 && linksJson.total >= 70, `links=${linksJson.total}`);
    check(
      '歌曲链接大部分是 BV 直链',
      Object.values(linksJson.links).filter((item) => /^BV/.test(item.bvid || '')).length >= 70,
    );

    const membersRes = await fetch(`${app.base}/api/members`);
    const membersJson = await membersRes.json();
    check(
      '成员名单接口可用',
      membersRes.status === 200 && membersJson.total >= 100,
      `members=${membersJson.total}`,
    );

    // 渲染器单测：歌名 → B 站，成员名 → 个人档案页
    const rendered = renderMarkdown(
      '## 热门歌曲\n1. **DDU-DU DDU-DU** — 招牌曲\n\n## 团体档案\n- 成员名单：Jisoo、Jennie（主唱）、Lisa\n',
      {
        songLinks: linksJson.links,
        members: new Set(['jisoo', 'jennie', 'lisa']),
        artist: 'BLACKPINK',
      },
    );
    check(
      '渲染：有 BV 的歌跳视频页',
      /https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]+/.test(rendered),
    );
    check('渲染：成员名链接到个人页', rendered.includes('href="/artist/Jennie"'));
    check('渲染：成员括号说明不丢', rendered.includes('（主唱）'));

    const fallback = renderMarkdown('## 热门歌曲\n1. **Unknown Song** — x', {
      songLinks: {},
      artist: 'BLACKPINK',
    });
    check('渲染：无 BV 的歌回退搜索页', fallback.includes('search.bilibili.com/all?keyword='));
    check('渲染：无 BV 时不跳视频页', !fallback.includes('/video/'));

    // AI 用 [[成员名]] 标记时，成员名单要变成个人页链接
    const marked = renderMarkdown(
      '## 团体档案\n- 成员名单：[[李赛纶]]（队长）、[[宋河英]]（主唱）\n',
      { members: new Set(), songLinks: {}, artist: 'fromis_9' },
    );
    check('渲染：AI 标记的成员可点', (marked.match(/class="member-link"/g) || []).length === 2);
    check('渲染：标记不残留', !marked.includes('[[') && !marked.includes(']]'));
    check('渲染：成员担当保留', marked.includes('（队长）'));

    // 歌曲详情页
    const firstSong = songItems[0];
    const songPage = await fetch(`${app.base}/song/${firstSong.id}`);
    const songHtml = await songPage.text();
    check('GET /song/[id] 200', songPage.status === 200);
    check(
      '歌曲页显示歌名与歌手',
      songHtml.includes(firstSong.title) && songHtml.includes(firstSong.artist),
    );
    check('歌曲页有两个入口', songHtml.includes('id="artistLink"') && songHtml.includes('id="biliLink"'));
    check('歌曲页有 VTO 标识', songHtml.includes('class="vto-mark"'));
    check(
      '歌曲页歌手入口指向档案页',
      songHtml.includes(`href="/artist/${encodeURIComponent(firstSong.artist)}"`),
    );
    check(
      '歌曲页 B 站入口是新标签',
      songHtml.includes('target="_blank"') && songHtml.includes('rel="noopener noreferrer"'),
    );
    check('歌曲页没有未替换的占位符', !songHtml.includes('{{'));
    check('歌手页没有未替换的占位符', !artistText.includes('{{'));

    const noSong = await fetch(`${app.base}/song/nope`, { redirect: 'manual' });
    check('未知歌曲回首页', noSong.status === 302);

    const chatRes = await postChat(app.base, 'BLACKPINK');
    check('POST /api/chat 状态码', chatRes.status === 200);
    check(
      'POST /api/chat 是 SSE',
      /text\/event-stream/.test(chatRes.headers.get('content-type') || ''),
    );

    const { text, deltas, done, meta } = await collectStream(chatRes);
    check('收到 done 事件', done);
    check('meta 标记来源为 builtin', meta?.source === 'builtin', meta?.source);
    check('流式分片 > 50 片', deltas > 50, `deltas=${deltas}`);
    for (const section of ['一句话', '团体档案', '热门歌曲', '入坑观看', '冷知识']) {
      check(`正文包含「${section}」`, text.includes(section));
    }
    check(
      '热门歌曲正好 5 首',
      (text.match(/^\d+\. \*\*.+?\*\*/gm) || []).length === 5,
      `found=${(text.match(/^\d+\. \*\*.+?\*\*/gm) || []).length}`,
    );
    check('正文包含曲目', /DDU-DU DDU-DU/.test(text));

    const alias = await collectStream(await postChat(app.base, '粉墨'));
    check('别名「粉墨」命中 BLACKPINK', alias.text.includes('BLACK + PINK'));

    const unknown = await collectStream(await postChat(app.base, 'Bigbang'));
    check('未收录团体标记来源为 ai', unknown.meta?.source === 'ai', unknown.meta?.source);
    check('未收录团体不编造正文', unknown.text === '' && unknown.deltas === 0);
    check('未收录团体给出中性提示', /暂时无法生成/.test(unknown.error), unknown.error);

    const badRes = await postChat(app.base, '   ');
    check('空团体名返回 400', badRes.status === 400);

    const methodRes = await fetch(`${app.base}/api/chat`);
    check('GET /api/chat 返回 405', methodRes.status === 405);

    const traverse = await fetch(`${app.base}/..%2Fserver.js`);
    check('路径穿越被拒绝', traverse.status !== 200, `status=${traverse.status}`);

    const missing = await fetch(`${app.base}/nope.json`);
    check('缺失资源返回 404', missing.status === 404);
  } finally {
    app.child.kill();
    coverApi.server.close();
  }
}

async function liveSuite() {
  const fake = await startFakeUpstream();
  const app = await startApp({
    AI_API_KEY: 'test-key',
    AI_BASE_URL: `http://127.0.0.1:${fake.port}/v1`,
    AI_MODEL: 'fake-model',
    DEMO_MODE: '',
    PROFILE_LOOKUP: '0',
  });

  try {
    check('LIVE 服务启动', app.up, app.up ? '' : serverLog.slice(0, 300));
    if (!app.up) return;

    const config = await (await fetch(`${app.base}/api/config`)).json();
    check('LIVE 模式识别', config.demo === false && config.model === 'fake-model', JSON.stringify(config));

    // 内置团体：走内置资料，不消耗模型调用
    const builtin = await collectStream(await postChat(app.base, 'BLACKPINK'));
    check('LIVE 内置团体走内置资料', builtin.text.includes('BLACK + PINK'));
    check('LIVE 内置团体标记 builtin', builtin.meta?.source === 'builtin', builtin.meta?.source);
    check('LIVE 内置团体不调用模型', fakeCalls === 0, `calls=${fakeCalls}`);

    // 未收录团体（Bigbang）：必须交给模型实时生成
    const ai = await collectStream(await postChat(app.base, 'Bigbang'));
    check('未收录团体标记 ai', ai.meta?.source === 'ai', ai.meta?.source);
    check('未收录团体调用模型', fakeCalls === 1, `calls=${fakeCalls}`);
    check('LIVE 转发模型名', fakeModel === 'fake-model', fakeModel);
    check('LIVE 携带 Bearer Key', fakeAuth === 'Bearer test-key', fakeAuth);
    check('LIVE 收到 done', ai.done);
    check(
      'LIVE 生成前有资料上下文事件',
      ai.context && ai.context.grounded === false,
      JSON.stringify(ai.context),
    );
    check('LIVE 正文完整', ai.deltas === FAKE_PARTS.length && ai.text === FAKE_PARTS.join(''), `deltas=${ai.deltas}`);

    const failRes = await postChat(app.base, '触发401');
    const failStream = await collectStream(failRes);
    check(
      'LIVE 401 映射为友好提示',
      /API Key/.test(failStream.error),
      failStream.error || '(no error event)',
    );
  } finally {
    app.child.kill();
    fake.server.close();
  }
}

/* ---------------- 入口 ---------------- */

try {
  envSuite();
  await demoSuite();
  await liveSuite();
} catch (err) {
  check('未捕获异常', false, String(err && err.stack ? err.stack : err).slice(0, 400));
}

for (const item of results) {
  console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? `  ${item.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} 项通过`);
process.exit(failed === 0 ? 0 : 1);
