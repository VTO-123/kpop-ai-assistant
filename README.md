# K-POP 档案室 · kpop-ai-assistant

输入一个 K-POP 团体名 → AI 流式返回一份「入坑档案」：一句话定性、团体档案、三首必听、入坑观看、一条冷知识。

- **最小依赖**：服务端零依赖；前端只有 `ogl` 一个包（WebGL2 渲染）。没装依赖时轮播自动降级为图片墙，页面不会白屏
- **真流式**：服务端把上游模型的 SSE 转发给浏览器，正文逐字浮现
- **Key 不进浏览器**：API Key 只存在服务端 `.env.local`，前端只调自己的 `/api/chat`
- **离线可用**：没配 Key 时自动进入 DEMO 模式，8 个主力团体的档案有内置文本；其余歌手由 AI 实时生成

![界面预览](docs/preview.png)

---

## 快速开始

要求：**Node.js ≥ 18.17**（内置 `fetch`）。

```bash
# 1. 进入项目
cd kpop-ai-assistant

# 2. 安装前端渲染依赖（只有 ogl，约 0.4MB）
npm install

# 3. 启动
npm start
# 或
node server.js
```

打开终端里打印的地址，默认是 <http://127.0.0.1:4321>。

想接真实模型，先复制一份配置：

```bash
cp .env.example .env.local     # Windows PowerShell: Copy-Item .env.example .env.local
```

然后编辑 `.env.local`，填入 `AI_API_KEY`，重启服务即可。

```ini
AI_API_KEY=sk-xxxxxxxx
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
```

> 任何 OpenAI 兼容的 `/chat/completions` 接口都能用，例如：
> `AI_BASE_URL=https://api.openai.com/v1` + `AI_MODEL=gpt-4o-mini`。

### 自检

```bash
npm run smoke
```

会真的把服务拉起来（随机端口、强制 DEMO），检查静态资源、SSE 流式分片、
五个小节是否齐全、中文别名、参数校验与路径穿越防护，最后输出通过项数。

---

## 功能

| 功能 | 说明 |
| --- | --- |
| 多页结构 | 首页只做搜索入口，回车或点「搜索」跳转到 `/artist/[name]` 独立详情页 |
| 封面 banner | 详情页顶部显示**当前搜索团体自己的歌手照片** + 团体名；没有照片时用深色渐变占位，不出现空白或破图 |
| 自动封面兜底 | 内置没配封面时，按团体名去网易云「歌手搜索」取头像当封面；命中缓存 6 小时，失败降级占位 |
| FlexCarousel 3D 轮播 | **首页搜索框下方「热门视频」**：ogl + WebGL2 的「液体玻璃」透镜，MV 封面穿过透镜产生弯折/折射/色散；拖拽、滚轮、← → 切换，**点击任意卡片进入这首歌的详情页**；10 首热门 K-POP 歌曲 |
| 歌曲详情页 | `/song/[id]`：MV 封面、歌名、歌手、年份、简介，再给出「了解歌手信息」（跳 `/artist/名字`）与「去 B 站看视频」（新标签打开官方播放页）|
| 歌手档案页 | `/artist/[name]`：顶部是该歌手本人的照片，下方 AI 流式生成档案（一句话 / 出道时间 / 所属公司 / 成员名单 / 音乐风格 / 名片 / **热门歌曲（5 首）** / 入坑观看 / 冷知识）；团体和个人歌手都支持；**歌名可点跳 B 站 MV，成员名可点进个人档案页** |
| 流式生成 | 详情页 SSE 逐字输出，带打字光标、耗时与字数统计 |
| 最近查询 | 浏览器 `localStorage` 记录最近 6 个团体，点一下重新进入详情页 |
| 停止生成 | 生成中可中断，已输出的内容保留 |
| 复制 / 下载 | 一键复制全文，或导出 `团体名-入坑档案.md` |
| DEMO 模式 | 没有 Key 时只有 8 个主力团体有内置档案文本；其余歌手需配置 Key 后由 AI 实时生成 |
| 歌手库 | `data/groups.json` 收录 **58 位歌手/团体**（38 团体 + 20 位 solo），含中英文名、封面、成员名单 |
| 可直接分享 | `/artist/BLACKPINK` 这类地址可以单独发给别人，标题与封面由服务端注入 |
| 移动端 | 单列布局，输入框与按钮自动铺满 |

---

## 目录结构

```
kpop-ai-assistant/
├── server.js              # HTTP 入口：路由（含 /artist/[name]）、静态资源、优雅退出
├── src/
│   ├── config.js          # .env 解析与运行时配置
│   ├── prompt.js          # 系统提示词、输出结构契约、输入清洗
│   ├── chat.js            # /api/chat：SSE 转发、超时、错误映射
│   ├── sources.js         # 来源判定：内置资料优先，其余交给 AI
│   ├── groups.js          # data/groups.json 读取、别名与封面查找
│   ├── cover.js           # 封面兜底：网易云歌手头像 + 内存缓存 + 并发去重
│   ├── images.js          # 团体系图片库（备用）
│   ├── songs.js           # 热门视频数据读取 + B 站链接生成
│   ├── song-page.js       # 歌曲详情页服务端渲染
│   ├── image-proxy.js     # /api/img：图片同源代理（白名单 + 内存缓存）
│   ├── vendor.js          # /vendor/ogl/* → node_modules/ogl/src/*
│   ├── artist-page.js     # 详情页服务端渲染（标题/封面注入 + 转义）
│   ├── demo.js            # 内置档案语料与模拟 token 流
│   └── static.js          # 静态文件服务（含路径穿越防护）
├── data/
│   ├── groups.json        # 热门团体：别名 + 封面 URL + 代表视频 bvid + 成员名单
│   ├── songs.json         # 首页热门视频：歌名 / 歌手 / MV 封面 / bvid / 简介
│   └── kpop_images.json   # 13 个热门团体 × 3~5 张照片（团体系图片库，备用）
├── public/
│   ├── index.html         # 首页：搜索入口
│   ├── artist.html        # 详情页模板（服务端注入 {{ARTIST_NAME}} 等占位符）
│   ├── song.html          # 歌曲详情页模板
│   ├── app.js             # 首页逻辑：搜索 → 跳转
│   ├── artist.js          # 详情页逻辑：流式渲染、复制、下载、停止
│   ├── js/                # 共享模块：md / stream / store / flex-carousel
│   ├── flex-carousel.css  # FlexCarousel 样式（含 WebGL2 降级图片墙）
│   ├── styles.css
│   └── favicon.svg
├── scripts/
│   └── smoke.mjs          # 端到端冒烟测试（npm run smoke）
├── docs/
│   └── preview.png        # README 界面预览图
├── .env.example           # 配置模板（可提交）
├── .gitignore
└── README.md
```

---

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AI_API_KEY` | 空 | 为空则进入 DEMO 模式。也兼容 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` | 任意 OpenAI 兼容网关 |
| `AI_MODEL` | `deepseek-chat` | 模型名 |
| `PORT` | `4321` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址，容器内可设为 `0.0.0.0` |
| `DEMO_MODE` | 未设置 | 设为 `1` 强制使用演示数据 |
| `AI_TIMEOUT_MS` | `60000` | 上游请求超时 |
| `COVER_LOOKUP` | 未设置 | 设为 `0` 关闭自动封面兜底 |
| `COVER_API_BASE` | `https://music.163.com` | 封面图源地址，换源或指向本地假接口时用 |
| `COVER_TIMEOUT_MS` | `2500` | 拉封面超时，超时就降级占位 |

配置读取顺序：`process.env` > `.env.local` > `.env`。

---

## 接口

### `GET /api/config`

返回前端需要的运行信息（不含 Key）。

```json
{ "demo": false, "model": "deepseek-chat", "provider": "api.deepseek.com" }
```

### `POST /api/chat`

请求：

```json
{ "group": "BLACKPINK" }
```

响应：`text/event-stream`，每条事件是一行 `data: <json>`。

```text
data: {"type":"meta","model":"deepseek-chat","demo":false,"source":"ai"}

data: {"type":"delta","text":"## 一句话\n"}

data: {"type":"delta","text":"四个人的气场各不相同…"}

data: {"type":"done"}
```

出错时以 `{"type":"error","message":"..."}` 结束；连接期间每 15 秒发送一次 `: ping` 心跳。

`meta.source` 表示这次回答的来源：`builtin` = 命中内置资料（准确、不耗 token），`ai` = 由模型实时生成。
未配置 Key 且未命中内置资料时，服务端会返回 `error` 事件，而不是编造一份档案。

### `GET /api/cover?name=<团体名>`

封面兜底接口，返回 `{ name, url, source }`，`source` 为 `builtin` / `netease` / `none`。
内置 `data/groups.json` 命中时不请求图源；否则调用网易云歌手搜索取 `artist.picUrl`，
结果按团体名（忽略大小写与空格）缓存：命中 6 小时、未命中 10 分钟，并做并发去重。

### `GET /artist/[name]`（页面路由）

返回详情页 HTML，服务端注入 `<title>`、`og:image` 与封面图。`[name]` 支持中文与别名，
例如 `/artist/粉墨` 会按 BLACKPINK 渲染；`/artist` 或非法路径会 302 回首页。

### `GET /api/img?u=<编码后的图片地址>`

图片同源代理。WebGL 纹理要求同源，且图源对浏览器直连会偶发 412 限流，所以图片统一经由这里转发：

- 只允许 `*.hdslb.com` / `*.music.126.net` 的 https 地址，其余返回 403（不是开放代理）；
- 8 秒超时、8MB 上限、30 分钟内存缓存，命中后返回 `X-Cache: HIT`；
- 响应带 `Access-Control-Allow-Origin: *` 与 `Cache-Control: public, max-age=86400`。

### `GET /api/songs`

首页「热门视频」的数据（只返回有封面的 10 首精选），返回 `{ total, items: [{ id, title, artist, subtitle, src, sourceUrl }] }`。
`src` 已经换成 `/api/img?...` 的同源代理地址（WebGL 纹理要求同源）。

### `GET /api/song-links`

「热门歌曲」的链接映射，返回 `{ total, links: { <规范化歌名>: { title, artist, bvid } } }`。
前端渲染时按歌名查表：有 `bvid` 就生成 `https://www.bilibili.com/video/BV…`，没有就退化为 B 站搜索链接。

### `GET /api/members`

成员名单映射，返回 `{ total, members: [{ name, group }] }`。
前端渲染「成员名单」那一行时，命中的成员名会变成 `<a href="/artist/{成员名}">`，点进去就是该成员的个人档案页。

### `GET /song/[id]`（页面路由）

歌曲详情页，服务端注入歌名 / 歌手 / 封面 / 简介与两个入口：

- 「了解歌手信息」→ `/artist/{artist}`（歌手档案页）
- 「去 B 站看视频」→ `https://www.bilibili.com/video/{bvid}`，新标签打开

未知 id 或 `/song` 会 302 回首页。

### `GET /api/images`

团体系图片库，返回 `{ total, items: [{ src, sourceUrl, title, caption, source }] }`。
`src` 已经是 `/api/img?...` 的同源代理地址，`sourceUrl` 是原始图源（13 个团体混合池，当前首页不直接用）。

### AI 兜底策略（真实性优先）

歌手库只有 58 条是**人工整理**的（有封面、成员、B 站链接）；其余任何团体/歌手都由 AI 兜底：

0. 生成前先做**多源聚合**（两个来源并行，任一成功都会喂给模型）：
   - **网易云音乐**：`search/get?type=100` 拿歌手 id → 歌手详情（照片、`briefDesc`、别名）、专辑、热门歌曲；
   - **QQ 音乐**：`smartbox_new.fcg` 拿歌手 mid → `musicu.fcg` 的 `get_singer_detail_info` 拿简介（`singer_brief`）、热门歌曲、专辑；
   - 两份资料合并成上下文，资料都没有才回退成「无平台资料」；
1. 先核实名字是否对应**真实存在**的 K-POP 团体或艺人；
2. 确认存在才输出档案，且出道时间、公司、成员、代表作以公开资料为准，不确定的字段写「不详」或省略；
3. 无法确认时只回「暂未收录」，不输出档案结构，**绝不虚构歌手、成员、公司、年份或作品**；
4. 前端在 AI 生成的内容上标注「**AI 检索生成**」，并在档案区上方提示「由 AI 检索公开资料整理，如有出入以官方为准」。

### 关于 FlexCarousel

首页搜索框下方的 3D 轮播在 [public/js/flex-carousel.js](public/js/flex-carousel.js)，是从 React + ogl 的
FlexCarousel 源码逐行移植的原生 ES module：

- 着色器（卡片圆角遮罩 / 液体透镜 / 色散）、弹簧物理、拖拽惯性、滚轮、方向键、点击聚焦、
  `rise` 入场动画、`liquid` 预设参数全部保留；
- 唯一差异：用命令式 DOM 更新代替 React state，`DEFAULT_ITEMS` 置空——卡片数据必须来自
  `data/songs.json`（歌曲 MV），仓库里不存在任何示例雕塑图；
- 只在首页挂载；详情页不加载这个组件，顶部保持「当前团体自己的歌手照片」；
- WebGL2 不可用或 `ogl` 未安装时，自动降级为图片墙（`.cover-fallback`），不白屏。

### 图片来源与版权

`data/kpop_images.json` 里的图片来自 B 站公开视频封面（`i0.hdslb.com` / `i1.hdslb.com`）与
网易云音乐专辑封面（`p1.music.126.net` 等），均为国内可直连地址，仅用于个人作品集展示。
版权归原视频作者与版权方所有；如果要长期公开部署，建议替换为你拥有授权的素材。

### B 站链接与合规

歌曲页与档案页的「B 站跳转」都只做**跳转**：

- 档案页「热门歌曲」每首歌 → 曲库里有 `bvid` 时打开 `https://www.bilibili.com/video/<bvid>`；没有就回退到
  `https://search.bilibili.com/all?keyword={歌名} {歌手}`，保证每首歌都能跳；
- 歌曲详情页（首页热门视频进入）的「去 B 站看视频」→ 同样优先 `bvid`，没有则回退搜索页；
- 不下载、不转存、不嵌播第三方视频文件，播放与版权由 B 站 / 上传方处理。

### 封面与图片优先级

- 首页的 3D 轮播：封面来自 `data/songs.json`（MV 封面），经 `/api/img` 同源代理加载；
  加载失败或 WebGL2 不可用时降级成图片墙；
- 歌手页顶部：优先 `data/groups.json` 的 `cover`，没有则由前端向 `/api/cover` 取**当前这个歌手**的网易云头像，
  再没有才用渐变占位 + 团体名；
- `og:image` 仍由 `data/groups.json` 的 `cover` 提供（没配就不输出该标签）。

---

## 常见问题

**端口被占用**
换端口：`PORT=4322 npm start`（PowerShell：`$env:PORT=4322; npm start`）。

**轮播显示成一格格图片，没有 3D 效果**
说明 WebGL2 不可用或没执行 `npm install`（缺 `node_modules/ogl`）。执行 `npm install` 后重启；
仍不行的话浏览器需支持 WebGL2（Chrome/Edge 默认支持，可在 `chrome://gpu` 确认）。

**提示「无法连接 AI 接口」**
检查网络与 `AI_BASE_URL`；企业代理需要走网关时，把网关地址填进去。

**提示「API Key 无效或已过期」**
确认 `.env.local` 里的 `AI_API_KEY` 没有多余空格或引号，改完要重启进程。

**一直显示 DEMO**
`AI_API_KEY` 为空，或 `DEMO_MODE=1`，或改了 `.env.local` 但没重启。

**Windows 下 `cp` 报错**
用 `Copy-Item .env.example .env.local`。

---

## 提交到 Git

```bash
git init
git add .
git commit -m "feat: K-POP 入坑档案助手（流式生成）"
git branch -M main
git remote add origin <你的仓库地址>
git push -u origin main
```

`.env.local` 已在 `.gitignore` 中，`git status` 不会显示它；提交前可以用
`git status --short` 再确认一次没有密钥文件。

---

## License

MIT
